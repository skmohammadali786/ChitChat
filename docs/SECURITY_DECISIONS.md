# Security decision record

## Status

OpenMLS 0.9.2 (RFC 9420) is selected and its Rust crate integration now includes a real two-client application-message and epoch-rotation test, an OpenMLS SQLite storage provider, and an authenticated-encryption codec for SQLite records. This is a Rust-level foundation, not a production messenger. The test engine is test-only, the application message API is not linked, the Android/iOS native bridge and Keychain/Keystore key injection are absent, and no cross-platform device exchange or independent review has passed.

ChitChat must not describe conversations as end-to-end encrypted or enable real message sending until the full release gate is met. See [ADR 0001](adr/0001-e2ee-protocol-openmls.md).

## Current server boundary

- The deployed message schema retains the legacy nonce-based envelope. It has not yet been migrated to the MLS wire format.
- There is no plaintext message column.
- Authenticated message and scheduled-message inserts remain revoked. The app-level secure send gate always fails closed.
- The active real conversation screen does not load/decrypt message history or expose a production composer.
- Supabase never receives private identity keys or MLS state.
- The encrypted outbox persists ciphertext envelopes only, but real composer integration and protected-storage policy remain unverified.

## Selected protocol: OpenMLS

OpenMLS is the selected Rust implementation of MLS (RFC 9420). Direct chats will use two-member MLS groups; group chats will use multi-member MLS groups. Supabase remains the ciphertext transport and public device/key-package directory. Private keys and MLS state must remain on devices.

The crate pins OpenMLS 0.9.2 and the mandatory X25519/AES-128-GCM/SHA-256/Ed25519 ciphersuite. A custom XChaCha20-Poly1305 codec encrypts each OpenMLS SQLite value and refuses storage access until a 32-byte platform key is installed. The provider is tested in-memory with two clients, but the platform key provider and persistent app lifecycle are not implemented.

## Device identity

- Rust generates Ed25519 identity keys, X25519 signed prekeys, a signed prekey bundle, a ten-digit fingerprint, and challenge-response signatures.
- The Supabase device registry stores public keys only. Native registration is gated on the missing protected-storage module.
- Peer trust is invalidated by database trigger whenever an identity/prekey/fingerprint/version changes or a device is revoked.
- Android Keystore/iOS Keychain persistence, key rotation, key-package distribution, QR/SAS comparison and physical-device tests remain incomplete.

## Media and group security

- Rust XChaCha20-Poly1305 media primitives and authenticated private-R2 metadata transport exist in source.
- Avatar and media picker/service methods are wired, but the native file encryption/decryption bridge and MLS-wrapped media-key distribution are absent. No plaintext upload fallback exists.
- Group membership and invitations are implemented as backend workflows. MLS group creation, Welcome/Commit processing, member-change key rotation and epoch-gated message delivery remain absent.

## Rejected protocol options

- Signal libsignal: the official repository states use outside Signal is unsupported and APIs/bridges can change without notice.
- Matrix Rust SDK: suitable only if ChitChat adopts Matrix's client/server protocol and homeserver; it is not a drop-in crypto layer for the Supabase message schema.

## Release rule

Never silently fall back to plaintext. If encryption is unavailable, message sending must fail closed and explain that secure messaging is not ready. Do not make public end-to-end encryption claims before native storage, device lifecycle, Android/iOS interoperability and independent protocol review pass.
