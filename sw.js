// Kanboard Whiteboard — Service Worker
// Caches shell + static assets for offline/fast loading
// API calls always go to network (fresh data)

const CACHE_NAME = 'kanboard-whiteboard-v3-public-demo';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js?v=20260505-comment-attribution',
  '/config.js',
  '/style.css',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

// Install — cache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy:
// - API calls (/api, /prefs, /allowed-projects): network only (always fresh)
// - Static assets: network first, fall back to cache
// - CDN resources (tailwindcss, sortablejs): cache first
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls — always network
  if (url.pathname.startsWith('/api') ||
      url.pathname.startsWith('/prefs') ||
      url.pathname.startsWith('/allowed-projects') ||
      url.pathname.startsWith('/admin') ||
      url.pathname.startsWith('/auth')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // CDN resources — cache first (they're versioned)
  if (url.hostname !== self.location.hostname) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Static assets — network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
