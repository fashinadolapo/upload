import { defineAuth } from "@aws-amplify/backend";

/**
 * Guests (unauthenticated visitors) are the only "users" of this app —
 * nobody signs in. Amplify still needs an Identity Pool to hand out
 * scoped, temporary IAM credentials to anonymous visitors, which is what
 * lets the frontend call S3 / AppSync directly without a custom backend.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});

// Note: Amplify Gen 2 always provisions an unauthenticated ("guest") IAM
// role on the Identity Pool created here. We don't grant it anything in
// this file — guest permissions are scoped per-resource via allow.guest()
// in amplify/storage/resource.ts and amplify/data/resource.ts.
