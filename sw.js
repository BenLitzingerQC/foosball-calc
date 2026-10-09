// Service Worker: makes the page usable offline after the first visit.
//
// Strategy: stale-while-revalidate. The cached copy is served immediately while
// the new version is fetched in the background. A reload right after a deploy
// therefore still shows the old state and the next launch the new one -- in
// exchange the page always starts instantly, even with no network at all.
//
// Bump CACHE whenever files change so stale entries are dropped.

const CACHE = "foosball-elo-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/elo.js",
  "./assets/icon.svg",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);

      const update = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);

      // Without a cache hit only the network is left; if that fails too, the
      // navigation document is the most sensible fallback.
      return cached ?? (await update) ?? cache.match("./index.html");
    }),
  );
});
