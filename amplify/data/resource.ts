import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  // ✅ GuestEntry - used by App.tsx main form submission
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
      mediaKeys: a.string().array(), // S3 object keys array
    })
    .authorization((allow) => [
      allow.guest().to(["create", "read"]),
    ]),

  // ✅ MediaItem - used by MediaUpload.tsx component
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
      allow.guest().to(["create", "read"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "iam",
  },
});