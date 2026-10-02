# Assignment Routing V5 — Firebase Key Fix

## Root cause fixed
The dashboard identifies a lead by the Firebase child key (`app.id`), while the CRM can also contain a separate business `applicationId`. V4 used the business ID for the Apps Script routing receipt but the dashboard polled the Firebase key, so the counselor-sheet route could complete while the dashboard waited forever and eventually reported that routing was not confirmed.

## V5 behavior
- Dashboard sends both identifiers: `firebaseKey` and business `applicationId`.
- Apps Script writes the assignment-routing receipt under the Firebase key that the dashboard polls.
- The receipt is mirrored under the business Application ID when the two identifiers differ for backward compatibility.
- Counselor sheet routing continues to use the business Application ID.
- Master Sheet1 is not changed by dashboard-only assignment.
- Health endpoint reports `V5-FIREBASE-KEY-FIX` so the deployed Apps Script version can be checked quickly.
