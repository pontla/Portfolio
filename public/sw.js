const CACHE_NAME = 'portfolio-shell-v2';
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

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
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('/index.html'))
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
