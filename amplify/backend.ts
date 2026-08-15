import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
});

// Allow the shared couple bootstrap password `dolan26` (8+ chars, letters+numbers)
// while still requiring a minimum of 8 characters. App forces password change
// after first login with the default.
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: false,
    requireUppercase: false,
    temporaryPasswordValidityDays: 7,
  },
};

backend.addOutput({
  custom: {
    uploadConfig: {
      maxVideoBytes: 5 * 1024 * 1024 * 1024,
      allowedTypes: [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
        "image/gif",
        "image/bmp",
        "video/mp4",
        "video/quicktime",
        "video/mov",
        "video/webm",
        "video/x-msvideo",
        "video/x-matroska",
      ],
    },
    app: {
      coupleNames: "Olanrewaju & Dolapo",
      hashtags: ["#morenikeji", "#dolan26", "#TheFashinas"],
      adminEmails: [
        "dolapofashina@gmail.com",
        "awoyinfaolanrewaju@gmail.com",
      ],
    },
  },
});

export default backend;
