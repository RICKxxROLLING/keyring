// web/public/sw.js — hand-written service worker (owner T4). See design §C10.7.
// Offline scope is deliberately narrow: the app shell, plus the dashboard and previously
// visited dossiers (stale-while-revalidate). Every other API call, and every non-GET, is
// network-only and never cached — there is no write queue and no offline mutation.

const SHELL_CACHE = "keyring-shell-v1";
const API_CACHE = "keyring-api-v1";
const THUMB_CACHE = "keyring-thumbs-v1";
const THUMB_CACHE_MAX = 200;
const CURRENT_CACHES = [SHELL_CACHE, API_CACHE, THUMB_CACHE];

const DOSSIER_RE = /^\/api\/properties\/[^/]+\/dossier$/;
const THUMB_RE = /^\/api\/uploads\/[^/]+\/thumb$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        await cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]);
      } catch {
        // Best-effort: a cold dev server or offline install shouldn't fail installation.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !CURRENT_CACHES.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("/", response.clone());
    return response;
  } catch {
    const cached = await cache.match("/");
    if (cached) return cached;
    throw new Error("offline and no cached shell");
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/**
 * Network-first, cache only as an offline fallback.
 *
 * This was previously `cached ?? (await network)`, which always answered from
 * the cache and merely refreshed it for next time. On a realtime app that is
 * actively wrong: AuthenticatedShell invalidates the dossier query on every
 * entity event, the refetch is served the PREVIOUS generation, and a
 * colleague's edit needs a second unrelated event before it appears — which
 * defeats the product's core "appears within ~1s without a refresh" promise.
 *
 * The cache still exists and is still written on every success; it is just no
 * longer allowed to answer while the network can. That keeps the intended
 * offline-read scope (dashboard + previously visited dossiers) intact.
 */
async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline and no cached response");
  }
}

async function cacheFirstThumb(request) {
  const cache = await caches.open(THUMB_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    if (keys.length > THUMB_CACHE_MAX) {
      await cache.delete(keys[0]);
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.method !== "GET") {
    return; // network-only: never intercept a write
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest" || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  if (url.pathname === "/api/dashboard" || DOSSIER_RE.test(url.pathname)) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (THUMB_RE.test(url.pathname)) {
    event.respondWith(cacheFirstThumb(request));
    return;
  }

  // Every other GET (including /api/uploads/*/raw) and every non-GET: network-only, uncached.
});
