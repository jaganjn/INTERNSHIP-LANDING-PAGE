InternsForge Admin Assignment Verification Fix — 2026-10-05

Purpose
-------
This is an ADMIN-JS-ONLY repair for counselor lead assignment.

Flow after this fix
-------------------
Admin Dashboard
  -> POST routeApplicationToCounselor
  -> Apps Script writes the selected counselor sheet
  -> Apps Script writes submittedApplications/<firebaseKey>/assignmentRouting
  -> Admin Dashboard polls that Firebase receipt
  -> Assignment is confirmed

Removed from browser flow
-------------------------
The admin browser no longer calls the Apps Script GET/JSONP verification endpoint
(verifyCounselorRouting). This removes the failing verification dependency shown
by the "Could not reach the Apps Script verification endpoint" error.

Backend
-------
No Code.gs, Firebase Rules, Google Sheets schema, counselor registry, or Apps Script
endpoint URL changes are included in this package.

Deployment
----------
Replace ONLY the existing admin.js with this file.
Keep the existing backend and admin.html unchanged.
A hard refresh (Ctrl+F5) is recommended after replacement.

Validation performed
--------------------
- Node JavaScript syntax check: PASS
- JSONP verifier function reference removed: PASS
- Firebase receipt polling function present: PASS
- routeApplicationToCounselor POST path preserved: PASS
