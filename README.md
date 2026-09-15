V13.7.2 — ABANDONED DASHBOARD SYNC ONLY

This patch changes only the Abandoned Applications synchronization path.
- Adds a server-side sync action that reads the existing Abandoned Applications sheet and mirrors records into Firebase /abandonedApplications.
- The Abandoned Applications Refresh button now triggers that sync and re-renders after a short delay.
- No Application Management, Live Visitors, popup, form, counselor, or other CRM logic was intentionally changed.

Deploy Code.gs as the Apps Script Web App version, then replace admin.js in the admin site and deploy.
