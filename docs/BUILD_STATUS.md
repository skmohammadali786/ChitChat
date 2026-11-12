# ChitChat build and integration status

## Configured\n- Private Cloudflare R2 bucket `chitchat-media` in APAC Standard storage.\n- Deployed `chitchat-media-api` Worker with an R2 binding and Supabase JWT verification.\n- Public `r2.dev` access is disabled; unauthenticated Worker requests return an authentication error.\n- Supabase `media_objects` metadata table with RLS and crypto-version metadata.
- Dedicated Supabase project URL and publishable client key.
- Expo Android and iOS identifiers and deep-link scheme.
- Rust workspace and platform-independent domain crate.
- Separate CI jobs for TypeScript/Expo and Rust tests.
- Rust bridge contract and fail-closed messaging guard.

## Not yet complete
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
