// Service Worker: macht die Seite nach dem ersten Besuch offline nutzbar.
//
// Strategie: stale-while-revalidate. Ausgeliefert wird sofort die Kopie aus dem
// Cache, parallel wird im Hintergrund die neue Version geholt. Ein Reload nach
// einem Deploy zeigt also noch den alten Stand, der nächste Start den neuen --
// dafür startet die Seite immer sofort und auch ganz ohne Netz.
//
// Beim Ändern von Dateien CACHE hochzählen, damit alte Einträge wegfallen.

const CACHE = "foosball-elo-v1";

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

      // Ohne Cache-Treffer bleibt nur das Netz; schlägt auch das fehl, ist die
      // Navigation der sinnvollste Ersatz.
      return cached ?? (await update) ?? cache.match("./index.html");
    }),
  );
});
