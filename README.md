# ChitChat

ChitChat is an Android and iOS messaging app with a TypeScript React Native UI and a shared Rust domain core.

## Architecture
- TypeScript owns the full UI, navigation, accessibility, Expo integration, and Supabase Auth, PostgREST, Realtime, and Storage client calls.
- Rust owns portable domain validation, encrypted-envelope validation, and the future cryptographic boundary.
- Supabase provides authentication, database persistence, private storage, and realtime events.

See [Rust architecture](docs/RUST_ARCHITECTURE.md), [security decisions](docs/SECURITY_DECISIONS.md), [OpenMLS E2EE ADR](docs/adr/0001-e2ee-protocol-openmls.md), and the [complete feature acceptance matrix](docs/FEATURE_ACCEPTANCE_MATRIX.md).

## Backend
The dedicated project is `roqostmesaxplurzjoin`. Its schema is installed and managed with Supabase migrations. See [backend setup](docs/SUPABASE_SETUP.md) and [Cloudflare R2 media storage](docs/CLOUDFLARE_MEDIA.md).

## Run the TypeScript app
Use Node.js 22.13 or newer:
```bash
npm ci
npx expo start
```

Expo Go cannot load ChitChat's custom Rust module. Use custom Android and iOS development builds after the native bridges are implemented.

## Run Rust tests
Install stable Rust:
```bash
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

## Security status
End-to-end encryption is not complete. The database stores ciphertext envelopes only, and real conversation message sending is disabled. Do not claim messages are encrypted until protocol integration, device keys, native bridges, Android/iOS interoperability, and an independent security review are complete.
