const { onValueCreated } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const webpush = require('web-push');

initializeApp();

// Standard Web Push VAPID identity. Keep the private key server-side only.
webpush.setVapidDetails(
  'mailto:admin@mnc-internship-live.web.app',
  'BC82nLMYMOPpZhjlzXiZ3KHHZ9RTDsgibtEkVwUj01sXpJ2ah1o2MMOVRzxDxUEeW6mdJOfg3lmRFMqAsF-9iHE',
  '88Iaxn6WXWrC873LnRDQH1sISY_7lDWb3RpeALEINes'
);

exports.notifyAdminsOnNewApplication = onValueCreated('/submittedApplications/{applicationId}', async event => {
  const app = event.data?.val() || {};
  const snapshot = await getDatabase().ref('adminPushTokens').get();
  const subscriptions = [];

  snapshot.forEach(userSnap => {
    userSnap.forEach(subscriptionSnap => {
      const value = subscriptionSnap.val();
      if (value?.enabled && value.subscription?.endpoint && value.subscription?.keys?.p256dh && value.subscription?.keys?.auth) {
        subscriptions.push({ userUid: userSnap.key, key: subscriptionSnap.key, subscription: value.subscription });
      }
    });
  });

  if (!subscriptions.length) return null;

  const payload = JSON.stringify({
    title: 'New Application Received',
    body: `${String(app.name || 'A student')} • ${String(app.college || 'New application')}`,
    icon: 'skillpath-mark.png',
    badge: 'skillpath-mark.png',
    tag: 'internsforge-new-application',
    url: 'admin.html'
  });

  await Promise.allSettled(subscriptions.map(async entry => {
    try {
      await webpush.sendNotification(entry.subscription, payload, { ttl: 86400, urgency: 'high' });
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) {
        await getDatabase().ref(`adminPushTokens/${entry.userUid}/${entry.key}`).remove();
      } else {
        console.error('Web Push send failed:', status, error?.message || error);
      }
    }
  }));

  return null;
});
