# ChitChat design system

This system takes inspiration from the conventions documented by Meta Astryx. Astryx is a reference for design thinking and consistency, not a runtime dependency.

Reference: https://github.com/meta/astryx

## Principles
- Guidance over rigid enforcement. Components expose semantic intent and tokens control visual identity.
- One visual language across screens and component families.
- Design every state: default, pressed, focused, disabled, loading, selected, empty, and error.
- Minimize decoration. Use color and elevation to communicate hierarchy, not to decorate every surface.
- Accessibility is part of the component contract, including labels, touch targets, contrast, and reduced motion.
- Themes change tokens, not component structure.

## Token layers
- Color: background, surface, raised surface, text, muted text, border, brand, success, warning, and danger.
- Space: a 4-point base scale.
- Shape: small, medium, large, and pill radii.
- Type: caption, body, title, heading, and display roles.
- Motion: short state transitions and spring-based reveal, with shared page transitions and spring-based press feedback. Both honor the operating system reduced-motion preference.

## Component conventions
- Prefer semantic props such as `disabled`, `selected`, `loading`, and `tone`.
- Components own their interaction states and accessibility labels.
- Screen components compose shared components rather than duplicating styles.
- Do not use arbitrary one-off values when an existing token expresses the same intent.
- Use platform-native behavior for navigation, keyboard handling, and touch feedback.

## Current implementation
- `src/components/ScreenTransition.tsx`: shared page and tab entrance transitions, with reduced-motion support.
- `src/components/MotionPressable.tsx`: shared animated press feedback and Android ripple, with reduced-motion support.
- Tokens: `src/theme/tokens.ts`
- Avatar: `src/components/Avatar.tsx`
- Secret reveal: `src/components/SecretReveal.tsx`
- App shell and initial screens: `App.tsx`

## Quality checklist
- [ ] Contrast checked in light and dark themes.
- [ ] Touch targets meet platform guidance.
- [ ] TalkBack labels and focus order verified.
- [ ] Reduced-motion behavior implemented and tested.
- [ ] Loading, empty, error, disabled, and success states covered.
- [ ] Screenshots reviewed at compact and large Android sizes.
