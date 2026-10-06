InternsForge Admin UI — repaired workspace build

Fixed in the frontend:
- Quick-operation cards now actually open their workspaces.
- Workspace sections stay mounted in one stable DOM location; switching modules no longer moves elements and break event handlers.
- Duplicate dashboard/module rendering removed; detailed modules are shown only inside the focused workspace.
- The redundant Application Recovery overview card was removed from the main analytics grid; the full Abandoned Applications workspace remains available.
- Referral workspace remains a single grouped workspace.
- Mobile Applications launcher uses the same stable CRM opener.
- Application modal z-index/overlay behavior is preserved for CRM actions.

Backend unchanged:
- Firebase rules and database paths
- Apps Script endpoints
- Google Sheets sync/routing
- Counselor assignment/routing logic
- Firebase authentication/configuration

Keep the existing dashboard.css, firebase.js, push-config.js and firebase-messaging-sw.js from the working deployment.
