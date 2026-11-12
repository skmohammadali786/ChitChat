# Implementation plan

## Completed in the foundation
- Expo, React Native, TypeScript app shell.
- Astryx-informed semantic tokens and component conventions.
- Chat list, local conversation prototype, message composer, and secret reveal/re-hide UI.
- Light/dark theme and recipient auto-reveal preference.
- Supabase email/password auth client with persistent mobile session storage.
- Sign-up, sign-in, email confirmation deep-link handling, and username/profile onboarding.
- SQL setup script with least-privilege grants and row-level security for private profiles.

## Phase 2: identity and backend
- Complete Supabase project setup and app environment configuration.
- Username availability checks and profile editing.
- Device registration and account recovery design.
- Realtime conversation events and offline outbox.
- Storage policies for media and short-lived secret assets.

## Phase 3: security
- Select and integrate a reviewed end-to-end encryption protocol/library.
- Device key lifecycle, key changes, verification, recovery, and multi-device strategy.
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
- TypeScript passes and Android build launches.
- Every interactive control has real behavior or is clearly marked as planned.
- Loading, empty, error, disabled, and success states are designed.
- Privacy and encryption claims match verified code.
