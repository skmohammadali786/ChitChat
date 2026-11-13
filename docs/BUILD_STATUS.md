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
- OpenMLS 0.9.2 is integrated into the Rust crate with RustCrypto, a ProtectedOpenMlsProvider, an encrypted SQLite storage codec and a two-client application-message/epoch-rotation test. The test engine is test-only. The production app API, Android/iOS bridge, protected Keychain/Keystore key injection, persistent group lifecycle, key packages, recovery and multi-device support are absent.
- `src/native/chitchatCore.ts` defines a React Native module contract, but Android and iOS native implementations are absent.
- The message service still uses the legacy nonce-based envelope. A migration to MLS wire metadata is required before MLS messaging can be enabled.
- SDK58 media pickers, encrypted-media/avatar service methods, R2 key-envelope metadata and profile-avatar update wiring are present in source. The actual native Rust file encrypt/decrypt implementation is not linked, and no picker-to-R2 round trip has passed on a device. The Worker stores ciphertext only; it does not perform encryption.
- Group creation/management, invitations, accept/decline/revoke, private invitation Realtime updates and generic background push invitations are wired. Encrypted group messaging, MLS membership commits and key rotation are absent.
- Receipt and reaction backend services are not integrated into an active message UI.
- Call sessions, participant-only history, expiry, private Realtime signaling, incoming-call push and call notification routing are wired. WebRTC peer connections, microphone/camera capture, TURN configuration and active call controls are not implemented.
- A bounded per-account ciphertext-only offline outbox, FIFO idempotent retry helper, app-foreground retry and network-reconnection hooks exist. Composer integration remains blocked by the production MLS/native encryption API. Disappearing messages, encrypted search, replies and forwarding remain absent.
- App lock is now integrated through Expo LocalAuthentication. It locks on app background and automatically prompts on foreground resume, using biometrics where available and device PIN/passcode fallback. Android/iOS lifecycle and lockout tests remain pending.
- External secret-link endpoints/reveal page and subscription purchase/restore flows are not implemented.
- System/light/dark theme selection and six accent palette choices are implemented and persisted. Accent usage is not yet consistent across every screen. Reduced-motion behavior exists in SecretReveal but needs broader coverage and testing. Systematic TalkBack/VoiceOver tests are incomplete.
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
- Direct-account and group report actions open a detailed form with seven categories and optional details up to 1,000 characters. Private RPCs check membership, enforce the database reason/details constraints and serialize five reports per hour per account. A reviewer console and moderation workflow are not implemented.
- The message, scheduled-message and media service methods now independently enforce the fail-closed crypto gate, not just the UI.
- Reporting migrations include conversation/account reporting, target-user indexing, message report validation and transaction-serialized five-per-hour throttling across both report endpoints. Security and health advisors returned no lints.


## App lock implementation

- Added `expo-local-authentication` for Expo SDK 58 and configured the iOS Face ID usage description.
- Signed-in users can enable app lock after authenticating with a configured device credential.
- When enabled, the app locks whenever it leaves the foreground and automatically requests device authentication on resume before reopening conversations. The native OS flow can use biometrics or device PIN/passcode fallback.
- This source integration has not yet been exercised in Android/iOS development builds. App-switching, cancellation, lockout, enrollment changes and notification-opening behavior must be tested on physical devices.


## Conversation inbox controls

- Added a Hidden inbox alongside Inbox and Archived.
- Long-press conversation controls now support hide/unhide as a per-user preference, separate from archiving.
- Account changes clear active chats, drafts in memory, and view state. Signed-in inboxes no longer retain demo sample conversations.


## Message-write security gate

- Supabase now revokes authenticated INSERT privileges on `messages` and `scheduled_messages` and drops their direct insert policies until a server-verifiable MLS protocol acceptance path exists.
- Scheduled-message UPDATE is revoked. Users cancel pending rows through a dedicated ownership-checked RPC.
- The live database has no authenticated INSERT grants for either table. Existing scheduled rows can still be read and cancelled. The secure composer remains disabled.

- Report throttling now takes a per-reporter transaction-scoped advisory lock and applies across both message and conversation submissions.


## Report form and consistency

- Added a detailed report form from direct and group chat actions. It supports seven categories and optional context up to 1,000 characters.
- The private table constraints and both reporting RPCs now agree on accepted reasons and the 1,000-character details limit.
- Report submissions are serialized per reporter across message and conversation report RPCs.
- App lock triggers the native authentication prompt on foreground resume; device validation remains pending.

- Concealed demo text is non-selectable, re-hides when the app leaves the foreground, and hides when the user disables auto-reveal. This is not secure memory zeroization and does not prevent all screenshots or screen recordings.


## Latest follow-up
- Outgoing typing broadcasts are now wired to the real-conversation composer and stop on inactivity, send, blur, or route cleanup. This is source-level implementation only; multi-account Realtime/device verification is still required.
