# InternsForge V15.20 — Counselor Call Status Live Sync

This release makes counselor-side Call Status changes immediately visible in the Admin Application Management dashboard.

## Flow
Counselor Leads sheet → installable onEdit trigger → Master Sheet1 → Firebase submittedApplications/{Application ID} → Admin dashboard realtime listener.

The dashboard listener now updates the local Application Management row immediately when Firebase reports a counselor change, then keeps the existing Firebase → Google Sheets synchronization.

## Deploy
1. Replace Apps Script Code.gs with this Code.gs and deploy a new version of the existing Web App.
2. Replace the deployed admin.js with this admin.js in the Admin frontend.
3. Ensure counselor onEdit triggers exist. New counselors created from the dashboard should create their trigger automatically.
4. Test by changing Call Status in a counselor Leads sheet. The Application Management row should change within Firebase realtime latency.

## Related Fix: V13.7 — Abandoned Dashboard Data Loading Fix

The Abandoned Applications dashboard now uses persistent `abandonedApplications` records as the primary source and falls back to eligible legacy/incomplete `liveVisitors` sessions from older V13.x versions. Submitted/recovered sessions are excluded. The admin.js cache version is bumped so browsers load the corrected script.

No Firebase data is deleted.
