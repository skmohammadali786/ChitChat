# ChitChat backend setup

The dedicated project is `roqostmesaxplurzjoin` at `https://roqostmesaxplurzjoin.supabase.co`.

## Live schema
- Profiles with opt-in username discovery.
- Conversations and conversation membership.
- Ciphertext-only message envelopes.
- Device public-key registry.
- Message reactions and user blocks.
- Private abuse reports and username-lookup rate limits.
- Private avatar and message-media metadata. Binary media bytes live in private Cloudflare R2, not Supabase Storage.
- Row Level Security on exposed application tables.
- Privileged RPC implementations live in the unexposed `private` schema. Public functions are invoker wrappers.

## Local development
1. Use Node.js 22.13 or newer.
2. Copy `.env.example` to `.env`.
3. Install dependencies with `npm install`. A committed lockfile is still required before a reproducible release build.
4. Start with `npx expo start`.

Only the publishable Supabase key belongs in the mobile app. Never place a service-role or secret key in the app bundle.

## Security boundary
The database stores message envelopes containing ciphertext, nonce, cryptographic metadata, and key version. The Rust crate currently validates structure only. It does not encrypt, decrypt, authenticate a device, or establish an end-to-end secure session. Real conversation sending remains disabled until a reviewed protocol and native Rust bridge are implemented and verified on both platforms.

## Cloudflare media storage
See [Cloudflare R2 media storage](CLOUDFLARE_MEDIA.md). The private `chitchat-media` R2 bucket is accessed through the authenticated `chitchat-media-api` Worker. Supabase stores metadata and enforces conversation membership through RLS.

## Push notifications
The `notify-message` Edge Function is deployed with JWT verification enabled. It sends generic alerts only, never message plaintext or encryption keys. The Expo app needs `EXPO_PUBLIC_EAS_PROJECT_ID` configured after `eas init` before token registration can work. Expo push credentials and real-device delivery still need setup and verification.


## Migration reproducibility warning

The live project records the initial migrations `20261112180603` through `20261112182101`, but those five SQL files are not currently present in `supabase/migrations` on this branch. Their baseline schema is represented in the two setup scripts:
1. Run `supabase/setup/profiles.sql`.
2. Run `supabase/setup/messaging.sql`.
3. Apply the tracked migration files in timestamp order.

This is a bootstrap workaround, not a clean migration history. Before a fresh-project release or a standard `supabase db push`, the original baseline migrations must be reconstructed and committed so the database can be created from migration history alone.
