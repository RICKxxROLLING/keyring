// web/public/sw.js — hand-written service worker (owner T4). See design §C10.7.
// Offline scope is deliberately narrow: the app shell, plus the dashboard and previously
// visited dossiers (stale-while-revalidate). Every other API call, and every non-GET, is
// network-only and never cached — there is no write queue and no offline mutation.

const SHELL_CACHE = "stoop-shell-v1";
const API_CACHE = "stoop-api-v1";
const THUMB_CACHE = "stoop-thumbs-v1";
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

async function staleWhileRevalidateApi(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await network) ?? Promise.reject(new Error("offline and no cached response"));
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
    event.respondWith(staleWhileRevalidateApi(request));
    return;
  }

  if (THUMB_RE.test(url.pathname)) {
    event.respondWith(cacheFirstThumb(request));
    return;
  }

  // Every other GET (including /api/uploads/*/raw) and every non-GET: network-only, uncached.
});
