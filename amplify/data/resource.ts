import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * Simple schema for tracking uploaded media without requiring user accounts.
 * Just basic metadata for organizing and displaying photos/videos.
 */
const schema = a.schema({
  MediaItem: a
    .model({
      // Basic file information
      fileName: a.string().required(),
      fileKey: a.string().required(), // S3 object key
      fileType: a.string().required(), // image/jpeg, video/mp4, etc.
      fileSize: a.integer().required(),
      
      // Optional guest info (if they want to share)
      uploaderName: a.string(),
      message: a.string(),
      
      // Automatic timestamps
      uploadedAt: a.datetime().default("now"),
      
      // Simple moderation flag
      isVisible: a.boolean().default(true),
    })
    .authorization((allow) => [
      // Anyone can create, read - no authentication required
      allow.guest().to(["create", "read"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "iam",
  },
});
