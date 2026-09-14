INTERNSFORGE V3.9.1 — CONTROL HUB MOBILE VISIBILITY FIX

Issue:
V3.9 hid the entire hero-actions area on mobile, which unintentionally hid
the existing Control Hub menu.

Fix:
- Control Hub is visible on mobile in the top-right of the hero area.
- System Health remains hidden to keep the mobile header compact.
- Control Hub opens the existing module popup workspace.
- Dropdown is constrained to the viewport and scrollable.
- Desktop behavior remains unchanged.
- No backend/Firebase/Sheets changes.

Replace:
- admin.html
- admin.js
- dashboard.css

Code.gs does not need to change for this specific fix.
