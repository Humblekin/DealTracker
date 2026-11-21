# Accessibility

DealGuider aims to be usable with keyboard, screen-reader, zoom, and reduced
motion settings. This document describes the current implementation; it is not
a claim of WCAG conformance.

## Current support

- Layouts include a skip link and semantic `main` regions; forms use native
  inputs and buttons.
- Login and registration fields have explicit labels.
- Global keyboard focus outlines are defined for links, buttons, and form
  controls. The notification menu and mobile drawer use keyboard-operable
  buttons and links.
- Primary deal fields and payout controls have programmatic labels, and the
  dispute dialog identifies itself to assistive technology.
- A global reduced-motion preference limits CSS animation and transition
  durations.
- Some animated mascot components already respect `prefers-reduced-motion`.
- The application has responsive layouts for narrow screens.

## Checks performed

- Reviewed shared navigation and primary account forms in source.
- Ran the repository lint, unit-test, and production-build commands.
- Automated accessibility scanning and a complete keyboard/screen-reader
  evaluation have not been performed.

## Known limitations

- Some form labels are still not programmatically associated with their
  controls.
- Modal focus placement, focus trapping, and focus restoration are not
  consistently implemented.
- Color contrast has not been measured across both themes and every route.
- JavaScript-driven animation and some component-specific effects may not
  respond to reduced-motion settings.

## Reporting issues

Report accessibility issues through the repository's issue tracker. Include the
route, browser and assistive technology (if applicable), keyboard steps, and
the expected versus observed behavior. Avoid including private transaction or
account information.
