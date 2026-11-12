# ChitChat deep implementation audit

Audit date: 2026-11-13
Branch: `feat/rust-native-supabase`
PR: #1, draft. Do not merge.

## Audit method

Reviewed the feature acceptance matrix, implementation plan, build-status document, app entry point, messaging service, message content model, native Rust bridge contract, group screens, settings service, presence and receipt services, notification registration, and the notification Edge Function.

A feature is verified only when the UI, native logic, backend authorization, error handling, and Android/iOS behavior work together. A schema, RPC, service function, or placeholder screen alone does not qualify.

## Critical findings

1. Authenticated conversations are created and listed, but the active real-chat screen is a placeholder. It does not load encrypted message history or subscribe to message inserts.
2. The active real-chat composer is disabled. The local composer only appends demo messages to React state.
3. `sendEncryptedMessage` still validates and writes the legacy nonce-based envelope. The OpenMLS ADR explicitly requires a schema and envelope migration before MLS messages can be enabled.
4. `src/native/chitchatCore.ts` expects `NativeModules.ChitChatCore`, but no Android or iOS implementation of that module exists. A custom build cannot provide Rust functionality until the bridge is implemented and linked.
5. OpenMLS is an architecture decision only. There is no MLS group lifecycle, key-package exchange, Welcome/Commit handling, persisted MLS state, device verification, or cross-device recovery.
6. Media metadata and the authenticated R2 Worker exist, but there is no native picker-to-Rust-encryption-to-R2-upload-to-authorized-download-to-Rust-decryption flow.
7. Group creation and member administration exist. Encrypted group messaging, invitation acceptance, device membership changes, and MLS epoch/key rotation do not.
8. Receipt and reaction services/database support exist, but the active chat does not display messages, receipts, or reactions and does not subscribe to receipt/reaction changes.
9. Presence is wired for an active conversation, but there is no message composer event path to emit typing state. Receipt subscriptions currently create a channel with the same topic as presence/message subscriptions; consolidate these into one conversation channel before enabling them together.
10. The Calls tab is explicitly a placeholder. Voice/video calling is not implemented.
11. Settings currently expose dark/light, auto-reveal, push enablement, discovery, block list, and selected privacy toggles. System theme, accent palette selection, notification-preview choices, app lock, biometric enforcement, and contact discovery are not complete.
12. The build has no committed `package-lock.json`. CI uses `npm install`, so dependency resolution is not reproducible.
13. The latest recorded CI jobs failed before any job steps were reported. No TypeScript, Expo, Rust, formatting, or Clippy result can be treated as verified.
14. `docs/BUILD_STATUS.md` contradicts the deployed `notify-message` function and its client invocation. It incorrectly says no push-delivery function is deployed. This audit corrects that status.
15. No Android/iOS development build, real-device test, Android-to-iOS exchange, or iOS-to-Android exchange has passed.

## A-to-Z feature status

Legend: **Partial** means a backend, UI, or design foundation exists but the acceptance criteria are not met. **Missing** means no working end-to-end implementation. **Blocked** means it depends on the native MLS and bridge work.

### Identity and account
- Email signup/login and email confirmation: Partial. Verify real Android/iOS callback handling, validation, and recovery.
- Password recovery: Partial. Verify reset deep links and password update on both platforms.
- Username/profile editing: Partial. Verify uniqueness, validation, avatar lifecycle, and RLS.
- Username discovery: Partial. Exact lookup and opt-in foundation exist; verify rate limiting and block behavior with multiple accounts.
- Optional phone discovery: Missing.
- Avatar upload/download: Missing end-to-end encrypted R2 integration.

### Messaging and conversations
- Direct conversation creation/listing: Partial. Backend exists; active chat history is not loaded.
- Real-time message delivery: Blocked. No MLS encryption adapter, history decryptor, or screen subscription.
- Android/iOS interoperability: Blocked. No MLS/native bridge/device tests.
- Device identity, verification, revocation, multi-device, recovery: Missing.
- Group create/member management: Partial. Management UI/RPCs exist; encrypted group messaging and MLS rekeying are missing.
- Replies, forwarding, copy policy: Missing.
- Reactions: Partial. Data/service foundation exists; UI and realtime are missing.
- Encrypted local search: Missing.
- Pin, mute, archive, hide, delete semantics: Partial. Per-user settings schema exists; complete UI and deletion behavior are missing.
- Typing/presence: Partial. Incoming presence/typing foundation exists; outgoing composer integration and cross-device tests are missing.
- Calls: Missing. Calls tab is only a placeholder.

### Concealed content
- Whole-message and per-block concealment: Partial. Data model and demo reveal UI exist; real encrypted message integration is missing.
- Automatic/manual reveal and re-hide: Partial. Recipient behavior, animation, accessibility, reduced-motion, and secure buffer lifecycle need implementation and tests.
- Concealed media: Blocked. Depends on file encryption and MLS-wrapped file keys.
- Screenshot/screen-recording controls: Missing. Platform limitations must be documented accurately; prevention cannot be promised universally.

### Media and storage
- Private Cloudflare R2 bucket: Configured.
- Authenticated media Worker: Partial. Authentication/membership gate exists; authenticated upload/download device tests remain.
- Supabase media metadata/RLS: Partial. Schema exists; multi-user authorization tests remain.
- Rust file encryption/decryption and chunking: Missing.
- Image/video/audio/file picker: Missing.
- Upload progress, retry, resumable multipart transfer: Missing.
- Expiry cleanup and cache purge: Missing.
- Emoji text: Partial. Unicode model validation exists; real encrypted transport is missing.
- Emoji reactions: Partial. Backend exists; UI/realtime is missing.

