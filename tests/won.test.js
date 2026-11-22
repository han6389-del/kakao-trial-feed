/* 🎉 당첨 · 후기 챙기기 순수 로직 검증 — QuickJS 에서 순수 함수만 돌린다.
 * 실행: python3 tests/run_won_test.py
 * 확인: 당첨 표시/해제, 후기 완료 토글, 발표 다음 날 자동 정리에서 당첨 보호,
 *       목록에서 빠진 당첨 카드 복원, 당첨 탭 정렬(후기 전 먼저), 탭·건수,
 *       기록 옮기기(KTF1) W/R 줄 왕복과 예전 백업 호환을 확인한다. */
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
  function keys(o) { return Object.keys(o || {}).sort(); }
  function isoDay(idx) {
    var d = new Date(idx * 864e5), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }
  var T = KT.todayKST();
  var NOW = Date.parse(isoDay(T) + "T12:00:00+09:00");

  /* ── 1) 당첨 표시 / 해제 ───────────────────── */
  var A = rows[0], B = rows[1], C = rows[2];
  var plain = {}; plain[A.campaignId] = KT.snapshotOf(A);
  var won1 = KT.withWon(plain, A.campaignId, true, NOW);
  eq("당첨: won=true", KT.isWonEntry(won1[A.campaignId]), true);
  eq("당첨: wonAt 을 남긴다", won1[A.campaignId].wonAt, new Date(NOW).toISOString());
  eq("당첨: reviewed 는 기본 false", won1[A.campaignId].reviewed, false);
  eq("당첨: 스냅샷(제목)이 그대로 남는다", won1[A.campaignId].title, A.title);
  eq("당첨: 마감일도 그대로", won1[A.campaignId].endDate, A.endDate);
  eq("당첨: 원본 맵은 바뀌지 않는다", KT.isWonEntry(plain[A.campaignId]), false);
  ok("당첨: 원본 항목도 바뀌지 않는다", plain[A.campaignId].wonAt === undefined);

  var undone = KT.withWon(won1, A.campaignId, false, NOW);
  eq("당첨 취소: won 이 빠진다", undone[A.campaignId].won, undefined);
  eq("당첨 취소: wonAt 도 빠진다", undone[A.campaignId].wonAt, undefined);
  eq("당첨 취소: reviewed 도 빠진다", undone[A.campaignId].reviewed, undefined);
  eq("당첨 취소: 신청완료 기록(스냅샷)은 남는다", undone[A.campaignId].title, A.title);
  eq("당첨 취소: 신청 시각도 남는다", undone[A.campaignId].at, plain[A.campaignId].at);
  eq("당첨 취소 뒤에도 신청완료로 센다", !!undone[A.campaignId], true);

  var fresh = KT.withWon({}, "brandnew0001", true, NOW);
  ok("당첨: 기록이 없어도 항목을 만든다", !!fresh["brandnew0001"] && fresh["brandnew0001"].won === true);
  ok("당첨: 만들어진 항목에 시각이 있다", !!fresh["brandnew0001"].at);

  /* 여러 건 중 한 건만 표시해도 나머지는 그대로 */
  var two = {}; two[A.campaignId] = KT.snapshotOf(A); two[B.campaignId] = KT.snapshotOf(B);
  var twoWon = KT.withWon(two, A.campaignId, true, NOW);
  eq("당첨: 두 건 중 한 건만 당첨", KT.isWonEntry(twoWon[A.campaignId]), true);
  eq("당첨: 다른 건은 그대로 신청완료", KT.isWonEntry(twoWon[B.campaignId]), false);
  eq("당첨: 다른 건도 사라지지 않는다", !!twoWon[B.campaignId], true);

  /* ── 2) 후기 완료 토글 ─────────────────────── */
  var rev1 = KT.withReviewed(won1, A.campaignId, true);
  eq("후기: reviewed=true", rev1[A.campaignId].reviewed, true);
  eq("후기: 당첨 표시는 유지", KT.isWonEntry(rev1[A.campaignId]), true);
  eq("후기: isReviewedEntry", KT.isReviewedEntry(rev1[A.campaignId]), true);
  eq("후기: 원본은 그대로", KT.isReviewedEntry(won1[A.campaignId]), false);
  var rev2 = KT.withReviewed(rev1, A.campaignId, false);
  eq("후기: 다시 누르면 해제", rev2[A.campaignId].reviewed, false);
  eq("후기: 해제해도 당첨은 유지", KT.isWonEntry(rev2[A.campaignId]), true);
  var revPlain = KT.withReviewed(plain, A.campaignId, true);
  ok("후기: 당첨 아닌 항목에는 붙지 않는다", !!(revPlain[A.campaignId] && !revPlain[A.campaignId].reviewed));
  eq("후기: 없는 id 도 조용히 무시", KT.isReviewedEntry(KT.withReviewed(won1, "nope00001", true)["nope00001"]), false);

  /* ── 3) 발표 다음 날 자동 정리에서 당첨은 보호 ── */
  var pastId = "pastwon00001", pastPlainId = "pastdone0001", nEndId = "wonnoend0001";
  var seed = {};
  seed[pastId] = { at: new Date().toISOString(), title: "지난 발표 당첨", endDate: isoDay(T - 3),
    won: true, wonAt: new Date().toISOString(), reviewed: false };
  seed[pastPlainId] = { at: new Date().toISOString(), title: "지난 발표 미당첨", endDate: isoDay(T - 3) };
  seed[nEndId] = { at: new Date().toISOString(), title: "마감일 모르는 당첨", won: true };
  var pr = KT.pruneApplied(seed, NOW);
  eq("정리: 발표 지난 당첨은 남는다", !!pr.applied[pastId], true);
  eq("정리: 발표 지난 미당첨은 지운다", !!pr.applied[pastPlainId], false);
  eq("정리: 지운 id 목록에 미당첨만", pr.removed.join(","), pastPlainId);
  eq("정리: 마감일 몰라도 당첨이면 남긴다", !!pr.applied[nEndId], true);
  eq("정리: 보호한 당첨 건수", pr.keptWon, 2);
  eq("정리: 당첨 항목의 후기 상태 보존", pr.applied[pastId].reviewed, false);

  var prNext = KT.pruneApplied(KT.withReviewed(seed, pastId, true), NOW);
  eq("정리: 후기까지 쓴 당첨도 자동으로 지우지 않는다", !!prNext.applied[pastId], true);
  ok("정리: 원본은 그대로(불변)", !!seed[pastPlainId]);

  /* ── 4) 목록에서 빠진 당첨 카드 복원 ─────────── */
  var snapSeed = {};
  snapSeed["snapWonPast01"] = { at: new Date().toISOString(), title: "지난 발표 당첨 상품",
    endDate: isoDay(T - 3), category: "식품 · 과자", recruitmentCount: 10, applicationCount: 100,
    winRate: 3, won: true, wonAt: new Date().toISOString(), reviewed: false };
  snapSeed["snapDonePast1"] = { at: new Date().toISOString(), title: "지난 발표 신청완료", endDate: isoDay(T - 3) };
  snapSeed["snapWonNoEnd01"] = { at: new Date().toISOString(), title: "마감일 없는 당첨", won: true };
  var sr = KT.snapshotRows(snapSeed, []);
  eq("복원: 당첨은 발표가 지나도 카드로 되살린다", sr.length, 2);
  ok("복원: 당첨 id 가 들어 있다", sr.some(function (c) { return c.campaignId === "snapWonPast01"; }));
  ok("복원: 마감일 없는 당첨도 되살린다", sr.some(function (c) { return c.campaignId === "snapWonNoEnd01"; }));
  ok("복원: 당첨 아닌 지난 기록은 여전히 만들지 않는다",
    !sr.some(function (c) { return c.campaignId === "snapDonePast1"; }));
  ok("복원: 스냅샷 표시", !!sr[0].fromSnapshot);

  /* ── 5) 당첨 탭 정렬 — 후기 미작성 먼저, 그다음 발표일 순 ── */
  var sortSeed = {};
  sortSeed["wonReviewed01"] = { at: new Date().toISOString(), title: "후기 완료(내일 발표)",
    endDate: isoDay(T), won: true, reviewed: true };
  sortSeed["wonTodoFar001"] = { at: new Date().toISOString(), title: "후기 전(모레 발표)",
    endDate: isoDay(T + 2), won: true, reviewed: false };
  sortSeed["wonTodoNear01"] = { at: new Date().toISOString(), title: "후기 전(오늘 발표)",
    endDate: isoDay(T - 1), won: true, reviewed: false };
  var wr = KT.wonRows(sortSeed, [], {}, NOW);
  eq("정렬: 당첨 3건", wr.length, 3);
  eq("정렬: 후기 전이 먼저 1", wr[0].campaignId, "wonTodoNear01");
  eq("정렬: 후기 전이 먼저 2", wr[1].campaignId, "wonTodoFar001");
  eq("정렬: 후기 완료는 뒤로", wr[2].campaignId, "wonReviewed01");
  var hiddenSeed = {}; hiddenSeed["wonTodoFar001"] = { at: new Date().toISOString() };
  eq("정렬: 숨긴 당첨은 빠진다", KT.wonRows(sortSeed, [], hiddenSeed, NOW).length, 2);

  var mix = [
    { campaignId: "m1", endDate: isoDay(T + 5), winRate: 1 },
    { campaignId: "m2", endDate: isoDay(T - 1), winRate: 1 },
    { campaignId: "m3", endDate: isoDay(T + 5), winRate: 1 }
  ];
  var reviewedSet = { m3: 1 };
  var sortedMix = KT.applyWonSort(mix, function (id) { return !!reviewedSet[id]; }, NOW);
  eq("정렬: 후기 완료는 뒤로 밀린다", sortedMix[2].campaignId, "m3");
  eq("정렬: 원본 배열은 그대로", mix[0].campaignId, "m1");

  /* ── 6) 탭·건수 계산 ───────────────────────── */
  var applySeed = {};
  applySeed[rows[0].campaignId] = KT.withWon({ x: 0 }, rows[0].campaignId, true, NOW)[rows[0].campaignId];
  applySeed[rows[1].campaignId] = KT.snapshotOf(rows[1]);
  var isDone = function (id) { return !!applySeed[id]; };
  var isWon = function (id) { return KT.isWonEntry(applySeed[id]); };
  eq("탭: 당첨 = 당첨으로 표시한 것만", KT.scopeRows(rows, "won", isDone, null, isWon).length, 1);
  eq("탭: 당첨 id", KT.scopeRows(rows, "won", isDone, null, isWon)[0].campaignId, rows[0].campaignId);
  eq("탭: 신청완료는 당첨을 뺀다", KT.scopeRows(rows, "done", isDone, null, isWon).length, 1);
  eq("탭: 신청완료 id", KT.scopeRows(rows, "done", isDone, null, isWon)[0].campaignId, rows[1].campaignId);
  eq("탭: 전체는 당첨·신청완료 모두 빠진다",
    KT.scopeRows(rows, "all", isDone, null, isWon).length, rows.length - 2);
  eq("탭: TABS 라벨", KT.TABS.won, "당첨");

  var qWon = KT.query(rows, { filter: "won", cat: "all", q: "", sort: "rate", isDone: isDone, isWon: isWon });
  eq("query: 당첨 탭 건수", qWon.length, 1);
  eq("query: 당첨 탭은 정렬 선택과 무관하게 후기 전 먼저",
    KT.query(rows, { filter: "won", cat: "all", q: "", sort: "deadline", isDone: isDone, isWon: isWon }).length, 1);
  eq("query: 신청완료 탭에서 당첨은 빠진다",
    KT.query(rows, { filter: "done", cat: "all", q: "", sort: "rate", isDone: isDone, isWon: isWon }).length, 1);
  eq("catCounts: 당첨 탭 합계", KT.catCounts(rows, { filter: "won", q: "", isDone: isDone, isWon: isWon }).all, 1);
  eq("catCounts: 신청완료 탭 합계", KT.catCounts(rows, { filter: "done", q: "", isDone: isDone, isWon: isWon }).all, 1);
  eq("요약: 당첨 탭 최고 확률", KT.summarize(qWon, isDone).total, 1);

  /* 실제 데이터로 — 한 건을 당첨으로 표시하고 도는 계산 */
  var realWon = KT.withWon(KT.hydrateApplied((function () { var m = {}; m[rows[3].campaignId] = { at: new Date().toISOString() }; return m; })(), rows),
    rows[3].campaignId, true, NOW);
  eq("실제: 당첨 한 건은 신청완료에서 빠진다",
    KT.scopeRows(rows, "done", function (id) { return !!realWon[id]; }, null,
      function (id) { return KT.isWonEntry(realWon[id]); }).length, 0);
  eq("실제: 당첨 탭에 한 건", KT.scopeRows(rows, "won", function (id) { return !!realWon[id]; }, null,
    function (id) { return KT.isWonEntry(realWon[id]); }).length, 1);

  /* ── 7) 기록 옮기기 — W(당첨)·R(후기 완료) 줄 ── */
  var wid = rows[5].campaignId, pid = rows[6].campaignId;
  var packSeed = {};
  packSeed[wid] = { at: "2026-11-20T10:00:00+09:00", title: "당첨 상품", endDate: isoDay(T + 2),
    won: true, wonAt: "2026-11-20T10:05:00+09:00", reviewed: true };
  packSeed[pid] = { at: "2026-11-20T10:00:00+09:00", title: "신청만" };
  var packed = KT.packRecords(packSeed, {});
  var plines = packed.split("\n");
  eq("백업: 머리말", plines[0], "KTF1");
  ok("백업: A 줄에 당첨 id 도 들어 있다(예전 앱 호환)", /^A /m.test(packed) && packed.indexOf(wid) !== -1);
  ok("백업: W 줄에 당첨 id", /^W /m.test(packed) && new RegExp("^W .*" + wid, "m").test(packed));
  ok("백업: R 줄에 후기 완료 id", /^R /m.test(packed) && new RegExp("^R .*" + wid, "m").test(packed));
  ok("백업: 당첨 아닌 id 는 W 줄에 없다", !new RegExp("^W .*" + pid, "m").test(packed));

  var back = KT.unpackRecords(packed);
  eq("백업 왕복: 당첨 유지", KT.isWonEntry(back.applied[wid]), true);
  eq("백업 왕복: 후기 완료 유지", KT.isReviewedEntry(back.applied[wid]), true);
  eq("백업 왕복: 당첨 아닌 건은 그대로", KT.isWonEntry(back.applied[pid]), false);
  eq("백업 왕복: 건수", keys(back.applied).length, 2);
  ok("백업 왕복: hasWon 표시", back.hasWon === true);

  var oldText = "KTF1\nA " + wid + "," + pid;
  var oldBack = KT.unpackRecords(oldText);
  eq("예전 백업: 당첨 없이 그대로 읽는다", KT.isWonEntry(oldBack.applied[wid]), false);
  eq("예전 백업: 건수", keys(oldBack.applied).length, 2);
  eq("예전 백업: hasWon 없음", !!oldBack.hasWon, false);

  var wOnly = KT.unpackRecords("KTF1\nA " + wid + "\nW " + wid);
  eq("W 줄만: 당첨으로 읽는다", KT.isWonEntry(wOnly.applied[wid]), true);
  eq("W 줄만: 후기는 미작성으로 둔다", KT.isReviewedEntry(wOnly.applied[wid]), false);
  var wNoA = KT.unpackRecords("KTF1\nW " + wid);
  eq("W 줄만(A 없이): 당첨으로 살아난다", KT.isWonEntry(wNoA.applied[wid]), true);
  var wordLines = KT.unpackRecords("KTF1\nwon: " + wid + "\nreviewed: " + wid);
  eq("영문 이름 줄도 읽는다(won/reviewed)", KT.isReviewedEntry(wordLines.applied[wid]), true);

  /* 합치기 — 예전 백업(당첨 개념 없음)을 합쳐도 이 기기의 당첨·후기가 지워지지 않는다 */
  var local = {}; local[wid] = { at: "2026-11-21T10:00:00+09:00", title: "당첨 상품",
    won: true, wonAt: "2026-11-21T10:01:00+09:00", reviewed: true };
  var mergedOld = KT.mergeRecords(local, oldBack.applied);
  eq("합치기: 예전 백업을 합쳐도 당첨 유지", KT.isWonEntry(mergedOld[wid]), true);
  eq("합치기: 예전 백업을 합쳐도 후기 완료 유지", KT.isReviewedEntry(mergedOld[wid]), true);
  var mergedW = KT.mergeRecords(KT.withReviewed(KT.withWon({}, wid, true), wid, true), wOnly.applied);
  eq("합치기: W 줄만 있는 백업이 후기 완료를 지우지 않는다", KT.isReviewedEntry(mergedW[wid]), true);
  var mergedPlain = KT.mergeRecords({}, back.applied);
  eq("합치기: 새 백업을 빈 기기에 — 당첨", KT.isWonEntry(mergedPlain[wid]), true);
  eq("합치기: 새 백업을 빈 기기에 — 후기 완료", KT.isReviewedEntry(mergedPlain[wid]), true);

  /* 40개 청크 — 당첨 id 가 많아도 줄이 나뉜다 */
  var many = {};
  rows.slice(0, 45).forEach(function (c) {
    many[c.campaignId] = { at: new Date().toISOString(), won: true };
  });
  var manyLines = KT.packRecords(many, {}).split("\n");
  eq("백업: 당첨 45건은 W 2줄", manyLines.filter(function (l) { return /^W /.test(l); }).length, 2);
  eq("백업: 왕복 건수", keys(KT.unpackRecords(KT.packRecords(many, {})).applied).length, 45);

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(this);
