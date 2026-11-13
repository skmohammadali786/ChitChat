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
3. The message service retains the legacy nonce-based envelope shape, but sending is now fail-closed at the service layer and authenticated INSERT is revoked for both messages and scheduled messages. The OpenMLS ADR requires a schema/envelope migration and protocol-aware server acceptance before writes can be restored.
4. `src/native/chitchatCore.ts` expects `NativeModules.ChitChatCore`, but no Android or iOS implementation of that module exists. A custom build cannot provide Rust functionality until the bridge is implemented and linked.
5. OpenMLS is an architecture decision only. There is no MLS group lifecycle, key-package exchange, Welcome/Commit handling, persisted MLS state, device verification, or cross-device recovery.
6. Media metadata and the authenticated R2 Worker exist, but there is no native picker-to-Rust-encryption-to-R2-upload-to-authorized-download-to-Rust-decryption flow.
7. Group creation and member administration exist. Encrypted group messaging, invitation acceptance, device membership changes, and MLS epoch/key rotation do not.
8. Receipt and reaction services/database support exist, but the active chat does not display messages, receipts, or reactions and does not subscribe to receipt/reaction changes.
9. Presence is wired for an active conversation, but there is no message composer event path to emit typing state. Receipt subscriptions currently create a channel with the same topic as presence/message subscriptions; consolidate these into one conversation channel before enabling them together.
10. The Calls tab is explicitly a placeholder. Voice/video calling is not implemented.
11. Settings now expose system/light/dark appearance, six accent palette choices, auto-reveal, push enablement, discovery, block list, sender-only/off notification previews, read-receipt/online/typing/last-seen privacy, and app lock. All-screen accent consistency, real-device lock tests, and contact discovery remain incomplete.
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
- Pin, mute, archive, hide, delete semantics: Partial. Per-user pin/mute/archive/hide UI and separate inbox views are implemented. Message-level deletion and secure cache cleanup remain missing.
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
- Scheduled messages: Partial. A management screen lists and cancels pending entries through an owner-scoped cancel RPC. Creating new entries is blocked until MLS exists; delivery tests remain missing.
- Disappearing messages: Missing.

### Privacy, safety, account controls
- Block/unblock: Partial. Backend and blocked-list UI exist. Server-side group discoverability, blocked direct-conversation filtering, direct-write block enforcement and push suppression are implemented; multi-user integration tests and group-specific semantics remain.
- Report user/message: Partial. Direct-account and group report UI now use a detailed form with seven categories and optional details. Private RPCs validate membership, reason and sender identity, enforce a 1,000-character limit and serialize a shared five-per-hour rate limit. Per-message report UI, moderation console and triage remain missing.
- App lock/biometric unlock: Partial. Expo LocalAuthentication gates the signed-in app after backgrounding and prompts on resume; biometrics or device PIN/passcode fallback are supported. Physical Android/iOS testing remains.
- Notification preview privacy: Partial. UI supports off and sender-only. The notification function never sends message plaintext. Device lock-screen behavior and real push delivery still need tests.
- Read receipt/online/typing/last-seen controls: Partial. Preferences and presence service exist; UI semantics and cross-device enforcement require tests.
- Contact permission/discovery: Missing.
- Spam/abuse controls: Partial. Username lookup throttling and serialized report throttling exist. Message, media and invite abuse limits remain.

### External sharing and business model
- External secret links: Partial. Storage schema exists; token-hash endpoints, expiry, revoke, and reveal web page are missing.
- Subscriptions: Partial. Entitlement storage exists; Apple/Google purchase verification, restore flow, and UI are missing.
- Free core privacy/security: Not verified until the basic E2EE message path works.
- Storage/customization tiers: Missing server-enforced quota and entitlement checks.

### Appearance, accessibility, release
- Dark/light/system: Partial. System/light/dark selection follows OS appearance and syncs to Supabase; semantic token coverage still varies by screen.
- Accent palette: Partial. Six accent choices persist locally and to Supabase and recolor key controls; full-screen token wiring remains.
- Design system: Partial. Components/tokens exist; screen coverage and loading/error/empty states need review.
- Reduced motion: Partial. Must cover reveal and navigation animation.
- Accessibility: Missing systematic TalkBack, VoiceOver, labels, focus, contrast, and touch-target tests.
- Android build: Missing verified native Rust integration and device test.
- iOS build: Missing verified native Rust integration and device test.
- CI: Failing before steps; unverified.
- Security review: Missing independent protocol review and threat-model sign-off.

## Follow-up implementation after the audit

