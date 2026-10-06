INTERNSFORGE V3.9 — MOBILE OPERATIONS COCKPIT
- Mobile admin redesign only (max-width: 700px).
- Desktop layout and existing desktop behavior are preserved.
- Adds live pipeline indicators, conversion funnel, 7-day trend,
  counselor workload, domain demand mix, live visitor pulse and a
  mobile power-tool deck.
- Existing Application CRM remains in the mobile popup drawer.
- Code.gs is the V3.8 date/time-safe backend.
Deployment: replace admin.html, admin.js, dashboard.css and Code.gs; save;
run repairMasterDateTimeCellsOnly() if needed; reinstall triggers; deploy a
new Web App version; hard refresh mobile.
