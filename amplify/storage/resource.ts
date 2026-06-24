import { defineStorage } from "@aws-amplify/backend";

/**
 * Single bucket for all wedding photos/videos. Everything lives under the
 * `media/` prefix. Guests (no sign-in) can upload, read, and delete only
 * within that prefix — this is what replaces the manual S3 console/bucket
 * policy work; Amplify generates the IAM policy on the unauthenticated
 * role from this declaration.
 */
export const storage = defineStorage({
  name: "weddingMedia",
  access: (allow) => ({
    "media/*": [
      allow.guest.to(["read", "write", "delete"]),
    ],
  }),
});
