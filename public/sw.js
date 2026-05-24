const CACHE_NAME = "hotel-search-v7";
const STATIC_ASSETS = [
  "/app.css",
  "/ui.js",
  "/sessionTimeout.js",
  "/analytics-init.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&subset=vietnamese&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
];

const API_CACHE = "hotel-api-v1";
const CACHEABLE_API = ["/api/bookmarks", "/api/suggestions"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== "GET") return;

  // Never cache API endpoints or HTML pages (always fetch fresh)
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/api-keys") || url.pathname.endsWith(".html")) {
    return;
  }

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith("/api/")) {
    const isCacheable = CACHEABLE_API.some((p) => url.pathname.startsWith(p));
    if (!isCacheable) return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return response;
      }).catch(() => {
        // Return a simple error response for failed fetches
        return new Response("", { status: 404, statusText: "Not Found" });
      });
    })
  );
});

// Listen for messages from the page
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
  if (event.data === "clearCache") {
    caches.delete(API_CACHE);
  }
});
