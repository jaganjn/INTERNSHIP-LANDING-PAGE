/* InternsForge background Web Push service worker. Must be hosted at the site root. */

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {
    try { data = { body: event.data ? event.data.text() : '' }; } catch {}
  }
  const title = data.title || 'New Application Received';
  const options = {
    body: data.body || 'A new internship application has been submitted.',
    icon: data.icon || 'skillpath-mark.png',
    badge: data.badge || 'skillpath-mark.png',
    tag: data.tag || 'internsforge-new-application',
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || 'admin.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || 'admin.html', self.location.origin).href;
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
