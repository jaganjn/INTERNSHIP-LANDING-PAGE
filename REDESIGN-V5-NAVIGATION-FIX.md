# InternsForge V5 — Navigation Fix

## Problem
The header had a later CSS rule using `position:absolute`, which caused the navigation bar to sit on top of the hero and visually overlap the first section.

## Fix
- Restored the header to `position: sticky` with normal document flow.
- Added explicit width, margin, and sizing rules.
- Kept the premium floating/blurred visual treatment.
- Preserved desktop, tablet and mobile navigation.
- Prevented legacy absolute-position rules from pulling the hero under the header.
