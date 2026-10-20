# Admin Dashboard Assignment Routing Fix — 2026-10-02

## Problem fixed
Admin Dashboard assignments were updating Firebase, then the dashboard's generic `submittedApplications/child_changed` listener sent the full record to `updateApplicationInSheet()`. That endpoint updated `Sheet1` before routing the lead to the selected counselor.

## New behavior
- Admin Dashboard row/bulk assignment routes Firebase + the selected counselor sheet only.
- Admin Dashboard modal CRM saves use a dedicated backend path.
- When `Assigned To` changes from the dashboard, Master Sheet1 keeps its existing `Assigned To` value.
- Counselor-sheet edits continue to synchronize back to Master/Firebase through the existing counselor workflow.
- Dashboard-originated Firebase writes are marked with `syncSource` (`dashboard-assignment` / `dashboard-crm`) so the generic realtime Sheets listener does not echo them back into Master Sheet1.
- Removing a counselor also uses the counselor-only routing path.

## Files changed
- `admin.js`
- `Code.gs`

## Firebase rules
`firebase-rules.json` was intentionally not changed in this patch. Its broader write permissions should be hardened as a separate security task after confirming the production authentication/role model.
