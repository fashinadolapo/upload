# Design: Production-Grade Amplify Optimization for Wedding Photo Sharing App

## Current Architecture Analysis

### Technology Stack
- **Frontend**: React 19 + TypeScript + Tailwind CSS 4
- **Build Tool**: Vite 7 with single-file output plugin
- **Backend**: AWS Amplify (Auth, Data, Storage)
- **Database**: DynamoDB via Amplify Data (AppSync)
- **Storage**: S3 bucket via Amplify Storage
- **Deployment**: AWS Amplify Hosting

### Current State Issues
1. **Bundle Size**: Single-file build may create large initial bundle
2. **No Code Splitting**: All code loaded upfront
3. **Limited Build Optimization**: Basic Vite config
4. **No Environment Separation**: Single configuration approach
5. **Basic Error Handling**: Console logging only
6. **No Performance Monitoring**
7. **Limited Security Configuration**: Basic Amplify defaults

## Design Goals

### Performance
1. **Bundle Size Reduction**: Target < 200KB initial bundle
2. **Core Web Vitals**: Achieve LCP < 2.5s, FID < 100ms, CLS < 0.1
3. **Code Splitting**: Lazy load non-critical components
4. **Image Optimization**: Implement modern formats and lazy loading

### Security
1. **Environment Separation**: Development/Production configurations
2. **Security Headers**: Implement CSP, HSTS, X-Frame-Options
3. **Input Validation**: Server-side and client-side validation
4. **Amplify Security Best Practices**: Least privilege access

### Reliability
1. **Error Boundaries**: Graceful error handling
2. **Retry Logic**: For API and upload failures
3. **Monitoring**: Error tracking and performance monitoring
4. **Fallback UI**: User-friendly error states

### Build & Deployment
1. **Optimized Vite Config**: For Amplify deployment
2. **Caching Strategy**: Proper cache headers and service worker
3. **Build Time Optimization**: Parallel builds and incremental compilation
4. **Environment Variables**: Secure configuration management

## Technical Architecture

### 1. Build System Optimization

#### Vite Configuration Enhancements
```typescript
// New optimized vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { compression } from 'vite-plugin-compression'
import { visualizer } from 'rollup-plugin-visualizer'
import { splitVendorChunkPlugin } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    splitVendorChunkPlugin(),
    compression({ algorithm: 'gzip' }),
    compression({ algorithm: 'brotli' }),
    mode === 'analyze' && visualizer({ open: true }),
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'aws-amplify'],
          ui: ['qrcode.react'],
          utils: ['browser-image-compression'],
        }
      }
    },
    sourcemap: mode === 'development',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production',
        drop_debugger: mode === 'production',
      }
    }
  }
}))
```

#### Build Optimization Features
- **Code Splitting**: Vendor, UI, and utility chunks
- **Tree Shaking**: Remove unused imports
- **Minification**: Production-only console removal
- **Source Maps**: Development-only for debugging
- **Bundle Analysis**: Visual bundle analyzer plugin

### 2. Component Architecture

#### Lazy Loading Strategy
```typescript
// Lazy load non-critical components
const GalleryPage = lazy(() => import('./components/GalleryPage'))
const AdminPanel = lazy(() => import('./components/AdminPanel'))
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'))

// Route-based code splitting
const routes = [
  {
    path: '/',
    element: <UploadPage />, // Critical - load immediately
  },
  {
    path: '/gallery',
    element: (
      <Suspense fallback={<LoadingSpinner />}>
        <GalleryPage />
      </Suspense>
    ),
  }
]
```

#### Error Boundary Implementation
```typescript
class UploadErrorBoundary extends React.Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    // Send to error monitoring service
    logErrorToService(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return <UploadErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}
```

### 3. Amplify Optimization

#### Environment-Based Configuration
```typescript
// src/config/amplify.ts
const getAmplifyConfig = () => {
  const env = import.meta.env.MODE
  
  const baseConfig = {
    Auth: {
      region: import.meta.env.VITE_AWS_REGION,
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolWebClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
    Storage: {
      S3: {
        region: import.meta.env.VITE_AWS_REGION,
        bucket: import.meta.env.VITE_S3_BUCKET,
      }
    }
  }

  // Development-specific overrides
  if (env === 'development') {
    return {
      ...baseConfig,
      ssr: false,
      // Local development settings
    }
  }

  // Production-specific optimizations
  return {
    ...baseConfig,
    Analytics: {
      disabled: false,
      autoSessionRecord: true,
    }
  }
}
```

#### Amplify Storage Optimization
```typescript
// Optimized upload with retry logic
const uploadWithRetry = async (file: File, key: string, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await uploadData({
        path: `media/${key}`,
        data: await optimizeFile(file),
        options: {
          contentType: file.type,
          onProgress: (progress) => updateProgress(progress),
          resumable: true, // Enable resumable uploads
        }
      })
      return result
    } catch (error) {
      if (attempt === maxRetries) throw error
      await delay(attempt * 1000) // Exponential backoff
    }
  }
}
```

### 4. Performance Optimizations

#### Image Optimization Pipeline
```typescript
// Advanced image optimization
const optimizeImage = async (file: File) => {
  const options = {
    maxSizeMB: import.meta.env.MODE === 'production' ? 1.0 : 2.0,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    initialQuality: 0.8,
    fileType: 'image/webp', // Modern format
    preserveExif: false,
  }

  try {
    return await imageCompression(file, options)
  } catch (error) {
    // Fallback to basic compression
    return await imageCompression(file, {
      maxSizeMB: 2.0,
      maxWidthOrHeight: 2560,
      useWebWorker: true,
    })
  }
}
```

