import { defineAuth } from "@aws-amplify/backend";
import { preSignUp } from "./pre-sign-up/resource";

/**
 * Production Cognito auth for the couple admin vault only.
 * Guest uploads stay unauthenticated (IAM identity pool guest role).
 *
 * Password policy is relaxed in backend.ts (CDK override) so the shared
 * bootstrap password `dolan26` is accepted, then the app forces a change.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  accountRecovery: "EMAIL_ONLY",
  groups: ["ADMINS"],
  triggers: {
    preSignUp,
  },
});
