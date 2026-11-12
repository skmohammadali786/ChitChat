# Security decision record

## Status
No end-to-end encryption protocol has been selected or integrated in this prototype. ChitChat must not describe conversations as end-to-end encrypted until device key generation, authentication, encryption, decryption, rotation, recovery, multi-device support, and interoperability tests are complete and independently reviewed.

## Current server boundary
- The message schema stores a ciphertext string, nonce, key version, client message ID, and a cryptographic metadata header.
- There is no plaintext message column.
- The app does not yet have an encryption implementation, so the messaging service refuses to accept a plaintext field but cannot cryptographically prove that caller-supplied ciphertext is encrypted.
- The real conversation UI therefore does not expose a message composer yet.
- Supabase never receives private identity keys or ratchet state in this design.

## Protocol evaluation

### Signal Protocol / libsignal
The official Signal implementation contains the Signal Protocol, including Double Ratchet, and cryptographic primitives. Its repository states that the library is intended for Signal clients and server use, and that use outside Signal is unsupported. Its bridges and APIs can change without notice. The current Expo/Hermes app must not import a Node-only bridge and assume it works on Android and iOS.

Reference: https://github.com/signalapp/libsignal

### Matrix Rust SDK
The Matrix Rust SDK is a maintained Rust client SDK with end-to-end encryption and device verification support. It is a credible option if ChitChat chooses to adopt Matrix's client/server protocol and infrastructure. It is not a drop-in encryption package for the current Supabase schema.

References:
- https://www.matrix.org/ecosystem/sdks/
- https://matrix-org.github.io/matrix-rust-sdk/matrix_sdk/encryption/index.html

## Required evaluation before implementation
1. Confirm official support for Android, iOS, React Native 0.88, and Hermes.
2. Review protocol and library maintenance, licensing, security history, and native build reproducibility.
3. Validate identity keys, signed prekeys, one-time prekeys, session setup, ratchet state, group key changes, and device verification.
4. Design encrypted media key distribution and secret-message reveal metadata inside the encrypted payload.
5. Design account recovery and multi-device transfer without creating a server-side decryption backdoor.
6. Write interoperability tests across Android and iOS devices.
7. Commission an independent security review before public E2EE claims.

## Release rule
Never silently fall back to plaintext. If encryption is unavailable, message sending must fail closed and explain that secure messaging is not ready.

## Additional candidate evaluated: OpenE2EE Signal Protocol SDK

The `@open-e2ee/signal-protocol-sdk` project documents a pure-TypeScript protocol profile and an Expo adapter based on Expo SQLite with SQLCipher and SecureStore. Its published runtime matrix specifically lists Expo development/release builds and React Native Hermes. This makes it a more relevant technical candidate for a controlled Expo 58 spike than a Node N-API libsignal package.

References:
- https://docs.open-e2ee.dev/start/expo
- https://docs.open-e2ee.dev/reference/runtime-support
- https://github.com/open-e2ee/signal-protocol-js

It is **not selected for production**. Its own assurance document says there is no independent-firm audit. It also documents a versioned Signal-derived profile that is not wire-compatible with Signal Messenger/libsignal and contains protocol deviations. Its public CI and adversarial-agent review do not substitute for an independent cryptographic audit.

A contained evaluation should:
1. Pin an exact SDK version and lockfile.
2. Build on a dedicated branch using an Expo development build, not Expo Go.
3. Verify the implementation against published test vectors and the published deviation document.
4. Exercise two independent Android devices and two independent iOS devices.
5. Test key changes, device replacement, backup/recovery, offline delivery, duplicates, reordering, group membership changes, and secret attachments.
6. Review the storage adapter, threat model, supply chain, and protocol design with an independent cryptography specialist.

Until those steps are completed, ChitChat must keep real conversation sending disabled. No encryption SDK has been added to the runtime.
