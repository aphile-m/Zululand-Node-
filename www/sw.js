/* sw.js — the service worker that makes SPEC §2.5 and §12 true: the game must
   launch and play with the network disabled.

   Network-first for same-origin, like the Trainer App's — updates land on
   reload and the cache is the offline fallback. Cache-first kept serving stale
   UI there and would do the same here.

   The precache list is the whole shell AND all of www/content/*.json, because
   the reducer imports that content at module load: a cached page with an
   uncached acts.json is a game that cannot start. The character sprites are
   included too, but the UI falls back to drawn portraits without them, so a
   miss there costs nothing. */

const CACHE = 'node-v2';

const SHELL = [
  '.', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js',
  'js/ui/store.js', 'js/ui/render.js', 'js/ui/portrait.js',
  'js/ui/title.js', 'js/ui/audio.js',
  'js/engine/types.js', 'js/engine/rng.js', 'js/engine/reduce.js',
  'js/engine/gates.js', 'js/engine/selectors.js', 'js/engine/events.js',
  'js/engine/missions.js',
  'content/index.js',
  'content/acts.json', 'content/parcels.json', 'content/buildings.json',
  'content/studies.json', 'content/cards.json', 'content/stakeholders.json',
  'content/missions.json', 'content/player.json', 'content/balance.json',
  'img/ch-meta.json',
  'img/ch-sakhile.webp', 'img/ch-mthiyane.webp', 'img/ch-thandeka.webp',
  'img/ch-sipho.webp', 'img/ch-renier.webp', 'img/ch-amara.webp',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; one missing sprite would fail the whole
      // install and leave the game with no offline copy at all.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))),
  );
});
