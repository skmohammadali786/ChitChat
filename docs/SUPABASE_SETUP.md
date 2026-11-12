# ChitChat Supabase setup

ChitChat currently uses Supabase Auth for email/password accounts and Postgres for private profile records. Mobile auth sessions are persisted through Expo SecureStore. Web uses a separate IndexedDB-backed storage adapter. The repository does not create or select a hosted Supabase project automatically.

## 1. Create a dedicated Supabase project
Create a new project named `ChitChat` in your Supabase organization. Do not reuse Momently or MT Learning. For users primarily in India, Mumbai (`ap-south-1`) is a sensible starting region. Choose a region based on where your first users will be located.

## 2. Create the profiles table
Open the new project's SQL Editor. Copy and run the contents of [profiles.sql](../supabase/setup/profiles.sql).

The table stores only a profile's username, display name, optional bio, and avatar URL. Row Level Security is enabled. The current policy lets an authenticated user read and change only their own profile. Anonymous access is revoked.

## 3. Expose the table through the Data API
New Supabase projects created after the October 30, 2026 Data API change do not automatically expose new public-schema tables. In the project's Data API settings, explicitly expose `public.profiles`. Keep the RLS policies and SQL grants in place. API exposure and row-level authorization are separate controls.

## 4. Configure email authentication
In Authentication settings:
- Enable the Email provider.
- Keep email confirmation enabled for real users.
- Add `chitchat://auth/callback` to the allowed redirect URLs.
- Configure a production SMTP provider before launch so account emails are reliable.

The app handles code-based callbacks, token-hash verification links, and access/refresh tokens returned in the callback URL.

## 5. Add client credentials
Copy the Project URL and the Publishable key from the project's Connect dialog or API Keys settings. Copy `.env.example` to `.env` and set:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Only the publishable client key belongs in the mobile app. Never add a `service_role` key or an `sb_secret_` key to an Expo public environment variable or commit it to Git. On Android and iOS, the Supabase session is stored in Expo SecureStore. The storage adapter splits larger session values into smaller secure chunks because some iOS Keychain versions reject large individual values.

Restart Expo after changing environment variables.

## 6. Run and test
Use Node.js 22.13 or newer for Expo SDK 58.

```bash
npm install
npx expo install --fix
npx expo-doctor
npx expo start
```

Test on a development build or a compatible Expo Go release:
1. Create an account with a valid email and a unique username.
2. Confirm the email using the link on the same device.
3. Sign in if the confirmation flow returns to the sign-in screen.
4. Complete the profile.
5. Close and reopen the app. The session should persist.
6. Sign out and confirm the app returns to the authentication screen.

## Current limits
The profile table is private by default. Username discovery, public profile browsing, profile photo upload, password recovery, message persistence, realtime delivery, and end-to-end encryption are not part of this phase. Add explicit, reviewed policies before introducing public profile search or contact discovery.
