# Assignment Routing V6 — Direct Counselor Sheet Verification

## What changed
- Dashboard assignment no longer waits on `submittedApplications/<key>/assignmentRouting`.
- Dashboard calls the existing Apps Script Web App to route the lead to the selected counselor.
- Dashboard then verifies the actual counselor spreadsheet row through a lightweight JSONP `verifyCounselorRouting` GET endpoint.
- Verification uses the Firebase key for dashboard identity and the CRM Application ID for counselor-sheet row identity.
- Master Sheet1 is not modified by dashboard assignment.
- Existing counselor -> Master/Firebase synchronization remains in place.
- HTML cache-buster updated to `admin.js?v=20261002-v6-direct-sheet-verify`.

## Deployment
1. Replace `Code.gs` in the existing Apps Script project.
2. Deploy a new version of the SAME web-app deployment URL.
3. Replace `admin.js` and `admin.html` in the website.
4. Publish `firebase-rules.json` only if the current rules do not match the supplied file.
5. Hard refresh the dashboard.

## Verification
Use the web-app health endpoint:
`<WEB_APP_URL>?action=health`

Expected version:
`V6-DIRECT-SHEET-VERIFY`

Then assign one lead and confirm:
- selected counselor's Leads sheet contains the lead;
- Firebase `assignedTo` is the selected counselor;
- Master Sheet1 `Assigned To` remains unchanged.
