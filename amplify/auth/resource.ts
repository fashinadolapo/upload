import { defineAuth } from "@aws-amplify/backend";

/**
 * Provision an Identity Pool to hand out scoped, temporary IAM credentials 
 * to anonymous wedding guests without requiring a login interface.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});