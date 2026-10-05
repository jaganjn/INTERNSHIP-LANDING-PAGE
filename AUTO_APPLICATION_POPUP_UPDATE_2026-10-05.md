# InternsForge — Automatic Application Popup Update

The landing page now automatically opens the existing guided application modal on the first visit of a browser session, after a short 1.15 second delay. When `?apply=1` or `?openApplication=1` is present, the popup opens faster (650 ms).

The auto-open uses the existing application form and recovery/Firebase logic. No backend, Firebase rules, Apps Script, Google Sheets routing, or application submission logic was changed.

The auto-open has a focused entrance animation and a small animated "Ready to build your profile?" prompt inside the form. The existing close/exit behavior remains available.

A sessionStorage flag prevents the auto-popup from interrupting every refresh. A forced query parameter can explicitly request the popup again.
