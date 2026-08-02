const CACHE_VERSION = "novel-system-browser-first-compute-plane-rc5";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "./offline.html";

const CORE_ASSETS = [
  "./",
  "./novel-system.html",
  "./novel-system.css",
  "./db.js",
  "./db-v2.js",
  "./migration.js",
  "./offline-engine.js",
  "./backup-service.js",
  "./novel-system.js",
  "./sovereign-learning-entry.js",
  "./legacy-security-boundary.js",
  "./manifest.json",
  "./offline.html",
  "../file.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(async (cache) => {
        await Promise.allSettled(
          CORE_ASSETS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch((error) => {
              console.warn("[novel-sw] cache skipped", url, error);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("novel-system-") && !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          return cachedPage || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
