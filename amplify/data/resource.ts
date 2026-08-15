import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * Production data rules:
 * - Guests (public / IAM unauth): can CREATE guest entries & media metadata only
 * - Authenticated couple accounts: full read/manage access for the admin vault
 */
const schema = a.schema({
  GuestEntry: a
    .model({
      names: a.string().required(),
      email: a.string(),
      relation: a.string().required(),
      attendance: a.string().required(),
      highlight: a.string(),
      rating: a.integer().required(),
      story: a.string().required(),
      suggestions: a.string(),
      mediaKeys: a.string().array(),
    })
    .authorization((allow) => [
      allow.guest().to(["create"]),
      allow.authenticated().to(["create", "read", "update", "delete"]),
    ]),

  MediaItem: a
    .model({
      fileName: a.string().required(),
      fileKey: a.string().required(),
      fileType: a.string().required(),
      fileSize: a.integer().required(),
      uploaderName: a.string(),
      message: a.string(),
      uploadedAt: a.datetime(),
      isVisible: a.boolean(),
      uploadStatus: a.string(),
    })
    .authorization((allow) => [
      allow.guest().to(["create"]),
      allow.authenticated().to(["create", "read", "update", "delete"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Guest uploads use IAM (unauthenticated identity pool role).
    // Admin vault uses Cognito user pools after sign-in.
    defaultAuthorizationMode: "iam",
  },
});
