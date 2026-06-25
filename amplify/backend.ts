import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'weddingMediaBucket',
  access: (allow) => ({
    'media/*': [
      // Allows guests/everyone to drop photos and read them back in the gallery feed
      allow.guest.to(['read', 'write']),
    ]
  })
});