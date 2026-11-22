/* 카드 숨김·완료 체크 UI 흐름 스모크 테스트 — 최소 가짜 DOM 위에서 app.js 화면 블록을 실제로 돌린다.
 * 확인: 카드 숨기기 → 목록/상단 수치/칩 감소 → 되돌리기, 하단 ‘모두 되돌리기’,
 *       완료 체크 → 목록에서 즉시 빠지고 ‘신청완료’ 탭으로 이동 → 되돌리기/해제, 탭별 수치.
 * 실행: python3 tests/run_ui_test.py */
(function (global) {
  "use strict";
  var out = [], pass = 0, fail = 0;
  function ok(name, cond, detail) {
    if (cond) { pass++; out.push("PASS  " + name); }
    else { fail++; out.push("FAIL  " + name + (detail ? "  → " + detail : "")); }
  }
  function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); }

  /* ── 최소 DOM ─────────────────────────── */
  function El(tag) {
    var cls = {};
    this.tag = tag || "div"; this.children = []; this._html = ""; this.attrs = {};
    this.listeners = {}; this.style = {}; this.hidden = false; this.textContent = ""; this.value = "";
    this.classList = {
      add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; },
      contains: function (c) { return !!cls[c]; },
      toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = 1; else delete cls[c]; return on; }
    };
  }
  El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
  El.prototype.querySelector = function (sel) { return sel === "button" ? (this._btn = this._btn || new El("button")) : null; };
  El.prototype.closest = function (sel) { return (this._closest && this._closest[sel]) || null; };
  El.prototype.querySelectorAll = function () { return []; };
  El.prototype.appendChild = function (c) { this.children.push(c); return c; };
  El.prototype.fire = function (type, ev) { (this.listeners[type] || []).forEach(function (f) { f(ev); }); };
  Object.defineProperty(El.prototype, "innerHTML", {
    get: function () { return this._html; },
    set: function (v) { this._html = String(v); this.children = []; }
  });
  Object.defineProperty(El.prototype, "firstChild", { get: function () { return this.children[0] || null; } });

  var byId = {};
  var chipsFilter = ["all", "new", "done"].map(function (k) { var e = new El("button"); e.attrs["data-filter"] = k; return e; });
  var chipsCat = ["all", "food", "living", "digital", "beauty", "fashion", "leisure", "pet", "etc"].map(function (k) {
    var e = new El("button"), b = new El("b");
    e.tag = "chip"; e.attrs["data-cat"] = k; e._b = b;
    e.querySelector = function (sel) { return sel === "b" ? b : (sel === "button" ? (this._btn = this._btn || new El("button")) : null); };
    return e;
  });
  global.document = {
    getElementById: function (id) { return byId[id] || (byId[id] = new El("div")); },
    querySelectorAll: function (sel) {
      return sel.indexOf("data-filter") !== -1 ? chipsFilter : chipsCat;
    },
    createElement: function (t) { return new El(t); }
  };
  var store = {};
  global.localStorage = {
    getItem: function (k) { return k in store ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  global.navigator = {};
  global.location = { protocol: "https:" };
  global.setTimeout = function (fn) { fn(); return 0; };
  global.clearTimeout = function () {};

  /* ── app.js 로드 → fetch → 렌더 ───────── */
  var DATA = global.__DATA__;
  function chain(value) {
    return {
      __chain: true,
      then: function (f) {
        var r = f(value);
        return (r && r.__chain) ? r : chain(r); // 안쪽 promise(r.json()) 는 펼쳐서 넘긴다
      },
      "catch": function () { return chain(value); } // 정상 경로만 확인
    };
  }
  global.fetch = function () {
    return chain({ ok: true, json: function () { return chain(DATA); } });
  };
  /* app.js 는 이미 앞에서 evaluate 됐지만 document 가 없어 순수함수만 남았다.
   * 여기서는 가짜 DOM 을 물린 상태로 다시 로드한다. */
  global.__RERUN__();
  var KT = global.KT;
  var A = function (id) { return byId[id]; };
  /* 토스트 버튼은 한 번 뜰 때마다 새로 잡아 쓴다(리스너가 쌓이지 않게) */
  function resetToast() { A("toast")._btn = null; }

  var rows = DATA.campaigns;
  var total0 = rows.length;
  var new0 = rows.filter(function (c) { return c.isNew; }).length;
  eq("초기: 전체 탭 = 미신청 건수", A("stScope").textContent, KT.num(total0));
  eq("초기: 상단 수치 라벨", A("stScopeLabel").textContent, "미신청");
  eq("초기: 검색 노출 건수", A("shownCount").textContent, total0 + "건");
  var chips0 = chipsCat.map(function (c) { return c._b.textContent; });
  eq("초기: 전체 탭 건수", A("cAll").textContent, KT.num(total0));
  eq("초기: 오늘 신규 탭 건수", A("cNew").textContent, KT.num(new0));
  eq("초기: 신청완료 탭 건수", A("cDone").textContent, "0");
  eq("초기: 신청 완료 수치", A("stDone").textContent, "0");

  /* ── 숨기기 클릭 — list 위임 핸들러에 가짜 이벤트를 넣는다 ── */
  var victim = rows[0], vCat = KT.groupKeyOf(victim);
  var card = new El("article");
  var delBtn = new El("button"); delBtn.attrs["data-hide"] = victim.campaignId; delBtn._closest = { ".card": card };
  var ev = {
    target: {
      closest: function (sel) {
        if (sel === "[data-hide]") return delBtn;
        if (sel === ".card") return card;
        return null;
      }
    },
    preventDefault: function () {}
  };
  A("list").fire("click", ev);

  eq("숨김: localStorage kt_hidden_v1 에 저장", !!JSON.parse(store["kt_hidden_v1"] || "{}")[victim.campaignId], true);
  eq("숨김: 상단 미신청 1 감소", A("stScope").textContent, KT.num(total0 - 1));
  eq("숨김: 검색 노출 건수 1 감소", A("shownCount").textContent, (total0 - 1) + "건");
  eq("숨김: 상단 ‘전체’ 칩 1 감소", A("cAll").textContent, KT.num(total0 - 1));
  var chipNow = chipsCat.filter(function (c) { var k = c.attrs["data-cat"]; return k === vCat; })[0]._b.textContent;
  var chipBefore = chips0[chipsCat.map(function (c) { return c.attrs["data-cat"]; }).indexOf(vCat)];
  eq("숨김: 그 상품의 카테고리 칩 1 감소", chipNow, KT.num(Number(String(chipBefore).replace(/,/g, "")) - 1));
  ok("숨김: 토스트 문구 + 되돌리기 버튼", A("toast").innerHTML.indexOf("목록에서 숨겼어요") !== -1 &&
    A("toast").innerHTML.indexOf("되돌리기") !== -1, A("toast").innerHTML);
  ok("숨김: 하단에 ‘숨긴 상품 1개 모두 되돌리기’", A("foot").innerHTML.indexOf("모두 되돌리기") !== -1 &&
    A("foot").innerHTML.indexOf("1개") !== -1);

  /* 되돌리기 — 토스트 버튼 클릭 */
  A("toast").querySelector("button").fire("click");
  eq("되돌리기: 저장소에서 제거", Object.keys(JSON.parse(store["kt_hidden_v1"] || "{}")).length, 0);
  eq("되돌리기: 미신청 원복", A("stScope").textContent, KT.num(total0));
  eq("되돌리기: 노출 건수 원복", A("shownCount").textContent, total0 + "건");
  eq("되돌리기: 칩 원복", A("cAll").textContent, KT.num(total0));
  eq("되돌리기: 칩 합계 원복",
    chipsCat.map(function (c) { return c._b.textContent; }).join(","), chips0.join(","));

  /* 두 건 숨긴 뒤 하단 ‘모두 되돌리기’ */
  [rows[1], rows[2]].forEach(function (r) {
    var b = new El("button"); b.attrs["data-hide"] = r.campaignId; b._closest = { ".card": card };
    A("list").fire("click", {
      target: { closest: function (sel) { return sel === "[data-hide]" ? b : (sel === ".card" ? card : null); } },
      preventDefault: function () {}
    });
  });
  eq("2건 숨김: 미신청 -2", A("stScope").textContent, KT.num(total0 - 2));
  ok("2건 숨김: 하단 ‘2개 모두 되돌리기’", A("foot").innerHTML.indexOf("2개") !== -1, A("foot").innerHTML);
  A("foot").fire("click", { target: { closest: function (sel) { return sel === "[data-unhide-all]" ? new El("button") : null; } } });
  eq("모두 되돌리기: 저장소 비움", Object.keys(JSON.parse(store["kt_hidden_v1"] || "{}")).length, 0);
  eq("모두 되돌리기: 미신청 원복", A("stScope").textContent, KT.num(total0));

  /* ── 완료 체크 — 목록에서 빠지고 ‘신청완료’ 탭으로 ── */
  resetToast();
  function toggleEv(id) {
    var b = new El("button"); b.attrs["data-toggle"] = id; b._closest = { ".card": card };
    return {
      target: { closest: function (sel) { return sel === "[data-toggle]" ? b : (sel === ".card" ? card : null); } },
      preventDefault: function () {}
    };
  }
  var A_STORE = "ktApp.applied.v1";
  A("list").fire("click", toggleEv(rows[0].campaignId));
  eq("체크: localStorage 에 저장", !!JSON.parse(store[A_STORE] || "{}")[rows[0].campaignId], true);
  eq("체크: 전체 탭에서 1건 빠짐", A("stScope").textContent, KT.num(total0 - 1));
  eq("체크: 노출 건수 1 감소", A("shownCount").textContent, (total0 - 1) + "건");
  eq("체크: 전체 탭 건수 1 감소", A("cAll").textContent, KT.num(total0 - 1));
  eq("체크: 신청완료 탭 건수 1", A("cDone").textContent, "1");
  eq("체크: 신청 완료 수치 1", A("stDone").textContent, "1");
  ok("체크: 토스트 ‘신청완료로 옮겼어요 [되돌리기]’",
    A("toast").innerHTML.indexOf("신청완료로 옮겼어요") !== -1 && A("toast").innerHTML.indexOf("되돌리기") !== -1,
    A("toast").innerHTML);
  A("toast").querySelector("button").fire("click");
  eq("체크 되돌리기: 저장소에서 제거", Object.keys(JSON.parse(store[A_STORE] || "{}")).length, 0);
  eq("체크 되돌리기: 전체 탭 원복", A("stScope").textContent, KT.num(total0));
  eq("체크 되돌리기: 신청완료 0", A("cDone").textContent, "0");

  /* 두 건 체크 → 신청완료 탭에서 모아 보기 */
  resetToast();
  A("list").fire("click", toggleEv(rows[1].campaignId));
  A("list").fire("click", toggleEv(rows[2].campaignId));
  eq("2건 체크: 전체 탭 건수 -2", A("cAll").textContent, KT.num(total0 - 2));
  eq("2건 체크: 신청완료 탭 건수 2", A("cDone").textContent, "2");
  chipsFilter.filter(function (c) { return c.attrs["data-filter"] === "done"; })[0].fire("click");
  eq("신청완료 탭: 라벨", A("stScopeLabel").textContent, "신청완료");
  eq("신청완료 탭: 상단 수치 = 완료 건수", A("stScope").textContent, "2");
  eq("신청완료 탭: 목록 = 완료 건수", A("shownCount").textContent, "2건");
  eq("신청완료 탭: 검색·카테고리 합계도 완료만",
    chipsCat[0]._b.textContent, KT.num(2));
  eq("신청완료 탭: 전체 탭 건수는 그대로", A("cAll").textContent, KT.num(total0 - 2));

  /* 신청완료 탭에서 체크 해제 → 미신청으로 복귀 */
  resetToast();
  A("list").fire("click", toggleEv(rows[1].campaignId));
  eq("해제: 저장소에서 제거", !JSON.parse(store[A_STORE] || "{}")[rows[1].campaignId], true);
  eq("해제: 신청완료 탭 1건", A("shownCount").textContent, "1건");
  eq("해제: 신청완료 건수 1", A("cDone").textContent, "1");
  eq("해제: 전체 탭 건수 +1", A("cAll").textContent, KT.num(total0 - 1));
  ok("해제: 토스트 ‘미신청으로 되돌렸어요’", A("toast").innerHTML.indexOf("미신청으로 되돌렸어요") !== -1, A("toast").innerHTML);

  /* 전체 탭으로 돌아오면 해제한 상품이 다시 보인다 */
  chipsFilter.filter(function (c) { return c.attrs["data-filter"] === "all"; })[0].fire("click");
  eq("전체 탭 복귀: 노출 건수", A("shownCount").textContent, (total0 - 1) + "건");
  eq("전체 탭 복귀: 라벨", A("stScopeLabel").textContent, "미신청");

  /* ── 저장된 상태가 새로고침(재로드) 뒤에도 유지되는지 ── */
  store[A_STORE] = "{}";
  var h = {}; h[rows[3].campaignId] = { at: new Date().toISOString() };
  store["kt_hidden_v1"] = JSON.stringify(h);
  A("list").listeners = {}; // 재로드로 핸들러가 겹치지 않게
  global.__RERUN__();
  eq("재로드: 저장된 숨김이 반영", A("stScope").textContent, KT.num(total0 - 1));
  ok("재로드: 숨김 1건이 하단에 표시", A("foot").innerHTML.indexOf("숨긴 상품 1개") !== -1, A("foot").innerHTML);

  /* 완료 체크도 재로드 뒤 유지되고 전체 탭에서는 빠져 있다 */
  var ap = {}; ap[rows[4].campaignId] = { at: new Date().toISOString() };
  store[A_STORE] = JSON.stringify(ap);
  global.__RERUN__();
  eq("재로드: 체크한 상품은 전체 탭에서 빠진다", A("stScope").textContent, KT.num(total0 - 2));
  eq("재로드: 신청완료 건수 유지", A("cDone").textContent, "1");

  /* 오래된(60일 초과) 숨김은 정리된다 */
  store["kt_hidden_v1"] = JSON.stringify({ "old-id": { at: new Date(Date.now() - 61 * 864e5).toISOString() } });
  store[A_STORE] = "{}";
  global.__RERUN__();
  eq("정리: 60일 지난 숨김은 버린다", Object.keys(JSON.parse(store["kt_hidden_v1"])).length, 0);

  /* ── 기록 옮기기 패널(복사 / 붙여넣기) ──
   * 실제 사용 흐름: 크롬(기록 있음) → 복사 → 새 앱(기록 일부) → 붙여넣어 합치기/덮어쓰기 */
  var TRANSFER_IDS = ["list", "foot", "transfer", "transferCopy", "transferMerge", "transferReplace", "transferClose"];
  function clearHandlers() {
    TRANSFER_IDS.forEach(function (id) { A(id).listeners = {}; });
  }
  function openEv() {
    return { target: { closest: function (sel) { return sel === "[data-transfer-open]" ? new El("button") : null; } } };
  }
  function reloadWith(seed) {
    store[A_STORE] = "{}";
    store["kt_hidden_v1"] = "{}";
    Object.keys(seed || {}).forEach(function (k) { store[k] = seed[k]; });
    A("transfer").hidden = true;
    clearHandlers();
    global.__RERUN__();
  }

  ok("푸터: ‘기록 옮기기’ 버튼이 있다",
    A("foot").innerHTML.indexOf("data-transfer-open") !== -1 &&
    A("foot").innerHTML.indexOf("기록 옮기기") !== -1, A("foot").innerHTML);

  /* 마크업 — 시트는 hidden 으로 시작하고, app.js 가 찾는 id 가 index.html 에 모두 있다 */
  var html = global.__HTML__ || "";
  ok("마크업: 시트가 hidden 으로 시작한다(화면을 가리지 않는다)",
    /id="transfer"[^>]*\shidden/.test(html), html.slice(0, 0) + "id=transfer hidden 없음");
  ok("마크업: 시트는 dialog 로 읽힌다",
    /id="transfer"[^>]*role="dialog"/.test(html) && /id="transfer"[^>]*aria-modal="true"/.test(html));
  ok("마크업: 시트 제목이 aria-labelledby 로 연결",
    /aria-labelledby="transferTitle"/.test(html) && /id="transferTitle"/.test(html));
  var used = {}, idRe = /\$\\("([A-Za-z0-9_]+)"\\)/g, hit;
  while ((hit = idRe.exec(global.__APP_SRC__))) used[hit[1]] = 1;
  var missingIds = Object.keys(used).filter(function (id) { return html.indexOf('id="' + id + '"') === -1; });
  eq("마크업: app.js 가 찾는 DOM id 가 index.html 에 모두 있다", missingIds.join(","), "");
  ok("마크업: 시트 요소 5개(복사·합치기·덮어쓰기·닫기·텍스트칸)가 있다",
    ["transferCopy", "transferMerge", "transferReplace", "transferClose", "transferText"]
      .every(function (id) { return html.indexOf('id="' + id + '"') !== -1; }));

  reloadWith(null);
  A("foot").fire("click", openEv());
  eq("시트: 하단 버튼으로 열린다", A("transfer").hidden, false);
  ok("시트: 열 때 이 기기 기록 건수를 안내",
    A("transferNote").textContent.indexOf("지금 이 기기 기록") !== -1, A("transferNote").textContent);
  eq("시트: 열면 붙여넣기 칸은 비어 있다", A("transferText").value, "");

  /* 기록이 없을 때 복사 — 머리말만 남기지 않고 안내만 */
  A("transferCopy").fire("click");
  eq("빈 기록: 복사해도 칸은 비어 있다", A("transferText").value, "");
  ok("빈 기록: ‘아직 옮길 기록이 없어요’",
    A("transferNote").textContent.indexOf("아직 옮길 기록이 없어요") !== -1, A("transferNote").textContent);

  A("transferClose").fire("click");
  eq("닫기: ✕ 로 닫힌다", A("transfer").hidden, true);

  /* 2건 체크 + 1건 숨김 후 복사 */
  resetToast();
  A("list").fire("click", toggleEv(rows[0].campaignId));
  A("list").fire("click", toggleEv(rows[1].campaignId));
  var hidBtn = new El("button"); hidBtn.attrs["data-hide"] = rows[2].campaignId; hidBtn._closest = { ".card": card };
  A("list").fire("click", {
    target: { closest: function (sel) { return sel === "[data-hide]" ? hidBtn : (sel === ".card" ? card : null); } },
    preventDefault: function () {}
  });
  A("foot").fire("click", openEv());
  A("transferCopy").fire("click");
  var copied = A("transferText").value;
  ok("복사: 칸에 KTF1 글자가 담긴다", copied.split("\n")[0] === "KTF1", copied.slice(0, 40));
  ok("복사: 체크한 id 가 실린다", copied.indexOf(rows[0].campaignId) !== -1 && copied.indexOf(rows[1].campaignId) !== -1);
  ok("복사: 숨긴 id 가 H 줄에 실린다", /^H /m.test(copied) && copied.indexOf(rows[2].campaignId) !== -1);
  ok("복사: 몇 건인지 안내", A("transferNote").textContent.indexOf("신청완료 2건") !== -1 &&
    A("transferNote").textContent.indexOf("숨김 1건") !== -1, A("transferNote").textContent);

  /* 새 기기(앱) — 기존 1건이 있는 상태에서 붙여넣어 합치기 */
  var seed = {}; seed[rows[5].campaignId] = { at: new Date().toISOString() };
  reloadWith({ "ktApp.applied.v1": JSON.stringify(seed) });
  eq("새 기기: 옮기기 전 신청완료 1건", A("cDone").textContent, "1");
  A("foot").fire("click", openEv());
  A("transferText").value = copied;
  A("transferMerge").fire("click");
  eq("합치기: 시트가 닫힌다", A("transfer").hidden, true);
  var afterMerge = JSON.parse(store[A_STORE] || "{}");
  eq("합치기: 기존 1건 + 옮긴 2건 = 3건", Object.keys(afterMerge).length, 3);
  ok("합치기: 이 기기의 기존 기록도 남아 있다", !!afterMerge[rows[5].campaignId]);
  eq("합치기: 숨김 1건도 옮겨졌다", Object.keys(JSON.parse(store["kt_hidden_v1"] || "{}")).length, 1);
  eq("합치기: 화면 신청완료 건수 = 3", A("cDone").textContent, "3");
  ok("합치기: 토스트 ‘기록을 불러왔어요’",
    A("toast").innerHTML.indexOf("기록을 불러왔어요") !== -1, A("toast").innerHTML);

  /* 덮어쓰기 — 이 기기 기록을 버리고 붙여넣은 것만 */
  A("foot").fire("click", openEv());
  A("transferText").value = copied;
  A("transferReplace").fire("click");
  var afterReplace = JSON.parse(store[A_STORE] || "{}");
  eq("덮어쓰기: 옮긴 2건만 남는다", Object.keys(afterReplace).length, 2);
  ok("덮어쓰기: 이 기기의 기존 기록은 지워진다", !afterReplace[rows[5].campaignId]);
  eq("덮어쓰기: 화면 신청완료 건수 = 2", A("cDone").textContent, "2");
  ok("덮어쓰기: 토스트 ‘기록을 덮어썼어요’",
    A("toast").innerHTML.indexOf("덮어썼어요") !== -1, A("toast").innerHTML);

  /* 잘못 붙여넣었을 때 — 시트는 열린 채로 이유를 알려 준다 */
  A("foot").fire("click", openEv());
  A("transferText").value = "그냥 글자";
  A("transferMerge").fire("click");
  eq("오류: 시트는 열린 채로 남는다", A("transfer").hidden, false);
  ok("오류: 붙여넣기를 안내한다", A("transferMsg").textContent.indexOf("붙여넣") !== -1, A("transferMsg").textContent);
  eq("오류: 기록은 바뀌지 않는다", Object.keys(JSON.parse(store[A_STORE] || "{}")).length, 2);

  /* 닫기 — 바깥(배경) 누르기 */
  A("transfer").fire("click", {
    target: { getAttribute: function (k) { return k === "data-transfer-close" ? "1" : null; } }
  });
  eq("닫기: 배경을 누르면 닫힌다", A("transfer").hidden, true);

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(this);
