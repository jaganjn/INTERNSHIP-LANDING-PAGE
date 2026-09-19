INTERNSFORGE ADMIN - APPLICATION MANAGEMENT DELETE VISIBILITY FIX

What was updated:
- Application Management rows now explicitly expose Open / History / Delete.
- Delete button is forced visible and clickable.
- Actions column is sticky on the right so Delete remains visible even when the CRM table is horizontally scrolled.
- Mobile/tablet action column remains visible.
- Application modal Delete Application control is preserved.

Backend preserved:
- Firebase configuration unchanged.
- Firebase database paths unchanged.
- Google Apps Script / Code.gs unchanged.
- Google Sheets integration unchanged.
- Application delete flow unchanged.
- Counselor assignment/data logic unchanged.

Install:
1. Replace the existing admin.js with admin.js from this package.
2. Replace the dashboard CSS file with dashboard.css (use the same CSS filename your admin HTML currently loads).
3. Deploy to Vercel.
4. Hard refresh the admin dashboard with Ctrl+Shift+R.

Expected Application Management row:
Open | History | Delete

The Delete action continues to use the existing deleteSingleApplication() flow.
