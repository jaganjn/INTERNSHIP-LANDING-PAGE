INTERNSFORGE V15.23 – UNIVERSAL COUNSELOR CRM FIELD SYNC

This release makes counselor-sheet CRM edits dynamically propagate for every registered counselor:
Counselor Lead Sheet -> Master Sheet1 -> Firebase -> Application Dashboard.

Dynamically synchronized fields:
- Call Status
- Remarks
- Assigned To
- Next Follow-up
- Name, Phone, Email, College, Department, Year, Domain, State, Communication Language, Start Availability, Application Reason

No counselor name is hardcoded. The source counselor is resolved from the registered spreadsheet/counselor configuration.

V15.23 adds a unique CRM revision to counselor-originated Firebase writes and a unified child_added/child_changed Application Management listener. This prevents the dashboard from missing a counselor-originated update.

Deployment:
1. Replace Code.gs in Apps Script.
2. Save.
3. Deploy -> Manage deployments -> Edit existing Web App -> select new version -> Deploy.
4. Replace admin.js in the dashboard project and redeploy the frontend.
5. Run ensureAllCounselorTriggers() once to ensure every currently registered counselor has the installable onEdit trigger.

Do not manually run counselorSpreadsheetOnEdit().
