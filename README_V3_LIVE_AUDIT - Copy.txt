INTERNSFORGE V3.2 — LIVE AUDIT + RELIABLE LEAD COPY AUDIT

Fix included:
- Counselor lead copy audit no longer depends on a previous baseline.
- On every counselor-sheet edit/paste, the edited rows are checked immediately.
- If an edited row contains an Application ID that already exists on another row in the same counselor sheet, a "Lead copied" activity is written immediately.
- The event stores counselor name, source row, destination row, actor, exact timestamp, and counselor-sheet source.
- Dashboard History renders copy events as:
  Lead copied
  Sam / counselor account (or detected editor identity)
  Counselor Sheet — Sam's Leads
  From row 25 → row 40
  Exact event timestamp
- A short dedupe window prevents duplicate trigger deliveries from creating duplicate copy events.
- Normal Firebase/Master synchronization remains unchanged.

SETUP AFTER REPLACEMENT
1. Replace the Apps Script Code.gs with this version.
2. Save the project.
3. Run createSheetToFirebaseTrigger() once if required by your existing setup.
4. Run reinstallAllCounselorTriggers() once. Authorize if prompted.
5. Deploy the Apps Script Web App as a NEW VERSION, keeping the same /exec URL.
6. Open a counselor lead sheet.
7. Copy an existing complete lead row (including Application ID) to a blank row.
8. Open that lead in Dashboard → History.

IMPORTANT
- Apps Script does not expose a guaranteed Ctrl+C/Ctrl+V flag. This implementation detects the observable result: an existing Application ID appearing on a different edited row.
- Copying an existing lead to a new blank row should be detected immediately, including the first test after deployment.
- If the copied row changes the Application ID, it cannot objectively be identified as the same lead by Application ID and will be treated as a normal edit.
