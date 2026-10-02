V7 Assignment Routing Fix

ROOT CAUSE FIXED:
Code.gs contained two doGet() functions. The later legacy doGet() overrode the V6/V7 doGet(e), so verifyCounselorRouting was unreachable.

CHANGES:
- Removed the duplicate legacy doGet().
- Preserved the V7 doGet(e) with verifyCounselorRouting JSONP and health endpoint.
- Bumped admin.js cache-buster to v7.
- Kept Firebase rules unchanged from V6.

DEPLOY:
1. Replace Apps Script Code.gs and deploy a NEW VERSION of the SAME Web App deployment.
2. Replace admin.js and admin.html in the dashboard.
3. Publish firebase-rules.json if your Firebase console is not already on the V6 rules.
4. Hard refresh the dashboard (Ctrl+Shift+R).
5. Verify the Web App URL with ?action=health and confirm V7-DOGET-CONFLICT-FIX.
