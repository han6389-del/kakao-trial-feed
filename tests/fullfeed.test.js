/* 전체 공개(전체 체험단) + 카테고리 칩 + 1탭 제외 프리셋 검증 — QuickJS에서 순수 함수만 돌린다.
 * 실행: python3 tests/run_fullfeed_test.py
 * 확인: data/campaigns.json 이 걸러내지 않은 전체(481건)인지, 모든 상품이 카테고리 칩 어딘가에
 *      빠짐없이 들어가는지(대분류 9묶음), 프리셋 키워드가 중복 없이·상한 안에서 더해지는지,
 *      프리셋이 실제 목록에서 여성·유아동·뷰티만 걷어내는지. */
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
  function lcat(c) { return String((c && c.category) || "").split(" · ")[0]; }
  function hay(c) { return (String(c.title || "") + " " + String(c.brandName || "") + " " + String(c.category || "")).toLowerCase(); }

  /* ── 1) 데이터: 걸러내지 않은 전체 ───────── */
  eq("데이터: excludedCount 0", DATA.excludedCount, 0);
  eq("데이터: excludeMode none", DATA.excludeMode, "none");
  eq("데이터: totalCount = 상품 수", DATA.totalCount, rows.length);
  eq("데이터: rawTotalCount = 상품 수", DATA.rawTotalCount, rows.length);
  ok("데이터: 전체 규모(450건 이상)", rows.length >= 450, rows.length + "건");
  ok("데이터: 모든 상품에 필수 값", rows.every(function (c) {
    return !!c.campaignId && !!String(c.title || "").trim() && !!c.mobileUrl &&
      typeof c.remainingDays === "number";
  }));
  eq("데이터: id 중복 없음", (function () {
    var seen = {}, dup = 0;
    rows.forEach(function (c) { if (seen[c.campaignId]) dup++; seen[c.campaignId] = 1; });
    return dup;
  })(), 0);
  eq("데이터: 신규 건수도 전체 기준", DATA.newCount, rows.filter(function (c) { return c.isNew; }).length);

  /* ── 2) 카테고리 칩: 모든 상품이 어딘가에 ── */
  eq("칩: 라벨 순서", KT.CAT_GROUPS.map(function (g) { return g.label; }).join(","),
    "전체,식품,리빙,디지털,뷰티,패션,레저,유아동·반려,기타");
  eq("칩: 키 순서", KT.CAT_GROUPS.map(function (g) { return g.key; }).join(","),
    "all,food,living,digital,beauty,fashion,leisure,pet,etc");
  var cats = KT.catCounts(rows, { filter: "all", cat: "all", q: "", isDone: null });
  eq("칩: 전체 = 상품 수", cats.all, rows.length);
  var sum = 0;
  KT.CAT_GROUPS.forEach(function (g) { if (g.key !== "all") sum += cats[g.key] || 0; });
  eq("칩: 묶음 합계 = 전체(빠지는 상품 없음)", sum, rows.length);
  ok("칩: 뷰티에 상품이 있다", (cats.beauty || 0) > 0, String(cats.beauty));
  ok("칩: 패션에 상품이 있다", (cats.fashion || 0) > 0, String(cats.fashion));
  ok("칩: 유아동·반려에 상품이 있다", (cats.pet || 0) > 0, String(cats.pet));
  eq("칩: 유아동·반려 = 그 대분류 상품 수", cats.pet,
    rows.filter(function (c) { return lcat(c) === "유아동·반려"; }).length);

  var EXPECT = {
    "식품": "food", "리빙": "living", "디지털·가전": "digital", "뷰티": "beauty",
    "패션": "fashion", "레저·스포츠": "leisure", "유아동·반려": "pet"
  };
  var wrong = [];
  rows.forEach(function (c) {
    var key = KT.groupKeyOf(c);
    if (!key || key === "all") { wrong.push("(없음) " + c.title); return; }
    var want = EXPECT[lcat(c)];
    if (want) { if (key !== want) wrong.push(lcat(c) + " → " + key + " / " + c.title); }
    else if (key !== "living" && key !== "etc") wrong.push(lcat(c) + " → " + key + " / " + c.title);
  });
  ok("칩: 대분류가 모두 제 칸으로", wrong.length === 0, wrong.slice(0, 3).join(" | "));
  eq("칩: 분류 없는 상품도 사라지지 않는다",
    rows.filter(function (c) { return !lcat(c); }).filter(function (c) {
      var k = KT.groupKeyOf(c); return k === "living" || k === "etc";
    }).length,
    rows.filter(function (c) { return !lcat(c); }).length);
  ok("칩: 기타에 남는 상품(책·음반티켓 등)이 있다", (cats.etc || 0) > 0, String(cats.etc));

  /* 칩을 누르면 그 묶음만 나온다 */
  eq("칩: 뷰티 칩 = 뷰티 상품 수", KT.query(rows, { filter: "all", cat: "beauty", sort: "rate", isDone: null }).length, cats.beauty);
  eq("칩: 패션 칩 = 패션 상품 수", KT.query(rows, { filter: "all", cat: "fashion", sort: "rate", isDone: null }).length, cats.fashion);
  eq("칩: 유아동·반려 칩 = 그 상품 수", KT.query(rows, { filter: "all", cat: "pet", sort: "rate", isDone: null }).length, cats.pet);

  /* ── 3) 1탭 프리셋 키워드 ─────────────── */
  eq("프리셋: 9개", KT.PRESET_KEYWORDS.length, 9);
  eq("프리셋: 키워드 목록", KT.PRESET_KEYWORDS.join(","),
    "여성,유아동,스킨케어,메이크업,향수,주얼리,임산부,육아,생리대");
  eq("프리셋: 빈 목록에 넣기", KT.applyPreset([]).join("|"),
    "여성|유아동|스킨케어|메이크업|향수|주얼리|임산부|육아|생리대");
  eq("프리셋: 기존 키워드는 앞에 그대로", KT.applyPreset(["커피"]).join("|"),
    "커피|여성|유아동|스킨케어|메이크업|향수|주얼리|임산부|육아|생리대");
  eq("프리셋: 겹치는 키워드는 늘지 않는다", KT.applyPreset(["여성", "향수"]).length, 9);
  eq("프리셋: 두 번 눌러도 9개", KT.applyPreset(KT.applyPreset([])).length, 9);
  eq("프리셋: 앞뒤 공백·대소문자 중복", KT.applyPreset(["  여성 "]).length, 9);
  ok("프리셋: 원본 배열은 바뀌지 않는다", (function () { var b = []; KT.applyPreset(b); return b.length === 0; })());
  eq("프리셋: 상한(" + KT.EXCL_MAX_KW + "개)을 넘지 않는다", (function () {
    var many = [];
    for (var i = 0; i < KT.EXCL_MAX_KW - 2; i++) many.push("k" + i);
    return KT.applyPreset(many).length;
  })(), KT.EXCL_MAX_KW);
  ok("프리셋: 상한에 걸리면 ‘적용됨’은 아니다", (function () {
    var many = [];
    for (var i = 0; i < KT.EXCL_MAX_KW - 2; i++) many.push("k" + i);
    return KT.hasPreset(KT.applyPreset(many)) === false;
  })());

  /* hasPreset — 버튼의 ‘적용됨’ 표시 */
  ok("프리셋 상태: 빈 목록은 아님", KT.hasPreset([]) === false);
  ok("프리셋 상태: 넣은 뒤에는 적용됨", KT.hasPreset(KT.applyPreset([])) === true);
  ok("프리셋 상태: 하나 지우면 아님", KT.hasPreset(KT.removeKeyword(KT.applyPreset([]), "육아")) === false);
  ok("프리셋 상태: 다른 키워드가 더 있어도 적용됨", KT.hasPreset(KT.applyPreset(["커피", "초콜릿"])) === true);
  ok("프리셋 상태: 대소문자 무시", KT.hasPreset(["여성", "유아동", "스킨케어", "메이크업", "향수", "주얼리", "임산부", "육아", "생리대", "COFFEE"]) === true);

  /* ── 4) 프리셋이 실제 목록에서 걷어내는 것 ── */
  var preset = KT.applyPreset([]), left = KT.filterExcluded(rows, preset);
  ok("프리셋: 목록이 줄어든다", left.length < rows.length, left.length + " / " + rows.length);
  ok("프리셋: 이름·브랜드·분류에 걸린 것만 빠진다", (function () {
    var hit = rows.filter(function (c) { return KT.excludedBy(c, preset); });
    return left.length === rows.length - hit.length && left.every(function (c) {
      return !KT.hitKeyword(c, preset);
    });
  })());
  ok("프리셋: 유아동·반려 묶음은 전부 가려진다", left.every(function (c) { return lcat(c) !== "유아동·반려"; }));
  ok("프리셋: 뷰티는 남는 것도 있다(바디·핸드·헤어 등)", left.some(function (c) { return lcat(c) === "뷰티"; }));
  ok("프리셋: 식품·디지털은 거의 그대로", left.filter(function (c) {
    var l = lcat(c); return l === "식품" || l === "디지털·가전";
  }).length >= rows.filter(function (c) {
    var l = lcat(c); return l === "식품" || l === "디지털·가전";
  }).length - rows.filter(function (c) {
    var l = lcat(c); return (l === "식품" || l === "디지털·가전") && KT.excludedBy(c, preset);
  }).length);
  eq("프리셋: 전체 탭 목록 = 프리셋을 뺀 수", KT.query(rows, {
    filter: "all", cat: "all", sort: "rate", isDone: null, exclude: preset
  }).length, left.length);
  eq("프리셋: 프리셋 없으면 481건 그대로", KT.query(rows, {
    filter: "all", cat: "all", sort: "rate", isDone: null, exclude: []
  }).length, rows.length);

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(typeof globalThis !== "undefined" ? globalThis : this);
