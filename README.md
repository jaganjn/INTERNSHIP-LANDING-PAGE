# InternsForge V13.7 – Abandoned Dashboard Data Loading Fix

The Abandoned Applications dashboard now uses persistent `abandonedApplications` records as the primary source and falls back to eligible legacy/incomplete `liveVisitors` sessions from older V13.x versions. Submitted/recovered sessions are excluded. The admin.js cache version is bumped so browsers load the corrected script.

No Firebase data is deleted.
