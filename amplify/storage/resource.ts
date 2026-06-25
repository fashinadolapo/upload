import { defineStorage } from "@aws-amplify/backend";

/**
 * Single bucket for all wedding photos/videos. Everything lives under the
 * `media/` prefix. Guests (no sign-in) can upload, read, and delete only
 * within that prefix.
 */
export const storage = defineStorage({
  name: "weddingMedia",
  access: (allow) => ({
    "media/*": [
      allow.guest.to(["read", "write"]),
    ],
  }),
});
