# Referral WhatsApp Auto-Redirect Update

Updated only the referral/share flow in `index.html` and the referral landing metadata/copy in `referral.html`.

- Submission success now generates a personalized WhatsApp share message with the student name, referral code, referral URL, programme benefits, and referral-benefit eligibility language.
- WhatsApp is opened automatically after successful submission with a short delay.
- Manual WhatsApp, SMS, email, native-share and copy fallbacks remain available.
- Referral share telemetry records `whatsapp_auto` before redirect.
- No resume, CV, portfolio, or existing application-form/resume functionality was modified.
