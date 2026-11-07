// Keeps the app shell available offline. Figures always come fresh from the
// database when online; the app itself shows the last figures it saw when offline.
var CACHE = 'ledger-shell-v3';
var SHELL = ['./', './index.html', './styles.css', './app.js', './config.js', './vendor/supabase.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // never cache the database
  if (url.origin === location.origin) {
    // network first, so updates show up right away; cache as fallback
    e.respondWith(fetch(req, { cache: 'no-store' }).then(function (res) {
      var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return res;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (m) { return m || caches.match('./index.html'); }); }));
  } else if (url.hostname.indexOf('fonts.g') === 0) {
    e.respondWith(caches.match(req).then(function (m) {
      var net = fetch(req).then(function (res) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return res; });
      return m || net;
    }));
  }
});
