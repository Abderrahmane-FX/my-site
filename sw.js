/* Olympiad Archive — offline service worker */
const CACHE_NAME = 'om-archive-v1';

/* Local files (relative to repo root) */
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

/* CDN assets we need for full offline math rendering */
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js',
  'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-400-normal.css',
  'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.css',
  'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-500-normal.css',
  'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-600-normal.css',
  'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.css'
];

/* Install: pre-cache everything we can */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll fails atomically, so add one-by-one with catch
    await Promise.allSettled(
      [...LOCAL_ASSETS, ...CDN_ASSETS].map(url =>
        cache.add(new Request(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' }))
          .catch(err => console.warn('SW: failed to cache', url, err))
      )
    );
    self.skipWaiting();
  })());
});

/* Activate: drop old caches */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* Fetch: cache-first, then network, with auto-caching of new resources */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Skip chrome-extension and other non-http schemes
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) {
      // Refresh in background (stale-while-revalidate)
      fetch(req).then(res => {
        if (res && res.status === 200 && res.type !== 'opaqueredirect') {
          cache.put(req, res.clone()).catch(() => {});
        }
      }).catch(() => {});
      return cached;
    }

    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      // Offline & not cached → return index.html for navigation requests
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});