# InternsForge Public Website — Conversion Redesign V1.0

## Direction
The public landing page is revised around one clear conversion path:
Visitor → Explore → Start application → Review → Submit → Request counselling guidance → Refer a friend.

## UX changes
- Hero CTA changed to **Submit Application**.
- Secondary hero action changed to **Explore Domains**.
- Added a compact conversion bridge explaining the counselling-call next step.
- Application reason is now optional to reduce friction while preserving the field in submitted data.
- Added optional counselling request and preferred time window in the review step.
- Added a post-submission counselling request state; it is explicitly described as a request, not a confirmed appointment.
- Expanded the referral experience with a clearer four-step referral journey and non-promissory value statements.
- Kept the existing Firebase, Google Sheets, visitor tracking, referral attribution, draft saving and application reference behavior.
- Preserved the existing domain explorer and application wizard.

## Booking note
No external scheduling provider or booking URL was invented. The current experience records a counselling-call request in the submitted application. A real calendar booking flow can be connected later by adding the actual scheduling URL/provider.

## Validation performed
- Extracted inline JavaScript from `index.html` and passed `node --check`.
- Validated `firebase-rules.json` with `python -m json.tool`.
- Confirmed the new counselling fields are present in the HTML and application payload code.
- Confirmed the referral page is self-contained and preserves the `ref` parameter.
