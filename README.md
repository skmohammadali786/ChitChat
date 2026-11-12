# ChitChat

ChitChat is an Android-first, privacy-focused messaging app. Its signature feature lets people conceal text or media and gives recipients control over when secret content is revealed.

## Stack
- Expo SDK 58, React Native 0.88, React 19.3, TypeScript
- Supabase Auth and Postgres for accounts and profiles
- Astryx-informed in-house design conventions, without importing Astryx as a runtime dependency

## Run locally
1. Use Node.js 22.13 or newer.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and add your ChitChat Supabase project URL and publishable key.
4. Start the app: `npx expo start`.
5. Use a development build for device testing.

Without Supabase credentials, the app opens in local demo mode. Demo messages are not stored remotely.

## Authentication setup
Follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md), then set the Supabase URL and publishable key in your environment. Configure `chitchat://auth/callback` as an allowed redirect URL in Supabase Auth.

## Current implementation
- Chat list, local message composer, secret reveal and re-hide interaction.
- Light and dark appearance and recipient auto-reveal preference.
- Supabase email/password sign-up and sign-in with mobile auth sessions stored in Expo SecureStore.
- Email confirmation deep-link handling.
- Profile onboarding with username validation and a private profile record.
- Demo mode remains available without backend credentials.

## Not implemented yet
This build does not yet provide cloud message delivery, media uploads, push notifications, or end-to-end encryption. The UI does not claim messages are encrypted. The encryption protocol and key lifecycle must be implemented and reviewed before describing ChitChat as an end-to-end encrypted messenger.

## Product and engineering documents
- [Product blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
