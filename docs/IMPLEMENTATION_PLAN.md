# Implementation plan

## Completed in the foundation
- Expo, React Native, TypeScript app shell.
- Astryx-informed semantic tokens and component conventions.
- Chat list, local conversation prototype, message composer, and secret reveal/re-hide UI.
- Light/dark theme and recipient auto-reveal preference.
- Supabase email/password auth client with persistent mobile session storage.
- Sign-up, sign-in, email confirmation deep-link handling, and username/profile onboarding.
- Dedicated profile SQL setup with private row-level security policies.
- Setup instructions covering Supabase Data API exposure and safe client credentials.

## Phase 2: connect the backend
- Create a dedicated ChitChat Supabase project and configure environment variables.
- Verify email confirmation deep links on Android and iOS.
- Add password recovery and username availability checks.
- Add profile editing and avatar uploads with strict storage policies.
- Device registration and account recovery design.
- Realtime conversation events and offline outbox.

## Phase 3: secure messaging
- Select and integrate a reviewed end-to-end encryption protocol/library.
- Device key lifecycle, key changes, verification, recovery, and multi-device strategy.
- Define secret-message payload encryption, expiry, and local caching rules.
- Threat model and independent security review before public claims.

## Phase 4: full messaging
- Message persistence and realtime delivery.
- Media, voice notes, files, groups, reactions, replies, search, scheduled messages, disappearing messages.
- Push notifications with privacy-preserving payloads.
- Abuse prevention, block/report, and operational monitoring.

## Phase 5: external sharing and monetization
- Expiring, revocable secret links with strict authorization.
- Optional subscription for convenience and customization only.

## Definition of done
- TypeScript passes and Android development build launches.
- Every interactive control has real behavior or is clearly marked as planned.
- Loading, empty, error, disabled, and success states are designed.
- All exposed tables have RLS, and Data API exposure is deliberate.
- Privacy and encryption claims match verified code.
