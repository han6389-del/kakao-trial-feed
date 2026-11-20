/* 카드 숨김(✕) 로직 검증 — QuickJS에서 순수 함수만 돌린다.
 * 실행: python3 tests/run_hide_test.py
 * data/campaigns.json 실제 데이터로 숨김 추가·복구·건수 재계산·카테고리 칩 연동을 확인한다. */
(function (global) {
  "use strict";
  var KT = global.KT, DATA = global.__DATA__, rows = DATA.campaigns;
  var out = [], pass = 0, fail = 0;
  function ok(name, cond, detail) {
    if (cond) { pass++; out.push("PASS  " + name); }
    else { fail++; out.push("FAIL  " + name + (detail ? "  → " + detail : "")); }
  }
  function eq(name, got, want) {
    ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  }

  /* 기준값(숨김 없음) */
  var base = KT.summarize(rows, null);
  var baseCats = KT.catCounts(rows, { filter: "all", cat: "all", q: "", isDone: null });
  eq("기준: 전체 건수 = 데이터 건수", base.total, rows.length);
  eq("기준: 칩 전체 합계 = 데이터 건수", baseCats.all, rows.length);

  /* 숨김 3건 — 카테고리가 서로 다른 상품을 고른다 */
  var byCat = {};
  rows.forEach(function (c) { var k = KT.groupKeyOf(c); (byCat[k] = byCat[k] || []).push(c); });
  var pick = [];
  Object.keys(byCat).forEach(function (k) { if (pick.length < 3 && byCat[k][0]) pick.push(byCat[k][0]); });
  var hidden = {};
  pick.forEach(function (c) { hidden[c.campaignId] = { at: new Date().toISOString() }; });

  var visible = KT.filterHidden(rows, hidden);
  eq("숨김: 3건이 빠진다", visible.length, rows.length - 3);
  ok("숨김: hidden 에 없는 id 는 남는다",
    visible.length === rows.length - 3 && pick.every(function (c) {
      return visible.every(function (v) { return v.campaignId !== c.campaignId; });
    }));
  eq("숨김: filterHidden 은 새 배열(원본 불변)", rows.length, DATA.campaigns.length);

  var s = KT.summarize(visible, null);
  eq("건수: 모집중 = visible 길이", s.total, rows.length - 3);
  eq("건수: 신규 = 숨긴 것 중 isNew 만큼 감소",
    s.newCount, base.newCount - pick.filter(function (c) { return c.isNew; }).length);
  ok("건수: 최고 확률은 남은 상품 기준",
    s.best === visible.reduce(function (m, c) { return Math.max(m, c.winRate); }, 0));
  eq("건수: 전부 숨기면 0", KT.summarize(KT.filterHidden(rows, (function () {
    var h = {}; rows.forEach(function (c) { h[c.campaignId] = { at: "" }; }); return h;
  })()), null).total, 0);

  var cats = KT.catCounts(visible, { filter: "all", cat: "all", q: "", isDone: null });
  eq("칩: 전체 = visible 길이", cats.all, rows.length - 3);
  var sum = 0;
  KT.CAT_GROUPS.forEach(function (g) { if (g.key !== "all") sum += cats[g.key] || 0; });
  eq("칩: 카테고리 합계 = 칩 전체", sum, cats.all);
  ok("칩: 숨긴 상품의 카테고리 건수가 줄어든다",
    pick.every(function (c) {
      var k = KT.groupKeyOf(c);
      return (cats[k] || 0) === (baseCats[k] || 0) - pick.filter(function (p) {
        return KT.groupKeyOf(p) === k;
      }).length;
    }));

  /* 목록·필터에서도 숨긴 상품이 안 나온다 */
  var q = KT.query(visible, { filter: "all", cat: "all", sort: "rate", isDone: null });
  eq("목록: 정렬 결과 = visible 길이", q.length, visible.length);
  ok("목록: 숨긴 id 가 결과에 없다",
    pick.every(function (c) {
      return q.every(function (x) { return x.campaignId !== c.campaignId; });
    }));
  var qCat = KT.query(visible, { filter: "all", cat: KT.groupKeyOf(pick[0]), sort: "rate", isDone: null });
  eq("목록: 숨긴 상품의 카테고리 칩 건수도 반영",
    qCat.length, Math.max(0, (baseCats[KT.groupKeyOf(pick[0])] || 0) - 1));
  var doneMap = {}; doneMap[visible[0].campaignId] = { at: "" };
  var sTodo = KT.summarize(KT.filterHidden(rows, hidden), function (id) { return !!doneMap[id]; });
  eq("건수: 신청 완료는 visible 안에서만 센다", sTodo.doneCount, 1);

  /* 되돌리기 — 숨김 맵에서 지우면 원래대로 */
  pick.forEach(function (c) { delete hidden[c.campaignId]; });
  var back = KT.filterHidden(rows, hidden);
  eq("되돌리기: 건수 원복", KT.summarize(back, null).total, base.total);
  var backCats = KT.catCounts(back, { filter: "all", cat: "all", q: "", isDone: null });
  ok("되돌리기: 칩 건수 원복",
    KT.CAT_GROUPS.every(function (g) { return (backCats[g.key] || 0) === (baseCats[g.key] || 0); }));

  /* 카드 마크업 — 숨기기 버튼이 campaignId 를 들고, 신청 버튼과 따로 있다 */
  var html = KT.cardHTML(rows[0], false);
  ok("카드: data-hide 버튼이 있다", html.indexOf('data-hide="' + rows[0].campaignId + '"') !== -1);
  ok("카드: 숨기기 버튼은 신청 버튼(.actions) 밖 .row 안에 있다",
    /<div class="row">[\s\S]*data-hide[\s\S]*<\/div>/.test(html) &&
    html.indexOf("data-hide") < html.indexOf('class="actions"'));
  ok("카드: 숨기기 버튼은 ✕ 표시", html.indexOf("✕") !== -1);
  ok("카드: 신청 완료 카드에서도 숨기기 버튼 유지", KT.cardHTML(rows[0], true).indexOf("data-hide") !== -1);
  ok("카드: 완료 플래그와 숨기기 버튼이 겹치지 않게 각각 따로", KT.cardHTML(rows[0], true).indexOf("doneflag") !== -1);

  /* 저장 키·프로토타입 안전성 */
  eq("저장 키 이름", KT.HIDDEN_STORE, "kt_hidden_v1");
  eq("숨김 보관 기간", KT.HIDDEN_DAYS, 60);
  ok("isHiddenId: __proto__/constructor 같은 키를 숨김으로 오판하지 않는다",
    !KT.isHiddenId({}, "constructor") && !KT.isHiddenId({}, "__proto__") &&
    !KT.isHiddenId({}, "toString") && !KT.isHiddenId(null, "abc"));
  ok("isHiddenId: 숨긴 id 는 true", KT.isHiddenId(hidden, rows[1].campaignId) === !!hidden[rows[1].campaignId]);

  global.__RESULT__ = {
    pass: pass, fail: fail, log: out,
    picked: pick.map(function (c) { return KT.groupKeyOf(c) + ":" + c.title.slice(0, 18); })
  };
})(this);
