import { defineFunction } from "@aws-amplify/backend";

/**
 * Blocks Cognito sign-up unless the email is one of the couple accounts.
 * ALLOWED_ADMIN_EMAILS is a comma-separated allowlist.
 */
export const preSignUp = defineFunction({
  name: "pre-sign-up",
  entry: "./handler.ts",
  environment: {
    ALLOWED_ADMIN_EMAILS:
      "dolapofashina@gmail.com,awoyinfaolanrewaju@gmail.com",
  },
});
