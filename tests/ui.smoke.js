/* 카드 숨김 UI 흐름 스모크 테스트 — 최소 가짜 DOM 위에서 app.js 화면 블록을 실제로 돌린다.
 * 확인: 카드 삭제(숨김) → 목록/상단 건수/칩 건수 감소 → 되돌리기 → 원복, 하단 ‘모두 되돌리기’.
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
  var chipsFilter = ["all", "new", "todo"].map(function (k) { var e = new El("button"); e.attrs["data-filter"] = k; return e; });
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

  var rows = DATA.campaigns;
  var total0 = rows.length;
  eq("초기: 모집중 = 데이터 건수", A("stTotal").textContent, KT.num(total0));
  eq("초기: 검색 노출 건수", A("shownCount").textContent, total0 + "건");
  var chips0 = chipsCat.map(function (c) { return c._b.textContent; });
  eq("초기: 칩 전체 건수", A("cAll").textContent, KT.num(total0));

  /* 숨기기 클릭 — list 위임 핸들러에 가짜 이벤트를 넣는다 */
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
  eq("숨김: 상단 모집중 1 감소", A("stTotal").textContent, KT.num(total0 - 1));
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
  eq("되돌리기: 모집중 원복", A("stTotal").textContent, KT.num(total0));
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
  eq("2건 숨김: 모집중 -2", A("stTotal").textContent, KT.num(total0 - 2));
  ok("2건 숨김: 하단 ‘2개 모두 되돌리기’", A("foot").innerHTML.indexOf("2개") !== -1, A("foot").innerHTML);
  A("foot").fire("click", { target: { closest: function (sel) { return sel === "[data-unhide-all]" ? new El("button") : null; } } });
  eq("모두 되돌리기: 저장소 비움", Object.keys(JSON.parse(store["kt_hidden_v1"] || "{}")).length, 0);
  eq("모두 되돌리기: 모집중 원복", A("stTotal").textContent, KT.num(total0));

  /* 저장된 숨김이 새로고침(재로드) 뒤에도 유지되는지 — app.js 를 한 번 더 로드 */
  var h = {}; h[rows[3].campaignId] = { at: new Date().toISOString() };
  store["kt_hidden_v1"] = JSON.stringify(h);
  var before = A("stTotal").textContent;
  global.__RERUN__();
  eq("재로드: 저장된 숨김이 반영", A("stTotal").textContent, KT.num(total0 - 1));
  ok("재로드: 저장 전 값과 다르다", before !== A("stTotal").textContent);

  /* 오래된(60일 초과) 숨김은 정리된다 */
  store["kt_hidden_v1"] = JSON.stringify({ "old-id": { at: new Date(Date.now() - 61 * 864e5).toISOString() } });
  global.__RERUN__();
  eq("정리: 60일 지난 숨김은 버린다", Object.keys(JSON.parse(store["kt_hidden_v1"])).length, 0);

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(this);
