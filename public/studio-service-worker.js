const CACHE_VERSION = "novel-studio-offline-v1";
const OFFLINE_FALLBACK = "/offline-studio.html";
const STATIC_SEED = [
  OFFLINE_FALLBACK,
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_SEED))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("novel-studio-offline-") && key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request))
      || (request.mode === "navigate" ? await cache.match(OFFLINE_FALLBACK) : undefined)
      || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/")
    || url.pathname.includes("/_next/webpack-hmr")
    || request.headers.get("range")
  ) return;
  if (
    url.pathname.startsWith("/_next/static/")
    || /\.(?:js|css|woff2?|png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "NOVEL_OFFLINE_STATUS") {
    event.source?.postMessage({
      type: "NOVEL_OFFLINE_STATUS",
      cacheVersion: CACHE_VERSION,
      controlled: true,
    });
  }
});
