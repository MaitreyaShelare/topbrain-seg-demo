// service-worker.js — offline caching for the TopBrain PWA.
// Strategy: precache all static assets on install, serve from cache on fetch,
// fall back to network for anything uncached.

const CACHE_NAME = 'topbrain-v1';

// Assets to precache on install. All file paths relative to /
const PRECACHE = [
  './',
  './index.html',
  './nifti.js',
  './preprocess.js',
  './inference.js',
  './viewer.js',
  './metrics.js',
  './model.onnx',
  './cases.json',
  './preprocessing.json',
  './class_table.csv',
  // Preloaded test cases (10 cases × 3 files)
  './cases/ct_002.nii.gz', './cases/ct_002.gt.nii.gz', './cases/ct_002.teacher.nii.gz',
  './cases/mr_002.nii.gz', './cases/mr_002.gt.nii.gz', './cases/mr_002.teacher.nii.gz',
  './cases/ct_005.nii.gz', './cases/ct_005.gt.nii.gz', './cases/ct_005.teacher.nii.gz',
  './cases/mr_005.nii.gz', './cases/mr_005.gt.nii.gz', './cases/mr_005.teacher.nii.gz',
  './cases/ct_010.nii.gz', './cases/ct_010.gt.nii.gz', './cases/ct_010.teacher.nii.gz',
  './cases/mr_010.nii.gz', './cases/mr_010.gt.nii.gz', './cases/mr_010.teacher.nii.gz',
  './cases/ct_015.nii.gz', './cases/ct_015.gt.nii.gz', './cases/ct_015.teacher.nii.gz',
  './cases/mr_015.nii.gz', './cases/mr_015.gt.nii.gz', './cases/mr_015.teacher.nii.gz',
  './cases/ct_025.nii.gz', './cases/ct_025.gt.nii.gz', './cases/ct_025.teacher.nii.gz',
  './cases/mr_025.nii.gz', './cases/mr_025.gt.nii.gz', './cases/mr_025.teacher.nii.gz',
  './manifest.json',
  // ONNX Runtime Web (external CDN — cache on first fetch)
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort.min.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort-wasm-simd-threaded.wasm',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort-wasm-simd.wasm',
];

self.addEventListener('install', (event) => {
  console.log('[SW] install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] precaching', PRECACHE.length, 'assets');
      return cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })))
        .catch(err => {
          console.error('[SW] precache failed on some asset:', err);
          // Non-fatal: continue installing with what was fetched
        });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activate');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // Not in cache — fetch from network and cache the response
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Network failed and not in cache: return error
        return new Response('Offline and not cached', { status: 503 });
      });
    })
  );
});
