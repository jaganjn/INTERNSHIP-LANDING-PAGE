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


## Admin password recovery

The admin login page now includes **Forgot your password?**. Password recovery does not require an active admin session.

1. Open `login.html`.
2. Select **Forgot your password?**.
3. Enter the Firebase administrator email.
4. Select **Send Reset Link**.
5. Open the **newest** Firebase reset email and use the link once.
6. Set the new password on Firebase's secure reset page.
7. Return to the login page and sign in with the new password.

The reset request uses Firebase `ActionCodeSettings` with an authorized continue URL. The dashboard reset button uses the same flow. The dashboard no longer signs the administrator out 1.2 seconds after sending the email, so the email can safely be opened on another device.

If Firebase shows an expired/already-used message, request a fresh email and use only the newest link. Each password-reset action code is single-use.

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

## Admin data controls

The admin dashboard includes Clear Tracking, Delete Applications, Delete Referrals and Full Reset.
The bundled `firebase-rules.json` permits authenticated admin deletion of the collection-level paths while
preserving public live-visitor writes at individual visitor IDs. Publish these rules to the same Firebase
Realtime Database used by `firebase.js` before using the destructive controls in production.

Example Firebase CLI deployment from this project root:
`firebase deploy --only database`


## Background Admin Push Notifications (required one-time setup)

This project uses Firebase Cloud Messaging (FCM) so new-application notifications can arrive even when `admin.html` is closed. Background notifications now use standard Web Push with a bundled public VAPID key. No Firebase Console Web Push certificate key is required in the frontend.

Deploy the included Firebase Cloud Function after installing the `functions/` dependencies. The function sends the push notification when a new `submittedApplications` record is created.


Background push setup:
1. Deploy the site over HTTPS.
2. From the functions directory run `npm install`, then deploy with `firebase deploy --only functions`.
3. Open Admin Dashboard, click Enable Browser Alerts, and allow notifications.
4. Close the Admin Dashboard and submit a test application from another device. The registered admin device should receive the notification.
5. The notification sound is controlled by the browser/OS when the page is closed.


## Live application counter (Spark-plan compatible)
The public landing page reads only `publicStats/applicationCount`; individual applications remain protected. New successful submissions increment the aggregate with a Realtime Database transaction. The authenticated admin dashboard synchronizes the aggregate to the exact application total, including after deletions/reset. Cloud Functions are not required for this counter.

Password recovery now includes a custom Firebase email action handler at reset-password.html. Configure Firebase Authentication Email Templates -> Password reset -> Customize action URL to the deployed reset-password.html URL.

## Latest integrated admin + mobile build
- Admin dashboard realtime application synchronization retained.
- Spark-compatible public aggregate application counter retained.
- Login-page password recovery and custom reset-password handler retained.
- Mobile domain/card contrast improvements and automatic card transitions retained.


## Google Sheets Recovery
The Admin Dashboard includes Sync Today to Sheets and Recover All Firebase Data. The Apps Script accepts Firebase recovery payloads and deduplicates by Application ID/fingerprint.


## Application CRM (v6)
The upgraded admin dashboard includes a dedicated Application CRM with:
- Search across name, phone, email, college and Application ID.
- Filters for call status, domain, year and follow-up state.
- Not Contacted, Interested, Selected, Joined and follow-up counters.
- Student detail modal with Call, WhatsApp and Email quick actions.
- Call Status, Next Follow-up, Assigned To, Last Contacted and Remarks.
- CRM CSV export of the current filtered view.
- CRM-to-Sheets sync using Application ID so existing Sheet rows can be updated rather than duplicated.

### Google Sheets columns
The updated Apps Script maintains the existing columns and adds:
`Call Status`, `Next Follow-up`, `Assigned To`, `Last Contacted`, and `Remarks`.

After replacing `Code.gs`, update the existing Web App deployment to a new version. Keep the same Web App URL used by the dashboard.


## Total Application Visitors
The admin Control Hub includes a Total Application Visitors module. The public portal increments `publicStats/applicationVisitorCount` once per browser session when the application form is opened. Firebase rules permit only the safe +1 public increment; admins can read the aggregate. Historical counts begin after this version is deployed.


VISITOR COUNTER UPDATE (2026-09-10): All application-opening paths, including Apply for this domain, call the same Firebase visitor counter. Counter uses a persistent browser ID and Firebase transaction retries. Ensure firebase-rules.json is deployed.


Traffic tracking update: Total Landing Page Visitors counts unique browsers that load the public landing page; Application Form Visitors remains a separate intent metric.


Traffic counter behavior: one unique landing-page visitor is counted per persistent browser/device. Refreshes and repeated visits from the same stored browser ID do not increment the total.


## Traffic tracking runtime fix
The landing-page unique visitor registration and live visitor initialization are deferred until after Firebase database initialization, preventing the previous early-return race that left counters at 0.
