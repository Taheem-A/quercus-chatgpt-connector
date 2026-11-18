const CACHE = 'quercus-workspace-v8';
const SHELL = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Always try to refresh navigation HTML. Preserve cached shell offline.
    if (event.request.mode === 'navigate' || url.pathname === '/index.html') {
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch {
        return (await cache.match(event.request)) || (await cache.match('/index.html'));
      }
    }
    // Vite fingerprints JS/CSS under /assets; immutable assets are safe to
    // cache. Never cache private JSON responses, auth, or university tokens.
    const asset = url.pathname.startsWith('/assets/') ||
      ['/icon.svg','/manifest.webmanifest'].includes(url.pathname);
    if (asset) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }
    return fetch(event.request);
  })());
});
