/* 우성고 카드 서비스 워커
   - 항상 인터넷에서 먼저 받아 온다(새로 올린 index.html 이 바로 반영되게).
   - 인터넷이 끊겼을 때만 저장해 둔 화면을 보여 준다.
   - 다른 주소(글꼴 CDN, Cloudflare Worker API)는 건드리지 않는다. */
const CACHE = 'ws-cardapp-v4';
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

  // 화면(페이지 이동)은 휴대폰에 10분 보관된 사본을 쓰지 말고 GitHub 에 바뀌었는지 꼭 물어본다.
  // (GitHub Pages 는 max-age=600 을 붙여서, 새로 올린 직후 옛 화면이 먼저 뜰 수 있었다.)
  // 안 바뀌었으면 짧은 확인(304)만 오가므로 느려지지 않는다.
  const isPage = req.mode === 'navigate' || /\.(html|json)$/.test(new URL(req.url).pathname);
  const network = isPage
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => (res.redirected ? fetch(req) : res)) // 주소가 넘겨진 경우는 원래 방식으로
    : fetch(req);

  event.respondWith(
    network
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
