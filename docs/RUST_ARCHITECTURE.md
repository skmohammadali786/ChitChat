# Rust core and TypeScript UI architecture

## Platform targets
- Android and iOS are first-class targets.
- TypeScript owns the full UI, navigation, accessibility, animations, and supported Supabase client integration.
- Rust owns portable domain validation, MLS protocol state, message/media encryption, serialization, and security-sensitive business rules.
- OpenMLS 0.9.2 is selected for MLS (RFC 9420). It is not integrated yet. See [ADR 0001](adr/0001-e2ee-protocol-openmls.md).
- A native bridge exposes a narrow API to React Native. Expo Go cannot load a custom Rust native module, so ChitChat requires a custom development build.

## Workspace
- `rust/chitchat-core`: platform-independent Rust library.
- `src/native/chitchatCore.ts`: TypeScript contract for the native bridge.

## Rust invariants
- Profile validation rules are implemented in Rust.
- Encrypted message envelope validation is implemented in Rust.
- No plaintext message fallback is permitted.
- Envelope validation is structural only. It does not encrypt, decrypt, authenticate keys, or provide end-to-end encryption.

## Protected OpenMLS local storage

- OpenMLS SQLite storage uses `ChitChatStorageCodec`, an XChaCha20-Poly1305 codec that encrypts each serialized record with a fresh 192-bit nonce.
- The codec fails closed until the native platform layer injects a random 32-byte key from Android Keystore or iOS Keychain. No fallback key or plaintext codec is used.
- Call `install_mls_storage_key` only after the native key provider has loaded or created the device-bound key. Call `clear_mls_storage_key` when locking or signing out.
- `ProtectedOpenMlsProvider` now opens the app-private SQLite path, runs the OpenMLS migrations, combines the encrypted codec with the RustCrypto provider, and refuses to open while the protected key is unavailable. Its in-memory Rust test provider exercises the same codec.
- The complete native module still has to obtain the device-bound key from Android Keystore or iOS Keychain, inject it into Rust, choose the app-private database path, and expose the provider through Kotlin and Swift modules.

## Native integration plan
1. Build the Rust crate for Android targets and package it with the React Native Android module.
2. Build the same crate for iOS targets and package it as an XCFramework.
3. Expose a small, versioned FFI API through UniFFI-generated Kotlin and Swift bindings.
4. Test identical serialization and validation vectors on Android and iOS.
5. Keep native module calls typed and asynchronous.

## Why Supabase stays in TypeScript
Supabase's official client-library matrix currently lists JavaScript/TypeScript, Dart, Swift, and Python. Rust is not listed as an official client. ChitChat uses the supported `supabase-js` client for Auth, PostgREST, Realtime, and Storage while Rust owns local domain logic. Never embed the database password, `service_role`, or secret key in the mobile app.

## Encryption boundary
- OpenMLS state and private keys stay on the device.
- Supabase stores public device credentials/key packages and opaque MLS wire messages only.
- The media key is generated in Rust and distributed only inside an MLS-encrypted application message. Cloudflare R2 stores encrypted media bytes.
- UTF-8 text and emoji remain part of the encrypted application payload. Reactions and message metadata must be evaluated separately for metadata leakage.

## Build gate
The native bridge is not considered implemented until Android and iOS native builds load the module, Rust tests pass, and device-level integration tests verify the same behavior on both platforms.
