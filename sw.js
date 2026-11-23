/* 카카오 체험단 피드 — 앱 껍데기는 캐시, 데이터(campaigns.json)는 네트워크 우선 */
const CACHE = "kt-feed-v19"; // 전체 체험단 공개 + 1탭 제외 프리셋 — 웹 자산이 바뀌었으니 크롬·APK WebView 모두 새 캐시를 받게 버전을 올린다
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json", "./icons/icon.svg", "./icons/icon-192.png"];

self.addEventListener("install", (e) => {
  // cache:"reload" 로 받아 HTTP 캐시에 남은 옛 파일이 새 캐시에 들어가지 않게 한다(배포 직후 흔한 사고)
  const fresh = SHELL.map((u) => new Request(u, { cache: "reload" }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.endsWith("/data/campaigns.json")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
      )
    );
  }
});
