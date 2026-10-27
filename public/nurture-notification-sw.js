/* 结界卡通知的点击行为。由 vite.config.ts 的 workbox.importScripts 引入。 */
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data;
  if (!data || data.nurture !== true) return;

  event.notification.close();
  const url = new URL(data.url || '/?nurture=1', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'yys:nurture' });
      return;
    }
    await clients.openWindow(url);
  })());
});
