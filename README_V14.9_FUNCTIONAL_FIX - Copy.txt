V14.9 — Abandoned Applications functional control fix

Fixes Recovery Status and Assigned To controls by using a readable Apps Script GET endpoint instead of no-cors POST requests. The dashboard now validates the server response before applying the optimistic state update and reverts the control on failure.

Code.gs adds doGet() support for:
- updateAbandonedApplicationAssignment
- updateAbandonedRecoveryStatus
- deleteAbandonedApplication
- health

Admin UI keeps the existing CRM styling and Open | History | Delete actions.
