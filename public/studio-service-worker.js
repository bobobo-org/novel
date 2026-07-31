const CACHE_PREFIX = "novel-studio-offline-";
const BOOTSTRAP_CACHE = `${CACHE_PREFIX}bootstrap-v3`;
const OFFLINE_FALLBACK = "/offline-studio.html";
const STATIC_SEED = [
  OFFLINE_FALLBACK,
  "/manifest.webmanifest",
];
let activeReleaseIdentity = null;

function isReleaseIdentity(value) {
  return Boolean(
    value
    && /^[0-9a-f]{40}$/i.test(value.appCommit)
    && /^[0-9a-f]{64}$/i.test(value.assetManifestDigest),
  );
}

function releaseCacheName(identity) {
  return `${CACHE_PREFIX}${identity.appCommit.toLowerCase()}-${identity.assetManifestDigest.toLowerCase()}`;
}

function releaseIdentityFromCacheName(cacheName) {
  const match = cacheName.match(
    /^novel-studio-offline-([0-9a-f]{40})-([0-9a-f]{64})$/i,
  );
  return match
    ? {
      appCommit: match[1].toLowerCase(),
      assetManifestDigest: match[2].toLowerCase(),
    }
    : null;
}

async function activeCacheName() {
  if (activeReleaseIdentity) return releaseCacheName(activeReleaseIdentity);
  const keys = await caches.keys();
  for (const key of keys) {
    const recovered = releaseIdentityFromCacheName(key);
    if (recovered) {
      activeReleaseIdentity = recovered;
      return key;
    }
  }
  return BOOTSTRAP_CACHE;
}

async function seedCache(cacheName) {
  const cache = await caches.open(cacheName);
  await cache.addAll(STATIC_SEED);
  return cache;
}

async function retainOnly(cacheName) {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== cacheName)
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    seedCache(BOOTSTRAP_CACHE)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    retainOnly(BOOTSTRAP_CACHE)
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(await activeCacheName());
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(await activeCacheName());
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
    || /\.(?:js|css)$/i.test(url.pathname)
  ) {
    // Application code must prefer the newest deployment. The cache remains
    // an offline fallback, but it can no longer pin an old UI after an update.
    event.respondWith(networkFirst(request));
    return;
  }
  if (
    /\.(?:woff2?|png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname)
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
  if (event.data?.type === "NOVEL_RELEASE_IDENTITY" && isReleaseIdentity(event.data)) {
    const identity = {
      appCommit: event.data.appCommit.toLowerCase(),
      assetManifestDigest: event.data.assetManifestDigest.toLowerCase(),
    };
    const cacheName = releaseCacheName(identity);
    event.waitUntil(
      seedCache(cacheName)
        .then(() => {
          activeReleaseIdentity = identity;
          return retainOnly(cacheName);
        })
        .then(() => {
          event.source?.postMessage({
            type: "NOVEL_RELEASE_IDENTITY_ACCEPTED",
            appCommit: identity.appCommit,
            assetManifestDigest: identity.assetManifestDigest,
            cacheName,
          });
        }),
    );
    return;
  }
  if (event.data?.type === "NOVEL_OFFLINE_STATUS") {
    event.waitUntil(
      activeCacheName().then((cacheName) => {
        event.source?.postMessage({
          type: "NOVEL_OFFLINE_STATUS",
          cacheName,
          appCommit: activeReleaseIdentity?.appCommit ?? null,
          assetManifestDigest:
            activeReleaseIdentity?.assetManifestDigest ?? null,
          controlled: true,
        });
      }),
    );
  }
});
