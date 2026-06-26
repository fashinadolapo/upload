import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';

// Simple backend - no complex Lambda functions
const backend = defineBackend({
  auth,
  data,
  storage,
});

// Simple configuration for unlimited uploads
backend.addOutput({
  custom: {
    // No file size limits - unlimited uploads
    uploadConfig: {
      unlimited: true,
      allowedTypes: [
        // Images
        "image/jpeg", "image/jpg", "image/png", "image/webp", 
        "image/heic", "image/heif", "image/gif", "image/bmp",
        
        // Videos  
        "video/mp4", "video/mov", "video/avi", "video/mkv", 
        "video/webm", "video/wmv", "video/m4v", "video/3gp",
        
        // Raw formats
        "image/x-canon-cr2", "image/x-nikon-nef", "image/x-sony-arw"
      ],
    },
    
    // Basic CORS for web uploads
    corsConfig: {
      allowedOrigins: ["*"], // Restrict to your domain in production
      allowedMethods: ["GET", "PUT", "POST", "HEAD", "DELETE"],
      allowedHeaders: ["*"],
      maxAgeSeconds: 86400,
    },
    
    // Performance optimizations
    performance: {
      useAccelerateEndpoint: true,
      enableCompression: true,
    },
  },
});

export default backend;
