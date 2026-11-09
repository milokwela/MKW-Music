// Service Worker MKW Music: приложение открывается мгновенно и даже без сети.
// HTML — сначала из сети (чтобы обновления приходили сразу), файлы с ?v= — из кэша (они не меняются).
const CACHE = 'mkw-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // чужие сайты (Firebase, YouTube, iTunes) не трогаем
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        const c = await caches.open(CACHE); c.put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  if (/\.(js|css|png|jpg|webp|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit && url.search) return hit;                       // версия в адресе — файл не меняется
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;                                       // без версии: отдаём кэш и обновляем в фоне
    })());
  }
});

// ---------- пуш-уведомления: звонки и сообщения, даже когда MKW закрыт ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'MKW Music', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // приложение открыто на экране — звонок и сообщение и так всплывут внутри
    if (d.kind !== 'missed' && wins.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    const call = d.kind === 'call';
    // чат «без уведомлений» — показываем тихо, без звука и вибрации
    let quiet = false;
    try {
      const m = /^chat-(.+)$/.exec(String(d.tag || ''));
      if (m && !call) { const r = await caches.match('/__mkw_mute'); const mm = r ? await r.json() : {}; quiet = Number(mm[m[1]]) > Date.now(); }
    } catch { quiet = false; }
    await self.registration.showNotification(d.title || 'MKW Music', {
      body: d.body || '', tag: d.tag || d.kind || 'mkw', renotify: d.kind !== 'missed' && !quiet, silent: d.kind === 'missed' || quiet,
      icon: 'assets/ic5-192.png', badge: 'assets/fav-96.png', data: { url: d.url || './' }, timestamp: d.at || Date.now(),
      requireInteraction: call, vibrate: call ? [400, 200, 400, 200, 400, 200, 400] : quiet ? [] : [150],
      actions: call ? [{ action: 'open', title: 'Ответить' }] : [],
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (w) { await w.focus().catch(() => {}); w.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
