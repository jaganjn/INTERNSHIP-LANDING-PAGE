const { onValueCreated } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

exports.notifyAdminsOnNewApplication = onValueCreated('/submittedApplications/{applicationId}', async event => {
  const app = event.data?.val() || {};
  const snapshot = await getDatabase().ref('adminPushTokens').get();
  const tokenEntries = [];
  snapshot.forEach(userSnap => {
    userSnap.forEach(tokenSnap => {
      const value = tokenSnap.val();
      if (value?.enabled && value.token) tokenEntries.push({ userUid: userSnap.key, key: tokenSnap.key, token: value.token });
    });
  });

  if (!tokenEntries.length) return null;

  const chunks = [];
  for (let i = 0; i < tokenEntries.length; i += 500) chunks.push(tokenEntries.slice(i, i + 500));

  for (const chunk of chunks) {
    const response = await getMessaging().sendEachForMulticast({
      tokens: chunk.map(x => x.token),
      notification: {
        title: 'New Application Received',
        body: `${String(app.name || 'A student')} • ${String(app.college || 'New application')}`
      },
      data: {
        type: 'new_application',
        count: '1',
        applicationId: String(event.params.applicationId || ''),
        name: String(app.name || 'A student'),
        college: String(app.college || 'New application'),
        url: 'admin.html'
      },
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        notification: {
          title: 'New Application Received',
          body: `${String(app.name || 'A student')} • ${String(app.college || 'New application')}`,
          icon: 'https://mnc-internship-live.web.app/skillpath-mark.png',
          badge: 'https://mnc-internship-live.web.app/skillpath-mark.png',
          tag: 'internsforge-new-application',
          renotify: true,
          requireInteraction: true
        },
        fcmOptions: { link: 'https://mnc-internship-live.web.app/admin.html' }
      }
    });

    const deletes = [];
    response.responses.forEach((result, index) => {
      const code = result.error?.code || '';
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        const entry = chunk[index];
        deletes.push(getDatabase().ref(`adminPushTokens/${entry.userUid}/${entry.key}`).remove());
      }
    });
    if (deletes.length) await Promise.allSettled(deletes);
  }

  return null;
});
