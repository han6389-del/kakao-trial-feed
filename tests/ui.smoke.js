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
  var doc = {
    hidden: false,
    listeners: {},
    addEventListener: function (t, f) { (doc.listeners[t] = doc.listeners[t] || []).push(f); },
    fire: function (t, ev) { (doc.listeners[t] || []).forEach(function (f) { f(ev || {}); }); },
    getElementById: function (id) { return byId[id] || (byId[id] = new El("div")); },
    querySelectorAll: function (sel) {
      return sel.indexOf("data-filter") !== -1 ? chipsFilter : chipsCat;
    },
    createElement: function (t) { return new El(t); }
  };
  global.document = doc;
  var store = {};
  global.localStorage = {
    getItem: function (k) { return k in store ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  var session = {};
  global.sessionStorage = {
    getItem: function (k) { return k in session ? session[k] : null; },
    setItem: function (k, v) { session[k] = String(v); },
    removeItem: function (k) { delete session[k]; }
  };
  global.navigator = {};
  global.location = { protocol: "https:" };
  global.setTimeout = function (fn) { fn(); return 0; };
  global.clearTimeout = function () {};
  /* window 이벤트(focus) — app.js 는 돌아오는 순간을 visibilitychange·focus·pageshow 로 본다 */
  global.__WIN__ = {};
  global.addEventListener = function (t, f) { (global.__WIN__[t] = global.__WIN__[t] || []).push(f); };
  function fireWin(t, ev) { (global.__WIN__[t] || []).forEach(function (f) { f(ev || {}); }); }

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
  var TRANSFER_IDS = ["list", "foot", "empty", "transfer", "transferCopy", "transferMerge", "transferReplace", "transferClose",
    "kwOpen", "excluded", "excludedClose", "kwInput", "kwAdd", "kwList", "kwClearAll", "kwBadge",
    "retBar", "retTitle", "retDone", "retClose"];
  function clearHandlers() {
    TRANSFER_IDS.forEach(function (id) { doc.getElementById(id).listeners = {}; });
  }
  function openEv() {
    return { target: { closest: function (sel) { return sel === "[data-transfer-open]" ? new El("button") : null; } } };
  }
  function reloadWith(seed) {
    store[A_STORE] = "{}";
    store["kt_hidden_v1"] = "{}";
    Object.keys(seed || {}).forEach(function (k) { store[k] = seed[k]; });
    // 시트·배너는 hidden 으로 시작(가짜 DOM 은 요소를 쓰일 때 만든다)
    ["transfer", "excluded", "retBar"].forEach(function (id) { doc.getElementById(id).hidden = true; });
    doc.hidden = false;
    doc.listeners = {};
    global.__WIN__ = {};
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

  /* ══ 제외 키워드 시트 ═══════════════════
   * 실제 흐름: 툴바 [🚫 제외] → 시트 → 입력·추가(Enter·쉬표 다중) → 칩 ✕ 삭제 → 모두 지우기 */
  function openExclEv() {
    return { target: { closest: function (sel) { return sel === "[data-excluded-open]" ? new El("button") : null; } } };
  }
  function hitsOf(kw) {
    var t = kw.toLowerCase();
    return rows.filter(function (c) {
      return (c.title + " " + (c.brandName || "") + " " + (c.category || "")).toLowerCase().indexOf(t) !== -1;
    });
  }
  function uiDone() { return JSON.parse(store[A_STORE] || "{}"); }
  function uiKws() { return JSON.parse(store["kt_excluded_kw_v1"] || "[]"); }

  ok("마크업: 제외 키워드 버튼·시트 요소가 있다",
    ["kwOpen", "excluded", "excludedClose", "kwInput", "kwAdd", "kwList", "kwClearAll", "kwBadge"]
      .every(function (id) { return html.indexOf('id="' + id + '"') !== -1; }));
  ok("마크업: 제외 키워드 시트도 hidden 으로 시작", /id="excluded"[^>]*\shidden/.test(html));
  ok("마크업: 시트는 dialog 로 읽히고 제목이 연결된다",
    /id="excluded"[^>]*role="dialog"/.test(html) && /aria-labelledby="excludedTitle"/.test(html));

  delete store["kt_excluded_kw_v1"];
  delete session["kt_last_open_v1"];
  reloadWith(null);
  eq("키워드: 처음에는 배지 숨김", A("kwBadge").hidden, true);
  A("kwOpen").fire("click");
  eq("키워드 시트: 툴바 버튼으로 열린다", A("excluded").hidden, false);
  ok("키워드 시트: 비었다고 안내", A("kwList").innerHTML.indexOf("등록된 제외 키워드가 없어요") !== -1, A("kwList").innerHTML);
  eq("키워드 시트: 입력칸은 비어 있다", A("kwInput").value, "");

  var KW_A = "바디", hitsA = hitsOf(KW_A).length;
  A("kwInput").value = KW_A;
  A("kwAdd").fire("click");
  eq("키워드: localStorage kt_excluded_kw_v1 에 저장", uiKws().join("|"), KW_A);
  eq("키워드: 전체 탭 건수가 걸린 만큼 줄어든다", A("cAll").textContent, KT.num(total0 - hitsA));
  eq("키워드: 노출 건수도 줄어든다", A("shownCount").textContent, (total0 - hitsA) + "건");
  eq("키워드: 상단 미신청 수치도 줄어든다", A("stScope").textContent, KT.num(total0 - hitsA));
  eq("키워드: 배지에 개수", A("kwBadge").textContent, "1");
  eq("키워드: 배지 보이기", A("kwBadge").hidden, false);
  ok("키워드: 칩으로 표시되고 ✕ 삭제 버튼이 있다",
    A("kwList").innerHTML.indexOf('data-kw-del="' + KW_A + '"') !== -1, A("kwList").innerHTML);
  eq("키워드: 추가하면 입력칸이 비워진다", A("kwInput").value, "");
  ok("키워드: 몇 건 가리는지 안내", A("kwMsg").textContent.indexOf("가리는 중") !== -1, A("kwMsg").textContent);
  ok("키워드: 하단에 관리 링크", A("foot").innerHTML.indexOf("data-excluded-open") !== -1, A("foot").innerHTML);
  ok("키워드: 목록을 다시 그려도 걸리는 상품이 없다",
    A("list").innerHTML.indexOf(KW_A) === -1 || hitsOf(KW_A).every(function (c) {
      return A("list").innerHTML.indexOf('data-id="' + c.campaignId + '"') === -1;
    }));

  /* Enter 키·쉼표 다중 입력·중복 */
  A("kwInput").value = "전용";
  A("kwInput").fire("keydown", { key: "Enter", preventDefault: function () {} });
  eq("키워드: Enter 로도 추가", uiKws().length, 2);
  A("kwInput").value = "가나다, 라마바 ,가나다";
  A("kwAdd").fire("click");
  eq("키워드: 쉼표 다중 입력 + 중복 제거", uiKws().length, 4);
  eq("키워드: 배지 4", A("kwBadge").textContent, "4");
  A("kwInput").value = "가나다";
  A("kwAdd").fire("click");
  eq("키워드: 이미 있는 키워드는 늘지 않는다", uiKws().length, 4);
  ok("키워드: 이미 등록됐다고 알린다", A("kwMsg").textContent.indexOf("이미") !== -1, A("kwMsg").textContent);
  A("kwInput").value = "";
  A("kwAdd").fire("click");
  ok("키워드: 빈 입력은 안내만", A("kwMsg").textContent.indexOf("입력해") !== -1, A("kwMsg").textContent);

  /* 신청완료 탭은 제외 키워드에 걸려도 그대로 보인다 */
  var hitRow = hitsOf(KW_A)[0];
  A("list").fire("click", toggleEv(hitRow.campaignId));
  eq("키워드: 걸리는 상품도 완료 체크된다", !!uiDone()[hitRow.campaignId], true);
  eq("키워드: 전체 탭은 완료분·걸림분 모두 빠진 수", A("cAll").textContent,
    KT.num(KT.scopeRows(rows, "all", function (id) { return !!uiDone()[id]; }, uiKws()).length));
  eq("키워드: 신청완료 건수는 그대로 1", A("cDone").textContent, "1");
  chipsFilter.filter(function (c) { return c.attrs["data-filter"] === "done"; })[0].fire("click");
  eq("키워드: 신청완료 탭에는 걸리는 상품도 남아 1건", A("shownCount").textContent, "1건");
  chipsFilter.filter(function (c) { return c.attrs["data-filter"] === "all"; })[0].fire("click");

  /* 칩 ✕ 로 하나 삭제 → 목록 복구 */
  var beforeDel = uiKws().length;
  A("kwList").fire("click", {
    target: {
      closest: function (sel) {
        if (sel !== "[data-kw-del]") return null;
        var b = new El("button"); b.attrs["data-kw-del"] = "가나다"; return b;
      }
    }
  });
  eq("키워드: ✕ 로 하나 지운다", uiKws().length, beforeDel - 1);
  ok("키워드: 지운 키워드는 목록·저장소에 없다",
    A("kwList").innerHTML.indexOf('data-kw-del="가나다"') === -1 && uiKws().indexOf("가나다") === -1);
  ok("키워드: 지웠다고 안내", A("kwMsg").textContent.indexOf("지웠어요") !== -1, A("kwMsg").textContent);
  eq("키워드: 지운 뒤 건수가 늘어난다", A("cAll").textContent,
    KT.num(KT.scopeRows(rows, "all", function (id) { return !!uiDone()[id]; }, uiKws()).length));

  /* 모두 지우기 → 원래 목록 */
  A("kwClearAll").fire("click");
  eq("키워드: 모두 지우기 → 저장소 비움", uiKws().length, 0);
  eq("키워드: 모두 지우기 → 배지 숨김", A("kwBadge").hidden, true);
  ok("키워드: 모두 지우기 → 빈 목록 안내", A("kwList").innerHTML.indexOf("등록된 제외 키워드가 없어요") !== -1);
  eq("키워드: 모두 지우면 전체 탭 원복", A("cAll").textContent, KT.num(total0 - 1));

  /* 시트 닫기 — ✕ 와 배경 누르기, Enter 키 (footer 링크로도 열린다) */
  A("excludedClose").fire("click");
  eq("키워드 시트: ✕ 로 닫힌다", A("excluded").hidden, true);
  A("foot").fire("click", openExclEv());
  eq("키워드 시트: 하단 링크로도 열린다", A("excluded").hidden, false);
  A("excluded").fire("click", {
    target: { getAttribute: function (k) { return k === "data-excluded-close" ? "1" : null; } }
  });
  eq("키워드 시트: 배경을 누르면 닫힌다", A("excluded").hidden, true);

  /* ══ 카톡 복귀 원탭 확인 배너 ═══════════
   * 실제 흐름: [모바일 신청 열기] → 카톡(페이지 hidden) → 돌아옴 → 하단 배너 → 완료 처리/닫기 */
  function openCardEv(id) {
    return {
      target: {
        closest: function (sel) {
          if (sel !== "[data-open]") return null;
          var a = new El("a"); a.attrs["data-open"] = id; return a;
        }
      },
      preventDefault: function () {}
    };
  }
  function lastOpen() { return JSON.parse(session["kt_last_open_v1"] || "null"); }

  delete store["kt_excluded_kw_v1"];
  delete session["kt_last_open_v1"];
  reloadWith(null);
  ok("마크업: 하단 배너 요소가 있고 hidden 으로 시작",
    ["retBar", "retTitle", "retDone", "retClose"].every(function (id) { return html.indexOf('id="' + id + '"') !== -1; }) &&
    /id="retBar"[^>]*\shidden/.test(html));
  eq("배너: 처음에는 안 보인다", A("retBar").hidden, true);

  doc.hidden = true; // 카톡으로 나간 상태
  A("list").fire("click", openCardEv(rows[0].campaignId));
  ok("배너: 카톡으로 열면 마지막으로 연 상품을 기억", !!lastOpen() && lastOpen().id === rows[0].campaignId, JSON.stringify(lastOpen()));
  eq("배너: 제목도 기억", lastOpen() && lastOpen().title, rows[0].title);
  eq("배너: 나가기 전에는 뜨지 않는다", A("retBar").hidden, true);
  eq("배너: 열었다고 바로 완료 처리하지는 않는다", A("cDone").textContent, "0");

  doc.hidden = false; // 돌아옴
  doc.fire("visibilitychange");
  eq("배너: 돌아오면 하단 배너가 뜬다", A("retBar").hidden, false);
  ok("배너: 문구에 방금 연 상품 이름", A("retTitle").textContent.indexOf(rows[0].title.slice(0, 8)) !== -1, A("retTitle").textContent);
  eq("배너: 배너가 뜨면 감춰 두지 않는다", A("retBar").hidden, false);

  resetToast();
  A("retDone").fire("click");
  eq("배너: [완료 처리] → 신청완료로 저장", !!uiDone()[rows[0].campaignId], true);
  eq("배너: [완료 처리] → 신청완료 1", A("cDone").textContent, "1");
  eq("배너: [완료 처리] → 전체 탭 1 감소", A("cAll").textContent, KT.num(total0 - 1));
  eq("배너: [완료 처리] → 배너 닫힘", A("retBar").hidden, true);
  ok("배너: [완료 처리] → 기억을 지운다", !session["kt_last_open_v1"], session["kt_last_open_v1"]);
  ok("배너: [완료 처리] → 토스트로 알린다", A("toast").innerHTML.indexOf("신청완료로 옮겼어요") !== -1, A("toast").innerHTML);
  A("toast").querySelector("button").fire("click"); // 되돌리기
  eq("배너: 되돌리면 미신청 복귀", A("cDone").textContent, "0");

  /* [닫기] — 완료 처리 없이 기억만 지운다 */
  resetToast();
  doc.hidden = true;
  A("list").fire("click", openCardEv(rows[1].campaignId));
  doc.hidden = false;
  fireWin("focus"); // window focus 로 돌아오는 경우
  eq("배너: focus 로 돌아와도 뜬다", A("retBar").hidden, false);
  A("retClose").fire("click");
  eq("배너: [닫기] → 배너 닫힘", A("retBar").hidden, true);
  eq("배너: [닫기] → 완료 처리 안 함", A("cDone").textContent, "0");
  ok("배너: [닫기] → 기억을 지운다", !session["kt_last_open_v1"], session["kt_last_open_v1"]);
  eq("배너: 닫은 뒤 다시 돌아와도 안 뜬다", (function () { doc.fire("visibilitychange"); return A("retBar").hidden; })(), true);

  /* 나가기 전에 직접 완료·숨김 처리한 상품은 묻지 않는다 */
  doc.hidden = true;
  A("list").fire("click", openCardEv(rows[2].campaignId));
  A("list").fire("click", toggleEv(rows[2].campaignId));
  doc.hidden = false;
  doc.fire("visibilitychange");
  eq("배너: 이미 완료한 상품은 묻지 않는다", A("retBar").hidden, true);
  A("list").fire("click", toggleEv(rows[2].campaignId)); // 되돌리기

  doc.hidden = true;
  A("list").fire("click", openCardEv(rows[4].campaignId));
  var hideBtn2 = new El("button"); hideBtn2.attrs["data-hide"] = rows[4].campaignId; hideBtn2._closest = { ".card": card };
  A("list").fire("click", {
    target: { closest: function (sel) { return sel === "[data-hide]" ? hideBtn2 : (sel === ".card" ? card : null); } },
    preventDefault: function () {}
  });
  doc.hidden = false;
  doc.fire("visibilitychange");
  eq("배너: 숨긴 상품은 묻지 않는다", A("retBar").hidden, true);
  A("foot").fire("click", { target: { closest: function (sel) { return sel === "[data-unhide-all]" ? new El("button") : null; } } });

  /* 30분이 지난 기억은 띄우지 않고 지운다 */
  session["kt_last_open_v1"] = JSON.stringify({ id: rows[3].campaignId, title: rows[3].title, at: Date.now() - 31 * 60e3 });
  doc.hidden = false;
  fireWin("pageshow");
  eq("배너: 30분 넘은 기억은 띄우지 않는다", A("retBar").hidden, true);
  ok("배너: 30분 넘으면 기억도 지운다", !session["kt_last_open_v1"], session["kt_last_open_v1"]);

  /* 새로고침해도 기억이 남아 있으면 다시 물어본다 */
  session["kt_last_open_v1"] = JSON.stringify({ id: rows[5].campaignId, title: rows[5].title, at: Date.now() - 60e3 });
  reloadWith(null);
  eq("배너: 새로고침 뒤에도 기억이 살아 있으면 뜬다", (function () { fireWin("pageshow"); return A("retBar").hidden; })(), false);
  A("retClose").fire("click");

  /* 카톡에 있는 사이 웹뷰가 죽어 sessionStorage 가 비워져도 — localStorage 에 같이 적어 둔 기억으로 살아난다 */
  delete session["kt_last_open_v1"];
  store["kt_last_open_v1"] = JSON.stringify({ id: rows[6].campaignId, title: rows[6].title, at: Date.now() - 60e3 });
  reloadWith(null);
  eq("배너: sessionStorage 가 비어도 localStorage 기억으로 뜬다", (function () { fireWin("pageshow"); return A("retBar").hidden; })(), false);
  A("retClose").fire("click");
  ok("배너: 닫으면 localStorage 쪽 기억도 지운다", !store["kt_last_open_v1"], store["kt_last_open_v1"]);

  /* 아직 카톡에 머무는 동안(hidden)에는 뜨지 않고, 돌아와야 뜬다 */
  session["kt_last_open_v1"] = JSON.stringify({ id: rows[6].campaignId, title: rows[6].title, at: Date.now() - 60e3 });
  doc.hidden = true;
  doc.fire("visibilitychange");
  eq("배너: 아직 카톡에 있는 동안에는 안 뜬다", A("retBar").hidden, true);
  doc.hidden = false;
  doc.fire("visibilitychange");
  eq("배너: 돌아오는 순간 뜬다", A("retBar").hidden, false);
  A("retClose").fire("click");

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(this);