#### Lazy Loading Images
```typescript
// src/components/LazyImage.tsx
const LazyImage = ({ src, alt, className }) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (imgRef.current?.complete) {
      setIsLoaded(true)
    }
  }, [])

  return (
    <div className={`lazy-image ${className}`}>
      {!isLoaded && <SkeletonLoader />}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setIsLoaded(true)}
        className={isLoaded ? 'loaded' : 'loading'}
      />
    </div>
  )
}
```

### 5. Security Implementation

#### Security Headers (Amplify.yml)
```yaml
frontend:
  phases:
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  customHeaders:
    - pattern: '**/*'
      headers:
        - key: 'Strict-Transport-Security'
          value: 'max-age=31536000; includeSubDomains'
        - key: 'Content-Security-Policy'
          value: "default-src 'self'; img-src 'self' data: https://*.amazonaws.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
        - key: 'X-Frame-Options'
          value: 'DENY'
        - key: 'X-Content-Type-Options'
          value: 'nosniff'
```

#### Input Validation Layer
```typescript
// src/utils/validation.ts
export const validateFileUpload = (file: File) => {
  const maxSize = 50 * 1024 * 1024 // 50MB
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
  
  if (file.size > maxSize) {
    throw new Error(`File size exceeds ${formatBytes(maxSize)} limit`)
  }
  
  if (!allowedTypes.includes(file.type)) {
    throw new Error('File type not supported')
  }
  
  // Additional security checks
  if (file.name.includes('..') || file.name.includes('/')) {
    throw new Error('Invalid file name')
  }
  
  return true
}
```

### 6. Monitoring & Observability

#### Error Tracking Setup
```typescript
// src/utils/monitoring.ts
export const initMonitoring = () => {
  if (import.meta.env.MODE === 'production') {
    // Initialize Amplify Analytics
    Analytics.autoTrack('session', {
      enable: true,
      attributes: {
        appName: 'wedding-photo-sharing',
        environment: 'production',
      }
    })
    
    // Error boundary integration
    window.addEventListener('error', (event) => {
      Analytics.record({
        name: 'frontend_error',
        attributes: {
          message: event.error?.message,
          stack: event.error?.stack,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        }
      })
    })
  }
}
```

#### Performance Monitoring
```typescript
// src/hooks/usePerformance.ts
export const usePerformance = () => {
  useEffect(() => {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'largest-contentful-paint') {
          Analytics.record({
            name: 'lcp_metric',
            attributes: {
              value: entry.startTime,
              url: window.location.href,
            }
          })
        }
      }
    })
    
    observer.observe({ entryTypes: ['largest-contentful-paint'] })
    
    return () => observer.disconnect()
  }, [])
}
```

## Implementation Phases

### Phase 1: Build & Infrastructure (Week 1)
- [ ] Optimize Vite configuration
- [ ] Implement code splitting
- [ ] Set up environment variables
- [ ] Configure Amplify build pipeline
- [ ] Add security headers

### Phase 2: Core Optimization (Week 2)
- [ ] Implement error boundaries
- [ ] Add retry logic for uploads
- [ ] Optimize image compression pipeline
- [ ] Add lazy loading components
- [ ] Implement proper caching

### Phase 3: Monitoring & Security (Week 3)
- [ ] Set up error monitoring
- [ ] Add input validation
- [ ] Implement performance monitoring
- [ ] Add security headers and CSP
- [ ] Set up analytics

### Phase 4: Production Readiness (Week 4)
- [ ] Performance testing
- [ ] Security audit
- [ ] Load testing
- [ ] Rollback procedures
- [ ] Documentation

## Success Metrics

### Performance Targets
- Initial bundle size: < 200KB (gzipped)
- Largest Contentful Paint: < 2.5s
- First Input Delay: < 100ms
- Cumulative Layout Shift: < 0.1
- Upload success rate: > 99%

### Reliability Targets
- Error rate: < 0.1%
- Uptime: 99.9%
- Mean Time To Recovery: < 15 minutes
- Data loss rate: 0%

### Security Targets
- Security headers: 100% coverage
- Input validation: All user inputs
- Access control: Least privilege principle
- Audit logging: All critical operations

## Dependencies & Risks

### Dependencies
1. AWS Amplify services availability
2. Browser compatibility (modern browsers)
3. Network connectivity for uploads
4. Storage costs for media files

### Risks & Mitigations
1. **Large file upload failures**: Implement chunked uploads and retry logic
2. **Amplify service limits**: Monitor usage and implement rate limiting
3. **Cost overruns**: Implement usage alerts and storage policies
4. **Security vulnerabilities**: Regular security audits and updates

## Future Considerations

### Scalability Enhancements
- CDN integration for media files
- Multi-region deployment
- Database read replicas
- Auto-scaling configurations

### Feature Enhancements
- Real-time notifications
- Advanced search capabilities
- Bulk download functionality
- Admin analytics dashboard

### Technical Debt Management
- Regular dependency updates
- Performance regression testing
- Security vulnerability scanning
- Code quality metrics tracking

## Conclusion

This design provides a comprehensive roadmap for optimizing the wedding photo sharing application for production-grade deployment with AWS Amplify. By implementing these optimizations, the application will achieve better performance, enhanced security, improved reliability, and easier maintainability while leveraging the full capabilities of the Amplify platform.

The phased approach allows for incremental improvements while maintaining application stability, with clear success metrics to measure progress throughout the optimization process.