V15 — Abandoned Applications dropdown stability fix

Fixed the Recovery and Assigned To dropdowns closing/disappearing because realtime Firebase updates were replacing the table DOM while a select was focused/open.

The table now defers Abandoned Applications redraws while either dropdown is being interacted with, then refreshes safely after the interaction completes. Backend assignment/recovery endpoints from V14.9 are retained.

Also cache-busted admin.js.
