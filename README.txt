InternsForge Admin Dashboard - Performance Fix

This update is FRONTEND JS ONLY.

Optimizations:
- CRM table uses event delegation instead of adding handlers to every row on every render.
- Counselor dropdown options are cached per render.
- Counselor controls are not rebuilt on every CRM refresh.
- CRM filter dropdowns are only rebuilt when domain/year/counselor data actually changes.
- Search input is debounced to avoid rebuilding the 100-row table on every keystroke.
- Visitor polling redraw interval changed from 2 seconds to 5 seconds; realtime child listeners still update immediately when Firebase data changes.
- Lead assignment refresh avoids rebuilding filter controls unnecessarily.

NOT CHANGED:
- Firebase database structure
- Firebase authentication
- Google Sheets / Apps Script integration
- Counselor assignment logic
- Application submission logic
- CRM data model
- APIs / backend functions
