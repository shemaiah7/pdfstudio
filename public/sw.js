// SentinelPDF service worker: offline app shell. Hand-written; bump the version suffixes to invalidate caches.
const SHELL = "pdfstudio-shell-v1";
const ASSETS = "pdfstudio-assets-v1";
const MAX_ASSETS = 150;
const STATIC = /^\/(assets\/|pdfjs-wasm\/|icons\/|favicon\.svg$|manifest\.webmanifest$)/;

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS]);
    for (const k of await caches.keys()) if (k.startsWith("pdfstudio-") && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

// Network-first so a deploy is never hidden behind an old cached page; the cached copy is only the offline fallback.
async function navigate(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    // Only the app itself is the offline shell; other pages (e.g. /terms.html) must not replace it.
    if (res.ok && new URL(request.url).pathname === "/") await cache.put("/", res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match("/");
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    await trim(cache);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") { event.respondWith(navigate(request)); return; }
  if (STATIC.test(url.pathname)) event.respondWith(cacheFirst(request));
});
