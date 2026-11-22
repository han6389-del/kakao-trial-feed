/* 기록 옮기기(내보내기 / 가져오기) 순수 로직 검증 — QuickJS에서 순수 함수만 돌린다.
 * 실행: python3 tests/run_transfer_test.py
 * pack → unpack 왕복, 형식 너그러움(CRLF·BOM·주석·applied:/hidden:), 잘못된 입력 오류,
 * 위험한 id 걸러내기, mergeRecords 불변성, 실제 data/campaigns.json 379건 왕복을 확인한다. */
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
  function errMsg(fn) {
    try { fn(); return ""; } catch (e) { return (e && e.message) || "Error"; }
  }
  function mapOf(list, at) {
    var m = {};
    list.forEach(function (c) { m[c.campaignId] = { at: at || new Date().toISOString() }; });
    return m;
  }
  var NOW = Date.now();

  /* ── 1) 형식 ───────────────────────────── */
  eq("pack: 기록이 없으면 머리말만", KT.packRecords({}, {}), "KTF1");
  eq("pack: 인자 없이 불러도 머리말만", KT.packRecords(), "KTF1");

  var applied3 = mapOf(rows.slice(0, 12), "2026-11-21T09:00:00+09:00");
  var hidden2 = mapOf(rows.slice(20, 25), "2026-11-20T09:00:00+09:00");
  var text = KT.packRecords(applied3, hidden2);
  var lines = text.split("\n");
  eq("pack: 첫 줄이 머리말 KTF1", lines[0], KT.TRANSFER_HEAD);
  ok("pack: ‘A ’ 로 시작하는 줄이 있다", /^A /m.test(text));
  ok("pack: ‘H ’ 로 시작하는 줄이 있다", /^H /m.test(text));
  ok("pack: 줄 수 = 머리말 + A 1줄 + H 1줄", lines.length === 3, lines.length);
  ok("pack: 실제 campaignId 가 그대로 들어 있다",
    text.indexOf(rows[0].campaignId) !== -1 && text.indexOf(rows[20].campaignId) !== -1);

  var allRows = mapOf(rows);
  var bigLines = KT.packRecords(allRows, {}).split("\n");
  eq("pack: 40개씩 줄을 나눈다", bigLines.length, 1 + Math.ceil(rows.length / 40));
  ok("pack: 나눈 줄도 모두 ‘A ’ 로 시작", bigLines.slice(1).every(function (l) { return /^A /.test(l); }));
  ok("pack: 한 줄이 40개를 넘지 않는다",
    bigLines.slice(1).every(function (l) { return l.slice(2).split(",").length <= 40; }));

  /* ── 2) 왕복 ───────────────────────────── */
  var back = KT.unpackRecords(text);
  eq("왕복: 신청완료 id 가 그대로", keys(back.applied).join(","), keys(applied3).join(","));
  eq("왕복: 숨김 id 가 그대로", keys(back.hidden).join(","), keys(hidden2).join(","));
  eq("왕복: 신청완료 개수", Object.keys(back.applied).length, 12);
  eq("왕복: 숨김 개수", Object.keys(back.hidden).length, 5);
  ok("왕복: 신청완료와 숨김이 섞이지 않는다",
    keys(back.applied).every(function (k) { return !hidden2[k]; }) &&
    keys(back.hidden).every(function (k) { return !applied3[k]; }));
  ok("왕복: 저장 시각은 지금으로 새로 찍는다",
    Object.keys(back.applied).concat(Object.keys(back.hidden)).every(function (k) {
      var ent = (back.applied[k] || back.hidden[k]);
      return ent && ent.at && Math.abs(Date.parse(ent.at) - NOW) < 60e3;
    }));

  var allBack = KT.unpackRecords(KT.packRecords(allRows, allRows));
  eq("왕복: 전체 " + rows.length + "건 신청완료", Object.keys(allBack.applied).length, rows.length);
  eq("왕복: 전체 " + rows.length + "건 숨김", Object.keys(allBack.hidden).length, rows.length);

  var ids = mapOf(rows);
  var idSet = {};
  rows.forEach(function (c) { idSet[c.campaignId] = 1; });
  ok("왕복: 내보낸 id 는 모두 실제 campaignId",
    keys(back.applied).concat(keys(back.hidden)).every(function (id) { return idSet[id]; }));
  eq("recordIds: 저장 맵에서 옮길 id 만", KT.recordIds(ids).length, rows.length);

  /* ── 3) 형식이 조금 달라도 읽는다 ───────── */
  var loose = "\uFEFF# 크롬에서 복사함\r\nKTF1\r\napplied: " + rows[0].campaignId + " " + rows[1].campaignId +
    "\r\nhidden : " + rows[2].campaignId + "\r\n  \r\n";
  var lb = KT.unpackRecords(loose);
  eq("형식: BOM·CRLF·주석·applied:/hidden: 도 읽는다",
    Object.keys(lb.applied).length + "/" + Object.keys(lb.hidden).length, "2/1");
  var spaced = KT.unpackRecords("KTF1\nA " + rows[3].campaignId + " , " + rows[4].campaignId + "  " + rows[5].campaignId);
  eq("형식: 쉼표·공백·군더더기 공백 허용", Object.keys(spaced.applied).length, 3);
  var twoAlines = KT.unpackRecords("KTF1\nA " + rows[6].campaignId + "\nA " + rows[7].campaignId);
  eq("형식: A 줄이 여러 개여도 합쳐 읽는다", Object.keys(twoAlines.applied).length, 2);
  ok("형식: 없는 id 도 오류 없이 받아 둔다(지난 시즌 기록)",
    Object.keys(KT.unpackRecords("KTF1\nA abcdef123456").applied).length === 1);

  /* ── 4) 잘못된 입력은 조용히 넘어가지 않고 알린다 ── */
  ok("오류: 빈 글자", errMsg(function () { KT.unpackRecords(""); }) !== "");
  ok("오류: 공백·줄바꿈만", errMsg(function () { KT.unpackRecords("  \n\t "); }) !== "");
  ok("오류: null", errMsg(function () { KT.unpackRecords(null); }) !== "");
  ok("오류: 관계없는 글자", errMsg(function () { KT.unpackRecords("안녕하세요"); }) !== "");
  ok("오류: 머리말만 있고 id 가 없음", errMsg(function () { KT.unpackRecords("KTF1"); }) !== "");
  ok("오류: 위험한 id 만 있으면 읽은 기록 0건으로 오류", errMsg(function () {
    KT.unpackRecords("KTF1\nA __proto__,constructor,prototype,ab,<script>");
  }) !== "");
  ok("오류 문구: 붙여넣기를 안내", /붙여넣/.test(errMsg(function () { KT.unpackRecords("KTF1"); })));

  /* ── 5) 위험하거나 형식이 틀린 id 는 버린다 ── */
  var dirty = KT.unpackRecords("KTF1\nA __proto__,constructor,prototype,abc,<script>,../../etc," + rows[0].campaignId);
  eq("정리: 위험한 id·형식 위반은 버리고 진짜 id 만", Object.keys(dirty.applied).length, 1);
  ok("정리: __proto__ 가 프로토타입을 건드리지 않는다",
    !Object.prototype.hasOwnProperty.call(dirty.applied, "__proto__") &&
    Object.keys(dirty.applied)[0] === rows[0].campaignId);
  ok("정리: recordIdOk — 3자·특수문자·프로토타입 이름은 거른다",
    !KT.recordIdOk("abc") && !KT.recordIdOk("<script>") && !KT.recordIdOk("__proto__") &&
    !KT.recordIdOk("constructor") && !KT.recordIdOk("Prototype") && KT.recordIdOk(rows[0].campaignId));
  var dirtyMerge = KT.mergeRecords({}, { "__proto__": { at: "" }, "abc": { at: "" }, "okay1234": { at: "" } });
  eq("정리: mergeRecords 도 위험한 키를 버린다", keys(dirtyMerge).join(","), "okay1234");

  /* ── 6) 합치기(merge) ───────────────────── */
  var base = {}; base[rows[0].campaignId] = { at: "2026-11-01T00:00:00+09:00" };
  var extra = {}; extra[rows[1].campaignId] = { at: "2026-11-22T00:00:00+09:00" };
  var merged = KT.mergeRecords(base, extra);
  eq("합치기: 기존 + 새 기록", Object.keys(merged).length, 2);
  ok("합치기: 기존 기록은 그대로", merged[rows[0].campaignId].at === "2026-11-01T00:00:00+09:00");
  ok("합치기: 새 기록이 들어 있다", !!merged[rows[1].campaignId]);
  ok("합치기: 원본 맵은 바뀌지 않는다", Object.keys(base).length === 1 && Object.keys(extra).length === 1);
  var twice = KT.mergeRecords(merged, KT.unpackRecords(text).applied);
  eq("합치기: 같은 글자를 두 번 불러와도 건수가 늘지 않는다",
    Object.keys(twice).length, 12);
  var clashBase = {}; clashBase[rows[0].campaignId] = { at: "2026-11-01T00:00:00+09:00" };
  var clashExtra = {}; clashExtra[rows[0].campaignId] = { at: "2026-11-22T00:00:00+09:00" };
  eq("합치기: 같은 id 는 붙여넣은 쪽 시각으로", KT.mergeRecords(clashBase, clashExtra)[rows[0].campaignId].at,
    "2026-11-22T00:00:00+09:00");
  eq("합치기: 빈 맵끼리", Object.keys(KT.mergeRecords({}, {})).length, 0);

  /* ── 7) 저장 키·보관 기간(옮길 때 기준이 되는 값) ── */
  eq("저장 키: 신청완료 = ktApp.applied.v1", KT.STORE, "ktApp.applied.v1");
  eq("저장 키: 숨김 = kt_hidden_v1", KT.HIDDEN_STORE, "kt_hidden_v1");
  eq("보관: 신청완료 45일", KT.KEEP_DAYS, 45);
  eq("보관: 숨김 60일", KT.HIDDEN_DAYS, 60);

  /* ── 8) 옮긴 기록이 화면 계산에 그대로 반영되는지 ── */
  var isDoneImported = function (id) { return !!back.applied[id]; };
  var tabDone = KT.scopeRows(KT.filterHidden(rows, back.hidden), "done", isDoneImported);
  eq("반영: 신청완료 탭 = 옮긴 12건", tabDone.length, 12);
  var tabAll = KT.scopeRows(KT.filterHidden(rows, back.hidden), "all", isDoneImported);
  eq("반영: 미신청 탭 = 전체 − 숨김 − 신청완료", tabAll.length, rows.length - 5 - 12);
  eq("반영: 요약 건수도 맞는다", KT.summarize(tabAll, isDoneImported).doneCount, 0);

  global.__RESULT__ = { pass: pass, fail: fail, log: out };
})(this);
