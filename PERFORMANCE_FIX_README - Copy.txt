INTERNSFORGE ADMIN DASHBOARD - PERFORMANCE FIX

Replace the existing frontend admin.js with the included admin.js.

IMPORTANT:
- Firebase configuration/database: NOT changed
- Firebase Authentication: NOT changed
- Google Apps Script / Code.gs: NOT changed
- Google Sheets integration: NOT changed
- Application submission flow: NOT changed
- Counselor assignment logic / data paths: NOT changed
- CRM data structure: NOT changed

Performance changes:
1. CRM row actions now use event delegation instead of attaching listeners to every row.
2. CRM search/filter inputs are debounced.
3. Single counselor assignment no longer forces a complete CRM rebuild.
4. Application realtime updates no longer redraw visitor/referral modules unnecessarily.
5. Live visitor rendering is throttled to reduce main-thread work.
6. Visitor periodic redraw reduced from every 2 seconds to every 5 seconds.
7. Referral search is debounced.
8. CRM controls remain fully functional after table refreshes.

Deployment:
- Replace your current admin.js with this file.
- Redeploy the same project.
- Hard refresh the browser after deployment (Ctrl+Shift+R).
