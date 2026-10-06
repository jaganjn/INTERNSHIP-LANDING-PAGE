# Assignment Routing V4 Fix — 2026-10-02

The dashboard previously polled `/assignmentRoutingStatus/<requestId>`, which introduced a separate Firebase permission dependency. V4 removes that dependency.

- Dashboard verifies routing using `submittedApplications/<applicationId>/assignmentRouting`.
- Apps Script writes the receipt there after verifying the counselor sheet.
- Dashboard assignment writes counselor sheets directly from the dashboard payload and does not touch Master Sheet1.
- Master Sheet1 remains available for counselor-side CRM synchronization.
- Failed routing causes the dashboard to roll Firebase `assignedTo` back to its previous value.
- The unused `assignmentRoutingStatus` rules node is removed.
