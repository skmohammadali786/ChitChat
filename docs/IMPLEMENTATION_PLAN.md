# Implementation plan

## Completed in the foundation
- Expo, React Native, TypeScript app shell.
- Astryx-informed semantic tokens and component conventions.
- Chat list, local demo conversation, composer, secret reveal/re-hide UI, and light/dark appearance.
- Supabase email/password sign-up, sign-in, email confirmation callbacks, password reset, and session persistence.
- Mobile auth sessions stored through Expo SecureStore, web sessions stored through IndexedDB-backed AsyncStorage.
- Profile onboarding, unique usernames, bio, and opt-in username discovery.
- Exact username lookup with a private server-side rate-limit table.
- Direct conversation creation and current-user conversation listing RPCs.
- Conversation/member/message schema with row-level security and ciphertext-only message fields.
- Realtime publication setup for new message records.
- Encrypted message service interface that accepts message envelopes, not plaintext.
- Demo mode remains available while backend configuration is missing.

## Phase 2: connect and verify backend
- Supabase project created, core migrations applied, and app environment variables documented.
- Profile, messaging, group, privacy, scheduling and media metadata migrations applied and security advisors checked.
- Verify email confirmation and password recovery deep links on Android and iOS.
- Verify username discovery opt-out, exact lookup, rate limiting, and RLS behavior.
- Verify direct conversation creation is idempotent and only members can list/read it.
- Add profile editing and avatar uploads through the private Cloudflare R2 media API, with Supabase authorization metadata.
- Add device registration and account recovery design.

## Phase 3: secure messaging
- Implement the OpenMLS 0.9.2 wrapper crate and versioned UniFFI interface.
- Add device credentials, key-package publication, device verification and encrypted local MLS state.
- Replace the generic message nonce envelope with validated MLS wire-format metadata.
- Add cross-platform direct and group messaging vectors before enabling the composer.
- Validate OpenMLS 0.9.2 on Android/iOS, React Native 0.88 and Hermes. Add UniFFI bindings and cross-platform tests.
- Device credentials, key-package lifecycle, epoch changes, verification, recovery, and multi-device strategy.
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

## Complete feature checklist\nSee [FEATURE_ACCEPTANCE_MATRIX.md](FEATURE_ACCEPTANCE_MATRIX.md). It tracks every product feature and its verified status.\n\n## Definition of done
- TypeScript passes and Android development build launches.
- Backend SQL has been applied and verified against a dedicated ChitChat project.
- Every exposed table has deliberate grants and RLS policies.
- Every interactive control has real behavior or is clearly marked as planned.
- Loading, empty, error, disabled, and success states are designed.
- Privacy and encryption claims match verified code and independent review.
