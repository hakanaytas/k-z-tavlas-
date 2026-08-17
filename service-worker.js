// service-worker.js — Kız Tavlası
// Basit "app shell" önbellekleme stratejisi. Firebase istekleri asla önbelleğe alınmaz.

const CACHE_NAME = "kiz-tavlasi-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase.js",
  "./manifest.json",
  "./sounds/snd-dice.wav",
  "./sounds/snd-stone.wav",
  "./sounds/snd-win.wav",
  "./sounds/snd-message.wav",
  "./sounds/snd-open.wav",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Firebase / Google API isteklerine hiç dokunma — her zaman ağdan git.
  if (url.includes("googleapis.com") || url.includes("firebaseio.com") || url.includes("firestore.googleapis.com") || url.includes("gstatic.com")) {
    return;
  }

  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
