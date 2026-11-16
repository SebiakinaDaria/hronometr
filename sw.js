// Хронометр: keeps the app files available offline. The records themselves live in localStorage.
const CACHE = "hronometr-v4";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "fonts/onest.woff", "fonts/prata.woff",
  "icon-180.png", "icon-192.png", "icon-512.png", "mark.svg", "logo-light.svg", "logo-dark.svg"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", ev => {
  const url = new URL(ev.request.url);
  // Only this site's own files are cached; Google sign-in and Sheets always go straight to the network.
  if (ev.request.method !== "GET" || url.origin !== location.origin) return;
  ev.respondWith(fetch(ev.request).then(r => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(ev.request, copy)); }
    return r;
  }).catch(() => caches.match(ev.request).then(r => r || caches.match("index.html"))));
});
