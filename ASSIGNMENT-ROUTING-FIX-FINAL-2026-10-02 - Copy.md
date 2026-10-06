# InternsForge Assignment Routing — Final Fix (2026-10-02)

## Intended behavior

Admin Dashboard assignment:

`Dashboard → Firebase assignedTo → selected counselor spreadsheet`

Master Sheet1 is intentionally NOT modified by the dashboard assignment.

Counselor edits and the existing CRM synchronization path remain unchanged.

## Reliability fix

Because the dashboard calls the Apps Script Web App with `no-cors`, the browser cannot read the response body. The backend now writes a small `/assignmentRoutingStatus/{requestId}` receipt after the counselor spreadsheet write. The dashboard polls that receipt and only reports success after the sheet routing is confirmed.

## Deployment

1. Replace the deployed Apps Script `Code.gs` with the included `Code.gs`.
2. Deploy a new version of the SAME Web App deployment/URL.
3. Publish the included `firebase-rules.json` if the new receipt path does not already exist.
4. Deploy the included `admin.js` with the website.
5. Test one lead: selected counselor sheet receives the lead; Master Sheet1 Assigned To remains unchanged.
