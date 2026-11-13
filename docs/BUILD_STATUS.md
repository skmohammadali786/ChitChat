# ChitChat build and integration status

Last audited: 2026-11-13
Branch: `feat/rust-native-supabase`
PR #1 remains draft. Do not merge.

## Configured foundations

- Expo React Native application shell, Supabase Auth/profile flows, profile editing and deep-link handlers.
- Rust workspace with profile/envelope validation and a versioned structured message-content model for Unicode text, concealed segments and encrypted-media references. Tests are authored but have not run successfully in CI.
- Supabase project and migrations for profiles, conversations, groups, messages, device records, blocks, reports, media metadata, receipts, settings, push devices and scheduled messages.
- Supabase security and health advisors previously returned no lints. This does not replace authenticated multi-user integration tests.
- Group create/list/add/remove/rename/leave/owner-transfer RPCs and management screens.
- User-scoped theme, auto-reveal, read-receipt, online, typing and last-seen preferences.
- Private Realtime authorization and an active-conversation presence/typing subscription in the app.
- Per-recipient delivery/read receipt records and RPCs. Receipt RLS now allows only the recipient and original sender to read each receipt, not every group member. The active chat UI does not yet load messages or display receipt state.
- Scheduled-message envelope storage and a pg_cron dispatcher. End-user scheduling UI and end-to-end delivery tests are incomplete.
- Private Cloudflare R2 bucket `chitchat-media`, with public `r2.dev` access disabled.
- Deployed `chitchat-media-api` Worker with an R2 binding and Supabase session/conversation-membership checks. Unauthenticated access was rejected. Authenticated device upload/download tests remain.
- Supabase `media_objects` metadata with RLS, digest and crypto-version fields.
- Authenticated Supabase Edge Function `notify-message` with JWT verification. It checks message ownership and conversation recipients, sends generic Expo alerts without plaintext or keys, honors `notification_preview = none`, and revokes tokens reported as unregistered.
- Client push permission/token registration UI and sign-out token-revocation attempt. `EXPO_PUBLIC_EAS_PROJECT_ID`, EAS credentials and real-device delivery remain unconfigured/unverified.
- Expo Android/iOS identifiers, EAS build profiles and CI workflow definitions.

## Verified limitations

- Real authenticated conversations are created/listed, but the active real-chat screen is a placeholder. It does not load message history or subscribe to new message records.
- The real-chat composer is disabled. The local composer only appends demo messages to in-memory state.
- OpenMLS 0.9.2 is selected in an ADR but is not integrated. There is no working MLS encryption/decryption, key-package lifecycle, device verification, recovery, or multi-device support.
- `src/native/chitchatCore.ts` defines a React Native module contract, but Android and iOS native implementations are absent.
- The message service still uses the legacy nonce-based envelope. A migration to MLS wire metadata is required before MLS messaging can be enabled.
- Media encryption/decryption and the picker-to-R2-to-decrypt UI flow are absent. The Worker and metadata schema do not encrypt files.
- Group management exists, but encrypted group messaging, MLS membership commits and key rotation are absent.
- Receipt and reaction backend services are not integrated into an active message UI.
- Calls are a placeholder. Voice/video calling is not implemented.
- Offline outbox, disappearing messages, encrypted search, replies, forwarding and complete message actions are absent.
- App lock and biometric enforcement are not implemented. Settings fields alone do not provide these controls.
- External secret-link endpoints/reveal page and subscription purchase/restore flows are not implemented.
- System theme, accent palette picker, complete reduced-motion behavior and systematic accessibility tests are incomplete.
- No committed `package-lock.json` exists. Current CI uses `npm install`, so dependency resolution is not reproducible.
- The five initial migration files missing from the branch have been restored as a consolidated bootstrap baseline plus four historical no-op placeholders. A completely clean Supabase migration test has not yet been run, so fresh-install reproducibility remains unverified.
- Latest recorded GitHub Actions run failed before any job steps were reported. TypeScript, Expo Doctor, Rust tests, rustfmt and Clippy have not been verified.
- No Android or iOS development/release build has been tested on a device. No Android↔iOS exchange has passed.

## Security and release rule

Do not describe ChitChat as end-to-end encrypted or enable real message sending until the OpenMLS engine, protected local state, native bridges, device lifecycle, envelope migration, media encryption and cross-platform tests pass. Keep real message sending fail-closed.

Do not merge PR #1 or treat an APK as a complete release until:
1. A reproducible lockfile is committed.
2. CI actually executes and passes TypeScript, Expo Doctor, Rust tests, formatting and Clippy.
3. Android and iOS native builds link the same Rust protocol engine.
4. Authenticated multi-user backend tests pass.
5. Android-to-iOS and iOS-to-Android encrypted exchanges pass.
6. Media, group membership changes, notifications, receipts, offline retry and privacy controls pass acceptance tests.
7. Threat model and independent security review are complete.

Termux can initiate an EAS Android cloud build. It cannot locally build iOS without macOS/Xcode.

## Commands used by CI

```bash
npm install
npx expo install --check
npm run typecheck
npx expo-doctor
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

See [DEEP_AUDIT_2026-11-13.md](DEEP_AUDIT_2026-11-13.md) for the full feature-by-feature inventory and implementation order.


## Additional changes on the feature branch

- System/light/dark appearance selection and six accent palette choices now persist locally and for signed-in users.
- A scheduled-message manager allows users to list and cancel pending entries. Scheduling new messages remains disabled until MLS encryption is implemented.
- Direct-account and group report actions call a private membership-checked RPC with reason validation and a five-per-hour rate limit. A reviewer console and moderation workflow are not implemented.
- The message, scheduled-message and media service methods now independently enforce the fail-closed crypto gate, not just the UI.
- Reporting migrations are recorded as `20261113030813_add_conversation_reporting` and `20261113031015_index_message_reports_target_user`. Security and health advisors returned no lints after these changes.


## App lock implementation

- Added `expo-local-authentication` for Expo SDK 58 and configured the iOS Face ID usage description.
- Signed-in users can enable app lock after authenticating with a configured device credential.
- When enabled, the app locks whenever it leaves the foreground and requires device authentication before reopening conversations. The native OS flow can use biometrics or device PIN/passcode fallback.
- This source integration has not yet been exercised in Android/iOS development builds. App-switching, cancellation, lockout, enrollment changes and notification-opening behavior must be tested on physical devices.


## Conversation inbox controls

- Added a Hidden inbox alongside Inbox and Archived.
- Long-press conversation controls now support hide/unhide as a per-user preference, separate from archiving.
- Account changes clear active chats, drafts in memory, and view state. Signed-in inboxes no longer retain demo sample conversations.


## Message-write security gate

- Supabase now revokes authenticated INSERT privileges on `messages` and `scheduled_messages` and drops their direct insert policies until a server-verifiable MLS protocol acceptance path exists.
- Scheduled-message UPDATE is revoked. Users cancel pending rows through a dedicated ownership-checked RPC.
- The live database has no authenticated INSERT grants for either table. Existing scheduled rows can still be read and cancelled. The secure composer remains disabled.
