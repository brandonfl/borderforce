const CACHE_NAME = 'bf-suite-v68-bus-catalogs-network-first';

const URLS_TO_CACHE = [
  './',
  './index.html',
  './borderforce/index.html',
  './compteur/index.html',
  './manifest.json',
  './trains-sncf-roya.js',
  './trains-trenitalia-roya.js',
  './borderforce/trains-sncf-roya.js',
  './borderforce/trains-trenitalia-roya.js',
  './html/index.html',
  './html/trains-sncf-roya.js',
  './html/trains-trenitalia-roya.js',
  './borderforce/html/index.html',
  './borderforce/html/trains-sncf-roya.js',
  './borderforce/html/trains-trenitalia-roya.js'
];

// Les données "live" ne doivent JAMAIS être servies depuis Cache Storage.
// On exclut tous les Workers Cloudflare utilisés par BorderForce.
// Cela couvre notamment le Worker Bus La Turbie et le Worker SNCF.
function isLiveApiRequest(request) {
  try {
    const url = new URL(request.url);
    return url.hostname.endsWith('.workers.dev');
  } catch (_) {
    return false;
  }
}

// Les catalogues de bus de La Turbie sont régénérés chaque jour :
// servis « cache d'abord », ils resteraient figés à leur première version.
function isBusCatalogRequest(request) {
  try {
    return new URL(request.url).pathname.endsWith('_turbie.json');
  } catch (_) {
    return false;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(URLS_TO_CACHE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // IMPORTANT :
  // Les requêtes vers les Workers Cloudflare passent toujours par le réseau.
  // Aucun caches.match() ni cache.put() pour les données temps réel.
  if (isLiveApiRequest(event.request)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
    );
    return;
  }

  // Catalogues de bus : réseau d'abord, cache uniquement si le réseau est indisponible.
  if (isBusCatalogRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Navigation : réseau d'abord, cache uniquement si le réseau est indisponible.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Ressources statiques : cache d'abord, puis réseau.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Ne met en cache que les réponses exploitables.
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
