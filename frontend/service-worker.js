const CACHE = 'guesstaimate-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/storage.js',
  '/render.js',
  '/charts.js',
  '/recording.js',
  '/main.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for API calls, cache-first for static assets.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept non-GET or cross-origin API requests (Whisper / GPT backend).
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
      return cached || network;
    })
  );
});
