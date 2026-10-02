# Firebase Rules Deployment Fix — 2026-10-02

## Root cause fixed
The previous rules file contained invalid Realtime Database Rules syntax:

`data.val() is number`

Realtime Database rules require:

`data.isNumber()`

The invalid expression appeared in the publicStats counter rules. If the rules publish failed, the live database could continue using older rules that did not contain the `assignmentRoutingStatus` path. The dashboard would then show:

`permission_denied at /assignmentRoutingStatus/<requestId>`

## Fix
All three occurrences were changed to `data.isNumber()`.

The `assignmentRoutingStatus` path remains protected by authenticated access. The dashboard assignment flow uses this path only as a server-written routing receipt that the signed-in admin dashboard reads.

## Required deployment
1. Deploy `firebase-rules.json` to the same Firebase Realtime Database used by the dashboard.
2. Confirm the Firebase console shows a successful rules publish.
3. Hard-refresh the dashboard.
4. Assign one test lead to a counselor.

Do not change the Apps Script Web App URL for this fix.
