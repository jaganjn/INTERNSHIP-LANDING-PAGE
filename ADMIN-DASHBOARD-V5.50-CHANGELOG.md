# InternsForge Admin Dashboard V5.50

## UI/UX
- Reworked the admin home into an accuracy-first dark command center.
- Added clearer visual hierarchy: command hero, secure-session badge, operational KPIs, application pulse, status queue, live visitors, applications, funnel, domain performance, activity timeline, audience insights, and referral performance.
- Added responsive layouts for desktop, tablet, and mobile with improved touch targets, compact cards, sticky tables, and reduced-motion support.
- Kept existing login/auth, password reset, notification settings, Firebase connection status, referral sections, and destructive data controls.

## Accuracy / analytics
- Application trend chart now uses the actual `submittedAt` timestamps and explicitly reports the last 7 days.
- Added a today-vs-previous-day submission comparison.
- Added explicit Shortlisted and Selected totals derived from stored `adminStatus` values.
- Status snapshot now visualizes the distribution of New, Reviewed, Shortlisted, Selected, and Rejected records.
- Funnel labels were changed to "observed visitor records" so retained-session data is not presented as a guaranteed unique-user conversion rate.
- Domain performance no longer labels a mismatched all-time-applications vs retained-visitor calculation as a true conversion rate; it shows applications, observed visitor records, and share of total applications instead.
- Added independent Firebase read-health checks for live visitors, applications, and referrals.
- Application Manager now supports Domain, State, Year, Language, Status, and free-text search filters.
- Fixed browser title text to use InternsForge consistently.

## Reliability
- Preserved independent Live Visitors refresh through `refreshLiveVisitorsOnly()`.
- Preserved realtime `liveVisitors` listener plus the existing 10-second safety refresh.
- No new paid Firebase service or Cloud Function dependency introduced.
