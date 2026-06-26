import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "weddingMedia",
  access: (allow) => ({
    // ✅ FIXED: Matches exact paths used in App.tsx and MediaUpload.tsx
    // App.tsx uploads to: media/${uniqueStorageKey}
    // MediaUpload.tsx uploads to: media/${uniqueKey}
    "media/*": [
      allow.guest.to(["read", "write"]),
      allow.authenticated.to(["read", "write", "delete"]),
    ],

    // ✅ Processed/optimized versions - future use
    "media/processed/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
    ],

    // ✅ Thumbnails - future use
    "media/thumbnails/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
    ],

    // ✅ Admin area - authenticated only
    "admin/*": [
      allow.authenticated.to(["read", "write", "delete"]),
    ],
  }),
});