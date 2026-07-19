const CACHE_VERSION = "novel-system-closed-ai-r4-20260720-1";
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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const fetched = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await fetched) || cache.match(OFFLINE_URL);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(OFFLINE_URL, copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match("./novel-system.html")) || (await cache.match(OFFLINE_URL)) || Response.error();
        })
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
