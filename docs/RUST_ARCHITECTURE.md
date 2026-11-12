# Rust core and TypeScript UI architecture

## Platform targets
- Android and iOS are first-class targets.
- TypeScript owns the full UI, navigation, accessibility, animations, and supported Supabase client integration.
- Rust owns portable domain validation, cryptographic boundaries, serialization, and security-sensitive business rules.
- A native bridge exposes a narrow API to React Native. Expo Go cannot load a custom Rust native module, so ChitChat requires a custom development build.

## Workspace
- `rust/chitchat-core`: platform-independent Rust library.
- `src/native/chitchatCore.ts`: TypeScript contract for the native bridge.

## Rust invariants
- Profile validation rules are implemented in Rust.
- Encrypted message envelope validation is implemented in Rust.
- No plaintext message fallback is permitted.
- Envelope validation is structural only. It does not encrypt, decrypt, authenticate keys, or provide end-to-end encryption.

## Native integration plan
1. Build the Rust crate for Android targets and package it with the React Native Android module.
2. Build the same crate for iOS targets and package it as an XCFramework.
3. Expose a small, versioned FFI API through UniFFI or a reviewed C ABI.
4. Test identical serialization and validation vectors on Android and iOS.
5. Keep native module calls typed and asynchronous.

## Why Supabase stays in TypeScript
Supabase's official client-library matrix currently lists JavaScript/TypeScript, Dart, Swift, and Python. Rust is not listed as an official client. ChitChat uses the supported `supabase-js` client for Auth, PostgREST, Realtime, and Storage while Rust owns local domain logic. Never embed the database password, `service_role`, or secret key in the mobile app.

## Build gate
The native bridge is not considered implemented until Android and iOS native builds load the module, Rust tests pass, and device-level integration tests verify the same behavior on both platforms.
