const CACHE_PREFIX = "novel-studio-offline-";
const BOOTSTRAP_CACHE = `${CACHE_PREFIX}bootstrap-v5`;
const OFFLINE_FALLBACK = "/offline-studio.html";
const STATIC_SEED = [
  OFFLINE_FALLBACK,
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/app-icon-192.png",
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

async function openActiveCache() {
  try {
    return await caches.open(await activeCacheName());
  } catch {
    return null;
  }
}

async function matchCached(cache, request) {
  if (!cache) return undefined;
  try {
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function storeCached(cache, request, response) {
  if (!cache || !response.ok) return;
  try {
    await cache.put(request, response.clone());
  } catch {
    // CacheStorage is progressive enhancement. A successful network response
    // must still reach the page when a release cache changes in flight.
  }
}

async function cacheFirst(request) {
  let cache = await openActiveCache();
  const cached = await matchCached(cache, request);
  if (cached) return cached;
  const response = await fetch(request);
  if (!cache) cache = await openActiveCache();
  await storeCached(cache, request, response);
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await storeCached(await openActiveCache(), request, response);
    }
    // An HTTP response is authoritative, including 401/403. Cached content is
    // only an offline fallback when fetch itself fails; it must never bypass a
    // server-side access decision or a deployment protection checkpoint.
    return response;
  } catch {
    const cache = await openActiveCache();
    return (await matchCached(cache, request))
      || (request.mode === "navigate" ? await matchCached(cache, OFFLINE_FALLBACK) : undefined)
      || Response.error();
  }
}

function isLocalRuntimeRequest(url) {
  return url.hostname === "127.0.0.1"
    || url.hostname === "localhost"
    || url.hostname === "[::1]";
}

function isHashedImmutableAsset(pathname) {
  return /(?:^|[-._])[0-9a-f]{8,}(?:[-._]|$)/i.test(pathname)
    && /\.(?:woff2?|png|jpg|jpeg|webp|svg|ico)$/i.test(pathname);
}

function isPublicVisualAsset(pathname) {
  return pathname.startsWith("/app-icon-")
    || pathname === "/app-icon.svg"
    || pathname.startsWith("/character-portraits/")
    || pathname.startsWith("/item-icons/");
}

function isNextFlightRequest(request, url) {
  return url.searchParams.has("_rsc")
    || request.headers.get("rsc") === "1"
    || request.headers.has("next-router-prefetch");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Local model runtimes are authenticated separately and must never pass
  // through an application cache, even if a browser changes SW scope rules.
  if (isLocalRuntimeRequest(url)) return;
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname === "/api"
    || url.pathname.startsWith("/api/")
    || url.pathname.includes("/_next/webpack-hmr")
    || isNextFlightRequest(request, url)
    || request.headers.get("range")
  ) return;
  if (isHashedImmutableAsset(url.pathname) || isPublicVisualAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    // Next build assets have content-addressed URLs and live inside the
    // commit-and-digest release cache. Reusing an exact chunk avoids refetching
    // it on every full navigation without allowing an older release to pin UI.
    event.respondWith(cacheFirst(request));
    return;
  }
  if (/\.(?:js|css)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request));
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
