# ChitChat build and integration status

## Configured
- Deployed authenticated Supabase Edge Function `notify-message` with JWT verification. It sends generic Expo push alerts only, checks message ownership and conversation recipients, honors notification-preview opt-out and revokes unregistered Expo tokens.
- Settings UI can request notification permission and register Expo push tokens. It requires `EXPO_PUBLIC_EAS_PROJECT_ID`, which must be filled after linking the Expo project.\n- Private Cloudflare R2 bucket `chitchat-media` in APAC Standard storage.\n- Deployed `chitchat-media-api` Worker with an R2 binding and Supabase JWT verification.\n- Public `r2.dev` access is disabled; unauthenticated Worker requests return an authentication error.\n- Supabase `media_objects` metadata table with RLS and crypto-version metadata.
- Group create/list/add/remove/rename/transfer-owner RPCs with server-side membership and role checks.
- Per-recipient delivery/read receipt rows, message-insert trigger, privacy-aware read RPCs and Realtime publication.
- User privacy/theme settings, per-conversation pin/mute/archive settings and push-device token registry.
- Encrypted scheduled-message envelope table and a verified `pg_cron` job that dispatches due rows once per minute.
- Private Realtime authorization policies for conversation channels, including online and typing privacy controls.
- Dedicated Supabase project URL and publishable client key.
- Expo Android and iOS identifiers and deep-link scheme.
- Rust workspace and platform-independent domain crate.
- Separate CI jobs for TypeScript/Expo and Rust tests.
- Rust bridge contract and fail-closed messaging guard.

## Not yet complete
- Group, receipts, settings, scheduled-message and push-device client services are present but are not yet fully wired into the screen UI.
- Scheduled messages are inserted by the database scheduler, but end-user scheduling and delivery flows still need Android/iOS integration tests.
- Push notifications have token registration only. No push-delivery Edge Function is deployed.
- Android JNI/UniFFI bridge implementation.
- iOS Swift/UniFFI bridge implementation.
- Native development builds for both platforms.
- A reviewed end-to-end encryption protocol and device-key lifecycle.
- Message encryption and decryption adapter.
- Integration tests with real authenticated users on Android and iOS.

## Honest release gate
The project must not be described as complete or end-to-end encrypted until the above steps pass on actual Android and iOS device builds. The R2 API accepts ciphertext bytes and records a client-supplied digest and crypto version, but the current Rust crate does not yet encrypt or decrypt those bytes. The database currently stores ciphertext envelopes only. The current Rust crate checks envelope structure but does not encrypt or decrypt content.

## Build commands
```bash
npm install
npx expo install --check
npm run typecheck
npx expo-doctor
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```
