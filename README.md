# InternsForge 2026 — Admin + Counselor CRM

This package contains the InternsForge admin dashboard, Firebase integration files, and the current Google Apps Script used for the centralized database and dedicated counselor spreadsheets.

## Application CRM
- Realtime Application Management dashboard.
- Search across name, phone, email, college and Application ID.
- Filters for call status, domain, year and follow-up state.
- Canonical Call Status list shared by the dashboard and managed counselor sheets.
- Metrics: All Applications, Not Contacted, Follow-ups Due, Interested, Paid / Pre-Reg and Enrolled.
- Student detail modal with Call, WhatsApp and Email quick actions.
- CRM CSV export of the current filtered view.
- Counselor assignment and dedicated counselor spreadsheet routing.

## Canonical Call Status list
1. Not Contacted
2. New
3. Connected
4. Callback
5. Details Shared
6. Follow-up
7. Interested
8. Not Interested
9. Not Picking
10. Paid / Pre-Reg
11. Enrolled
12. RNR
13. Invalid Number

Legacy values are normalized as follows:
- Called → Connected
- Call Back → Callback
- Selected → Paid / Pre-Reg
- Joined → Enrolled
- Not Reachable → Not Picking

## Google Sheets / Apps Script
The included `Code.gs` is based on the current centralized Apps Script architecture:
- `Sheet1` is the central database.
- `Counselors` stores counselor names and dedicated Spreadsheet IDs.
- Each counselor has a separate spreadsheet with a `<Counselor Name>'s Leads` sheet.
- Counselor edits synchronize to the master Sheet1 and Firebase.
- The master spreadsheet is referenced explicitly by its configured `MASTER_SPREADSHEET_ID` so counselor triggers do not accidentally search for the registry inside a counselor spreadsheet.
- Call Status data validation is applied to managed sheets.
- `standardizeAllCallStatuses()` can be run once to convert existing legacy statuses.

### Important Apps Script setup
1. Replace the central Apps Script project's `Code.gs` with the included file if you want to use this package's current Apps Script version.
2. Keep the existing Script Property `FIREBASE_SERVICE_ACCOUNT_JSON`.
3. Keep the counselor installable triggers; the script can create missing counselor triggers through the existing connection/setup functions.
4. The master Spreadsheet ID is already set in `Code.gs` for the current central spreadsheet.
5. If `Code.gs` is deployed as the Web App, update the existing Web App deployment to a new version while keeping the same Web App URL used by the dashboard.
6. Run `standardizeAllCallStatuses()` once from the central Apps Script editor after authorization if you want existing Sheet values converted to the canonical list immediately.

## Dashboard deployment
The web dashboard files are static Firebase-hosted files. `admin.html`, `admin.js`, and `dashboard.css` have been updated for the canonical status list and legacy-status normalization.

The admin JavaScript cache-busting query has been updated to `admin.js?v=20260911-counselor2-status`.
