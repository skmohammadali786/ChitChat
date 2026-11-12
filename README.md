# ChitChat

ChitChat is an Android-first, privacy-focused messaging app. Its signature feature lets people conceal text or media and gives recipients control over when secret content is revealed.

## Stack
- Expo SDK 58, React Native 0.88, React 19.3, TypeScript
- Supabase Auth, Postgres, and Realtime foundations
- Astryx-informed in-house design conventions, without importing Astryx as a runtime dependency

## Run locally
1. Use Node.js 22.13 or newer.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and add your dedicated ChitChat Supabase project URL and publishable key.
4. Start the app: `npx expo start`.
5. Use a development build for device testing.

Without Supabase credentials, the app opens in local demo mode. Demo messages are not stored remotely.

## Implemented foundations
- Conversation list and local demo chat UI.
- Secret-message reveal and re-hide interaction.
- Light and dark appearance and recipient auto-reveal preference.
- Supabase email/password sign-up, sign-in, email confirmation callback, and password recovery.
- Encrypted mobile session persistence using Expo SecureStore.
- Profile onboarding and editing with username, display name, bio, and username-discovery preference.
- Account blocking and unblock management, enforced in username discovery and direct-message send policies.
- Exact username lookup, with a server-side per-user rate limit.
- Direct conversation creation and conversation list APIs.
- Conversation and ciphertext-only message table schema with membership-based RLS.
- Encrypted-message service interface and Realtime subscription interface.

## Backend setup
Follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) and run the SQL scripts in order:
1. [Profile setup](supabase/setup/profiles.sql)
2. [Messaging setup](supabase/setup/messaging.sql)

## Security status
End-to-end encryption is not implemented yet. The current message service accepts ciphertext envelopes only, but the app does not yet create or decrypt them. Real conversation message sending is intentionally disabled. Do not treat demo messages as encrypted, and do not add plaintext fallback.

See [security decisions](docs/SECURITY_DECISIONS.md) for protocol evaluation and release requirements.

## Product and design
- [Product blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Android build guide](docs/ANDROID_BUILDS.md)
