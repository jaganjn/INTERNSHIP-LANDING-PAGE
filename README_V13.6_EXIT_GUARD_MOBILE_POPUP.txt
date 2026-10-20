INTERNSFORGE V13.6 — EXIT GUARD + MOBILE POPUP REDESIGN

Changes:
- Deliberate navigation away from the active application (internal links, Home/navigation links) is intercepted while meaningful form data exists.
- Browser Back while the application modal is active is intercepted and uses the designed exit confirmation.
- Cancel / Close uses the designed exit confirmation.
- Clear / Start over uses the designed clear confirmation.
- Mobile exit confirmation redesigned as a compact bottom sheet with a drag-handle, compact benefits/trust content, sticky action buttons, safe-area support and reduced text density.
- Existing recovery/save flow and V13.5 behavior retained.

Browser limitation:
- A custom HTML popup cannot be rendered when a browser is actually closing a tab/window. beforeunload can only request the browser's native leave confirmation, and modern browsers control its wording. The app still attempts the recovery snapshot on page exit.
