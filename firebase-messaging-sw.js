/* Firebase Cloud Messaging service worker. This file must be hosted at the site root. */
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyAJ6712p0MdiL2JKuh3GxuPuGSuRVp3ILI",
  authDomain: "mnc-internship-live.firebaseapp.com",
  databaseURL: "https://mnc-internship-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mnc-internship-live",
  storageBucket: "mnc-internship-live.firebasestorage.app",
  messagingSenderId: "190638783121",
  appId: "1:190638783121:web:492d77b4233cc23b8a5d30"
});

const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler(function(payload) {
  const data = payload && payload.data ? payload.data : {};
  const count = Number(data.count || 1);
  const title = count === 1 ? 'New Application Received' : `${count} New Applications`;
  const body = count === 1
    ? `${data.name || 'A student'} • ${data.college || 'New application'}`
    : 'New internship applications are waiting for review.';

  return self.registration.showNotification(title, {
    body,
    icon: 'skillpath-mark.png',
    badge: 'skillpath-mark.png',
    tag: 'internsforge-new-applications',
    renotify: true,
    requireInteraction: false,
    data: { url: 'admin.html' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || 'admin.html', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    for (const client of clientList) {
      if ('focus' in client) {
        try { client.navigate(target); } catch {}
        return client.focus();
      }
    }
    return clients.openWindow(target);
  }));
});
