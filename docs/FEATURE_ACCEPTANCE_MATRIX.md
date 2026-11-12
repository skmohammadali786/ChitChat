# ChitChat feature acceptance matrix

This file is the release checklist. A feature is not "done" because a screen or database table exists. It is done only after the UI, Rust logic where required, Supabase/Cloudflare integration, authorization, and Android/iOS tests all pass.

Legend:
- DONE: implemented and verified end-to-end.
- PARTIAL: foundation exists, but one or more required layers are missing.
- NOT STARTED: no functional implementation yet.

## Account and identity

| Feature | Status | Acceptance requirement |
|---|---|---|
| Email signup and login | PARTIAL | Real Supabase account flow, email confirmation, Android/iOS deep links, error states |
| Password recovery | PARTIAL | Recovery link, deep-link callback, password update and device tests |
| Username and profile | PARTIAL | Unique username, display name, bio, avatar, onboarding and editing |
| Username discovery | PARTIAL | Exact lookup, opt-in discoverability, rate limits, block filtering |
| Optional phone discovery | NOT STARTED | Explicit permission, normalized phone matching, privacy controls |
| Profile avatar | PARTIAL | Encrypted Rust output, private R2 upload, authorized download and update |

## One-to-one and group messaging

| Feature | Status | Acceptance requirement |
|---|---|---|
| Conversation list and history | PARTIAL | Real Supabase records, pagination, loading/empty/error states |
| Real-time message delivery | PARTIAL | Encrypted inserts, realtime updates, reconnect and duplicate handling |
| End-to-end encryption | NOT STARTED | Reviewed Olm/Double Ratchet or other selected protocol, key exchange, ratchet persistence and independent review |
| Android to iOS and iOS to Android | NOT STARTED | Cross-platform protocol vectors and two-device tests |
| Device identity and verification | NOT STARTED | Identity keys, signed prekeys, one-time keys, QR/SAS verification, rotation and revocation |
| Multi-device and recovery | NOT STARTED | Secure device linking and recovery without a server decryption key |
| Groups | PARTIAL | Group create/manage UI and RPCs exist; server RPCs now enforce discoverability and block checks even when called outside the UI. Invitations and E2EE key rotation remain |
| Replies and forwarding | NOT STARTED | Encrypted references and UI actions |
| Copy restrictions | NOT STARTED | Respect sender policy and platform limitations |
| Reactions | PARTIAL | Unicode emoji table, RLS and client add/remove service exist; chat UI and realtime subscription remain |
| Search | NOT STARTED | Local encrypted search index, no server-side plaintext indexing |
| Pin, mute, archive, delete | PARTIAL | Per-user pin/mute/archive UI and persistence exist; muted conversations are excluded from push delivery. Delete and hidden-state UI remain |
| Typing and presence | PARTIAL | Private membership-authorized Realtime channels, privacy-aware client service, active-chat online state and incoming typing indicator are wired; outgoing typing events and device tests remain |

## Secret content

| Feature | Status | Acceptance requirement |
|---|---|---|
| Whole-message concealment | PARTIAL | Secret payload encrypted and stored with recipient reveal preference |
| Concealed text sections | PARTIAL | Rust message-content model supports ordered Unicode text blocks and concealed flags; MLS encryption and reveal UI integration remain |
| Automatic reveal | PARTIAL | Recipient-controlled setting, animation and reduced-motion behavior |
| Manual reveal | PARTIAL | Explicit tap and accessibility support |
| Re-hide | PARTIAL | Hide decrypted UI and clear temporary buffers where technically possible |
| Secret photos/videos/audio/files | PARTIAL | Rust content model supports encrypted-media references and concealed attachments; file encryption, key wrapping, picker and decrypt path remain |
| Screenshot/screen-recording claims | NOT STARTED | Document platform limitations; never promise impossible prevention |

## Media and storage

| Feature | Status | Acceptance requirement |
|---|---|---|
| Cloudflare R2 private bucket | DONE | Private bucket created; public r2.dev domain disabled |
| Authenticated media API | PARTIAL | Worker deployed; unauthenticated requests rejected; signed-in upload/download integration tests still required |
| Supabase media metadata | PARTIAL | RLS table and migration installed; authenticated device-level tests required |
| Rust media encryption | NOT STARTED | Encrypt/decrypt files, chunking, digest verification and crypto-version compatibility |
| Image/video/audio/file picker | NOT STARTED | Native pickers, size limits, upload progress and retry |
| Large media | NOT STARTED | Resumable/multipart upload, pause/resume and cleanup |
| Media expiry and cleanup | NOT STARTED | Delete expired R2 objects and Supabase metadata safely |
| Emoji in messages | PARTIAL | Rust payload model preserves Unicode/emoji text; MLS encryption and real message transport remain |
| Emoji reactions | PARTIAL | Database supports selected emoji values; UI and realtime behavior remain |

