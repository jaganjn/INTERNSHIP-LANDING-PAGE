# InternsForge V15.11 — Requirements Audit Fix — 2026-09-17

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