- Security audit found that group creation/add-member RPCs checked profile existence but did not enforce `profiles.discoverable`. A caller who knew a UUID could bypass the username-lookup privacy gate. Fixed both private RPC implementations in Supabase migration `20261112191645_enforce_discoverable_group_members`; the deployed functions now reject new non-discoverable members while allowing existing group members to remain after opting out.
- A second block-flow review found that the conversation-list RPC continued returning blocked direct conversations after app restart. Migration `20261112191804_hide_blocked_direct_conversations` now hides direct chats if either participant has blocked the other. The deployed notification Edge Function was upgraded to version 4 and suppresses alerts in either direction of a block relationship, including a block created between message insert and notification dispatch. A further policy review found the message INSERT policy only checked conversation membership, not blocks. Migration `20261112191917_enforce_blocks_on_direct_message_inserts` now rejects new direct-message inserts when either participant has blocked the other. All three migrations are committed to the branch. A further privilege audit found broad grants on every exposed public table, including TRUNCATE and UPDATE rights that RLS does not sufficiently constrain. Migration `20261112192222_tighten_public_api_privileges` revokes broad grants, regrants only the operations used by the client, removes direct role/read-state mutation policies, and explicitly grants authenticated-only access to the public invoker RPCs. The postgres role default privileges were also tightened. The Supabase-managed `supabase_admin` default ACL remains a residual owner-level maintenance item because the available SQL execution role cannot alter that role’s defaults. The live table grants were re-queried and show no TRUNCATE, TRIGGER, REFERENCES, or broad UPDATE rights for authenticated clients. Supabase security advisor returned no lints after the changes.

- Added per-user conversation preference loading and safe partial updates that preserve other preference columns.
- Added long-press actions for pinning, muting for eight hours, and archiving conversations.
- Pinned conversations sort first. Archived conversations are available in a dedicated inbox view and can be restored.
- Added notification privacy controls for alerts off or sender-only. Message text is intentionally never included in push payloads.
- Added push notification tap routing. The app reads the notification response, opens the matching conversation after the inbox loads, and clears the consumed response.
- Fixed the blocked-users screen. It previously attempted to read other users’ profiles directly even though profile RLS permits only self-reads. Added a security-definer implementation behind an authenticated invoker RPC that returns only the caller’s own blocked accounts and their display fields.
- Restricted message-receipt RLS to the recipient and original sender. Other group members can no longer inspect receipt rows for messages they did not send.
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


## Additional implementation after this audit

- Added a scheduled-message management screen. It lists pending encrypted envelopes and supports cancellation. New scheduling remains fail-closed until a real MLS composer exists.
- Added system/light/dark theme selection using the OS color scheme and six selectable accent palettes. Theme and palette preferences persist locally and sync to Supabase for signed-in users. Some screen styles still need to consume the semantic accent token.
- Added direct-account and group report actions. A private server RPC validates conversation membership, target membership, supported reasons and a five-per-hour per-account limit. Reports remain in the private moderation schema; no reviewer/admin console or abuse triage workflow exists yet.
- Added explicit crypto-gate checks to message insertion, scheduled-message creation, encrypted media upload and encrypted avatar upload. This prevents lower-level callers from bypassing the disabled composer while the native MLS implementation is unavailable.
- Supabase security and health advisors returned no lints after the reporting changes. The target-user foreign-key index warning was fixed with migration `20261113031015_index_message_reports_target_user`. Unused-index notices are expected on an empty project and are not a reason to drop required indexes.


- Added device-authentication app lock using Expo LocalAuthentication. The app requires an enrolled device credential before enabling the setting, locks when the app leaves the foreground, and gates the signed-in UI until successful authentication. Android/iOS device and lifecycle tests are still pending.


- Added a separate hidden-conversation inbox with restore controls. Per-user hidden state uses the existing `conversation_user_settings.hidden_at` field; delete semantics remain unimplemented.
- Fixed an account-switching issue where demo/sample conversations could be merged into a signed-in inbox. Account-scoped UI state is reset on identity changes and the inbox now uses only the server-loaded conversation set.


## Additional security boundary

- Authenticated clients no longer have `INSERT` privileges on `public.messages` or `public.scheduled_messages`. Their old insert policies are removed. This closes the direct REST API bypass around the TypeScript crypto gate while the native MLS engine is unavailable.
- Authenticated clients no longer have `UPDATE` privileges on scheduled-message rows. Cancellation is available only through `public.cancel_scheduled_message(uuid)`, which checks sender ownership and pending status. This prevents a client from rewriting scheduled ciphertext, timing or routing fields after insertion.
- The scheduled-message manager remains useful for reading/cancelling any existing pending records. Creating new entries is intentionally disabled on the server until the MLS protocol is integrated.


- Hardened the existing message-report RPC with supported-reason validation, a 1,000-character details limit, membership checks, rejection of self-reports and the shared five-per-hour reporter limit.

- Report throttling is serialized per reporter using a transaction-scoped advisory lock across both message and conversation report RPCs, preventing concurrent submissions from racing the five-per-hour threshold.


- Added `ReportConversationModal` with seven report categories, optional 1,000-character context, busy/error states and a private submit flow from direct/group chat actions.
- Corrected the moderation schema/RPC mismatch. The live `private.message_reports` table now accepts exactly the reason values supported by the private RPCs and caps details at 1,000 characters. The client mirrors that limit.
- App lock now tracks React Native `AppState` and invokes the OS authentication prompt when the app returns to active state. Real-device tests still remain.

- Secret reveal now uses the selected theme/accent, hides when auto-reveal is switched off, automatically re-hides when the app leaves the foreground, and disables text selection for concealed content. JavaScript string memory is not guaranteed to be zeroized and platform capture prevention is not implemented.
