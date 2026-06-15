/*
 * SundayStage display service worker — offline resilience for /d and /s.
 *
 * Strategy (safest for Next App Router on OpenNext + Cloudflare):
 *   - Cache ONLY immutable, content-hashed assets (/_next/static/*) plus the
 *     icons/manifest, cache-first. A content hash IS the version, so a constant
 *     cache name never serves stale code.
 *   - NEVER cache /api/* or any non-GET request: the live frame must always hit
 *     the network (a cached state/by-code would freeze a display on a dead
 *     slide). The newer-wins reducer + polling already heal missed broadcasts.
 *   - Navigations (/d, /s, …) are network-first with a same-URL offline
 *     fallback, so a reload during an outage still boots the client, which then
 *     rehydrates the last slide from localStorage. RSC/data requests are left to
 *     the network (a cached document could reference deleted chunks post-deploy;
 *     network-first means an online client always gets the fresh document).
 *
 * To DISABLE everywhere: replace this file's body with a stub that deletes all
 * caches and calls self.registration.unregister(), then deploy — old clients
 * self-clean on their next update check.
 *
 * Bump CACHE_VERSION whenever this file's logic changes.
 */
const CACHE_VERSION = "v1";
const STATIC_CACHE = `stage-static-${CACHE_VERSION}`;
const SHELL_CACHE = `stage-shell-${CACHE_VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Same-origin only; cross-origin requests pass straight through.
  if (url.origin !== self.location.origin) return;

  // The live data plane is always network — never cache, never fall back.
  if (url.pathname.startsWith("/api/")) return;

  // Immutable, content-hashed assets → cache-first.
  if (url.pathname.startsWith("/_next/static/") || isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Navigations → network-first with a same-URL offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(navigationNetworkFirst(req));
    return;
  }
  // Everything else (RSC/data fetches): leave to the network.
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|ttf|css|js)$/.test(pathname)
  );
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return hit || Response.error();
  }
}

async function navigationNetworkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || Response.error();
  }
}
