// Ozone Salon & Spa — ERP Service Worker (Firebase edition)
// Bump the cache version on every release so installed PWAs auto-update.
const CACHE = 'ozone-erp-v25-services-setup-redesign';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  // Activate immediately so users are not pinned to stale cached shells.
  self.skipWaiting();
});

self.addEventListener('message', e => {
  // The page can send {type:'SKIP_WAITING'} to activate the new SW immediately.
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = e.request.url;
  // Never intercept Firebase / Google API traffic — Firestore manages its own
  // offline persistence via IndexedDB and must talk to the network directly.
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebaseio.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('googleapis.com')
  ) return;

  // Only cache same-origin assets
  if (!url.startsWith(self.location.origin)) return;

  // For HTML/doc navigations, always prefer network so stale cached shells
  // cannot keep resurfacing. Fallback to cache only when offline.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
