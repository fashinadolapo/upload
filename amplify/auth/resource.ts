import { defineAuth } from "@aws-amplify/backend";

// Minimal auth setup - only needed for Amplify backend structure
// Guests won't actually use authentication
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
