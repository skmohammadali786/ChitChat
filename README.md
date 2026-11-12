# ChitChat

ChitChat is an Android-first, privacy-focused messaging app. Its signature feature lets people conceal text or media and gives recipients control over when secret content is revealed.

## Tech foundation
- Expo
- React Native
- TypeScript
- Android-first, with iOS and web targets kept available through Expo

## Run locally
1. Install Node.js LTS.
2. Install dependencies with `npm install`.
3. Start Expo with `npx expo start`.
4. Open the project in Expo Go or an Android emulator.

## Current prototype
- Conversation list with search and unread indicators.
- Chat screen with a working local message composer.
- Secret message reveal and re-hide interaction.
- Recipient preference for automatic versus manual reveal.
- Light and dark appearance toggle.
- Shared design tokens and reusable avatar component.

The current screens use local sample data. Authentication, network delivery, media upload, push notifications, and end-to-end encryption are not implemented yet. The app does not claim to provide secure messaging until the encryption protocol and key lifecycle are implemented and reviewed.

## Design system
See [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). Meta Astryx is used as a design-convention reference, not imported as a dependency.

## Product and engineering plans
- [Product blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
