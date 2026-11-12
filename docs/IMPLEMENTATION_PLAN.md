# Implementation plan

## Completed in the foundation
- Expo, React Native, TypeScript app shell.
- EAS preview APK and production AAB profiles.
- Astryx-informed semantic tokens and component conventions.
- Chat list, local demo conversation, composer, secret reveal/re-hide UI, and light/dark appearance.
- Supabase email/password sign-up, sign-in, email confirmation callbacks, password reset, and session persistence.
- Mobile auth sessions stored through Expo SecureStore, web sessions stored through IndexedDB-backed AsyncStorage.
- Profile onboarding, unique usernames, bio, and opt-in username discovery.
- Exact username lookup with a private server-side rate-limit table.
- User block/unblock with block-list management, discovery filtering, and direct-message delivery checks.
- Profile editing for display name, username, and bio.
- Direct conversation creation and current-user conversation listing RPCs.
- Conversation/member/message schema with row-level security and ciphertext-only message fields.
- Realtime publication setup for new message records.
- Encrypted message service interface that accepts message envelopes, not plaintext.
- Demo mode remains available while backend configuration is missing.

## Phase 2: connect and verify backend
- Create a dedicated ChitChat Supabase project and configure app environment variables.
- Run the profile and messaging setup SQL in order.
- Verify email confirmation and password recovery deep links on Android and iOS.
- Verify username discovery opt-out, exact lookup, rate limiting, and RLS behavior.
- Verify direct conversation creation is idempotent and only members can list/read it.
- Add profile editing and avatar uploads with strict storage policies.
- Add device registration and account recovery design.

## Phase 3: secure messaging
- Complete a contained evaluation of the OpenE2EE Signal Protocol SDK and compare it with other viable implementations. It is not independently audited and is not selected for production.
- Select and integrate a reviewed protocol/library that supports Android, iOS, React Native 0.88, and Hermes.
- Device identity keys, prekeys, key changes, verification, recovery, and multi-device strategy.
- Define encrypted attachments, secret-message payload format, expiry, and local cache lifecycle.
- Fail closed. Never send plaintext if encryption is unavailable.
- Threat model and independent security review before public E2EE claims.

## Phase 4: full messaging
- End-to-end encrypted message persistence and realtime delivery.
- Offline outbox, delivery/read state, and message history.
- Media, voice notes, files, groups, reactions, replies, search, scheduled messages, and disappearing messages.
- Push notifications with privacy-preserving payloads.
- Abuse prevention, block/report, and operational monitoring.

## Phase 5: external sharing and monetization
- Expiring, revocable encrypted secret links with strict authorization.
- Optional subscription for convenience and customization only.

## Definition of done
- TypeScript passes and Android development build launches.
- Backend SQL has been applied and verified against a dedicated ChitChat project.
- Every exposed table has deliberate grants and RLS policies.
- Every interactive control has real behavior or is clearly marked as planned.
- Loading, empty, error, disabled, and success states are designed.
- Privacy and encryption claims match verified code and independent review.
