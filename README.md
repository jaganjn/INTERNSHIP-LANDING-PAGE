# InternsForge V15.21 — Counselor → Dashboard Live Status Sync

## Root cause fixed
The Admin Dashboard's “Add new counselor” flow previously added the counselor only to browser localStorage. It did not register the counselor in the Apps Script `Counselors` registry or install the counselor spreadsheet `onEdit` trigger. Therefore a Call Status changed in a newly-added counselor's sheet could not reliably flow back to Firebase/Application Management.

## Permanent behavior
1. Dashboard adds counselor.
2. Browser registers counselor with Apps Script.
3. Apps Script creates/initializes the dedicated counselor spreadsheet when needed.
4. Apps Script enforces the canonical 17-column counselor schema.
5. Apps Script installs `counselorSpreadsheetOnEdit` for that spreadsheet.
6. When counselor changes Call Status, the installable trigger runs:
   Counselor Sheet → Master Sheet1 → Firebase → Application Management.
7. The Admin dashboard's Firebase listener updates immediately.

## Deployment
Replace `Code.gs` and deploy the existing Web App deployment as a new version.
Replace `admin.js` and redeploy the dashboard.

## Deploy
1. Replace Apps Script Code.gs with this Code.gs and deploy a new version of the existing Web App.
2. Replace the deployed admin.js with this admin.js in the Admin frontend.
3. Ensure counselor onEdit triggers exist. New counselors created from the dashboard should create their trigger automatically.
4. Test by changing Call Status in a counselor Leads sheet. The Application Management row should change within Firebase realtime latency.

## Existing counselors
Run `ensureAllCounselorTriggers()` once after deployment. For a specific registered counselor, `verifyCounselorLiveSync("Name")` can verify/rebuild the trigger.

Do not manually run `sheetOnEdit` or `counselorSpreadsheetOnEdit`.

## Related Fix: V13.7 — Abandoned Dashboard Data Loading Fix

## Related Fix: V15.11 — Requirements Audit Fix — 2026-09-17
This is a targeted stability patch for the Abandoned Applications workflow.

This is a targeted stability patch for the Abandoned Applications workflow.

## Enforced rules
- Abandoned Applications uses Draft ID as the unique row identity.
- Duplicate rows with the same Draft ID can be cleaned with `cleanupAbandonedApplicationDuplicates()`.
- Firebase/liveVisitors cannot automatically rewrite existing Abandoned Applications Sheet rows.
- Firebase → Sheet synchronization is disabled, including the exposed Apps Script action.
- The old manual Firebase → Sheet recovery controls were removed from `admin.html`.
- Admin Dashboard Recovery Status updates only column 23.
- Admin Dashboard Assigned To updates only column 25.
- Admin Dashboard delete removes only the selected Draft ID.
- Student recovery snapshots may refresh entered application fields, but cannot overwrite Recovery Status, Application ID, or Assigned To.
- Existing abandoned sync triggers are removed by `createAbandonedFirebaseToSheetTrigger()`; no repeating Firebase/liveVisitors → Sheet trigger is created.
- The Clear Application flow in the V15.10 frontend clears the UI immediately and records recovery in the background.

## One-time cleanup
After deploying the Code.gs, run:

`cleanupAbandonedApplicationDuplicates()`

Then do not run old Firebase → Sheet sync functions.

## Deployment
- Replace `Code.gs` in Apps Script.
- Update the existing Web App deployment to the new version.
- Replace `admin.html` only if this patch is being applied to the same frontend project.
- Hard-refresh the Admin Panel.
