/* 우성고 카드 서비스 워커
   - 항상 인터넷에서 먼저 받아 온다(새로 올린 index.html 이 바로 반영되게).
   - 인터넷이 끊겼을 때만 저장해 둔 화면을 보여 준다.
   - 다른 주소(글꼴 CDN, Cloudflare Worker API)는 건드리지 않는다. */
const CACHE = 'ws-cardapp-v3';
const CORE = [
  './',
  './index.html',
  './gate.html',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) =>
          hit || (req.mode === 'navigate'
            ? caches.match('./index.html')
            : Response.error())
        )
      )
  );
});
