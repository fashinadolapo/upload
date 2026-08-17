# Production deployment guide

## What was production-wired

### Auth (Cognito)
- Admin vault uses **AWS Cognito email/password** via Amplify Gen 2 Auth.
- Only these emails may sign up / administer:
  - `dolapofashina@gmail.com`
  - `awoyinfaolanrewaju@gmail.com`
- Enforced in:
  1. Frontend allowlist (`src/config/constants.ts`)
  2. Cognito **preSignUp** Lambda (`amplify/auth/pre-sign-up`)
- Default bootstrap password: `dolan26` (never shown in UI).
- First successful login with the default password **forces a password change**.
- Forgot password uses **real Cognito email codes**.
- Both couple emails can stay signed in on separate devices simultaneously.

### Data authorization
- Guests (IAM unauthenticated): **create only** on `GuestEntry` / `MediaItem`.
- Authenticated couple: full **read/update/delete** for the admin vault.
- Admin list uses `authMode: "userPool"`.

### Storage and public gallery
- Guests: list/read/write `media/*`
- The Gallery page anonymously lists the direct objects in `media/`, creates temporary read-only preview URLs, and creates fresh attachment URLs for downloads.
- Anyone with the portal link can therefore view and download all wedding photos/videos. Guest messages, emails, and other form answers remain private to authenticated admins.
- Authenticated couple accounts: read/write/delete + private `admin/*`. Only authenticated admins can delete media through the interface.

### Hosting hardening (`amplify.yml`)
- HSTS, nosniff, SAMEORIGIN frame, referrer policy, permissions policy
- Long-cache hashed assets; no-cache `index.html`

## Deploy to `main`

1. Merge this branch to `main`.
2. Amplify Hosting runs:
   - `npx ampx pipeline-deploy` (backend)
   - `npm run build` (frontend)
3. After first deploy of the new auth trigger, create couple accounts by signing in once with:
   - Email: one of the allowlisted addresses
   - Password: `dolan26`
   - Then set a personal password when prompted.

### Optional: pre-create users in Cognito console
You can also create both users in the Cognito User Pool console with temporary password `dolan26` and force change on first login. The app handles the `NEW_PASSWORD_REQUIRED` challenge.

## Local development

```bash
npm ci
npx ampx sandbox   # optional: live backend
npm run dev
```

Without sandbox, the app uses committed `amplify_outputs.json` pointing at the deployed backend.

## Security notes

- Guest form submissions (names, emails, stories, and wishes) are not publicly readable; only authenticated admins can list them.
- Wedding media is intentionally public to anyone with the portal link. Rotate the storage policy or take the portal offline after the sharing window if that is no longer desired.
- Passwords are never stored in `localStorage` (only a “must change password” flag).
- Recovery codes are emailed by Cognito; they are not displayed on-screen.
- Rotate couple passwords after the wedding if the portal stays online.
