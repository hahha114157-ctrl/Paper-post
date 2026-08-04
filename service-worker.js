const VERSION = '6.13.0';
const CACHE = `paperscope-pages-v27-${VERSION}`;
const SHELL = [
  './',
  `./app.js?v=${VERSION}`,
  './pdf-storage.js',
  './library-logic.js',
  './ui-logic.js',
  './note-export.js',
  './note-pdf-export.js',
  './manifest.webmanifest',
  './icon.svg',
  `./vendor/pdfjs/pdf.mjs?v=${VERSION}`,
  `./vendor/pdfjs/pdf.worker.mjs?v=${VERSION}`,
  `./vendor/pdf-lib/pdf-lib.mjs?v=${VERSION}`,
  `./vendor/tesseract/tesseract.mjs?v=${VERSION}`,
  `./vendor/tesseract/worker.min.js?v=${VERSION}`,
  `./data/dictionary/manifest.json?v=${VERSION}`,
  `./data/dictionary/domain.json?v=${VERSION}`
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('paperscope-pages-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isData = url.pathname.includes('/data/');
  event.respondWith(
    fetch(event.request, isData ? { cache: 'no-store' } : undefined)
      .then(async response => {
        if (response.ok) await (await caches.open(CACHE)).put(event.request, response.clone());
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
