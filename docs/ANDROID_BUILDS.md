# Android builds with EAS

## Preview APK
1. Install EAS CLI: `npm install --global eas-cli`.
2. Sign in: `eas login`.
3. Link the repository to the ChitChat Expo project: `eas build:configure`.
4. Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the EAS environment used by preview builds.
5. Build an installable APK: `eas build --platform android --profile preview`.

## Production Android App Bundle
Use `eas build --platform android --profile production`. The production profile creates an AAB for Play Console upload.

## Important
- Do not commit a real `.env` file.
- Only the Supabase publishable key belongs in the mobile application. Do not add a service-role or secret key to EAS environment variables exposed to the client.
- The app can run its local demo without Supabase. Authentication, account profiles, username discovery, blocking, and direct-conversation setup require the dedicated ChitChat Supabase project.
- The current EAS file does not contain a project ID. `eas build:configure` links it to the EAS project associated with your account.
- The current direct-message screen remains read-only. An APK does not mean end-to-end encryption is ready.


## Device security

The app uses `expo-local-authentication` for the app lock. SDK 58's documented package version is `~58.0.3`. A development or release build is required for native authentication testing; validate biometric and device PIN/passcode fallback on physical devices. Face ID requires the configured `NSFaceIDUsageDescription` permission string.
