INTERNSFORGE ADMIN — PROPER MATCHED FRONTEND FIX (2026-09-19)

Replace BOTH files together in the deployed admin frontend:
1. admin.js
2. dashboard.css

Do not mix one file with an older/newer dashboard asset.

This package:
- restores the complete V3.6 dashboard styling
- keeps the performance-fixed admin.js
- keeps Open / History / Delete visible in Application Management
- does not contain or change Code.gs
- does not change Firebase configuration
- does not change Google Sheets / Apps Script backend
- does not change CRM data paths

After replacing both files, redeploy Vercel and hard refresh with Ctrl+Shift+R.
