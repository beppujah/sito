// Service worker: makes the site installable (Add to Home Screen) and keeps the pages
// already visited readable offline. build.py copies this file to the site root and fills
// in the version below, so the caches are renewed whenever style.css, app.js or this file change.
const PAGES = 'pages-__VERSION__';   // pages, style sheet, scripts, fonts
const MEDIA = 'media-__VERSION__';   // images of the pages already seen
const MEDIA_LIMIT = 150;             // oldest images are dropped beyond this number
const SHELL = ['./', 'manifest.webmanifest'];
const NOT_CACHED = /\.(mp4|webm|mov|m4v|ogv|mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|svg|avif)$/i;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(PAGES).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== PAGES && key !== MEDIA).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Pages: always try the network first, so new posts show up right away; the saved copy
// (or the home page) is only used when offline.
async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || (await cache.match('./')) || Response.error();
  }
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}

// Style, scripts, fonts and images: answer from the cache at once and refresh the copy
// in the background.
async function staleWhileRevalidate(event, name, limit) {
  const cache = await caches.open(name);
  const cached = await cache.match(event.request);
  const fresh = fetch(event.request).then(async response => {
    if (response.ok) {
      await cache.put(event.request, response.clone());
      if (limit) await trim(cache, limit);
    }
    return response;
  });
  if (!cached) return fresh;
  event.waitUntil(fresh.catch(() => {}));
  return cached;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  // The editor always talks to the network; videos and audio are streamed, not stored.
  if (path.startsWith('admin/') || path === 'posts.json' || NOT_CACHED.test(path)) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request));
  else if (IMAGE.test(path)) event.respondWith(staleWhileRevalidate(event, MEDIA, MEDIA_LIMIT));
  else event.respondWith(staleWhileRevalidate(event, PAGES));
});
