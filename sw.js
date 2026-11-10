// Sube el número de versión cada vez que cambies algún archivo para que el iPad tome la actualización.
const CACHE = 'consultorio-v9';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'vivo.css', 'vivo.js', 'vivo-worklet.js', 'vivo-whisper.js', 'suive.js', 'frases.js', 'manifest.webmanifest',
  'vendor/jspdf.js', 'vendor/autotable.js', 'vendor/docx.js', 'vendor/transformers/transformers.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  // Solo se borran las versiones viejas de la app. El modelo de voz (caché «transformers-cache», cientos de MB) se conserva entre actualizaciones.
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('consultorio-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(caches.match('index.html').then(r => r || fetch(req))); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
  })));
});
