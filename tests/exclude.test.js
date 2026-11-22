/* 제외 키워드 + 카톡 복귀 확인 배너(판단 함수) 순수 로직 검증 — QuickJS에서 순수 함수만 돌린다.
 * 실행: python3 tests/run_exclude_test.py
 * 키워드 파싱·정리(쉼표·쉼표 여러 개·중복·상한), 상품별 걸림 판정(대소문자 무시 부분일치),
 * 탭별 적용 범위(전체·오늘 신규만, 신청완료는 그대로), 백업(K 줄) 왕복·예전 포맷 호환,
 * 복귀 배너 조건(최근 30분·미완료·미숨김)을 확인한다. */
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
  function errMsg(fn) {
    try { fn(); return ""; } catch (e) { return (e && e.message) || "Error"; }
  }
  function hay(c) { return (c.title + " " + (c.brandName || "") + " " + (c.category || "")).toLowerCase(); }
  function hits(kw) { return rows.filter(function (c) { return hay(c).indexOf(kw.toLowerCase()) !== -1; }); }

  /* ── 1) 입력 파싱 ───────────────────────── */
  eq("파싱: 쉼표로 나눈다", KT.parseKeywords("사과, 수박").join("|"), "사과|수박");
  eq("파싱: 전각 쉼표·쉼표 여러 개도 나눈다", KT.parseKeywords("사과，，수박,,").join("|"), "사과|수박");
  eq("파싱: 줄바꿈으로도 나눈다", KT.parseKeywords("사과\n수박").join("|"), "사과|수박");
  eq("파싱: 앞뒤 공백을 지운다", KT.parseKeywords("  사과  ,　수박 ").join("|"), "사과|수박");
  eq("파싱: 대소문자만 다른 중복은 하나로", KT.parseKeywords("Coffee, coffee, COFFEE").join("|"), "Coffee");
  eq("파싱: 빈 값·공백만은 버린다", KT.parseKeywords(" , ,\n ").length, 0);
  eq("파싱: 빈 문자열·null", KT.parseKeywords("").length + KT.parseKeywords(null).length, 0);
  eq("파싱: 키워드 하나의 길이 상한", KT.parseKeywords("가나다라마바사아자차카타파하가나다라마바사아자차").join("").length, KT.EXCL_KW_LEN);
  eq("파싱: 개수 상한 " + KT.EXCL_MAX_KW + "개", (function () {
    var many = [];
    for (var i = 0; i < 60; i++) many.push("kw" + i);
    return KT.parseKeywords(many.join(",")).length;
  })(), KT.EXCL_MAX_KW);
  eq("파싱: 키워드 안 쉼표는 나눠서 들어간다", KT.parseKeywords("사과,수박").length, 2);

  /* ── 2) 추가·삭제 ───────────────────────── */
  var base = ["여성"];
  eq("추가: 기존 + 새 키워드", KT.addKeywords(base, "아동, 화장품").join("|"), "여성|아동|화장품");
  eq("추가: 이미 있는 키워드는 늘지 않는다", KT.addKeywords(base, "여성").length, 1);
  eq("추가: 대소문자 무시 중복", KT.addKeywords(["Coffee"], "coffee").length, 1);
  ok("추가: 원본 배열은 바뀌지 않는다", base.length === 1, base.join("|"));
  eq("추가: 상한을 넘지 않는다", (function () {
    var many = [];
    for (var i = 0; i < KT.EXCL_MAX_KW; i++) many.push("k" + i);
    return KT.addKeywords(many, "넘치는키워드").length;
  })(), KT.EXCL_MAX_KW);
  eq("삭제: 키워드 하나 지운다", KT.removeKeyword(["여성", "아동"], "여성").join("|"), "아동");
  eq("삭제: 대소문자 무시", KT.removeKeyword(["Coffee", "tea"], "coffee").join("|"), "tea");
  eq("삭제: 없는 키워드는 그대로", KT.removeKeyword(["여성"], "아동").length, 1);
  eq("정리: 저장값이 JSON 문자열이어도 읽는다", KT.sanitizeKeywords('["여성","아동"]').join("|"), "여성|아동");
  eq("정리: 깨진 JSON 은 빈 배열", KT.sanitizeKeywords("{망가짐").length, 0);
  eq("정리: 배열이 아니면 빈 배열", KT.sanitizeKeywords(42).length + KT.sanitizeKeywords(null).length, 0);

  /* ── 3) 상품 걸림 판정 ──────────────────── */
  var pick = hits("바디")[0];
  ok("판정: 상품명 부분일치", !!KT.excludedBy(pick, ["바디"]));
  ok("판정: 대소문자 무시(영문)", !!KT.excludedBy({ title: "Nike Air Max", brandName: "", category: "" }, ["nike"]));
  ok("판정: 브랜드로도 걸린다", !!KT.excludedBy({ title: "무관한 상품", brandName: "모렌츠", category: "" }, ["모렌츠"]));
  ok("판정: 카테고리로도 걸린다", !!KT.excludedBy({ title: "무관한 상품", brandName: "", category: "뷰티 · 스킨케어" }, ["스킨"]));
  ok("판정: 안 걸리면 통과", !KT.excludedBy({ title: "사과 주스", brandName: "과일", category: "식품" }, ["수박"]));
  eq("판정: 걸린 키워드를 돌려준다", KT.hitKeyword({ title: "사과 수박 세트" }, ["수박", "사과"]), "수박");
  eq("판정: 키워드가 없으면 빈 문자열", KT.hitKeyword(pick, []), "");
  eq("판정: 키워드 배열이 없으면 빈 문자열", KT.hitKeyword(pick, null), "");
  eq("필터: 걸리는 상품만 빠진다", KT.filterExcluded(rows, ["바디"]).length, rows.length - hits("바디").length);
  eq("필터: 키워드가 없으면 전부 그대로", KT.filterExcluded(rows, []).length, rows.length);
  eq("필터: 원본은 그대로", rows.length, DATA.campaigns.length);
  eq("필터: 빈 배열끼리", KT.filterExcluded([], ["바디"]).length, 0);

  /* ── 4) 탭별 적용 범위 — 전체·오늘 신규만, 신청완료는 그대로 ── */
  var doneIds = {};
  doneIds[rows[0].campaignId] = { at: "2026-11-21T09:00:00+09:00" };
  doneIds[pick.campaignId] = { at: "2026-11-21T09:00:00+09:00" };
  var isDone = function (id) { return !!doneIds[id]; };
  var kw = ["바디"];
  var allNoKw = KT.scopeRows(rows, "all", isDone);
  var allKw = KT.scopeRows(rows, "all", isDone, kw);
  eq("범위: 전체 탭은 제외 키워드만큼 줄어든다", allKw.length, allNoKw.length - hits("바디").filter(function (c) { return !isDone(c.campaignId); }).length);
  ok("범위: 전체 탭에 걸리는 상품이 없다", allKw.every(function (c) { return !KT.excludedBy(c, kw); }));
  var newNoKw = KT.scopeRows(rows, "new", isDone), newKw = KT.scopeRows(rows, "new", isDone, kw);
  eq("범위: 오늘 신규도 줄어든다", newKw.length,
    newNoKw.length - hits("바디").filter(function (c) { return !isDone(c.campaignId) && c.isNew; }).length);
  eq("범위: 신청완료 탭은 제외 키워드 영향 없음", KT.scopeRows(rows, "done", isDone, kw).length,
    KT.scopeRows(rows, "done", isDone).length);
  ok("범위: 신청완료 탭에 걸리는 상품도 남아 있다",
    KT.scopeRows(rows, "done", isDone, kw).some(function (c) { return KT.excludedBy(c, kw); }));
  eq("범위: query(all) 도 제외 키워드를 반영", KT.query(rows, { filter: "all", cat: "all", sort: "rate", isDone: isDone, exclude: kw }).length, allKw.length);
  eq("범위: query(done) 은 제외 키워드를 무시", KT.query(rows, { filter: "done", cat: "all", sort: "rate", isDone: isDone, exclude: kw }).length, KT.scopeRows(rows, "done", isDone).length);
  eq("범위: query(new) 도 반영", KT.query(rows, { filter: "new", cat: "all", sort: "rate", isDone: isDone, exclude: kw }).length, newKw.length);
  var cntNoKw = KT.catCounts(rows, { filter: "all", q: "", isDone: isDone });
  var cntKw = KT.catCounts(rows, { filter: "all", q: "", isDone: isDone, exclude: kw });
  eq("범위: 카테고리 칩 합계에서도 빠진다", cntKw.all, cntNoKw.all - hits("바디").filter(function (c) { return !isDone(c.campaignId); }).length);
  var sumKw = KT.summarize(KT.scopeRows(rows, "all", isDone, kw), isDone);
  eq("범위: 상단 수치도 같은 값", sumKw.total, allKw.length);

  /* ── 5) 기록 옮기기 백업에 K 줄 ─────────── */
  var packPlain = KT.packRecords({}, {});
  eq("백업: 키워드를 안 넣으면 예전과 같은 ‘KTF1’", packPlain, "KTF1");
  var one = {}; one[rows[1].campaignId] = { at: "2026-11-21T09:00:00+09:00" };
  var withKw = KT.packRecords(one, {}, ["여성", "아동"]);
  ok("백업: K 줄에 키워드가 실린다", /^K 여성,아동$/m.test(withKw), withKw);
  ok("백업: A 줄은 그대로", /^A /m.test(withKw));
  var back = KT.unpackRecords(withKw);
  eq("백업: 신청완료 id 왕복", back.applied[rows[1].campaignId] ? 1 : 0, 1);
  eq("백업: 키워드 왕복", back.keywords.join("|"), "여성|아동");
  ok("백업: K 줄이 있었다고 알린다(덮어쓰기 판단용)", back.hasKeywords === true);
  var oldBack = KT.unpackRecords("KTF1\nA " + rows[2].campaignId);
  eq("백업: 예전 백업(K 줄 없음)도 읽는다", Object.keys(oldBack.applied).length, 1);
  ok("백업: 예전 백업은 hasKeywords=false", oldBack.hasKeywords === false);
  eq("백업: 예전 백업의 키워드는 빈 배열", oldBack.keywords.length, 0);
  var emptyKw = KT.unpackRecords("KTF1\nK");
  ok("백업: ‘K’ 한 줄(키워드 없음)도 오류 없이", emptyKw.hasKeywords === true && emptyKw.keywords.length === 0);
  ok("백업: 키워드만 있고 기록이 없어도 오류 아님", errMsg(function () { KT.unpackRecords("KTF1\nK 여성"); }) === "");
  ok("백업: 키워드만 읽었을 때 키워드가 들어 있다", KT.unpackRecords("KTF1\nK 여성,아동").keywords.length === 2);
  ok("백업: 관계없는 글자는 여전히 오류", errMsg(function () { KT.unpackRecords("안녕하세요"); }) !== "");
  ok("백업: 머리말만은 여전히 오류", errMsg(function () { KT.unpackRecords("KTF1"); }) !== "");
  var many = [];
  for (var i = 0; i < 25; i++) many.push("kw" + i);
  var kLines = KT.packRecords({}, {}, many).split("\n").filter(function (l) { return /^K /.test(l); });
  ok("백업: 키워드도 20개씩 줄을 나눈다", kLines.length === 2 && kLines.every(function (l) { return l.slice(2).split(",").length <= 20; }), kLines.length);
  eq("백업: 나눈 키워드도 왕복", KT.unpackRecords(KT.packRecords({}, {}, many)).keywords.length, 25);

  /* ── 6) 복귀 배너 조건 ──────────────────── */
  var NOW = Date.parse("2026-11-22T15:00:00+09:00");
  var none = function () { return false; };
  ok("배너: 방금 열었고 미완료면 띄운다", KT.shouldPromptReturn({ id: "abc12345", at: NOW - 60e3 }, NOW, none, none));
  ok("배너: 30분이 지나면 띄우지 않는다", !KT.shouldPromptReturn({ id: "abc12345", at: NOW - KT.RETURN_TTL - 1 }, NOW, none, none));
  ok("배너: 경계값(정확히 30분)은 띄운다", KT.shouldPromptReturn({ id: "abc12345", at: NOW - KT.RETURN_TTL }, NOW, none, none));
  ok("배너: 이미 신청완료면 띄우지 않는다", !KT.shouldPromptReturn({ id: "abc12345", at: NOW - 60e3 }, NOW, function (id) { return id === "abc12345"; }, none));
  ok("배너: 숨긴 상품이면 띄우지 않는다", !KT.shouldPromptReturn({ id: "abc12345", at: NOW - 60e3 }, NOW, none, function (id) { return id === "abc12345"; }));
  ok("배너: 연 기록이 없으면 안 띄운다", !KT.shouldPromptReturn(null, NOW, none, none));
  ok("배너: id 가 없으면 안 띄운다", !KT.shouldPromptReturn({ at: NOW - 60e3 }, NOW, none, none));
  ok("배너: 시각이 깨져 있으면 안 띄운다", !KT.shouldPromptReturn({ id: "abc12345", at: "언제" }, NOW, none, none));
  ok("배너: ISO 시각 문자열도 읽는다", KT.shouldPromptReturn({ id: "abc12345", at: new Date(NOW - 60e3).toISOString() }, NOW, none, none));
  ok("배너: 기기 시계가 앞서도 띄운다", KT.shouldPromptReturn({ id: "abc12345", at: NOW + 5 * 60e3 }, NOW, none, none));
  eq("배너: 확인 시간은 30분", KT.RETURN_TTL, 30 * 60e3);
  eq("저장 키: 제외 키워드 = kt_excluded_kw_v1", KT.EXCL_STORE, "kt_excluded_kw_v1");
  eq("저장 키: 마지막으로 연 상품 = kt_last_open_v1", KT.OPEN_STORE, "kt_last_open_v1");

  /* ── 7) 실제 목록에 적용했을 때 ─────────── */
  var realKw = ["여성"];
  var realHits = hits("여성");
  ok("실제: ‘여성’ 키워드가 걸리는 상품이 있다", realHits.length > 0, realHits.length);
  eq("실제: 전체 탭 건수가 걸린 만큼 줄어든다", KT.scopeRows(rows, "all", none, realKw).length, rows.length - realHits.length);
  eq("실제: 필터 결과에 걸린 상품이 없다",
    KT.query(rows, { filter: "all", cat: "all", sort: "rate", isDone: none, exclude: realKw })
      .filter(function (c) { return KT.excludedBy(c, realKw); }).length, 0);
  eq("실제: 걸린 상품 수만큼만 빠진다(과잉 제외 없음)", realHits.length + KT.scopeRows(rows, "all", none, realKw).length, rows.length);

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(this);
