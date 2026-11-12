# Implementation plan

## Phase 1: app foundation
- Expo + React Native + TypeScript, Android-first.
- Astryx-informed design conventions implemented natively: semantic tokens, consistent component APIs, state coverage, accessibility, and restrained visual hierarchy.
- Chat list, conversation view, message composer, secret reveal interaction, settings shell, and theme foundation.
- Local mock data only. No false claim of backend persistence or encryption.

## Phase 2: identity and backend
- Supabase Auth, username profiles, device registration, contact discovery controls.
- Database schema with strict row-level security.
- Realtime conversation events and offline outbox.
- Storage policies for media and short-lived secret assets.

## Phase 3: security
- Select and integrate a reviewed end-to-end encryption protocol/library.
- Device key lifecycle, key changes, verification, recovery, and multi-device strategy.
- Threat model and independent security review before public claims.

## Phase 4: full messaging
- Media, voice notes, files, groups, reactions, replies, search, scheduled messages, disappearing messages.
- Push notifications with privacy-preserving payloads.
- Abuse prevention, block/report, and operational monitoring.

## Phase 5: external sharing and monetization
- Expiring, revocable secret links with strict authorization.
- Optional subscription for convenience and customization only.

## Definition of done
- TypeScript passes.
- Android build launches.
- Every interactive control has a real behavior or is clearly marked as planned.
- Loading, empty, error, disabled, and success states are designed.
- Privacy and encryption claims match verified code.
