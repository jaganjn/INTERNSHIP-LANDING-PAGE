# InternsForge Final Production Landing Page

This is the clean deployment package for the InternsForge 2026 internship landing page.

## Deploy

Upload every file in this folder to the root of the same Netlify/Vercel/Firebase Hosting project. Do not upload the outer folder as a nested website folder unless your hosting service is configured to publish from it.

The public landing page is `index.html`. Its final landing-page CSS and JavaScript are embedded inside the same file to prevent missing-file and cache-version problems.

## Final application flow

1. Contact step: Full name and WhatsApp number only.
2. Academic step: Email, college, department, year, interest and domain.
3. Review step: The student checks details, accepts the terms and submits.

A future step stays hidden and locked until the current step is valid. The form includes saved drafts, inline validation, field glow effects, progress animations, domain recommendations, a final review screen and optional referral sharing after successful submission.

## Important files

- `index.html` — complete public landing page, form UI, CSS and JavaScript.
- `firebase.js` — existing Firebase project configuration.
- `firebase-rules.json` — rules required by the application and admin dashboard.
- `admin.html`, `admin.js`, `dashboard.css` — admin dashboard.
- `login.html`, `login.js` — admin authentication page.
- `privacy.html`, `terms.html` — public legal pages.
- `_headers` — cache-control and basic security headers for Netlify.

## Firebase

The included `firebase-rules.json` must be published in Firebase Realtime Database Rules. The frontend code cannot update live database rules by itself.

## Verified in this package

- Inline JavaScript syntax check passed.
- Admin, login and Firebase JavaScript syntax checks passed.
- All local images, scripts, styles and linked HTML files exist.
- Three-step form flow passed on desktop and mobile test viewports.
- Only one application step is visible at a time.
- Locked-step validation passed.
- Review data rendering passed.
- Horizontal overflow check passed at 1440 px and 390 px widths.
- No JavaScript console or page errors were found in the isolated UI test.

## Publishing note

After replacing an older deployment, open the public link in a private/incognito tab. The `_headers` file prevents the landing page from being held by an old browser or CDN cache on Netlify.
