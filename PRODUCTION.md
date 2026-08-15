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

### Storage
- Guests: read/write `media/*`
- Authenticated: read/write/delete + private `admin/*`

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

- Guest **read** of all submissions is no longer public — only authenticated admins can list.
- Passwords are never stored in `localStorage` (only a “must change password” flag).
- Recovery codes are emailed by Cognito; they are not displayed on-screen.
- Rotate couple passwords after the wedding if the portal stays online.
