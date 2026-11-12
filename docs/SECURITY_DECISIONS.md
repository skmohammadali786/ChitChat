# Security decision record

## Status
OpenMLS 0.9.2 using MLS (RFC 9420) is selected for implementation. It is not integrated yet. ChitChat must not describe conversations as end-to-end encrypted until device key generation, authentication, encryption, decryption, rotation, recovery, multi-device support, and interoperability tests are complete and independently reviewed. See [ADR 0001](adr/0001-e2ee-protocol-openmls.md).

## Current server boundary
- The message schema stores a ciphertext string, nonce, key version, client message ID, and a cryptographic metadata header.
- There is no plaintext message column.
- The app does not yet have an encryption implementation, so the messaging service refuses to accept a plaintext field but cannot cryptographically prove that caller-supplied ciphertext is encrypted.
- The real conversation UI therefore does not expose a message composer yet.
- Supabase never receives private identity keys or ratchet state in this design.

## Selected protocol: OpenMLS
OpenMLS is the chosen Rust implementation of MLS (RFC 9420). Direct chats will use two-member MLS groups; group chats will use multi-member MLS groups. Supabase remains the ciphertext transport and public device/key-package directory. Private keys and MLS state remain on devices.

OpenMLS is MIT-licensed. Its published target matrix lists Android and iOS as buildable but not tested targets, so ChitChat must add native build and cross-platform device tests. The first implementation will pin OpenMLS 0.9.2 and the mandatory X25519/AES-128-GCM/SHA-256/Ed25519 ciphersuite.

Reference: https://github.com/openmls/openmls

## Rejected protocol options
- Signal libsignal: the official repository states use outside Signal is unsupported and APIs/bridges can change without notice.
- Matrix Rust SDK: suitable only if ChitChat adopts Matrix's client/server protocol and homeserver; it is not a drop-in crypto layer for the Supabase message schema.

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
