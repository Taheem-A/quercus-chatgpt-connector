const CACHE = 'quercus-pocket-v3';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./data.mjs','./core/canvas.mjs','./core/sync.mjs','./core/page-content.mjs','./core/export.mjs','./core/mobile-export.mjs','./core/zip.mjs','./core/rich-content.mjs','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});