## Delivery, reliability and notifications

| Feature | Status | Acceptance requirement |
|---|---|---|
| Offline outbox | NOT STARTED | Encrypted local queue, retry, idempotency and conflict handling |
| Pending/sent/delivered/failed states | PARTIAL | Per-recipient receipt rows, message-insert trigger, delivered/read RPCs and realtime subscription exist; UI state mapping remains |
| Read receipts | PARTIAL | Database receipts and privacy-aware read RPC exist; UI controls and cross-device verification remain |
| Push notifications | PARTIAL | Expo token registration, authenticated generic sender-only delivery, mute/opt-out enforcement and notification tap routing exist; EAS credentials and real-device delivery/retry tests remain |
| Scheduled messages | PARTIAL | Encrypted envelope table, client scheduling service and pg_cron dispatcher are installed; UI and delivery tests remain |
| Disappearing messages | NOT STARTED | Expiry policy, server cleanup and local cache handling |

## Privacy, safety and account controls

| Feature | Status | Acceptance requirement |
|---|---|---|
| Block/unblock | PARTIAL | Block list and unblock UI exist; direct conversations are hidden after block, group creation/add checks both directions, and push delivery excludes blocked relationships. Multi-user acceptance tests and group-specific block semantics remain |
| Report message/user | PARTIAL | Private report table exists; reporting UI, abuse triage and rate limits |
| App lock | PARTIAL | Synced preference fields exist; native lock screen and lifecycle enforcement remain |
| Biometric unlock | NOT STARTED | Native biometric prompt on Android/iOS |
| Notification privacy | PARTIAL | User can disable alerts or show sender only; push payloads never include message text. Device lock-screen behavior and push delivery tests remain |
| Last seen/read receipts privacy | PARTIAL | Read receipt, online, typing and last-seen controls are wired to Supabase; read receipt UI and cross-device tests remain |
| Contact permissions | NOT STARTED | Optional OS permission and privacy-safe discovery |
| Spam and abuse controls | PARTIAL | Username lookup throttling exists; message, media and invite controls remain |

## External sharing and business model

| Feature | Status | Acceptance requirement |
|---|---|---|
| External secret links | PARTIAL | Private token-hash and encrypted-payload table exists; create/redeem/revoke endpoints, expiry enforcement and web reveal page remain |
| Optional subscriptions | PARTIAL | User-scoped entitlement table exists; Apple/Google purchase validation, UI and restore purchases remain |
| Free core privacy/security | NOT STARTED | Encryption, basic messaging and safety never paywalled |
| Storage/customization tiers | NOT STARTED | Server-enforced quota and subscription entitlements |

## Appearance, accessibility and release

| Feature | Status | Acceptance requirement |
|---|---|---|
| Light/dark/system themes | PARTIAL | Dark/light preference syncs to Supabase user settings; system mode and all-screen token coverage remain |
| Accent palette selection | PARTIAL | Synced accent token exists; palette picker and all-screen UI wiring remain |
| Design system | PARTIAL | Astryx-informed conventions, reusable components and state coverage |
| Reduced motion | PARTIAL | All reveal and navigation animation respects OS setting |
| Accessibility | NOT STARTED | TalkBack, VoiceOver, focus order, labels, contrast and touch targets |
| Android release build | NOT STARTED | Rust module linked, APK/AAB built and device tested |
| iOS release build | NOT STARTED | Rust module linked, IPA built and device tested |
| CI | NOT STARTED | Green TypeScript, Expo doctor, Rust tests, formatting and clippy |
| Security review | NOT STARTED | Protocol review, threat model and independent audit before E2EE claims |

## Release rule

Do not merge to `main`, publish an APK/IPA as complete, or enable real message sending until the relevant acceptance tests pass on both Android and iOS. In particular, cross-platform encryption must be proven by Android-to-iOS and iOS-to-Android test vectors and real-device exchanges.
