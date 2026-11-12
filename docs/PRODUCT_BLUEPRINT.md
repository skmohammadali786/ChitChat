# ChitChat product blueprint

## Product
ChitChat is an Android-first, privacy-first messenger. Its signature feature is recipient-controlled secret content: a sender can conceal all or selected parts of a message, and the recipient chooses whether content reveals automatically or only after a deliberate tap.

## Product principles
- Privacy is the default, not a premium trick.
- The recipient controls reveal behavior on their device.
- Secret content should be understandable before reveal, without exposing the content itself.
- Encryption and privacy claims must be backed by tested implementations, never UI labels alone.
- Messaging must remain usable on slow networks and when offline.

## Messaging
- One-to-one conversations and group conversations.
- Text, photos, videos, voice notes, and file attachments.
- Reply, forward, copy where permitted, reactions, message status, and timestamps.
- Drafts, search, pinned conversations, mute, archive, and delete.
- Typing and presence indicators with privacy controls.
- Scheduled messages and disappearing-message timers.
- Offline send queue with clear pending, sent, delivered, and failed states.

## Secret content
- Conceal an entire message or selected text sections.
- Conceal photos, videos, audio, and files behind a preview/reveal step.
- Recipient preference: automatic reveal with a playful animation, or manual reveal.
- Recipient can re-hide revealed content where technically possible.
- Sender sees a clear indication that content is concealed, not whether the recipient has viewed it unless read receipts are enabled.
- Reveal animation must respect reduced-motion preferences.
- Never describe screenshots, screen recording prevention, or local cache deletion as guaranteed unless platform behavior supports it.

## Privacy and safety
- End-to-end encryption is a release requirement for private conversations.
- Secure key generation, device identity, key verification, and multi-device key management.
- App lock, biometric unlock, notification privacy, read-receipt controls, last-seen controls, block, report, and contact permissions.
- Group membership and invite controls.
- Rate limits, spam controls, abuse reporting, and account recovery design.
- Secret media lifecycle and local storage threat model.

## Social and personalization
- Username-first discovery, optional phone-number discovery.
- Profile photo, display name, username, status, and privacy settings.
- Reactions and expressive reveal animations.
- Light, dark, and system themes with user-selectable accent palettes.

## External secret sharing
- Share a protected secret link outside ChitChat only after a secure token and expiry model is implemented.
- External recipients should receive a web reveal experience with explicit expiry and revocation.
- Do not ship public links until token entropy, access limits, abuse controls, and media authorization are reviewed.

## Business model
- Core private messaging remains usable without payment.
- Optional subscription can fund larger storage, customization, and advanced convenience features.
- Never put encryption, basic privacy, or safety controls behind a paywall.

## Release gates
1. Working local prototype and design system.
2. Authentication, profiles, contacts, and conversation persistence.
3. End-to-end encryption and key verification reviewed by security specialists.
4. Realtime delivery, push notifications, offline queue, and media storage.
5. Groups, voice/video, scheduled messages, external sharing, and subscriptions after core reliability.
