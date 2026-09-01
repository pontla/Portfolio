const CACHE_NAME = 'portfolio-shell-v3';
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/js/app.js',
    '/js/icons.js',
    '/js/core/config.js',
    '/js/core/platform.js',
    '/js/core/supabase.js',
    '/js/core/auth.js',
    '/js/core/utils.js',
    '/js/core/api.js',
    '/js/core/analysis.js',
    '/js/core/portfolio.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Le code de l'app est desormais eclate en modules ES : servir un module depuis
// le cache alors qu'un autre vient du reseau donnerait une app a moitie a jour.
// Les scripts et la feuille de style passent donc par le reseau en priorite, le
// cache ne servant que de repli hors-ligne. Le reste (icones, manifeste) reste
// en cache d'abord.
const CODE_ASSET = /\.(?:js|css)$/;

self.addEventListener('install', /** @param {ExtendableEvent} event */ (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self)).skipWaiting())
    );
});

self.addEventListener('activate', /** @param {ExtendableEvent} event */ (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self)).clients.claim())
    );
});

self.addEventListener('fetch', /** @param {FetchEvent} event */ (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('/index.html'))
        );
        return;
    }

    if (CODE_ASSET.test(url.pathname)) {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return res;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request).then((res) => {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
                return res;
            }).catch(() => cached);
            return cached || network;
        })
    );
});
