/* 大鼠心血管实验台 Service Worker：预缓存应用外壳，断网可继续使用已加载的实验。
 * 实验数据保存在 localStorage，不经过网络；缓存策略为 stale-while-revalidate。 */
const CACHE = 'ratheart-simpro-v0.1.4';
const SHELL = [
  './',
  './index.html',
  './follow.html',
  './follow.js',
  './app.js',
  './core.js',
  './catalog.js',
  './simulation.worker.js',
  './styles.css',
  './prep.png',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // 授课广播 API（SSE /api/follow 等）永远直连，不经 SW 缓存
  if (new URL(request.url).pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // 应用代码(html/js/css)网络优先:在线时一次刷新即拿到最新版本,
  // 离线回退缓存;图标等静态资源保持 stale-while-revalidate
  if (/\.(html|js|css|webmanifest)(\?|$)/.test(new URL(request.url).pathname)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
