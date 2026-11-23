/* 발표일 계산 · 신청완료 스냅샷 · 발표 당일 유지 · 발표 다음 날 자동 정리 검증 — QuickJS에서 순수 함수만 돌린다.
 * 실행: python3 tests/run_announce_test.py
 * 실제 data/campaigns.json 을 함께 써서 “목록에서 빠진 신청완료”가 발표일까지 살아 있는지 본다. */
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
  function isoDay(idx) {
    var d = new Date(idx * 864e5), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }
  function mdOf(idx) {
    var d = new Date(idx * 864e5);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
  }
  var T = KT.todayKST(); // 오늘(KST) day index
  /* 발표 시각(11:00 KST) 경계 — 오늘 발표일(= 마감 T-1)의 10:59:59 / 11:00:00 / 11:05 */
  function kstAt(dayIdx, h, m, s) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return Date.parse(isoDay(dayIdx) + "T" + p(h) + ":" + p(m) + ":" + p(s) + "+09:00");
  }
  var PRE11 = kstAt(T, 10, 59, 59), AT11 = kstAt(T, 11, 0, 0), POST11 = kstAt(T, 11, 5, 0);

  /* ── 1) 발표일 = 마감일 + 1일 ───────────── */
  eq("발표일: 마감일 + 1", KT.announceDay("2026-11-22") - KT.announceDay("2026-11-21"), 1);
  eq("발표일: 오늘 마감 → 발표는 내일", KT.announceDay(isoDay(T)), T + 1);
  eq("발표일: 어제 마감 → 발표는 오늘", KT.announceDay(isoDay(T - 1)), T);
  ok("발표일: 마감일이 없으면 NaN", isNaN(KT.announceDay("")) && isNaN(KT.announceDay(null)) && isNaN(KT.announceDay("2026-11")));
  eq("발표일: M/D 글자", KT.dayToMD(KT.announceDay("2026-11-22")), "11/23");

  /* ── 2) 배지 — 오늘 / 앞으로 / 지남 / 없음 ── */
  var bToday = KT.announceBadge(isoDay(T - 1), PRE11);
  eq("배지: 오늘 발표 문구", bToday.label, "🎉 오늘 11시 발표");
  eq("배지: 오늘 발표 강조 클래스", bToday.cls, "today");
  eq("배지: 오늘 발표 남은 일수 0", bToday.days, 0);
  ok("배지: 오늘 발표는 show", bToday.show === true);
  var bEnded = KT.announceBadge(isoDay(T - 1), AT11);
  eq("배지: 오늘 11시가 지나면 ‘발표 끝남’", bEnded.label, "발표 끝남");
  eq("배지: 오늘 11시가 지나면 past 클래스", bEnded.cls, "past");

  var bFut = KT.announceBadge(isoDay(T + 2));
  eq("배지: 앞으로 문구", bFut.label, "발표 " + mdOf(T + 3) + " 11시");
  eq("배지: 앞으로 남은 일수 3", bFut.days, 3);
  eq("배지: 앞으로는 강조 클래스 없음", bFut.cls, "");
  eq("배지: 내일 발표 = 발표 M/D 11시", KT.announceBadge(isoDay(T)).days, 1);
  ok("배지: 앞으로 문구가 ‘발표 M/D 11시’ 꼴", /^발표 \d{1,2}\/\d{1,2} 11시$/.test(KT.announceBadge(isoDay(T + 2)).label),
    KT.announceBadge(isoDay(T + 2)).label);

  var bPast = KT.announceBadge(isoDay(T - 2));
  eq("배지: 지난 발표 남은 일수 -1", bPast.days, -1);
  eq("배지: 지난 발표 클래스", bPast.cls, "past");
  ok("배지: 마감일 없으면 안 붙는다", KT.announceBadge("").show === false && KT.announceBadge(null).show === false);
  ok("배지: nowMs 를 주면 그 시각 기준", KT.announceBadge("2026-11-22", Date.parse("2026-11-22T14:59:00Z")).days === 1 &&
    KT.announceBadge("2026-11-22", Date.parse("2026-11-22T15:00:00Z")).days === 0,
    KT.announceBadge("2026-11-22", Date.parse("2026-11-22T15:00:00Z")).label);

  /* KST 자정 경계 — UTC 15:00 이 KST 다음 날 00:00 */
  eq("KST: 23:59 에는 오늘이 아직 11/22", KT.dayToMD(KT.todayKST(Date.parse("2026-11-22T14:59:00Z"))), "11/22");
  ok("KST: 하루 차이", KT.todayKST(Date.parse("2026-11-22T15:00:00Z")) - KT.todayKST(Date.parse("2026-11-22T14:59:00Z")) === 1);
  var kstEnd = "2026-11-22";
  eq("KST: 마감 11/22 · 23:59 → 내일 발표", KT.announceBadge(kstEnd, Date.parse("2026-11-22T14:59:00Z")).label, "발표 11/23 11시");
  eq("KST: 마감 11/22 · 00:00(11/23) → 오늘 발표", KT.announceBadge(kstEnd, Date.parse("2026-11-22T15:00:00Z")).label, "🎉 오늘 11시 발표");

  /* ── 3) 스냅샷 만들기 ───────────────────── */
  var snap = KT.snapshotOf(rows[0], Date.parse("2026-11-22T10:00:00Z"));
  ok("스냅샷: 체크 시각(at)을 남긴다", snap.at === "2026-11-22T10:00:00.000Z", snap.at);
  ["title", "brandName", "imageUrl", "endDate", "mobileUrl", "category", "recruitmentCount",
    "applicationCount", "winRate", "productId"].forEach(function (k) {
    eq("스냅샷: " + k + " 저장", snap[k], rows[0][k]);
  });
  eq("스냅샷: 상품이 없으면 at 만", Object.keys(KT.snapshotOf(null)).join(","), "at");
  var blank = KT.snapshotOf({ campaignId: "x", title: "티", brandName: "", endDate: "" });
  ok("스냅샷: 빈 값은 넣지 않는다", !("brandName" in blank) && !("endDate" in blank) && blank.title === "티");

  /* ── 4) hydrate — 예전 체크분 보강 ───────── */
  var legacy = {}; legacy[rows[0].campaignId] = { at: "2026-11-01T00:00:00+09:00" };
  legacy[rows[1].campaignId] = { at: "2026-11-01T00:00:00+09:00", endDate: "2099-01-01", title: "내가 적은 제목" };
  legacy.unknownid99 = { at: "2026-11-01T00:00:00+09:00" };
  var hy = KT.hydrateApplied(legacy, rows);
  eq("hydrate: 예전 체크분에 endDate 를 채운다", hy[rows[0].campaignId].endDate, rows[0].endDate);
  eq("hydrate: 제목도 채운다", hy[rows[0].campaignId].title, rows[0].title);
  eq("hydrate: 체크 시각은 그대로", hy[rows[0].campaignId].at, "2026-11-01T00:00:00+09:00");
  eq("hydrate: 이미 있는 값은 덮지 않는다", hy[rows[1].campaignId].endDate, "2099-01-01");
  eq("hydrate: 이미 있는 제목도 덮지 않는다", hy[rows[1].campaignId].title, "내가 적은 제목");
  eq("hydrate: 목록에 없는 id 는 그대로", Object.keys(hy.unknownid99).join(","), "at");
  eq("hydrate: 건수 유지", Object.keys(hy).length, 3);
  eq("hydrate: 원본은 바뀌지 않는다", Object.keys(legacy[rows[0].campaignId]).join(","), "at");
  eq("hydrate: 보강할 게 없으면 같은 값을 돌려준다",
    JSON.stringify(KT.hydrateApplied(hy, rows)), JSON.stringify(hy));

  /* ── 5) prune — 발표 시각(11:00 KST)이 지나면 바로 정리 ── */
  var keepToday = {}; keepToday.todaySnap = { at: "2026-11-15T00:00:00Z", title: "오늘 발표", endDate: isoDay(T - 1) };
  var keepFuture = {}; keepFuture.futureSnap = { at: "2026-11-15T00:00:00Z", title: "모레 마감", endDate: isoDay(T + 2) };
  var dropPast = {}; dropPast.pastSnap = { at: "2026-11-15T00:00:00Z", title: "그제 발표", endDate: isoDay(T - 2) };
  var noEnd = {}; noEnd.noEndSnap = { at: "2026-11-15T00:00:00Z", title: "마감일 모름" };
  var endToday = {}; endToday.endTodaySnap = { at: "2026-11-15T00:00:00Z", title: "오늘 마감", endDate: isoDay(T) };

  eq("정리: 발표 10:59:59 에는 남는다", KT.pruneApplied(keepToday, PRE11).removed.length, 0);
  eq("정리: 발표 10:59:59 에는 그대로 1건", Object.keys(KT.pruneApplied(keepToday, PRE11).applied).length, 1);
  var atPr = KT.pruneApplied(keepToday, AT11);
  eq("정리: 발표 11:00:00 에 바로 지운다", atPr.removed.join(","), "todaySnap");
  eq("정리: 11:00 에는 저장소에서도 빠진다", Object.keys(atPr.applied).length, 0);
  eq("정리: 11:05 에도 지운다", KT.pruneApplied(keepToday, POST11).removed.length, 1);
  eq("정리: 앞으로 발표도 남는다", Object.keys(KT.pruneApplied(keepFuture, POST11).applied).length, 1);
  eq("정리: 오늘 마감(내일 발표)도 남는다", Object.keys(KT.pruneApplied(endToday, POST11).applied).length, 1);
  var pr = KT.pruneApplied(dropPast, POST11);
  eq("정리: 발표가 지나면 지운다", Object.keys(pr.applied).length, 0);
  eq("정리: 지운 id 를 알려 준다", pr.removed.join(","), "pastSnap");
  eq("정리: 원본은 그대로", Object.keys(dropPast).length, 1);
  var mixed = {};
  ["todaySnap", "futureSnap", "pastSnap", "noEndSnap", "endTodaySnap"].forEach(function (k) {
    var src = { todaySnap: keepToday, futureSnap: keepFuture, pastSnap: dropPast, noEndSnap: noEnd, endTodaySnap: endToday }[k];
    for (var id in src) mixed[id] = src[id];
  });
  var mixedPre = KT.pruneApplied(mixed, PRE11);
  eq("정리: 11시 전 — 지난 것만 빠진다", mixedPre.removed.join(","), "pastSnap");
  eq("정리: 11시 전 — 남는 건수", Object.keys(mixedPre.applied).length, 4);
  var mixedPost = KT.pruneApplied(mixed, POST11);
  eq("정리: 11시 뒤 — 오늘 발표도 빠진다", mixedPost.removed.sort().join(","), "pastSnap,todaySnap");
  eq("정리: 11시 뒤 — 남는 건수", Object.keys(mixedPost.applied).length, 3);
  ok("정리: 마감일 없는 옛 항목은 지우지 않는다", !!KT.pruneApplied(mixed, POST11).applied.noEndSnap);
  eq("정리: 빈 맵", Object.keys(KT.pruneApplied({}, POST11).applied).length, 0);
  eq("정리: 발표 전날에는 지우지 않는다", KT.pruneApplied(keepToday, kstAt(T - 1, 12, 0, 0)).removed.length, 0);
  eq("정리: 발표 당일 00:10 에는 아직 남긴다", KT.pruneApplied(keepToday, kstAt(T, 0, 10, 0)).removed.length, 0);
  eq("정리: 다음 날 00:10 에 지운다", KT.pruneApplied(keepToday, kstAt(T + 1, 0, 10, 0)).removed.length, 1);
  eq("정리: 다음 날 09:00 에도 지운다", KT.pruneApplied(keepToday, kstAt(T + 1, 9, 0, 0)).removed.length, 1);
  /* 당첨은 11시가 지나도 그대로 — 발표 시각 경계와 무관 */
  var wonToday = {}; wonToday.wonTodaySnap = { at: "2026-11-15T00:00:00Z", title: "오늘 발표 당첨",
    endDate: isoDay(T - 1), won: true, wonAt: "2026-11-15T00:00:00Z", reviewed: false };
  eq("정리: 11:05 에도 당첨은 남는다", !!KT.pruneApplied(wonToday, POST11).applied.wonTodaySnap, true);
  eq("정리: 11:05 당첨은 삭제 목록에도 없다", KT.pruneApplied(wonToday, POST11).removed.length, 0);
  eq("정리: 10:59 에도 당첨은 남는다", !!KT.pruneApplied(wonToday, PRE11).applied.wonTodaySnap, true);
  eq("정리: nowMs 를 안 주면 실제 시각 기준", typeof KT.pruneApplied(keepToday).removed.length, "number");

  /* ── 6) snapshotRows — 목록에서 빠진 신청완료 카드 ── */
  var sRows = {};
  sRows["snapToday0001"] = { at: "2026-11-15T00:00:00Z", title: "테스트 상품 A", brandName: "브랜드A",
    endDate: isoDay(T - 1), category: "식품 · 과자", recruitmentCount: 10, applicationCount: 100, winRate: 10,
    imageUrl: "https://example.com/a.jpg", mobileUrl: "https://example.com/a" };
  sRows["snapPast00002"] = { at: "2026-11-15T00:00:00Z", title: "테스트 상품 B", endDate: isoDay(T - 2) };
  sRows["snapNoEnd0003"] = { at: "2026-11-15T00:00:00Z", title: "테스트 상품 C" };
  var sr = KT.snapshotRows(sRows, rows, PRE11);
  eq("되살리기: 발표 11시 전에는 1건만", sr.length, 1);
  eq("되살리기: 제목", sr[0] && sr[0].title, "테스트 상품 A");
  eq("되살리기: id", sr[0] && sr[0].campaignId, "snapToday0001");
  eq("되살리기: 당첨확률", sr[0] && sr[0].winRate, 10);
  ok("되살리기: 스냅샷 표시", !!(sr[0] && sr[0].fromSnapshot));
  eq("되살리기: 발표 11시가 지나면 오늘 발표는 카드로 만들지 않는다", KT.snapshotRows(sRows, rows, POST11).length, 0);
  eq("되살리기: 목록에 이미 있는 id 는 만들지 않는다", KT.snapshotRows(legacy, rows, PRE11).length, 0);
  eq("되살리기: 제목이 없으면 만들지 않는다", KT.snapshotRows({ x1234: { at: "2026-11-15T00:00:00Z", endDate: isoDay(T) } }, [], PRE11).length, 0);
  ok("되살리기: 원본 맵은 그대로", Object.keys(sRows).length === 3);
  /* 당첨은 11시가 지나도 카드로 살아난다 */
  var wonSnap = {};
  wonSnap["snapWon000001"] = { at: "2026-11-15T00:00:00Z", title: "오늘 발표 당첨", endDate: isoDay(T - 1),
    won: true, reviewed: false };
  var srWon = KT.snapshotRows(wonSnap, [], POST11);
  eq("되살리기: 11:05 에도 당첨 카드는 살아난다", srWon.length, 1);
  eq("되살리기: 당첨 카드 id", srWon[0] && srWon[0].campaignId, "snapWon000001");

  /* ── 7) doneRows — 신청완료 탭 목록·정렬·건수 ── */
  var doneSeed = {}, hiddenSeed = {};
  doneSeed[rows[0].campaignId] = KT.snapshotOf(rows[0]);          // 목록에 있는 상품
  doneSeed["snapToday0001"] = sRows["snapToday0001"];             // 목록에서 빠진 오늘 발표
  doneSeed["snapLater0004"] = { at: "2026-11-15T00:00:00Z", title: "테스트 상품 D", endDate: isoDay(T + 3) };
  doneSeed["snapHidden005"] = { at: "2026-11-15T00:00:00Z", title: "숨긴 완료", endDate: isoDay(T + 1) };
  hiddenSeed["snapHidden005"] = { at: "2026-11-15T00:00:00Z" };
  var dr = KT.doneRows(doneSeed, rows, hiddenSeed, PRE11);
  eq("신청완료 목록: 숨긴 것 빼고 3건", dr.length, 3);
  eq("신청완료 정렬: 오늘 발표가 맨 위", dr[0].campaignId, "snapToday0001");
  var days = dr.map(function (c) { return KT.announceDay(c.endDate); });
  ok("신청완료 정렬: 발표일 오름차순", days[0] <= days[1] && days[1] <= days[2], JSON.stringify(days));
  ok("신청완료 목록: 목록에 있는 상품도 포함", dr.some(function (c) { return c.campaignId === rows[0].campaignId; }));
  eq("신청완료 목록: 원본 campaigns 는 그대로", rows.length, DATA.campaigns.length);

  var q1 = KT.query(KT.filterHidden(rows.concat(KT.snapshotRows(doneSeed, rows, PRE11)), hiddenSeed), {
    filter: "done", cat: "all", q: "", sort: "rate", isDone: function (id) { return !!doneSeed[id]; }
  });
  eq("query: 신청완료 탭 = doneRows 와 같은 건수", q1.length, 3);
  eq("query: 정렬 선택과 무관하게 오늘 발표가 맨 위", q1[0].campaignId, "snapToday0001");

  /* 발표가 끝난 기록이 화면에 남아 있는 순간에도 오늘 발표가 위로 온다 */
  var mix = [
    { campaignId: "past0000011", endDate: isoDay(T - 2), winRate: 9 },
    { campaignId: "later000012", endDate: isoDay(T + 2), winRate: 1 },
    { campaignId: "today000013", endDate: isoDay(T - 1), winRate: 2 },
    { campaignId: "noend000014", endDate: "", winRate: 8 },
    { campaignId: "sooner00015", endDate: isoDay(T), winRate: 0.5 }
  ];
  var sortedMix = KT.sortList(mix, "announce");
  eq("정렬: 오늘 발표가 맨 위", sortedMix[0].campaignId, "today000013");
  eq("정렬: 그다음이 내일 발표", sortedMix[1].campaignId, "sooner00015");
  eq("정렬: 그다음이 먼 발표", sortedMix[2].campaignId, "later000012");
  eq("정렬: 지난 발표는 뒤로", sortedMix[3].campaignId, "past0000011");
  eq("정렬: 마감일 미상은 맨 뒤", sortedMix[4].campaignId, "noend000014");
  eq("정렬: 원본 배열 불변", mix[0].campaignId, "past0000011");

  /* ── 8) 실제 데이터 — 목록에서 사라져도 발표일까지 남는다 ── */
  var victim = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].endDate === isoDay(T)) { victim = rows[i]; break; }
  ok("실제: 오늘 마감 상품이 데이터에 있다(발표는 내일)", !!victim);
  if (victim) {
    var realApplied = {};
    realApplied[victim.campaignId] = KT.snapshotOf(victim);
    // 내일 10:15 갱신에서 이 상품이 campaigns.json 에서 빠진 상황을 흉내 낸다
    var without = rows.filter(function (c) { return c.campaignId !== victim.campaignId; });
    var prunedNo = KT.pruneApplied(realApplied);
    eq("실제: 발표 전날에는 정리되지 않는다", Object.keys(prunedNo.applied).length, 1);
    var kept = KT.doneRows(realApplied, without, {});
    eq("실제: 목록에서 빠져도 신청완료에 남는다", kept.length, 1);
    eq("실제: 배지는 내일 발표", KT.announceBadge(kept[0].endDate).label, "발표 " + mdOf(T + 1) + " 11시");
    // 발표 시각(내일 11:00)이 지나면 정리된다
    var nextDay = kstAt(T + 1, 10, 0, 0);
    eq("실제: 발표 당일 10:00 에는 남는다", KT.pruneApplied(realApplied, nextDay).removed.length, 0);
    eq("실제: 발표 당일 11:00 에 바로 정리된다",
      KT.pruneApplied(realApplied, kstAt(T + 1, 11, 0, 0)).removed.length, 1);
    eq("실제: 발표 다음 날 정리된다", KT.pruneApplied(realApplied, kstAt(T + 2, 0, 10, 0)).removed.length, 1);
  }

  /* ── 9) 기록 옮기기와의 호환 — 옮겨 온 {at} 만 있는 기록 ── */
  var imported = KT.unpackRecords("KTF1\nA " + rows[2].campaignId).applied;
  var hyImported = KT.hydrateApplied(imported, rows);
  eq("옮기기: 붙여넣은 기록도 보강된다", hyImported[rows[2].campaignId].endDate, rows[2].endDate);
  var merged = KT.mergeRecords(hyImported, imported);
  eq("옮기기: 합쳐도 스냅샷이 지워지지 않는다", merged[rows[2].campaignId].endDate, rows[2].endDate);
  eq("옮기기: 같은 id 는 붙여넣은 쪽 시각", KT.mergeRecords(
    (function () { var m = {}; m[rows[0].campaignId] = { at: "2026-11-01T00:00:00+09:00", title: "가" }; return m; })(),
    (function () { var m = {}; m[rows[0].campaignId] = { at: "2026-11-22T00:00:00+09:00" }; return m; })()
  )[rows[0].campaignId].at, "2026-11-22T00:00:00+09:00");

  /* ── 10) 발표 시각 경계 — 11:00 KST ─────── */
  eq("발표 시각: 마감 11/22 → 11/23 11:00 KST", KT.announceAt("2026-11-22"), Date.UTC(2026, 10, 23, 2, 0, 0));
  eq("발표 시각: 마감 11/22 는 UTC 02:00", new Date(KT.announceAt("2026-11-22")).toISOString(), "2026-11-23T02:00:00.000Z");
  ok("발표 시각: 마감일이 없으면 NaN", isNaN(KT.announceAt("")) && isNaN(KT.announceAt(null)));
  eq("발표 시각: 11시 상수", KT.ANNOUNCE_HOUR, 11);

  ok("발표 끝남: 10:59:59 는 아직 아니다", KT.announced("2026-11-22", Date.UTC(2026, 10, 23, 1, 59, 59)) === false);
  ok("발표 끝남: 11:00:00 부터 참", KT.announced("2026-11-22", Date.UTC(2026, 10, 23, 2, 0, 0)) === true);
  ok("발표 끝남: 10:59:59.999 도 아직 아니다", KT.announced("2026-11-22", Date.UTC(2026, 10, 23, 1, 59, 59, 999)) === false);
  ok("발표 끝남: 마감일을 모르면 거짓", KT.announced("") === false && KT.announced(null) === false);
  ok("발표 끝남: 11/22 23:59(발표 전날)는 아니다", KT.announced("2026-11-22", Date.parse("2026-11-22T14:59:00Z")) === false);
  ok("발표 끝남: 11/23 00:00 에도 아직 아니다", KT.announced("2026-11-22", Date.parse("2026-11-22T15:00:00Z")) === false);
  ok("발표 끝남: 11/23 11:00 에 참", KT.announced("2026-11-22", Date.parse("2026-11-23T02:00:00Z")) === true);

  /* 시계를 고정하면 nowMs 를 안 준 함수도 그 시각을 쓴다(화면 코드와 같은 경로) */
  KT.setNow(PRE11);
  eq("시계: 고정한 10:59:59 에는 오늘 발표가 남는다", KT.pruneApplied(keepToday).removed.length, 0);
  eq("시계: 고정 시각으로 배지도 오늘 발표", KT.announceBadge(isoDay(T - 1)).label, "🎉 오늘 11시 발표");
  KT.setNow(POST11);
  eq("시계: 고정한 11:05 에는 바로 지운다", KT.pruneApplied(keepToday).removed.join(","), "todaySnap");
  eq("시계: 고정한 11:05 에 당첨은 남는다", !!KT.pruneApplied(wonToday).applied.wonTodaySnap, true);
  KT.setNow(null);
  ok("시계: 되돌리면 실제 시각", typeof KT.pruneApplied(keepToday).removed.length === "number");

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(this);
