/* CoreTech Recruiting service worker.
 *
 * Privacy-first caching rules:
 *  - Pages (navigations) are NEVER cached: they can contain signed-in, private data (candidates,
 *    leads, notes). They always come from the network; if the device is offline, the generic
 *    /offline page is shown instead.
 *  - Only public, immutable build assets (/_next/static/*) and app icons are cached.
 *  - Non-GET requests (form posts, server actions, uploads) and cross-origin requests are not touched.
 *
 * Bump VERSION to force clients to drop old caches after changing these rules.
 */
const VERSION = "v1";
const OFFLINE_CACHE = `coretech-offline-${VERSION}`;
const STATIC_CACHE = `coretech-static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      // credentials: "omit" → the cached copy is the signed-out page, never a personalized one.
      const response = await fetch(new Request(OFFLINE_URL, { credentials: "omit", cache: "reload" }));
      if (response.ok) await cache.put(OFFLINE_URL, response);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([OFFLINE_CACHE, STATIC_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("coretech-") && !keep.has(key)) await caches.delete(key);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

function isCacheableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          return preloaded || (await fetch(request));
        } catch {
          const offline = await caches.match(OFFLINE_URL);
          return offline || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") await cache.put(request, response.clone());
        return response;
      })(),
    );
  }
  // Everything else (API, RSC payloads, images, auth routes) goes straight to the network.
});
