# InternsForge Assignment Routing Fix V2

## Root cause fixed
The dashboard stored counselor names in browser localStorage, while the Apps Script routing layer required a matching counselor in the master `Counselors` registry with a Spreadsheet ID. When the registry entry was missing, the dashboard assignment endpoint failed before the counselor sheet or Firebase assignment was written. The frontend used `no-cors`, so the backend failure was hidden and looked like a no-op.

## V2 behavior
- Admin Dashboard assignment ensures the selected counselor is registered server-side.
- If the counselor does not exist in `Counselors`, a dedicated counselor spreadsheet is created automatically.
- The selected counselor's lead sheet is then updated.
- Firebase `submittedApplications/{id}.assignedTo` is updated with `syncSource: dashboard-assignment`.
- Master Sheet1 is NOT changed by dashboard assignment.
- Dashboard modal CRM assignment changes use the same server-side counselor registration guard.
- Existing counselor reassignments still remove stale copies from the previous counselor.

## Deployment
Replace `admin.js` and `Code.gs`, deploy a new Apps Script Web App version using the same deployment URL, then hard-refresh the dashboard.
