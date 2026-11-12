# ADR 0001: End-to-end encryption protocol

- Status: **Selected for implementation, not yet integrated**
- Date: 2026-11-13
- Decision owner: ChitChat project

## Decision

Use **OpenMLS 0.9.2** as the Rust E2EE protocol engine, implementing the IETF Messaging Layer Security protocol (RFC 9420).

Treat every ChitChat conversation as an MLS group:
- A direct conversation is an MLS group with two user devices.
- A group conversation is an MLS group with the devices belonging to its members.
- A user may have multiple devices. Each device is a distinct MLS member.
- Adding or removing a device or user must produce and distribute the required MLS commit before new-epoch application messages are accepted.

Pin the exact OpenMLS version and one mutually supported ciphersuite for the first release:
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`.

OpenMLS is MIT-licensed. Its current release documentation says Android and iOS targets are built in CI but are not listed among its tested targets. ChitChat must add its own Android and iOS native build and interoperability tests before relying on it in production.

References:
- https://github.com/openmls/openmls
- https://docs.rs/openmls/0.9.2/openmls/
- https://datatracker.ietf.org/doc/html/rfc9420

## Why this fits ChitChat

- The cryptographic engine is written in Rust, matching the requested Rust-first core.
- It supports group sizes from two devices upward, so direct and group conversations use one protocol family.
- It is a protocol library, not a hosted chat network. Supabase can remain ChitChat's identity, device directory, ciphertext transport, Realtime and authorization backend.
- The same Rust state machine can be exposed to React Native through a narrow UniFFI-generated Kotlin/Swift bridge.
- UTF-8 message payloads preserve ordinary text, formatting and emoji. Those bytes remain inside the encrypted MLS application message.

## Rejected alternatives

### Signal libsignal

The official libsignal repository says its supported product is the Java, Swift and TypeScript libraries used by Signal, and explicitly says use outside Signal is unsupported. Its JNI, C and Node bridge layers and APIs may change without notice. Do not base ChitChat on an unsupported external integration.

Reference: https://github.com/signalapp/libsignal

### Matrix Rust SDK

The Matrix Rust SDK is a strong maintained Rust client with E2EE and device verification. It is appropriate if ChitChat adopts Matrix's client/server protocol and homeserver. It is not a drop-in crypto module for the existing Supabase message schema, and adopting it would change the backend architecture.

References:
- https://www.matrix.org/ecosystem/sdks/
- https://github.com/matrix-org/matrix-rust-sdk

## Required implementation

1. Create a dedicated Rust crate that wraps OpenMLS and owns all protocol state transitions.
2. Generate UniFFI bindings for Kotlin and Swift. Do not implement separate cryptography in TypeScript.
3. Generate device credentials and key packages locally. Publish only public credentials and key packages through Supabase.
4. Keep MLS group state and private keys local. Encrypt persisted state with a random local database key protected by Android Keystore or iOS Keychain.
5. Store only serialized MLS ciphertext, protocol version, group identifier and epoch metadata in Supabase. The server must never receive plaintext or private MLS state.
6. Add a device verification and account-level signing-key design. Do not silently trust a newly linked device.
7. On membership or device changes, process an MLS commit and reject messages from an unaccepted epoch.
8. Encrypt media in Rust before Cloudflare R2 upload. Generate a fresh random file key per object. Send the file key only inside an MLS-encrypted application message. Use authenticated, chunked encryption with unique nonces and authenticated metadata.
9. Keep secret-message reveal settings and hidden text/media references inside the encrypted application payload. The recipient controls local reveal and re-hide behavior.
10. Add cross-platform test vectors and real-device exchanges: Android to Android, iOS to iOS, Android to iOS, and iOS to Android.
11. Complete a threat model and independent cryptographic review before enabling the real-message composer.

## Message envelope migration

The current `nonce` column was designed for a generic AEAD envelope. MLS wire messages already contain their protocol authentication and encryption structure. Before enabling MLS, migrate the message and scheduled-message schemas so the app does not invent a fake external nonce. Put protocol name, wire-format version, ciphersuite, group ID and epoch in validated metadata.

Do not overload `key_version` with the MLS epoch. Keep wire-format version and MLS epoch as separate fields.

## Release gate

Until the OpenMLS wrapper, local protected storage, device verification, media encryption and cross-platform tests pass:
- keep real message sending disabled;
- do not claim end-to-end encryption;
- do not upload plaintext media to Cloudflare;
- do not accept arbitrary caller-supplied strings as proof of encryption.
