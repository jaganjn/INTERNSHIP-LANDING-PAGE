# InternsForge V15.12 — Abandoned Applications Sync Repair

## Purpose
Fix the Abandoned Applications dashboard showing 0 records while preserving the requirement that Firebase/liveVisitors must never periodically rewrite the Google Sheet.

## Final synchronization model
- Google Sheet is the durable source for abandoned records.
- Firebase is a realtime mirror for the Admin Dashboard.
- Student recovery saves may create/update the student's recovery snapshot in the Sheet and Firebase.
- Admin Dashboard Recovery Status changes update only column 23 in the Sheet and the matching Firebase field.
- Admin Dashboard Assigned To changes update only column 25 in the Sheet and the matching Firebase field.
- Admin Dashboard delete removes only the selected Draft ID.
- Firebase -> Sheet automatic synchronization is disabled.
- liveVisitors -> Sheet automatic synchronization is disabled.
- A safe 1-minute Sheet -> Firebase mirror may run; it only updates Firebase when actual Sheet data differs, so it does not rewrite the Sheet.
- Draft ID is the only identity key for abandoned records.

## One-time deployment / repair
1. Replace Code.gs with this version.
2. Deploy a new version of the existing Apps Script Web App deployment.
3. Run `repairAndStartAbandonedSync()` once from Apps Script.

That function:
- removes duplicate Draft ID rows,
- keeps the newest active duplicate and merges missing values,
- preserves Recovery Status / Application ID / Assigned To,
- mirrors all repaired Sheet records to Firebase,
- installs exactly one safe Sheet -> Firebase 1-minute trigger,
- removes legacy Firebase/liveVisitors -> Sheet triggers.

## Do not run
Do not run old Firebase -> Sheet functions as a periodic trigger.
Do not create multiple abandoned synchronization triggers manually.

## Dashboard expectation
After the one-time repair, the Admin Dashboard should read the populated `/abandonedApplications` Firebase mirror and show the abandoned records in realtime.
