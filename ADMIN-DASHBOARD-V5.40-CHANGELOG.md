# InternsForge Admin Dashboard V5.40

This build upgrades the existing admin dashboard without requiring Cloud Functions or Blaze.

## Added / upgraded
- Real-time Live Visitors panel with independent manual refresh and a 10-second safety refresh.
- Active / Filling / Abandoned / Completed visitor summary.
- Live activity feed for visitor joins, application starts, submissions and admin status changes. The activity feed is intentionally stored in the admin browser's localStorage so it does not expose a new public Firebase path.
- Visitor environment tracking on the public portal: device type, browser, operating system, screen size, browser language, referrer and landing URL.
- Application funnel: Visitors → Started form → 80%+ progress → Submitted.
- Domain performance: retained visitors, applications and observed conversion.
- Application breakdowns by start availability, communication language and state / union territory.
- Application Management modal with search, domain/state/status filters, pagination and applicant details.
- Applicant workflow statuses: New, Reviewed, Shortlisted, Selected, Rejected.
- Persistent admin notes on each application using additional fields inside `submittedApplications`.
- Filtered CSV export from the Application Management view (Ctrl/Cmd+E while the manager is open).
- Application summary copy-to-clipboard.
- Referral performance remains realtime and now has an additional summary metric in the main dashboard.
- System health indicators and admin identity remain visible.
- Existing sign-out, password reset, sound alerts and browser push alerts are preserved.
- Application counter is reset when applications are deleted/reset.

## Firebase compatibility
The build uses the existing Firebase Realtime Database paths and authentication model. No new paid Firebase service is required.

`firebase-rules.json` includes the rules required by this build, including authenticated admin reads and the no-Blaze public application counter path.
