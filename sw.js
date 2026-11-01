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
