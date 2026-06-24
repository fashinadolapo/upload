import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * One record per guest submission. mediaKeys holds the S3 object keys
 * (under media/) that this guest uploaded, so the gallery can group
 * thumbnails by who shared them and still let anyone browse/download
 * everything in one shared feed.
 *
 * allow.guest() on both create and read means no sign-in is required —
 * matches the no-auth, single-shared-gallery requirement.
 */
const schema = a.schema({
  GuestEntry: a
    .model({
      names: a.string().required(),
      email: a.string(),
      relation: a.string(),
      attendance: a.string(),
      highlight: a.string(),
      rating: a.integer(),
      story: a.string(),
      suggestions: a.string(),
      mediaKeys: a.string().array(),
    })
    .authorization((allow) => [allow.guest().to(["create", "read"])]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "identityPool",
  },
});
