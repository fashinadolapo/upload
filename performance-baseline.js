#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function measureBuildPerformance() {
  console.log('=== Build Performance Measurement ===');
  
  // Measure build time
  console.log('\n1. Measuring build time...');
  const startTime = Date.now();
  execSync('npm run build', { stdio: 'inherit' });
  const buildTime = Date.now() - startTime;
  
  // Analyze bundle size
  console.log('\n2. Analyzing bundle size...');
  const distPath = path.join(__dirname, 'dist');
  const files = fs.readdirSync(distPath);
  
  let totalSize = 0;
  const fileSizes = {};
  
  function getSizeRecursive(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    items.forEach(item => {
      const itemPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        getSizeRecursive(itemPath);
      } else {
        const stats = fs.statSync(itemPath);
        const sizeKB = stats.size / 1024;
        totalSize += sizeKB;
        const relativePath = path.relative(distPath, itemPath);
        fileSizes[relativePath] = {
          sizeKB: sizeKB.toFixed(2),
          sizeBytes: stats.size,
          extension: path.extname(itemPath)
        };
      }
    });
  }
  
  getSizeRecursive(distPath);
  
  // Calculate gzipped size estimation (rough)
  const estimatedGzipSize = totalSize * 0.25; // Rough estimation
  
  console.log(`Build time: ${(buildTime / 1000).toFixed(2)}s`);
  console.log(`Total bundle size: ${totalSize.toFixed(2)} KB`);
  console.log(`Estimated gzipped size: ${estimatedGzipSize.toFixed(2)} KB`);
  
  console.log('\nFile breakdown:');
  Object.entries(fileSizes)
    .sort(([, a], [, b]) => b.sizeBytes - a.sizeBytes)
    .slice(0, 10)
    .forEach(([file, info]) => {
      console.log(`  ${file}: ${info.sizeKB} KB (${info.sizeBytes} bytes)`);
    });
  
  return {
    buildTime: buildTime / 1000, // in seconds
    totalSizeKB: totalSize,
    estimatedGzipSizeKB: estimatedGzipSize,
    fileSizes
  };
}

async function measureDevServerPerformance() {
  console.log('\n=== Development Server Performance ===');
  
  console.log('\n3. Measuring dev server startup time...');
  const startTime = Date.now();
  
  try {
    // Start dev server in background
    const serverProcess = execSync('npm run dev &', { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const startupTime = Date.now() - startTime;
    console.log(`Dev server startup time: ${(startupTime / 1000).toFixed(2)}s`);
    
    // Kill the dev server
    execSync('pkill -f "vite"', { stdio: 'ignore' });
    
    return {
      startupTime: startupTime / 1000 // in seconds
    };
  } catch (error) {
    console.log('Error measuring dev server performance:', error.message);
    return { startupTime: null };
  }
}

async function analyzeDependencies() {
  console.log('\n=== Dependency Analysis ===');
  
  console.log('\n4. Analyzing dependencies...');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };
  
  console.log(`Total dependencies: ${Object.keys(dependencies).length}`);
  
  // Identify large dependencies
  const largeDeps = Object.keys(dependencies).filter(dep => 
    dep.includes('aws-amplify') || 
    dep.includes('react') ||
    dep.includes('typescript') ||
    dep.includes('tailwind')
  );
  
  console.log('\nKey dependencies:');
  largeDeps.forEach(dep => {
    console.log(`  ${dep}: ${dependencies[dep]}`);
  });
  
  return {
    totalDependencies: Object.keys(dependencies).length,
    keyDependencies: largeDeps.map(dep => ({ name: dep, version: dependencies[dep] }))
  };
}

async function generateBaselineReport() {
  console.log('=== Performance Baseline Measurement ===');
  console.log('Date:', new Date().toISOString());
  console.log('Node version:', process.version);
  
  const buildMetrics = await measureBuildPerformance();
  const devMetrics = await measureDevServerPerformance();
  const depMetrics = await analyzeDependencies();
  
  // Calculate performance scores
  const performanceScore = {
    buildTimeScore: buildMetrics.buildTime < 10 ? 'Good' : buildMetrics.buildTime < 20 ? 'Fair' : 'Poor',
    bundleSizeScore: buildMetrics.totalSizeKB < 500 ? 'Good' : buildMetrics.totalSizeKB < 1000 ? 'Fair' : 'Poor',
    estimatedGzipScore: buildMetrics.estimatedGzipSizeKB < 150 ? 'Good' : buildMetrics.estimatedGzipSizeKB < 300 ? 'Fair' : 'Poor',
    startupTimeScore: devMetrics.startupTime && devMetrics.startupTime < 3 ? 'Good' : devMetrics.startupTime && devMetrics.startupTime < 6 ? 'Fair' : 'Poor'
  };
  
  console.log('\n=== Performance Baseline Summary ===');
  console.log('Build Time:', `${buildMetrics.buildTime}s (${performanceScore.buildTimeScore})`);
  console.log('Bundle Size:', `${buildMetrics.totalSizeKB.toFixed(2)} KB (${performanceScore.bundleSizeScore})`);
  console.log('Estimated Gzipped Size:', `${buildMetrics.estimatedGzipSizeKB.toFixed(2)} KB (${performanceScore.estimatedGzipScore})`);
  if (devMetrics.startupTime) {
    console.log('Dev Server Startup:', `${devMetrics.startupTime}s (${performanceScore.startupTimeScore})`);
  }
  console.log('Total Dependencies:', depMetrics.totalDependencies);
  
  console.log('\n=== Optimization Opportunities ===');
  console.log('1. Single-file build creates large initial bundle');
  console.log('2. Consider implementing code splitting');
  console.log('3. Vendor chunk optimization needed');
  console.log('4. Image optimization pipeline required');
  console.log('5. Build time could be improved');
  
  // Save report to file
  const report = {
    timestamp: new Date().toISOString(),
    metrics: {
      build: buildMetrics,
      dev: devMetrics,
      dependencies: depMetrics
    },
    performanceScores: performanceScore,
    recommendations: [
      'Implement code splitting for better initial load',
      'Optimize vendor chunks for React and AWS Amplify',
      'Add image compression and lazy loading',
      'Improve build configuration for production',
      'Set up performance monitoring'
    ]
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'performance-baseline-report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log('\nReport saved to performance-baseline-report.json');
}

generateBaselineReport().catch(console.error);