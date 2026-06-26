import { defineStorage } from "@aws-amplify/backend";

/**
 * Optimized storage with security controls, lifecycle management,
 * and performance enhancements for wedding media sharing.
 */
export const storage = defineStorage({
  name: "weddingMedia",
  access: (allow) => ({
    // Original media uploads - guest access
    "media/uploads/*": [
      allow.guest.to(["read", "write"]),
      allow.authenticated.to(["read"]),
    ],
    
    // Processed/optimized media - read-only for guests
    "media/processed/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
    ],
    
    // Thumbnails - public read access
    "media/thumbnails/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
    ],
    
    // Private admin area
    "admin/*": [
    ],
  }),
});

// Additional S3 configuration (to be applied via CDK or CloudFormation)
export const storageConfig = {
  // Lifecycle rules for cost optimization
  lifecycleRules: [
    {
      id: "OptimizeStorage",
      status: "Enabled",
      transitions: [
        {
          days: 30,
          storageClass: "STANDARD_IA", // Move to Infrequent Access after 30 days
        },
        {
          days: 90,
          storageClass: "GLACIER", // Archive after 90 days
        },
      ],
    },
  ],
  
  // CORS configuration for web uploads
  corsRules: [
    {
      allowedHeaders: ["*"],
      allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
      allowedOrigins: ["*"], // Restrict to your domain in production
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3000,
    },
  ],
  
  // Server-side encryption
  encryption: {
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: "AES256",
        },
      },
    ],
  },
  
  // Public access block (security)
  publicAccessBlock: {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  },
};