### Delivery and reliability
- Offline encrypted outbox and idempotent retry: Missing.
- Pending/sent/delivered/read/failed UI: Partial. Receipt backend exists; message UI integration is missing.
- Push: Partial. Registration UI and authenticated generic-alert Edge Function exist; EAS project ID, credentials, device delivery, retry policy, and notification deep-link routing remain unverified.
- Scheduled messages: Partial. Encrypted envelope table and cron dispatcher exist; compose UI, local schedule UX, and end-to-end delivery tests are missing.
- Disappearing messages: Missing.

### Privacy, safety, account controls
- Block/unblock: Partial. Backend and blocked-list UI exist; verify mutual enforcement across lookup, group membership, sends, and notifications.
- Report user/message: Partial. Private report storage exists; UI, abuse workflow, rate limits, and moderation access controls are missing.
- App lock/biometric unlock: Missing. Preference fields do not implement a native lock.
- Notification preview privacy: Partial. Server suppresses preview mode `none`; settings UI does not expose all preview modes or test lock-screen behavior.
- Read receipt/online/typing/last-seen controls: Partial. Preferences and presence service exist; UI semantics and cross-device enforcement require tests.
- Contact permission/discovery: Missing.
- Spam/abuse controls: Partial. Username lookup throttling exists; message, media, invite, and report throttles remain.

### External sharing and business model
- External secret links: Partial. Storage schema exists; token-hash endpoints, expiry, revoke, and reveal web page are missing.
- Subscriptions: Partial. Entitlement storage exists; Apple/Google purchase verification, restore flow, and UI are missing.
- Free core privacy/security: Not verified until the basic E2EE message path works.
- Storage/customization tiers: Missing server-enforced quota and entitlement checks.

### Appearance, accessibility, release
- Dark/light/system: Partial. Dark/light preference syncs; system mode and consistent token coverage are missing.
- Accent palette: Partial. Preference field exists; picker and full-screen token wiring are missing.
- Design system: Partial. Components/tokens exist; screen coverage and loading/error/empty states need review.
- Reduced motion: Partial. Must cover reveal and navigation animation.
- Accessibility: Missing systematic TalkBack, VoiceOver, labels, focus, contrast, and touch-target tests.
- Android build: Missing verified native Rust integration and device test.
- iOS build: Missing verified native Rust integration and device test.
- CI: Failing before steps; unverified.
- Security review: Missing independent protocol review and threat-model sign-off.

## Follow-up implementation after the audit

- Security audit found that group creation/add-member RPCs checked profile existence but did not enforce `profiles.discoverable`. A caller who knew a UUID could bypass the username-lookup privacy gate. Fixed both private RPC implementations in Supabase migration `20261112191645_enforce_discoverable_group_members`; the deployed functions now reject new non-discoverable members while allowing existing group members to remain after opting out. The migration is committed to the branch. Supabase security advisor returned no lints after the change.

- Added per-user conversation preference loading and safe partial updates that preserve other preference columns.
- Added long-press actions for pinning, muting for eight hours, and archiving conversations.
- Pinned conversations sort first. Archived conversations are available in a dedicated inbox view and can be restored.
- Added notification privacy controls for alerts off or sender-only. Message text is intentionally never included in push payloads.
- Added push notification tap routing. The app reads the notification response, opens the matching conversation after the inbox loads, and clears the consumed response.
- Updated and redeployed `notify-message` as version 3. It now suppresses push delivery for muted conversations and disabled notification preferences. JWT verification remains enabled.
- Verified Supabase RLS policies exist for conversation preferences, user settings and push devices. The Supabase security advisor returned no lints.
- These additions are implemented in source and backend deployment, but authenticated multi-user/device acceptance tests remain outstanding.

## Required implementation order

1. Stabilize the build: add a committed lockfile, fix CI runner/workflow setup, and get TypeScript, Expo Doctor, Rust tests, fmt, and Clippy to execute.
2. Implement the Rust MLS engine and versioned native bridge. Add Android and iOS build targets and native smoke tests.
3. Add protected local MLS storage, device credentials, key packages, device verification/revocation, and multi-device lifecycle.
4. Migrate message and scheduled-message envelopes from the legacy nonce format to validated MLS wire metadata. Add server-side membership/epoch enforcement.
5. Implement direct encrypted message history, send, receive, realtime, duplicate handling, outbox, receipts, and UI. Keep sending disabled until the full path passes.
6. Implement group MLS lifecycle and epoch changes, then encrypted group messaging.
7. Implement encrypted media, picker, chunked transfer, R2 upload/download, digest verification, local cache lifecycle, and expiry cleanup.
8. Finish reactions, replies, forwarding, search, pin/mute/archive/delete, scheduled and disappearing messages.
9. Finish notification settings/deep links, block/report enforcement, app lock/biometrics, external links, and subscriptions.
10. Complete theme/palette/system appearance, accessibility, reduced motion, and all-screen state handling.
11. Run multi-account backend tests and physical-device tests for Android↔Android, iOS↔iOS, Android↔iOS, and iOS↔Android. Complete threat model and independent security review.

## Merge and APK gate

Do not merge PR #1 or call an APK complete until all release-critical checks pass. An APK can be built earlier for a clearly labelled UI/native smoke test, but it must not be presented as a working secure messaging release. Termux can initiate an EAS Android cloud build; it cannot locally build iOS without macOS/Xcode.
