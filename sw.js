/*
 * Offline support: the app is a handful of static files, cached on first
 * visit. Network first: online, every file comes fresh (and refreshes the
 * cache), so an update is never stuck behind an old copy; offline, the
 * cache answers. Bump VERSION when the file list changes.
 */
const VERSION = "pixel-dither-v10";
const FILES = [
  "./",
  "index.html",
  "src/app.js",
  "src/dither.js",
  "src/style.css",
  "src/samples.js",
  "samples/jellyfish.jpg",
  "samples/bust.jpg",
  "samples/chrome.jpg",
  "samples/dunes.jpg",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./"))),
  );
});
