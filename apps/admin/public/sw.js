/** Shows workflow push notifications and opens their URL on click. Caches nothing. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = { title: 'Manablox', body: '', url: null };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Manablox', {
      body: payload.body || '',
      icon: '/logo-mark.svg',
      badge: '/logo-mark.svg',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const same = clients.find((client) => client.url === url && 'focus' in client);
      if (same) return same.focus();
      const any = clients.find((client) => 'navigate' in client);
      if (any) return any.navigate(url).then((client) => client?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
