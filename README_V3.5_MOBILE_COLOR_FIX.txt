InternsForge V3.5 — Mobile Admin Color / Contrast Fix

This is a frontend-only correction to the V3.4 mobile admin redesign.

Fix:
- CRM KPI numbers were inheriting the old light-theme #26334a text color while the mobile cards use a dark background.
- Mobile KPI labels and values now use high-contrast colors.
- Individual KPI values use subtle semantic colors where appropriate.
- Desktop styles/layout are unchanged.

Replace dashboard.css with the included file. No Code.gs, Firebase, audit, counselor sync, or backend changes are required.
