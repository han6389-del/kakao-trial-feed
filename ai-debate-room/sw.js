/* AI 아이디어 토론방 — 항상 최신 파일을 받도록 네비게이션은 네트워크 우선.
   (같은 오리진의 상위 서비스워커가 이 경로를 캐시로 가로채는 것을 막는다) */
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function(e){
  if(e.request.mode === "navigate"){
    e.respondWith(fetch(e.request, { cache: "no-store" }).catch(function(){ return caches.match(e.request); }));
  }
});
