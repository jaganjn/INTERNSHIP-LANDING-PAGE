INTERNSFORGE V3 — LIVE-SYNCED AUDIT TRAIL
=========================================

This package upgrades the V2 audit trail so that history follows the current
live Firebase application data and records edits from every supported source:

1. CRM Dashboard / Firebase
2. Master Sheet (Sheet1)
3. Every individual counselor Leads spreadsheet

V3 FEATURES
------------
- Records editor identity for Google Sheets edits using the Apps Script edit
  event user when Google exposes it; falls back to the counselor/source name
  when the account identity is unavailable.
- Dashboard edits record the signed-in Firebase admin email.
- Counselor-sheet edits are synchronized to Firebase, Master Sheet, and the
  Dashboard.
- Master-sheet edits are synchronized to Firebase and the assigned counselor.
- Multi-row and multi-cell paste/fill operations are processed row-by-row.
- Audit entries are compared against the live Firebase application state so
  the history reflects actual old -> new live values instead of only the
  edited cell event payload.
- Next Follow-up date formats are normalized for comparison to avoid false
  history entries.
- System synchronization through setValue/setValues does not fire the
  installable onEdit trigger, preventing duplicate audit entries.
- Dashboard Lead History uses a real-time Firebase listener while the modal
  is open, so counselor/master edits appear without needing a page refresh.
- Existing Delete Lead, Remove Counselor, Logout, counselor routing and
  bidirectional sync features are preserved.

FIREBASE
--------
The audit trail is stored at:
/applicationActivity/{Application ID}/{eventId}

Realtime Database rules must allow authenticated admin read/write access to
applicationActivity. Use the corrected rules already supplied in this chat.

APPS SCRIPT SETUP
-----------------
1. Replace the existing Code.gs with the Code.gs in this package.
2. Run createSheetToFirebaseTrigger once.
3. Run reinstallAllCounselorTriggers once.
4. Run repairAllManagedTableHeaders if the Google Sheets Table headers need
   repair.
5. Do NOT manually run sheetOnEdit, counselorSpreadsheetOnEdit,
   syncSheetRowToFirebase or syncCounselorRowToFirebase.
6. Redeploy the Apps Script Web App as a NEW VERSION after changing Code.gs.
   Keep the same /exec URL used by the dashboard.

TEST PLAN
---------
A. Master Sheet: change Call Status. Confirm Firebase, counselor sheet and
   Dashboard update; History shows the editor account and old -> new.
B. Counselor Sheet: change Call Status. Confirm Firebase, Master and
   Dashboard update; History shows the counselor editor account.
C. Counselor Sheet: paste multiple cells/rows. Confirm each affected live
   Application ID is updated and its History records the actual changed
   fields.
D. Open a lead History panel and make the change from another interface.
   The History panel should update in real time.
E. Confirm a single human edit produces one audit event, not duplicates from
   downstream synchronization.

IMPORTANT IDENTITY NOTE
-----------------------
Google Apps Script does not guarantee that the editor account is available
for every trigger execution. V3 uses e.user first and Session active user as a
fallback. If Google withholds both identities, the audit still records the
source/counselor name rather than inventing an email address.


V3.1 COPY/PASTE AUDIT UPDATE
=============================
- Individual counselor lead sheets now detect newly-created duplicate Application IDs after an edit/paste.
- When an existing lead appears in a new row, the audit records "Lead copied" with counselor sheet, editor, source row and destination row.
- This does not create a second Firebase application; the Application ID remains the live lead identity.
- Google Sheets does not expose a reliable Ctrl+C/Ctrl+V flag to Apps Script, so copy detection is based on the actual duplicated lead appearing in the sheet.
- First observation of a counselor sheet establishes a baseline and does not create false copy events.
