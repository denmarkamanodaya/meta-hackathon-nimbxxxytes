// App-shell service worker. Caches the HTML shell, manifest, icons and hashed build assets.
// Never caches /api/* (data, presigned media URLs) or any cross-origin request (S3 media).
// Bump CACHE when the precache list or a precached file (such as an icon) changes; old caches
// are deleted on activate.
const CACHE = 'nimbytes-shell-v3';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/fonts/bricolage-grotesque/bricolage-grotesque-700-latin.woff2',
  '/fonts/bricolage-grotesque/bricolage-grotesque-700-latin-ext.woff2',
  '/fonts/geist/geist-latin.woff2',
  '/fonts/geist/geist-latin-ext.woff2',
  '/fonts/geist-mono/geist-mono-500-latin.woff2',
  '/fonts/geist-mono/geist-mono-500-latin-ext.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isShellRequest(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return (
    request.mode === 'navigate' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    SHELL.includes(url.pathname)
  );
}

// Navigations: network first so a new deploy shows at once; the cached shell when offline.
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put('/', response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match('/');
    if (cached) return cached;
    throw error;
  }
}

// Hashed assets and icons: cache first; file names change on every build.
async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!isShellRequest(event.request, url)) return; // browser handles it, no caching
  event.respondWith(
    event.request.mode === 'navigate' ? handleNavigation(event.request) : handleAsset(event.request),
  );
});
