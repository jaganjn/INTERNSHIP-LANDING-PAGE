INTERNSFORGE CRM V2 — AUDIT TRAIL
=================================

Included:
- Code.gs: latest Remove Counselor backend + bidirectional sync + table-header repair + delete lead + V2 audit logging.
- admin.js: latest Remove Counselor CRM + delete lead + audit history + logout listener.
- admin.html: latest Remove Counselor UI + Delete Lead + Remove Counselor + Logout + Lead History panel.
- dashboard.css: latest dashboard styles + audit trail + logout button styles.

AUDIT STORAGE
-------------
Firebase path:
  /applicationActivity/{Application ID}/{event ID}

Recorded sources:
- Master Sheet edits
- Counselor Sheet edits
- Admin Dashboard CRM edits
- Lead reassignment
- Counselor removal / unassignment
- Lead deletion

INSTALLATION
------------
1. Replace your Apps Script Code.gs with the included Code_REMOVE_COUNSELOR_2026-09-12.gs.
2. In Apps Script run createSheetToFirebaseTrigger().
3. Then run reinstallAllCounselorTriggers().
4. If table headers still show Column 1, Column 2, run repairAllManagedTableHeaders().
5. Replace admin.js, admin.html and dashboard.css in the dashboard project.
6. Deploy a NEW Apps Script Web App version after Code.gs changes.
7. Refresh the dashboard with a hard refresh (Ctrl+Shift+R).

IMPORTANT
---------
The audit trail is non-blocking: if Firebase rules reject /applicationActivity writes,
CRM updates continue to work, but history will show unavailable/empty.
If history does not appear, add Firebase rules allowing the authenticated admin
to read/write applicationActivity for this dashboard.
