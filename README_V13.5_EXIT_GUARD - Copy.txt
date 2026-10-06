InternsForge V13.5 — Application Exit & Recovery Guard

This update extends the V13.4 recovery dashboard with a consistent student-facing exit guard.

Captured abandonment actions:
- Cancel / close application
- Clear application / Start over
- Browser Back while filling
- In-page navigation such as Home or other sections
- Same-site page navigation while filling

Behavior:
- A designed confirmation dialog is shown before the student leaves when meaningful form data exists.
- Choosing Continue/Stay keeps the application open.
- Choosing Leave/Clear records a recovery snapshot with the corresponding exit type/reason.
- Firebase realtime recovery and Google Sheets recovery are both updated.
- Submitted applications are not treated as abandoned.
- Browser Back is guarded with a temporary history entry and then honors the original Back action after confirmation.

Important:
- The Apps Script endpoint must remain deployed and reachable.
- Existing V13.4 Firebase rules remain applicable.
- Test with a dummy student before production use.
