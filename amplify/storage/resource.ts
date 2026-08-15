import { defineStorage } from "@aws-amplify/backend";

/**
 * Guests may upload & read wedding media.
 * Authenticated couple accounts get full management including delete.
 */
export const storage = defineStorage({
  name: "weddingMedia",
  access: (allow) => ({
    "media/*": [
      allow.guest.to(["read", "write"]),
      allow.authenticated.to(["read", "write", "delete"]),
    ],
    "media/processed/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read", "write", "delete"]),
    ],
    "media/thumbnails/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read", "write", "delete"]),
    ],
    "admin/*": [allow.authenticated.to(["read", "write", "delete"])],
  }),
});
