/* 카카오 체험단 피드 — 로직
 * 순수 함수는 KT 로 내보내 테스트할 수 있게 두고, 화면 동작은 아래 UI 블록에 있다. */
(function (global) {
  "use strict";

  var STORE = "ktApp.applied.v1";
  var HIDDEN_STORE = "kt_hidden_v1";
  var EXCL_STORE = "kt_excluded_kw_v1"; // 사용자가 등록한 제외 키워드(이 폰에만)
  var OPEN_STORE = "kt_last_open_v1";   // 마지막으로 연 캠페인 — sessionStorage 라 탭을 닫으면 사라진다
  var PAGE = 30;
  var KEEP_DAYS = 45;
  var HIDDEN_DAYS = 60; // 숨김은 60일 뒤 정리(모집 기간이 7일이라 목록에서 이미 빠져 있다)
  var EXCL_MAX_KW = 30, EXCL_KW_LEN = 20; // 키워드 개수·길이 상한(실수 입력으로 목록이 텅 비는 것 방지)
  /* 1탭 프리셋 — ‘🚫 제외’ 시트의 버튼 하나로 넣는 표준 키워드.
   * 공개 피드는 전체를 보여 주고, 자기 취향으로 가리는 건 이 폰에서 한 번에 켜고 끈다. */
  var PRESET_KEYWORDS = ["여성", "유아동", "스킨케어", "메이크업", "향수", "주얼리", "임산부", "육아", "생리대"];
  var RETURN_TTL = 30 * 60e3;             // 카톡에서 돌아온 걸 확인 배너로 묻는 시간(30분)
  /* 신청완료로 체크할 때 함께 저장해 두는 상품 정보.
   * campaigns.json 에서 빠진 뒤에도 발표일까지 카드를 보여 주려면 이 값들이 필요하다. */
  var SNAP_FIELDS = ["title", "brandName", "imageUrl", "endDate", "mobileUrl", "category",
    "recruitmentCount", "applicationCount", "winRate", "productId"];

  /* 카카오톡 앱 직행 딥링크 — scripts/fetch_campaigns.py 의 mobile_url() 과 같은 형식.
   * gift.kakao.com 모바일 페이지는 앱으로 못 넘기고 선물하기 홈으로 떨어진다.
   * appredirect 는 to 값을 그대로 intent:// 에 실어 카카오톡을 열기 때문에 이중 인코딩이 필요하다. */
  var APP_REDIRECT = "https://gift-talk.kakao.com/appredirect";
  var APP_CHANNEL = "13478";
  function deepLink(campaignId) {
    var target = "https://gift.kakao.com/giftbox/trial-campaign/" + campaignId;
    var encoded = encodeURIComponent(encodeURIComponent(target));
    return APP_REDIRECT + "?to=" + encoded + "&input_channel_id=" + APP_CHANNEL;
  }

  /* ── 순수 로직 ─────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) {
    var v = Math.round(Number(n) || 0);
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function pct(v) {
    var n = Number(v) || 0;
    return (n >= 1 ? n.toFixed(1) : n.toFixed(2)) + "%";
  }
  function dayIndex(iso) {
    var p = String(iso || "").split("-");
    if (p.length < 3) return NaN;
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5;
  }
  /* ── 시계 ───────────────────────────────
   * 발표 시각(11:00) 판단은 날짜뿐 아니라 시(hour)까지 봐야 해서, 테스트가 시각을 고정할 수 있게
   * 전역에 시계를 하나 둔다. 비어 있으면 실제 시각(Date.now)이다. */
  var ANNOUNCE_HOUR = 11; // 발표 시각(KST) — 마감 다음 날 11:00
  function now() {
    var fixed = global && global.__KT_NOW_MS__;
    return typeof fixed === "number" && isFinite(fixed) ? fixed : Date.now();
  }
  /** 테스트용 시계 고정 — ms 를 주면 그 시각, 아무것도 주지 않으면 실제 시각으로 되돌린다 */
  function setNow(ms) {
    if (global) global.__KT_NOW_MS__ = (typeof ms === "number" && isFinite(ms)) ? ms : null;
  }
  function todayKST(nowMs) {
    var d = new Date((nowMs || now()) + 9 * 3600e3);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 864e5;
  }
  /** 남은 일수 표시: 오늘 마감 / D-n / 마감 */
  function dday(endDate, nowMs) {
    var end = dayIndex(endDate);
    if (isNaN(end)) return { label: "", cls: "", days: null };
    var d = Math.round(end - todayKST(nowMs));
    if (d < 0) return { label: "마감", cls: "soon", days: d };
    if (d === 0) return { label: "오늘 마감", cls: "today", days: 0 };
    if (d === 1) return { label: "내일 마감", cls: "soon", days: 1 };
    return { label: "D-" + d, cls: "", days: d };
  }
  /* ── 발표일 · 신청완료 스냅샷 ─────────────
   * 카카오 선물하기 체험단은 마감(endDate) 다음 날 11:00 에 당첨자를 발표한다.
   * 신청완료로 체크할 때 상품 정보를 같이 저장해 두면, campaigns.json 에서 빠져도
   * 발표일까지는 카드가 남고 발표 다음 날 자동으로 정리된다. */
  /** 발표일(day index) = 마감일 + 1일. 마감일이 없으면 NaN */
  function announceDay(endDate) {
    var end = dayIndex(endDate);
    return isNaN(end) ? NaN : end + 1;
  }
  /** 발표 시각(ms) = 발표일 11:00 KST. 마감일이 없으면 NaN */
  function announceAt(endDate) {
    var ann = announceDay(endDate);
    // day index 는 UTC 자정 기준이라 KST 11:00 = 그날 UTC 02:00
    return isNaN(ann) ? NaN : ann * 864e5 + (ANNOUNCE_HOUR - 9) * 3600e3;
  }
  /** 발표가 끝났나 — 발표일 11:00:00 KST 부터 참. 마감일을 모르면 거짓(모른다) */
  function announced(endDate, nowMs) {
    var at = announceAt(endDate);
    if (isNaN(at)) return false;
    return (typeof nowMs === "number" ? nowMs : now()) >= at;
  }
  /** day index → "M/D" */
  function dayToMD(idx) {
    var d = new Date(idx * 864e5);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
  }
  /** 발표일 정렬 순위 — 0 오늘, 1 앞으로, 2 지남, 3 마감일 미상 */
  function announceRank(endDate, nowMs) {
    var ann = announceDay(endDate);
    if (isNaN(ann)) return { rank: 3, days: 0 };
    var d = Math.round(ann - todayKST(nowMs));
    return { rank: d === 0 ? 0 : (d > 0 ? 1 : 2), days: d };
  }
  /** 카드에 붙는 발표일 배지 — {show, label, cls, days} */
  function announceBadge(endDate, nowMs) {
    var ann = announceDay(endDate);
    if (isNaN(ann)) return { show: false, label: "", cls: "", days: null };
    var d = Math.round(ann - todayKST(nowMs));
    if (d === 0) {
      // 발표일 11:00 이 지났으면 ‘오늘 발표’가 아니다(정리되기 전 한순간에도 문구가 틀리지 않게)
      if (announced(endDate, nowMs)) return { show: true, label: "발표 끝남", cls: "past", days: 0 };
      return { show: true, label: "🎉 오늘 11시 발표", cls: "today", days: 0 };
    }
    if (d > 0) return { show: true, label: "발표 " + dayToMD(ann) + " 11시", cls: "", days: d };
    return { show: true, label: "발표 끝남", cls: "past", days: d };
  }
  /** 상품 → 신청완료 저장용 스냅샷(빈 값은 넣지 않는다) */
  function snapshotOf(c, nowMs) {
    var out = { at: new Date(nowMs || now()).toISOString() };
    if (!c) return out;
    for (var i = 0; i < SNAP_FIELDS.length; i++) {
      var k = SNAP_FIELDS[i], v = c[k];
      if (v !== undefined && v !== null && v !== "") out[k] = v;
    }
    return out;
  }
  /** 기존 체크분(예전에 {at} 만 저장된 기록)에 campaigns.json 정보를 채워 넣는다. 이미 있는 값은 그대로 둔다. */
  function hydrateApplied(applied, campaigns) {
    var byId = {};
    (campaigns || []).forEach(function (c) { if (c && c.campaignId) byId[c.campaignId] = c; });
    var out = {};
    Object.keys(applied || {}).forEach(function (id) {
      var cur = applied[id] || {}, c = byId[id];
      if (!c) { out[id] = cur; return; }        // 지금 목록에 없는 id 는 건드리지 않는다
      var next = {}, k;
      for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
      for (var i = 0; i < SNAP_FIELDS.length; i++) {
        var f = SNAP_FIELDS[i];
        if (next[f] !== undefined && next[f] !== null && next[f] !== "") continue;
        if (c[f] !== undefined && c[f] !== null && c[f] !== "") next[f] = c[f];
      }
      if (!next.at) next.at = new Date().toISOString();
      out[id] = next;
    });
    return out;
  }
  /** 발표 시각(발표일 11:00 KST)이 지난 신청완료 항목을 지운다 — 그날 11시가 지나면 바로 지운다.
   *  (마감일이 없는 옛 항목은 안전하게 남긴다.) 당첨으로 표시한 항목(won)은 후기를 쓸 때까지 절대 지우지 않는다. */
  function pruneApplied(applied, nowMs) {
    var at = typeof nowMs === "number" ? nowMs : now(), out = {}, removed = [], keptWon = 0;
    Object.keys(applied || {}).forEach(function (id) {
      var e = applied[id] || {};
      if (e.won) { keptWon++; out[id] = e; return; }   // 🎉 당첨은 자동 정리 대상에서 제외
      if (announced(e.endDate, at)) { removed.push(id); return; }
      out[id] = e;
    });
    return { applied: out, removed: removed, keptWon: keptWon };
  }
  /** campaigns.json 에서 빠졌지만 발표일이 아직 남은 신청완료 기록을 카드 모양으로 되살린다 */
  function snapshotRows(applied, campaigns, nowMs) {
    var have = {}, today = todayKST(nowMs), at = typeof nowMs === "number" ? nowMs : now(), out = [];
    (campaigns || []).forEach(function (c) { if (c && c.campaignId) have[c.campaignId] = 1; });
    Object.keys(applied || {}).forEach(function (id) {
      if (have[id]) return;                     // 지금 목록에 있으면 그 카드를 쓴다
      var e = applied[id] || {}, ann = announceDay(e.endDate);
      // 마감일이 없거나 발표 시각(11:00)이 지난 옛 기록은 카드로 만들지 않는다 — 단 당첨은 후기를 쓸 때까지 남긴다
      if (!e.won && (isNaN(ann) || announced(e.endDate, at))) return;
      if (!e.title) return;
      out.push({
        campaignId: id, title: e.title, brandName: e.brandName || "", imageUrl: e.imageUrl || "",
        category: e.category || "", recruitmentCount: Number(e.recruitmentCount) || 0,
        applicationCount: Number(e.applicationCount) || 0, winRate: Number(e.winRate) || 0,
        endDate: e.endDate || "", mobileUrl: e.mobileUrl || "", isNew: false,
        remainingDays: isNaN(ann) ? null : ann - today - 1, fromSnapshot: true
      });
    });
    return out;
  }
  /** 신청완료 탭에 실제로 보이는 목록 — 발표일 가까운 순(오늘 발표가 맨 위). 당첨은 ‘당첨’ 탭에서 본다. */
  function doneRows(applied, campaigns, hidden, nowMs) {
    var rows = filterHidden((campaigns || []).concat(snapshotRows(applied, campaigns, nowMs)), hidden)
      .filter(function (c) { return !!(applied && applied[c.campaignId]) && !isWonEntry(applied[c.campaignId]); });
    return sortList(rows, "announce");
  }
  /* ── 당첨 · 후기 관리 ───────────────────
   * 신청완료 카드에서 [🎉 당첨]을 누르면 state.applied[id] 에 won / wonAt / reviewed 를 남기고
   * ‘당첨’ 탭으로 옮긴다. 당첨으로 표시한 항목은 발표 다음 날 자동 정리(pruneApplied)에서 빠지고
   * 스냅샷도 그대로 남아, 후기를 다 쓸 때까지 목록에 남아 있는다. */
  function isWonEntry(e) { return !!(e && e.won); }
  function isReviewedEntry(e) { return !!(e && e.won && e.reviewed); }
  /** 항목 하나를 복사하면서 won / wonAt / reviewed 를 켜거나 끈다(원본 맵·항목은 그대로) */
  function withWon(applied, id, on, nowMs) {
    var out = {}, k;
    for (k in applied || {}) {
      if (Object.prototype.hasOwnProperty.call(applied, k)) out[k] = applied[k];
    }
    if (!id) return out;
    var cur = out[id], next = {}, at = new Date(nowMs || Date.now()).toISOString();
    if (cur) for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
    if (!next.at) next.at = at;
    if (on) {
      next.won = true;
      next.wonAt = next.wonAt || at;
      next.reviewed = !!next.reviewed;
    } else {
      delete next.won; delete next.wonAt; delete next.reviewed;
    }
    out[id] = next;
    return out;
  }
  /** 후기 완료(reviewed) 토글 — 당첨으로 표시한 항목에만 붙는다 */
  function withReviewed(applied, id, reviewed) {
    var out = {}, k;
    for (k in applied || {}) {
      if (Object.prototype.hasOwnProperty.call(applied, k)) out[k] = applied[k];
    }
    if (!out[id] || !out[id].won) return out;
    var next = {}, cur = out[id];
    for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
    next.reviewed = !!reviewed;
    out[id] = next;
    return out;
  }
  /** 당첨 탭 정렬 — 후기 미작성 먼저, 그다음 발표일 가까운 순 */
  function applyWonSort(rows, isReviewed, nowMs) {
    var out = (rows || []).slice(), t = typeof nowMs === "number" ? nowMs : now();
    out.sort(function (a, b) {
      var ar = isReviewed && isReviewed(a.campaignId) ? 1 : 0;
      var br = isReviewed && isReviewed(b.campaignId) ? 1 : 0;
      if (ar !== br) return ar - br;                       // 후기 전 → 후기 완료
      var x = announceRank(a.endDate, t), y = announceRank(b.endDate, t);
      var dd = (x.rank === 2 && y.rank === 2) ? (y.days - x.days) : (x.days - y.days);
      return (x.rank - y.rank) || dd || (b.winRate - a.winRate);
    });
    return out;
  }
  /** 당첨 탭에 실제로 보이는 목록 */
  function wonRows(applied, campaigns, hidden, nowMs) {
    var rows = filterHidden((campaigns || []).concat(snapshotRows(applied, campaigns, nowMs)), hidden)
      .filter(function (c) { return !!(applied && applied[c.campaignId] && applied[c.campaignId].won); });
    return applyWonSort(rows, function (id) { return isReviewedEntry(applied && applied[id]); }, nowMs);
  }
  function fmtUpdated(iso) {
    if (!iso) return "갱신 시각 없음";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var k = new Date(d.getTime() + 9 * 3600e3);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return (k.getUTCMonth() + 1) + "/" + k.getUTCDate() + " " +
      p(k.getUTCHours()) + ":" + p(k.getUTCMinutes()) + " 갱신";
  }
  /* ── 카테고리 그룹 ───────────────────────
   * 카카오 API 의 category 는 "대분류 · 소분류" 형태다(예: "리빙 · 주방·수입주방").
   * 소분류는 47가지라 칩으로 쓰기엔 많아서 대분류를 8묶음으로 묶는다.
   * 분류가 비어 있는 상품(핫팩·물주머니 등)은 상품명으로 보정하고, 그래도 모르면 기타로 보낸다.
   * 어떤 상품도 빠지지 않게 하려고 기타 칩은 항상 둔다. */
  var CAT_FALLBACK = /핫팩|물주머니|찜질|필로우|양말|방향제|쿠션|주방|침구|수납|인테리어|무드등/;
  var CAT_GROUPS = [
    { key: "all", label: "전체" },
    { key: "food", label: "식품", re: /^식품/ },
    { key: "living", label: "리빙", re: /^리빙/ },
    { key: "digital", label: "디지털", re: /^디지털/ },
    { key: "beauty", label: "뷰티", re: /^뷰티/ },
    { key: "fashion", label: "패션", re: /^패션/ },
    { key: "leisure", label: "레저", re: /^레저/ },
    { key: "pet", label: "유아동·반려", re: /^(유아동·반려|유아동|반려)/ },
    { key: "etc", label: "기타" }
  ];
  /** 상품이 속할 카테고리 그룹 키 */
  function groupKeyOf(c) {
    var cat = String((c && c.category) || "").trim();
    for (var i = 1; i < CAT_GROUPS.length - 1; i++) {
      if (CAT_GROUPS[i].re.test(cat)) return CAT_GROUPS[i].key;
    }
    if (!cat && CAT_FALLBACK.test(String((c && c.title) || ""))) return "living";
    return "etc";
  }
  function catLabel(key) {
    for (var i = 0; i < CAT_GROUPS.length; i++) if (CAT_GROUPS[i].key === key) return CAT_GROUPS[i].label;
    return "기타";
  }
  /* ── 상태 탭 ───────────────────────────
   * all  = 미신청 전체(완료 체크한 상품은 자동으로 빠진다)
   * new  = 오늘 신규 중 미신청
   * done = 신청완료로 체크한 상품만 모아 보기 */
  var TABS = { all: "미신청", new: "오늘 신규", done: "신청완료", won: "당첨" };
  /** 칩·검색 조건 통과 여부. opts = {filter, cat, q, isDone, isWon} */
  function matches(c, opts) {
    var o = opts || {};
    var done = !!(o.isDone && o.isDone(c.campaignId));
    var won = !!(o.isWon && o.isWon(c.campaignId));
    if (o.filter === "done") {
      if (!done || won) return false;       // 신청완료 탭은 체크한 것 중 당첨 아닌 것(당첨은 ‘당첨’ 탭에서)
    } else if (o.filter === "won") {
      if (!won) return false;               // 당첨 탭은 당첨으로 표시한 것만
    } else {
      if (done) return false;               // 전체·오늘 신규 탭은 미신청만
      if (o.filter === "new" && !c.isNew) return false;
      // 제외 키워드는 미신청 목록(전체·오늘 신규)에만 건다 — 신청완료·당첨 탭은 그대로 보여준다
      if (o.exclude && excludedBy(c, o.exclude)) return false;
    }
    if (o.cat && o.cat !== "all" && groupKeyOf(c) !== o.cat) return false;
    if (o.q) {
      var hay = (c.title + " " + (c.brandName || "") + " " + (c.category || "")).toLowerCase();
      if (hay.indexOf(o.q) === -1) return false;
    }
    return true;
  }
  /** 탭 기준으로 거른 배열 — 상단 수치용이라 카테고리·검색어는 반영하지 않는다.
   *  exclude(제외 키워드 배열)를 주면 전체·오늘 신규에서만 걸러 낸다. */
  function scopeRows(rows, filter, isDone, exclude, isWon) {
    rows = rows || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      var done = !!(isDone && isDone(c.campaignId));
      var won = !!(isWon && isWon(c.campaignId));
      if (filter === "done") { if (!done || won) continue; }
      else if (filter === "won") { if (!won) continue; }
      else if (done || (filter === "new" && !c.isNew)) continue;
      if ((filter === "all" || filter === "new") && excludedBy(c, exclude)) continue;
      out.push(c);
    }
    return out;
  }
  /** 정렬된 새 배열 반환. rate | recruit | deadline */
  function sortList(rows, mode) {
    var out = rows.slice();
    if (mode === "recruit") {
      out.sort(function (a, b) {
        return (b.recruitmentCount - a.recruitmentCount) || (b.winRate - a.winRate);
      });
    } else if (mode === "deadline") {
      out.sort(function (a, b) {
        return (a.remainingDays - b.remainingDays) || (b.winRate - a.winRate);
      });
    } else if (mode === "announce") {
      // 발표일 가까운 순 — 오늘 발표가 맨 위, 그다음 앞으로의 발표일, 이미 지난 것·마감일 미상은 뒤로
      var t = now();
      out.sort(function (a, b) {
        var x = announceRank(a.endDate, t), y = announceRank(b.endDate, t);
        var dd = x.rank === 2 ? (y.days - x.days) : (x.days - y.days); // 지난 것은 최근 것부터
        return (x.rank - y.rank) || dd || (b.winRate - a.winRate);
      });
    } else {
      out.sort(function (a, b) {
        return (b.winRate - a.winRate) || (a.remainingDays - b.remainingDays) ||
          (a.applicationCount - b.applicationCount);
      });
    }
    return out;
  }
  function query(all, opts) {
    var o = opts || {};
    var rows = (all || []).filter(function (c) { return matches(c, o); });
    // 당첨 탭은 후기 미작성 먼저, 신청완료 탭은 정렬 선택과 무관하게 발표일 가까운 순
    if (o.filter === "won") return applyWonSort(rows, o.isReviewed, now());
    return sortList(rows, o.filter === "done" ? "announce" : o.sort);
  }
  /* ── 숨김(삭제) ─────────────────────────
   * 숨긴 상품은 목록·건수·칩 어디에도 세지 않는다. 저장은 이 폰(localStorage)에만. */
  function isHiddenId(hidden, id) {
    return !!(hidden && id && Object.prototype.hasOwnProperty.call(hidden, id));
  }
  /** 숨긴 campaignId 를 뺀 배열 */
  function filterHidden(rows, hidden) {
    var out = [];
    rows = rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (!isHiddenId(hidden, rows[i].campaignId)) out.push(rows[i]);
    }
    return out;
  }
  /** 카테고리 칩 건수 — 상태 탭·검색어는 반영하고 카테고리 조건만 뺀 수치 */
  function catCounts(rows, opts) {
    var o = opts || {};
    var base = { filter: o.filter, q: o.q, isDone: o.isDone, isWon: o.isWon, exclude: o.exclude };
    var counts = { all: 0 };
    rows = rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (!matches(rows[i], base)) continue;
      counts.all++;
      var k = groupKeyOf(rows[i]);
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }
  /* ── 기록 옮기기(내보내기 / 가져오기) ─────
   * 기록은 기기(브라우저·앱)마다 따로 저장되므로, 크롬에서 쓰던 신청완료·숨김을
   * 앱으로 1회 옮길 때 쓴다. 형식은 첫 줄 KTF1, 그 아래 'A id,id…'(신청완료) /
   * 'H id,id…'(숨김) / 'K 키워드,키워드…'(제외 키워드) — 화면에 드러나는 날짜는 옮기지
   * 않고 불러온 날부터 새로 센다. K 줄은 나중에 더한 것이라 예전 백업(K 줄 없음)도 그대로 읽는다. */
  var TRANSFER_HEAD = "KTF1";
  var RECORD_ID = /^[A-Za-z0-9_-]{4,64}$/;
  var TRANSFER_CHUNK = 40; // 한 줄에 담는 id 수(긴 한 줄이 잘려 보이지 않게 나눈다)
  var KW_CHUNK = 20;       // 한 줄에 담는 키워드 수
  /** 옮겨도 되는 id 인가 — 형식 + 프로토타입을 건드리는 이름은 뺀다 */
  function recordIdOk(id) {
    if (!RECORD_ID.test(id)) return false;
    var low = id.toLowerCase();
    return low !== "__proto__" && low !== "constructor" && low !== "prototype";
  }
  /** 기록 맵에서 옮길 id 만 뽑는다(저장소가 오염돼 있어도 안전하게) */
  function recordIds(map) {
    return Object.keys(map || {}).filter(recordIdOk);
  }
  function packRecords(applied, hidden, keywords) {
    var lines = [TRANSFER_HEAD];
    var appliedIds = recordIds(applied);
    [["A", appliedIds], ["H", recordIds(hidden)]].forEach(function (pair) {
      var ids = pair[1];
      for (var i = 0; i < ids.length; i += TRANSFER_CHUNK) {
        lines.push(pair[0] + " " + ids.slice(i, i + TRANSFER_CHUNK).join(","));
      }
    });
    // 당첨(W)·후기 완료(R)는 줄을 더한다 — 예전 앱은 W·R 줄을 모르고 A 줄만 읽으므로 그대로 호환된다.
    // 당첨 id 도 A 줄에 들어 있어서, W 줄을 모르는 곳에서도 ‘신청완료’로는 살아난다.
    var wonIds = appliedIds.filter(function (id) { return isWonEntry(applied && applied[id]); });
    var revIds = wonIds.filter(function (id) { return isReviewedEntry(applied && applied[id]); });
    [["W", wonIds], ["R", revIds]].forEach(function (pair) {
      var ids = pair[1];
      for (var i = 0; i < ids.length; i += TRANSFER_CHUNK) {
        lines.push(pair[0] + " " + ids.slice(i, i + TRANSFER_CHUNK).join(","));
      }
    });
    // keywords 를 넘기면 K 줄을 넣는다(넘기지 않으면 예전과 똑같은 글자 = 하위 호환)
    if (typeof keywords !== "undefined") {
      var kws = sanitizeKeywords(keywords);
      for (var j = 0; j < kws.length; j += KW_CHUNK) {
        lines.push("K " + kws.slice(j, j + KW_CHUNK).join(","));
      }
      if (!kws.length) lines.push("K"); // 제외 키워드가 없음도 ‘K 줄이 있다’로 알린다
    }
    return lines.join("\n");
  }
  /** 붙여넣은 글자 → {applied, hidden, keywords, hasKeywords, hasWon}. 형식이 아니면 Error */
  function unpackRecords(text) {
    var s = String(text == null ? "" : text).replace(/^\uFEFF/, "").trim();
    if (!s) throw new Error("붙여넣은 내용이 비어 있어요.");
    var applied = {}, hidden = {}, keywords = [], read = 0, hasKeywords = false;
    var wonIds = [], revIds = [];
    s.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === "#") return;
      if (/^KTF\d*$/i.test(line)) return; // 머리말
      var m = /^([AHKWR]|applied|hidden|kw|keywords|won|reviewed|review)\b[\s:|]*(.*)$/i.exec(line);
      if (!m) return;
      var word = m[1].toLowerCase();
      var kind = word === "won" ? "W" : (word.indexOf("review") === 0 ? "R" : word.charAt(0).toUpperCase());
      if (kind === "K") {                // 제외 키워드 줄
        hasKeywords = true;
        parseKeywords(m[2]).forEach(function (k) { keywords.push(k); });
        return;
      }
      if (kind === "W" || kind === "R") { // 당첨·후기 완료 줄
        m[2].split(/[\s,]+/).forEach(function (id) {
          id = id.trim();
          if (!recordIdOk(id)) return;
          (kind === "W" ? wonIds : revIds).push(id);
          read++;
        });
        return;
      }
      var dest = kind === "H" ? hidden : applied;
      m[2].split(/[\s,]+/).forEach(function (id) {
        id = id.trim();
        if (!recordIdOk(id)) return;
        dest[id] = { at: new Date().toISOString() };
        read++;
      });
    });
    if (!read && !hasKeywords) {
      throw new Error("옮길 기록을 찾지 못했어요. 복사한 글자를 ② 칸에 그대로 붙여넣어 주세요.");
    }
    // W·R 줄은 A 줄 뒤에 모아서 적용한다(당첨 id 가 A 줄에 빠져 있어도 당첨으로 살린다).
    // W 줄만으로는 reviewed 를 건드리지 않는다 — 예전 백업을 합칠 때 이 기기의 ‘후기 완료’가 지워지지 않게.
    var stamp = new Date().toISOString();
    function touchWon(id, reviewed) {
      var cur = applied[id] || { at: stamp }, next = {}, k;
      for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
      next.won = true;
      next.wonAt = next.wonAt || stamp;
      if (reviewed) next.reviewed = true;
      applied[id] = next;
    }
    wonIds.forEach(function (id) { touchWon(id, false); });
    revIds.forEach(function (id) { touchWon(id, true); });
    return { applied: applied, hidden: hidden, keywords: sanitizeKeywords(keywords),
      hasKeywords: hasKeywords, hasWon: wonIds.length > 0 || revIds.length > 0 };
  }
  /** 기록 한 항목 합치기 — 붙여넣은 쪽(b)의 값이 이기되, b 에 없는 스냅샷 정보는 a 것을 남긴다 */
  function mergeEntry(a, b) {
    var out = {}, k;
    [a, b].forEach(function (src) {
      if (!src) return;
      for (k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var v = src[k];
        if (v === undefined || v === null || v === "") {
          if (!(k in out)) out[k] = v;   // 한쪽만 비어 있으면 다른 쪽 값을 살린다
          continue;
        }
        out[k] = v;
      }
    });
    if (b && b.at) out.at = b.at;        // 체크 시각은 붙여넣은 쪽 기준
    if (!out.at) out.at = new Date().toISOString();
    return out;
  }
  /** base 위에 extra 를 얹은 새 객체(원본 불변) */
  function mergeRecords(base, extra) {
    var out = {};
    [base, extra].forEach(function (src) {
      Object.keys(src || {}).forEach(function (k) {
        if (!recordIdOk(k)) return;
        out[k] = mergeEntry(out[k], src[k]) || {};
      });
    });
    return out;
  }

  /* ── 제외 키워드 ───────────────────────
   * 사용자가 직접 등록한 키워드가 상품명·브랜드·카테고리에 들어가면 ‘전체·오늘 신규’ 목록과
   * 건수에서 뺀다(신청완료 탭은 그대로). 저장은 이 폰(localStorage)에만, 대소문자 무시 부분일치. */
  function normKw(s) {
    var k = String(s == null ? "" : s).replace(/[\uFF0C,;\u3001]+/g, " ").replace(/\s+/g, " ").trim();
    if (k.length > EXCL_KW_LEN) k = k.slice(0, EXCL_KW_LEN).trim();
    return k;
  }
  /** 저장된 값(JSON 문자열 포함) → 깨끗한 키워드 배열 */
  function sanitizeKeywords(list) {
    var src = list;
    if (typeof src === "string") {
      try { src = JSON.parse(src); } catch (e) { src = []; }
    }
    if (!src || typeof src.length !== "number") return [];
    var out = [], seen = {};
    for (var i = 0; i < src.length && out.length < EXCL_MAX_KW; i++) {
      var k = normKw(src[i]);
      if (!k) continue;
      var low = k.toLowerCase();
      if (seen[low]) continue;
      seen[low] = 1;
      out.push(k);
    }
    return out;
  }
  /** 입력 글자(쉼표·줄바꿈 구분) → 키워드 배열 */
  function parseKeywords(text) {
    return sanitizeKeywords(String(text == null ? "" : text).split(/[\uFF0C,;\u3001\n\r]+/));
  }
  /** 기존 목록에 입력 글자를 더한 새 배열(중복·상한은 조용히 버린다) */
  function addKeywords(list, text) {
    var cur = sanitizeKeywords(list), seen = {};
    cur.forEach(function (k) { seen[k.toLowerCase()] = 1; });
    parseKeywords(text).forEach(function (k) {
      var low = k.toLowerCase();
      if (seen[low] || cur.length >= EXCL_MAX_KW) return;
      seen[low] = 1;
      cur.push(k);
    });
    return cur;
  }
  /** 키워드 하나 지운 새 배열(대소문자 무시) */
  function removeKeyword(list, kw) {
    var low = String(kw == null ? "" : kw).toLowerCase();
    return sanitizeKeywords(list).filter(function (k) { return k.toLowerCase() !== low; });
  }
  /** 1탭 프리셋 — 표준 키워드를 기존 목록에 더한 새 배열(있던 키워드는 그대로, 중복은 늘지 않는다) */
  function applyPreset(list) {
    return addKeywords(list, PRESET_KEYWORDS.join(","));
  }
  /** 프리셋 키워드가 하나도 빠짐없이 들어 있는지 */
  function hasPreset(list) {
    var set = {};
    sanitizeKeywords(list).forEach(function (k) { set[k.toLowerCase()] = 1; });
    return PRESET_KEYWORDS.every(function (k) { return !!set[String(k).toLowerCase()]; });
  }
  /** 상품에서 처음 걸리는 제외 키워드(없으면 "") */
  function hitKeyword(c, kws) {
    if (!kws || !kws.length || !c) return "";
    var hay = (String(c.title || "") + " " + String(c.brandName || "") + " " + String(c.category || "")).toLowerCase();
    for (var i = 0; i < kws.length; i++) {
      var k = String(kws[i] == null ? "" : kws[i]).toLowerCase();
      if (k && hay.indexOf(k) !== -1) return kws[i];
    }
    return "";
  }
  function excludedBy(c, kws) { return !!hitKeyword(c, kws); }
  /** 제외 키워드에 걸리는 상품을 뺀 배열(키워드가 없으면 원본 복사본) */
  function filterExcluded(rows, kws) {
    rows = rows || [];
    if (!kws || !kws.length) return rows.slice();
    var out = [];
    for (var i = 0; i < rows.length; i++) if (!excludedBy(rows[i], kws)) out.push(rows[i]);
    return out;
  }
  /** 카톡에서 돌아왔을 때 확인 배너를 띄울 조건 — 최근에 열었고 아직 완료·숨김이 아닐 때 */
  function shouldPromptReturn(lo, nowMs, isDone, isHidden) {
    if (!lo || !lo.id) return false;
    var at = typeof lo.at === "number" ? lo.at : Date.parse(lo.at);
    if (!at || isNaN(at)) return false;
    var t = typeof nowMs === "number" ? nowMs : now();
    if (at > t) at = t;                      // 기기 시계가 앞서 있어도 30분 규칙은 지킨다
    if (t - at > RETURN_TTL) return false;
    if (isDone && isDone(lo.id)) return false;
    if (isHidden && isHidden(lo.id)) return false;
    return true;
  }

  function summarize(all, isDone) {
    var total = all.length, newCount = 0, doneCount = 0, best = 0;
    for (var i = 0; i < total; i++) {
      var c = all[i];
      if (c.isNew) newCount++;
      if (isDone && isDone(c.campaignId)) doneCount++;
      if (c.winRate > best) best = c.winRate;
    }
    return { total: total, newCount: newCount, doneCount: doneCount, best: best };
  }

  global.KT = {
    esc: esc, num: num, pct: pct, dday: dday, todayKST: todayKST, fmtUpdated: fmtUpdated, now: now, setNow: setNow,
    matches: matches, sortList: sortList, query: query, summarize: summarize, cardHTML: cardHTML,
    announceDay: announceDay, announceAt: announceAt, announced: announced, ANNOUNCE_HOUR: ANNOUNCE_HOUR,
    dayToMD: dayToMD, announceBadge: announceBadge, snapshotOf: snapshotOf,
    hydrateApplied: hydrateApplied, pruneApplied: pruneApplied, snapshotRows: snapshotRows,
    doneRows: doneRows, SNAP_FIELDS: SNAP_FIELDS, announceRank: announceRank,
    scopeRows: scopeRows, TABS: TABS,
    deepLink: deepLink, groupKeyOf: groupKeyOf, catLabel: catLabel, CAT_GROUPS: CAT_GROUPS,
    isHiddenId: isHiddenId, filterHidden: filterHidden, catCounts: catCounts,
    packRecords: packRecords, unpackRecords: unpackRecords, mergeRecords: mergeRecords,
    recordIds: recordIds, recordIdOk: recordIdOk, TRANSFER_HEAD: TRANSFER_HEAD,
    isWonEntry: isWonEntry, isReviewedEntry: isReviewedEntry, withWon: withWon, withReviewed: withReviewed,
    applyWonSort: applyWonSort, wonRows: wonRows,
    parseKeywords: parseKeywords, sanitizeKeywords: sanitizeKeywords, addKeywords: addKeywords,
    removeKeyword: removeKeyword, hitKeyword: hitKeyword, excludedBy: excludedBy,
    applyPreset: applyPreset, hasPreset: hasPreset, PRESET_KEYWORDS: PRESET_KEYWORDS,
    filterExcluded: filterExcluded, shouldPromptReturn: shouldPromptReturn,
    STORE: STORE, HIDDEN_STORE: HIDDEN_STORE, EXCL_STORE: EXCL_STORE, OPEN_STORE: OPEN_STORE,
    PAGE: PAGE, KEEP_DAYS: KEEP_DAYS, HIDDEN_DAYS: HIDDEN_DAYS,
    EXCL_MAX_KW: EXCL_MAX_KW, EXCL_KW_LEN: EXCL_KW_LEN, RETURN_TTL: RETURN_TTL
  };

  if (typeof document === "undefined") return; // 테스트(순수 함수) 환경

  /* ── 상태 ─────────────────────────────── */
  var state = {
    data: null, filter: "all", cat: "all", sort: "rate", q: "", limit: PAGE,
    applied: loadApplied(), hidden: loadHidden(), excl: loadKeywords()
  };
  var $ = function (id) { return document.getElementById(id); };
  var list = $("list"), more = $("more"), emptyBox = $("empty"), toastEl = $("toast");

  /* ── 저장소(localStorage) ─────────────── */
  function loadApplied() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "{}");
      var cut = now() - KEEP_DAYS * 864e5, out = {};
      Object.keys(raw).forEach(function (k) {
        var at = raw[k] && raw[k].at ? Date.parse(raw[k].at) : 0;
        // 당첨 기록은 기간과 상관없이 남긴다 — 후기를 쓸 때까지 사라지지 않아야 한다
        if (!at || at > cut || (raw[k] && raw[k].won)) out[k] = raw[k] || { at: new Date().toISOString() };
      });
      return out;
    } catch (e) { return {}; }
  }
  function saveApplied() {
    try { localStorage.setItem(STORE, JSON.stringify(state.applied)); } catch (e) { /* 사생활 모드 등 */ }
  }
  function isDone(id) { return !!state.applied[id]; }
  function isWon(id) { return isWonEntry(state.applied[id]); }
  function isReviewed(id) { return isReviewedEntry(state.applied[id]); }
  function setDone(id, done) {
    // 체크할 때 상품 정보를 함께 저장한다 — 목록에서 빠진 뒤에도 발표일까지 카드를 보여 주기 위해서다
    if (done) {
      var prev = state.applied[id] || {}, snap = snapshotOf(findCampaign(id));
      if (prev.won) { // 당첨 표시를 잃지 않게 그대로 옮긴다
        snap.won = true;
        snap.wonAt = prev.wonAt || new Date().toISOString();
        snap.reviewed = !!prev.reviewed;
      }
      state.applied[id] = snap;
    } else delete state.applied[id];
    saveApplied();
  }
  /** 저장된 신청완료를 지금 목록에 맞춘다 — ① 예전 체크분 정보 보강(hydrate) ② 발표가 끝난 것 정리(prune) */
  function syncApplied() {
    var before = JSON.stringify(state.applied);
    var pruned = pruneApplied(hydrateApplied(state.applied, rawCampaigns()), now());
    state.applied = pruned.applied;
    var changed = JSON.stringify(state.applied) !== before;
    if (changed) saveApplied();
    return { changed: changed, removed: pruned.removed };
  }
  /* 정리한 건수를 알린다. 아직 목록을 못 불러온 순간(pageshow 등)이면 모아 두었다가 불러온 뒤에 알린다. */
  var pendingPrune = 0;
  function notePrune(n) {
    if (!n) return;
    if (!state.data) { pendingPrune += n; return; }
    toast("발표가 끝난 " + num(n) + "건을 신청완료에서 정리했어요");
  }

  /* ── 숨김 저장소 ─────────────────────── */
  function loadHidden() {
    try {
      var raw = JSON.parse(localStorage.getItem(HIDDEN_STORE) || "{}");
      var cut = now() - HIDDEN_DAYS * 864e5, out = {}, dropped = false;
      Object.keys(raw).forEach(function (k) {
        var at = raw[k] && raw[k].at ? Date.parse(raw[k].at) : 0;
        if (!at || at > cut) out[k] = raw[k] || { at: new Date().toISOString() };
        else dropped = true;
      });
      if (dropped) localStorage.setItem(HIDDEN_STORE, JSON.stringify(out)); // 오래된 숨김은 저장소에서도 정리
      return out;
    } catch (e) { return {}; }
  }
  function saveHidden() {
    try { localStorage.setItem(HIDDEN_STORE, JSON.stringify(state.hidden)); } catch (e) { /* 사생활 모드 등 */ }
  }
  function isHidden(id) { return isHiddenId(state.hidden, id); }
  function setHidden(id, on) {
    if (!id) return;
    if (on) state.hidden[id] = { at: new Date().toISOString() };
    else delete state.hidden[id];
    saveHidden();
  }
  function clearHidden() { state.hidden = {}; saveHidden(); }

  /* ── 데이터 불러오기 ──────────────────── */
  function load() {
    var btn = $("refresh");
    btn.classList.add("spin");
    setTimeout(function () { btn.classList.remove("spin"); }, 600);
    fetch("data/campaigns.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        state.data = d;
        state.limit = PAGE;
        var sync = syncApplied();
        renderAll();
        notePrune(sync.removed.length + pendingPrune);
        pendingPrune = 0;
      })
      .catch(function (err) {
        // 단일 파일(오프라인) 배포본은 데이터가 파일 안에 들어 있다
        if (global.__DATA__) { state.data = global.__DATA__; state.limit = PAGE; syncApplied(); renderAll(); return; }
        $("updatedAt").textContent = "데이터를 불러오지 못했어요";
        emptyBox.hidden = false;
        emptyBox.innerHTML = '<span class="big">⚠️</span>campaigns.json 을 못 읽었어요.<br>' +
          "인터넷 연결을 확인하거나 잠시 뒤 새로고침해 주세요." +
          '<br><span style="font-size:11px;color:#bbb">' + esc(err.message) + "</span>";
      });
  }

  function rawCampaigns() { return (state.data && state.data.campaigns) || []; }
  /** 화면·건수에 쓰는 목록 — campaigns.json + (목록에서 빠졌지만 발표일이 남은) 신청완료 스냅샷 */
  function allCampaigns() {
    var rows = rawCampaigns();
    return rows.concat(snapshotRows(state.applied, rows, now()));
  }
  /** 숨긴 상품을 뺀, 화면·건수에 실제로 쓰는 목록 */
  function visibleCampaigns() { return filterHidden(allCampaigns(), state.hidden); }
  function hiddenCount() { return allCampaigns().length - visibleCampaigns().length; }

  /* ── 렌더 ─────────────────────────────── */
  function cardHTML(c, done, inDoneTab, nowMs, st) {
    var s = st || {};
    var won = !!s.won, reviewed = won && !!s.reviewed, inWonTab = won && !!s.wonTab;
    var dd = dday(c.endDate, nowMs);
    done = !!done || won;
    // 신청완료 카드에는 발표일 배지를 붙인다 — 오늘 발표면 강조(당첨 카드는 🏆 배지가 대신한다)
    var ab = done && !won ? announceBadge(c.endDate, nowMs) : null;
    var announceHTML = ab && ab.show
      ? '<span class="announce' + (ab.cls ? " " + ab.cls : "") + '">' + esc(ab.label) + "</span>"
      : "";
    // 후기 완료 항목은 흐릿하게 두고 ‘후기 완료됨’ 배지로 알린다
    var reviewHTML = reviewed ? '<span class="reviewflag">후기 완료됨</span>' : "";
    // 신청완료 탭에서는 '체크 해제(미신청으로)' 동작임이 보이게 문구를 바꿔 둔다
    var toggleText = done ? (inDoneTab ? "↩ 미신청으로" : "✓ 완료") : "완료 체크";
    var toggleLabel = done
      ? (inDoneTab ? "신청 완료를 해제하고 미신청으로 되돌리기" : "신청 완료 표시 해제")
      : "이 상품을 신청완료로 옮기기";
    // 캐시·구버전 JSON 의 mobileUrl 이 홈으로 떨어지는 예전 주소여도, campaignId 로 앱 딥링크를 다시 만든다.
    var href = c.campaignId ? deepLink(c.campaignId) : (c.mobileUrl || "");
    var img = c.imageUrl
      ? '<img class="thumb" loading="lazy" decoding="async" src="' + esc(c.imageUrl) + '" alt="" ' +
        'onerror="this.outerHTML=\'<div class=&quot;thumb-ph&quot;>🎁</div>\'">'
      : '<div class="thumb-ph">🎁</div>';
    var flag = won ? '<span class="doneflag wonflag">🏆 당첨됨</span>'
      : (done ? '<span class="doneflag">신청 완료</span>' : "");
    var openA = '<a class="open" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" ' +
      'data-open="' + esc(c.campaignId) + '">' + (inWonTab ? "모바일 열기" : "모바일 신청 열기") + "</a>";
    var actions;
    if (inWonTab) {
      // 당첨 탭 — 후기 챙기기: 열기 · 후기 완료 토글 · 당첨 취소
      actions = '<div class="actions won-actions">' + openA +
        '<button class="review" type="button" data-review="' + esc(c.campaignId) + '" aria-pressed="' +
          (reviewed ? "true" : "false") + '" aria-label="' +
          esc(reviewed ? "후기 완료 표시 해제" : "후기 완료로 표시") + '" title="' +
          esc(reviewed ? "후기 완료 표시 해제" : "후기 완료로 표시") + '">✓ 후기 완료</button>' +
        '<button class="unwon" type="button" data-unwon="' + esc(c.campaignId) + '" ' +
          'aria-label="당첨을 취소하고 신청완료로 되돌리기" title="당첨을 취소하고 신청완료로 되돌리기">당첨 취소</button>' +
      "</div>";
    } else {
      actions = '<div class="actions">' + openA +
        '<button class="toggle" type="button" data-toggle="' + esc(c.campaignId) + '" aria-pressed="' +
          (done ? "true" : "false") + '" aria-label="' + esc(toggleLabel) + '" title="' + esc(toggleLabel) +
          '">' + esc(toggleText) + "</button>" +
        (inDoneTab && !won
          ? '<button class="wonbtn" type="button" data-won="' + esc(c.campaignId) + '" ' +
            'aria-label="당첨으로 표시하고 당첨 탭에서 후기 챙기기" title="당첨으로 표시하기">🎉 당첨</button>'
          : "") +
      "</div>";
    }
    return '<article class="card' + (done ? " is-done" : "") + (won ? " is-won" : "") +
      (reviewed ? " is-reviewed" : "") + '" data-id="' + esc(c.campaignId) + '">' +
      flag +
      '<div class="top">' + img +
        '<div class="info">' +
          '<div class="brand">' + esc(c.brandName || "브랜드") +
            (c.category ? ' <span class="cat">· ' + esc(c.category) + "</span>" : "") + "</div>" +
          '<h2 class="title">' + esc(c.title) + "</h2>" +
          '<div class="nums">' +
            '<span class="rate' + (c.winRate < 0.05 ? " low" : "") + '">당첨확률 ' + pct(c.winRate) + "</span>" +
            '<span class="people">모집 ' + num(c.recruitmentCount) + "명 / 신청 " + num(c.applicationCount) + "명</span>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="row">' +
        (won ? "" : '<span class="dday' + (dd.cls ? " " + dd.cls : "") + '">' + dd.label + "</span>") +
        announceHTML +
        reviewHTML +
        (c.isNew ? '<span class="newtag">NEW</span>' : "") +
        '<button class="del" type="button" data-hide="' + esc(c.campaignId) + '" ' +
          'aria-label="이 상품을 목록에서 숨기기" title="목록에서 숨기기">' +
          '<span class="x" aria-hidden="true">✕</span>숨기기</button>' +
      "</div>" +
      actions +
    "</article>";
  }

  function renderSummary() {
    // 숨기기(✕)를 뺀 목록을 기준으로, 수치는 모두 현재 탭 기준으로 센다.
    var all = visibleCampaigns();
    var doneAll = all.filter(function (c) { return isDone(c.campaignId); }).length;   // 당첨 포함 전체
    var wonAll = all.filter(function (c) { return isWon(c.campaignId); }).length;
    var tabRows = scopeRows(all, state.filter, isDone, state.excl, isWon);
    var s = summarize(tabRows, isDone);
    $("stScope").textContent = num(s.total);
    $("stScopeLabel").textContent = TABS[state.filter] || "미신청";
    $("stNew").textContent = num(s.newCount);
    $("stDone").textContent = num(doneAll);
    $("stBest").textContent = tabRows.length ? pct(s.best) : "–";
    // 탭 건수: 전체·오늘 신규는 제외 키워드까지 걸러서 세고, 신청완료는 당첨을 뺌, 당첨은 전체 당첨 건수
    var inList = filterExcluded(all, state.excl);
    $("cAll").textContent = num(inList.length - inList.filter(function (c) { return isDone(c.campaignId); }).length);
    $("cNew").textContent = num(scopeRows(all, "new", isDone, state.excl, isWon).length);
    $("cDone").textContent = num(doneAll - wonAll);
    var cWon = $("cWon");
    if (cWon) cWon.textContent = num(wonAll);
    $("progressBar").style.width = (all.length ? (doneAll / all.length) * 100 : 0) + "%";

    var upd = state.data && state.data.updatedAt;
    $("updatedAt").textContent = fmtUpdated(upd);
    $("staleNote").hidden = !(upd && (Date.now() - Date.parse(upd)) > 30 * 3600e3);

    var d = state.data || {};
    var hiddenN = hiddenCount();
    var exN = Math.round(Number(d.excludedCount) || 0);
    $("foot").innerHTML = "수집 " + num(d.rawTotalCount) + "건" +
      (exN ? " 중 " + num(d.totalCount) + "건 표시 · 걸러낸 " + num(exN) + "건" : " 전체를 보여 줍니다") + "<br>" +
      "신규 기준: " + esc(d.newRule || "-") + "<br>" +
      "카테고리 칩은 카카오 대분류를 묶은 것이고, 분류가 없는 상품은 상품명으로 보정합니다.<br>" +
      "[완료 체크]를 누르면 그 상품이 ‘신청완료’ 탭으로 옮겨집니다(이 폰에만 저장).<br>" +
      "카드의 [✕ 숨기기]를 누르면 목록에서 빠집니다(이 폰에만 저장).<br>" +
      "발표일(마감 다음 날) 11시가 지나면 신청완료 탭에서 바로 자동으로 정리됩니다.<br>" +
      "신청완료 카드의 [🎉 당첨]을 누르면 ‘당첨’ 탭으로 옮겨지고, 후기를 쓸 때까지 자동 정리에서 빠집니다." +
      (state.excl.length
        ? "<br>제외 키워드 " + num(state.excl.length) + "개로 " + num(excludedCount()) + "건을 가리는 중" +
          '<br><button type="button" class="linkish" data-excluded-open="1">제외 키워드 관리</button>'
        : '') +
      (hiddenN
        ? '<br><button type="button" class="linkish" data-unhide-all="1">숨긴 상품 ' + num(hiddenN) + "개 모두 되돌리기</button>"
        : "") +
      '<br><button type="button" class="linkish" data-transfer-open="1">기록 옮기기 (복사 / 붙여넣기)</button>';
  }

  function currentOpts() {
    return { filter: state.filter, cat: state.cat, q: state.q, sort: state.sort,
      isDone: isDone, isWon: isWon, isReviewed: isReviewed, exclude: state.excl };
  }

  /** 제외 키워드만 빼고 같은 조건으로 거른 배열 — ‘다 가려졌다’ 안내에 쓴다 */
  function rowsWithoutKeywords(opts) {
    var o = {};
    Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
    delete o.exclude;
    return query(visibleCampaigns(), o);
  }

  /** 지금 목록에서 제외 키워드가 가리고 있는 건수(탭·카테고리 무관) */
  function excludedCount() {
    var all = visibleCampaigns();
    return all.length - filterExcluded(all, state.excl).length;
  }

  /** 카테고리 칩 건수 — 상태 탭·검색어는 반영하고 카테고리 조건만 뺀 수치 */
  function renderCatCounts(opts) {
    var counts = catCounts(visibleCampaigns(), opts);
    Array.prototype.forEach.call(document.querySelectorAll(".chip[data-cat]"), function (chip) {
      var key = chip.getAttribute("data-cat");
      var b = chip.querySelector("b");
      if (b) b.textContent = num(counts[key] || 0);
      chip.classList.toggle("is-empty", !counts[key]);
    });
  }

  function renderAll() {
    renderKeywordBadge();
    renderSummary();
    renderList(true);
  }

  function renderList(reset) {
    var opts = currentOpts();
    var rows = query(visibleCampaigns(), opts);
    renderCatCounts(opts);
    $("shownCount").textContent = rows.length + "건";
    if (reset) list.innerHTML = "";
    var shown = rows.slice(0, state.limit);
    var from = reset ? 0 : list.children.length;
    var frag = document.createElement("div");
    frag.innerHTML = shown.slice(from).map(function (c) {
      return cardHTML(c, isDone(c.campaignId), state.filter === "done", now(),
        { won: isWon(c.campaignId), reviewed: isReviewed(c.campaignId), wonTab: state.filter === "won" });
    }).join("");
    while (frag.firstChild) list.appendChild(frag.firstChild);

    more.hidden = rows.length <= shown.length;
    if (!more.hidden) more.textContent = "더 보기 (" + Math.min(rows.length - shown.length, PAGE) + "건)";

    emptyBox.hidden = rows.length !== 0;
    if (!rows.length) {
      var bits = [];
      if (state.filter === "new") bits.push("오늘 신규");
      if (state.filter === "done") bits.push("신청완료");
      if (state.filter === "won") bits.push("당첨");
      if (state.cat !== "all") bits.push(catLabel(state.cat));
      if (state.q) {
        emptyBox.innerHTML = '<span class="big">🔍</span>‘' + esc(state.q) + "’ " +
          (bits.length ? esc(bits.join(" · ")) + " 안에서 " : "") + "검색 결과가 없어요.";
      } else if (state.filter === "won" && state.cat === "all") {
        emptyBox.innerHTML = '<span class="big">🎉</span>아직 당첨으로 표시한 상품이 없어요.<br>' +
          "신청완료 탭 카드에서 <b>🎉 당첨</b>을 누르면 여기로 모여요.<br>" +
          "당첨으로 표시한 상품은 발표일이 지나도 정리되지 않고 후기를 쓸 때까지 남습니다.";
      } else if (state.filter === "done" && state.cat === "all") {
        emptyBox.innerHTML = '<span class="big">🗂️</span>아직 신청완료로 옮긴 상품이 없어요.<br>' +
          "카드의 <b>완료 체크</b>를 누르면 여기에 모입니다.";
      } else if (state.filter !== "done" && state.excl.length && rowsWithoutKeywords(opts).length) {
        // 목록이 비었다면 제외 키워드가 가리고 있을 수 있다 — 바로 관리할 수 있게 안내
        emptyBox.innerHTML = '<span class="big">🚫</span>제외 키워드 ' + num(state.excl.length) + "개로 " +
          num(rowsWithoutKeywords(opts).length) + "건이 가려져 있어요.<br>”" + esc(state.excl[0]) + "” 같은 단어가 상품명·브랜드·카테고리에 들어간 상품이에요." +
          '<br><button type="button" class="linkish" data-excluded-open="1">제외 키워드 관리</button>';
      } else if (state.filter === "all" && state.cat === "all") {
        emptyBox.innerHTML = '<span class="big">🎉</span>미신청 상품이 없어요.<br>전부 완료 체크되어 있습니다.<br>' +
          "<b>신청완료</b> 탭에서 체크를 해제하면 다시 올 수 있어요.";
      } else if (bits.length) {
        emptyBox.innerHTML = '<span class="big">🔍</span>' + esc(bits.join(" · ")) + " 조건에 맞는 상품이 없어요." +
          (state.filter === "new" ? "<br>보통 10~11시에 새 목록이 열립니다.<br>(데이터는 매일 10:05 갱신)" : "");
      } else {
        emptyBox.innerHTML = (hiddenCount() && !allCampaigns().filter(function (c) { return !isHidden(c.campaignId); }).length)
          ? '<span class="big">🗑️</span>모두 숨겼어요.<br>아래 <b>숨긴 상품 모두 되돌리기</b>로 다시 볼 수 있어요.'
          : '<span class="big">🔍</span>모집 중인 체험단이 없어요.';
      }
    }
  }

  /* ── 토스트 ───────────────────────────── */
  var toastTimer = null, undoFn = null;
  function toast(msg, actionLabel, action, ms) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = esc(msg) +
      (actionLabel ? '<button type="button">' + esc(actionLabel) + "</button>" : "");
    toastEl.classList.add("show");
    undoFn = action || null;
    if (actionLabel) {
      toastEl.querySelector("button").addEventListener("click", function () {
        if (undoFn) undoFn();
        toastEl.classList.remove("show");
      });
      toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 6000);
    } else {
      toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 2200);
    }
  }

  /* ── 완료 체크 / 해제 ──────────────────
   * 체크하면 카드가 목록에서 바로 빠지고 ‘신청완료’ 탭에 모인다.
   * 실수로 눌렀을 때는 4초 토스트의 [되돌리기]로 즉시 원래대로 돌린다. */
  function moveCard(id, next, cardEl) {
    dismissReturnIf(id);
    setDone(id, next);
    if (cardEl) cardEl.classList.add("is-out");
    toast(next ? "신청완료로 옮겼어요" : "미신청으로 되돌렸어요", "되돌리기", function () {
      setDone(id, !next);
      renderAll();
      toast(next ? "미신청으로 되돌렸어요" : "신청완료로 옮겼어요");
    }, 4000);
    // 짧은 페이드아웃 뒤 목록·탭 건수·카테고리 칩을 한 번에 다시 그린다
    setTimeout(renderAll, 160);
  }

  /* ── 이벤트 ───────────────────────────── */
  /* 탭 전환 — 칩 표시·상단 수치를 한 번에 맞춘다(당첨 처리 뒤 탭을 옮길 때도 쓴다) */
  function setFilter(next) {
    state.filter = next;
    state.limit = PAGE;
    Array.prototype.forEach.call(document.querySelectorAll(".chip[data-filter]"), function (c) {
      var on = c.getAttribute("data-filter") === next;
      c.classList.remove("new-on");
      c.classList.toggle("on", on);
      c.setAttribute("aria-selected", on ? "true" : "false");
      if (on && next === "new") c.classList.add("new-on");
    });
    renderAll(); // 상단 수치도 탭 기준으로 다시 센다
  }

  /* ── 당첨 · 후기 챙기기 ────────────────
   * 신청완료 카드의 [🎉 당첨] → applied 에 won 남기고 당첨 탭으로 이동
   * 당첨 탭의 [✓ 후기 완료] → reviewed 토글   [당첨 취소] → 신청완료로 복귀(발표 지났으면 정리) */
  function markWon(id, cardEl) {
    if (!id) return;
    dismissReturnIf(id);
    if (!state.applied[id]) {
      var c = findCampaign(id);
      if (!c) return;
      state.applied[id] = snapshotOf(c);
    }
    state.applied = withWon(state.applied, id, true);
    saveApplied();
    if (cardEl && cardEl.classList) cardEl.classList.add("is-out");
    setFilter("won"); // 당첨 탭으로 이동해 바로 보여 준다
    toast("🎉 당첨! 당첨 탭에서 후기를 챙겨요", "되돌리기", function () {
      state.applied = withWon(state.applied, id, false);
      saveApplied();
      renderAll();
      toast("당첨 표시를 되돌렸어요");
    }, 6000);
  }
  function toggleReviewed(id) {
    var ent = state.applied[id];
    if (!ent || !ent.won) return;
    var next = !ent.reviewed;
    state.applied = withReviewed(state.applied, id, next);
    saveApplied();
    renderAll();
    toast(next ? "후기 완료로 표시했어요" : "후기 완료를 풀었어요", "되돌리기", function () {
      state.applied = withReviewed(state.applied, id, !next);
      saveApplied();
      renderAll();
    }, 4000);
  }
  function unwonCard(id) {
    var prevEntry = state.applied[id];
    if (!prevEntry || !prevEntry.won) return;
    state.applied = withWon(state.applied, id, false);
    // 발표일이 지난 건은 신청완료로 돌아가도 바로 정리된다 — 그 사실을 알린다
    var pruned = pruneApplied(state.applied, now());
    var gone = pruned.removed.indexOf(id) !== -1;
    state.applied = pruned.applied;
    saveApplied();
    renderAll();
    toast(gone ? "당첨을 취소해 정리했어요 (발표일이 지나서)" : "신청완료로 되돌렸어요", "되돌리기", function () {
      var cur = state.applied;
      var back = {};
      Object.keys(cur).forEach(function (k) { back[k] = cur[k]; });
      back[id] = prevEntry;
      state.applied = back;
      saveApplied();
      renderAll();
      toast("당첨으로 되돌렸어요");
    }, 6000);
  }

  function hideOne(id, actEl) {
    dismissReturnIf(id);
    setHidden(id, true);
    if (actEl) actEl.classList.add("is-out");
    toast("목록에서 숨겼어요", "되돌리기", function () {
      setHidden(id, false);
      renderAll();
      toast("다시 보이게 했어요");
    }, 4000);
    // 짧은 페이드아웃 뒤 목록·건수·칩을 한 번에 다시 그린다
    setTimeout(renderAll, 160);
  }

  list.addEventListener("click", function (e) {
    var hideBtn = e.target.closest("[data-hide]");
    if (hideBtn) {
      e.preventDefault();
      hideOne(hideBtn.getAttribute("data-hide"), hideBtn.closest(".card"));
      return;
    }
    // 완료 체크 / 해제 — 카드가 목록에서 빠지고 ‘신청완료’ 탭과 오가며 되돌린다
    var btn = e.target.closest("[data-toggle]");
    if (btn) {
      e.preventDefault();
      var cid = btn.getAttribute("data-toggle");
      moveCard(cid, !isDone(cid), btn.closest(".card"));
      return;
    }
    // 당첨 표시 / 후기 완료 토글 / 당첨 취소
    var wonBtn = e.target.closest("[data-won]");
    if (wonBtn) {
      e.preventDefault();
      markWon(wonBtn.getAttribute("data-won"), wonBtn.closest(".card"));
      return;
    }
    var reviewBtn = e.target.closest("[data-review]");
    if (reviewBtn) {
      e.preventDefault();
      toggleReviewed(reviewBtn.getAttribute("data-review"));
      return;
    }
    var unwonBtn = e.target.closest("[data-unwon]");
    if (unwonBtn) {
      e.preventDefault();
      unwonCard(unwonBtn.getAttribute("data-unwon"));
      return;
    }
    var openA = e.target.closest("[data-open]");
    if (openA) {
      var id = openA.getAttribute("data-open");
      rememberOpen(id); // 카톡을 열고 돌아오면 하단 배너에서 한 번에 완료 처리하게 묻는다
      return; // 링크는 그대로 새 탭·앱으로 열린다
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll(".chip[data-filter]"), function (chip) {
    chip.addEventListener("click", function () {
      setFilter(chip.getAttribute("data-filter"));
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".chip[data-cat]"), function (chip) {
    chip.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".chip[data-cat]"), function (c) {
        c.classList.remove("on");
        c.setAttribute("aria-selected", "false");
      });
      chip.setAttribute("aria-selected", "true");
      chip.classList.add("on");
      state.cat = chip.getAttribute("data-cat");
      state.limit = PAGE;
      renderList(true);
    });
  });

  $("sort").addEventListener("change", function (e) {
    state.sort = e.target.value;
    state.limit = PAGE;
    renderList(true);
  });

  var qTimer = null;
  $("q").addEventListener("input", function (e) {
    $("searchWrap").classList.toggle("has-text", !!e.target.value);
    var v = e.target.value.trim();
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      state.q = v.toLowerCase();
      state.limit = PAGE;
      renderList(true);
    }, 180);
  });
  $("qClear").addEventListener("click", function () {
    $("q").value = "";
    $("searchWrap").classList.remove("has-text");
    state.q = "";
    state.limit = PAGE;
    renderList(true);
    $("q").focus();
  });

  more.addEventListener("click", function () {
    state.limit += PAGE;
    renderList(false);
  });

  /* 하단 안내의 ‘숨긴 상품 모두 되돌리기’ — innerHTML 이 다시 그려져도 살아있게 위임 */
  $("foot").addEventListener("click", function (e) {
    if (e.target.closest("[data-transfer-open]")) {
      openTransfer();
      return;
    }
    if (e.target.closest("[data-excluded-open]")) {
      openExcluded();
      return;
    }
    if (!e.target.closest("[data-unhide-all]")) return;
    var n = hiddenCount();
    clearHidden();
    renderAll();
    toast(n ? "숨긴 상품 " + num(n) + "개를 되돌렸어요" : "되돌릴 상품이 없어요");
  });

  /* ── 기록 옮기기 패널 ────────────────
   * ① 이 기기의 기록을 KTF1 글자로 복사 ② 다른 기기에서 만든 글자를 붙여넣어 불러오기 */
  function transferCounts() {
    var ids = recordIds(state.applied);
    return {
      applied: ids.length,
      hidden: recordIds(state.hidden).length,
      kw: state.excl.length,
      won: ids.filter(function (id) { return isWon(id); }).length,
      reviewed: ids.filter(function (id) { return isReviewed(id); }).length
    };
  }
  /** 기록 안내에 붙는 ‘당첨 N건’ 조각(없으면 빈 글자) */
  function wonPart(n) {
    return n.won ? " · 당첨 " + num(n.won) + "건" + (n.reviewed ? "(후기 완료 " + num(n.reviewed) + ")" : "") : "";
  }
  function openTransfer() {
    var box = $("transfer");
    if (!box) return;
    var n = transferCounts();
    box.hidden = false;
    $("transferNote").textContent = "지금 이 기기 기록 — 신청완료 " + num(n.applied) + "건" + wonPart(n) +
      " · 숨김 " + num(n.hidden) + "건" +
      (n.kw ? " · 제외 키워드 " + num(n.kw) + "개" : "");
    $("transferMsg").textContent = "";
    $("transferText").value = "";
    var btn = $("transferCopy");
    if (btn && btn.focus) btn.focus();
  }
  function closeTransfer() {
    var box = $("transfer");
    if (box) box.hidden = true;
  }
  /** 클립보드 API 가 막힌 곳(일부 WebView·http)을 위한 글자 선택 복사 */
  function legacyCopy(ta) {
    try {
      if (!ta) return false;
      if (ta.focus) ta.focus();
      if (ta.select) ta.select();
      if (ta.setSelectionRange) ta.setSelectionRange(0, ta.value.length);
      return typeof document.execCommand === "function" && !!document.execCommand("copy");
    } catch (e) { return false; }
  }
  function copyTransfer() {
    var ta = $("transferText"), note = $("transferNote");
    var n = transferCounts();
    if (!n.applied && !n.hidden && !n.kw) {
      if (ta) ta.value = "";
      note.textContent = "이 기기에는 아직 옮길 기록이 없어요.";
      return;
    }
    var text = packRecords(state.applied, state.hidden, state.excl);
    if (ta) ta.value = text; // 자동 복사가 막혀도 여기서 직접 복사할 수 있게 남긴다
    var counted = "신청완료 " + num(n.applied) + "건" + wonPart(n) + " · 숨김 " + num(n.hidden) + "건" +
      (n.kw ? " · 제외 키워드 " + num(n.kw) + "개" : "");
    var ok = function () { note.textContent = counted + " 복사했어요. 새 기기에서 ②에 붙여넣어 주세요."; };
    var manual = function () {
      note.textContent = counted + " 준비했어요. 자동 복사가 안 되면 아래 칸의 글자를 길게 눌러 전체 복사해 주세요.";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(text).then(ok, function () {
          if (!legacyCopy(ta)) manual();
          else ok();
        });
        return;
      } catch (e) { /* 아래로 */ }
    }
    if (legacyCopy(ta)) ok(); else manual();
  }
  /** 붙여넣은 기록 저장 — replace 면 이 기기의 기존 기록을 버리고 덮어쓴다. */
  function importTransfer(replace) {
    var ta = $("transferText"), msg = $("transferMsg"), rec;
    try {
      rec = unpackRecords(ta ? ta.value : "");
    } catch (err) {
      msg.textContent = err.message || "글자를 읽지 못했어요.";
      return;
    }
    if (replace) { state.applied = {}; state.hidden = {}; }
    state.applied = mergeRecords(state.applied, rec.applied);
    state.hidden = mergeRecords(state.hidden, rec.hidden);
    // 제외 키워드: 합치기는 더하고, 덮어쓰기는 K 줄이 있는 백업일 때만 갈아치운다(예전 백업 보호)
    if (rec.hasKeywords) state.excl = replace ? rec.keywords : sanitizeKeywords(state.excl.concat(rec.keywords));
    saveApplied();
    saveHidden();
    saveKeywords();
    syncApplied(); // 옮겨 온 예전 기록도 지금 목록으로 보강하고, 발표가 끝난 것은 정리
    renderAll();
    closeTransfer();
    toast((replace ? "기록을 덮어썼어요" : "기록을 불러왔어요") +
      " · 신청완료 " + num(recordIds(state.applied).length) + "건" + wonPart(transferCounts()) + " · 숨김 " +
      num(recordIds(state.hidden).length) + "건" +
      (state.excl.length ? " · 제외 키워드 " + num(state.excl.length) + "개" : ""));
  }
  $("transferCopy").addEventListener("click", copyTransfer);
  $("transferMerge").addEventListener("click", function () { importTransfer(false); });
  $("transferReplace").addEventListener("click", function () { importTransfer(true); });
  $("transferClose").addEventListener("click", closeTransfer);
  $("transfer").addEventListener("click", function (e) {
    var t = e.target;
    if (t === this || (t && t.getAttribute && t.getAttribute("data-transfer-close"))) closeTransfer();
  });
  if (document.addEventListener) {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("transfer").hidden) closeTransfer();
      var ex = $("excluded");
      if (ex && !ex.hidden) closeExcluded();
    });
  }

  /* ── 제외 키워드 ─────────────────────────
   * 등록한 키워드는 ‘전체·오늘 신규’ 목록과 건수에서만 빠지고 ‘신청완료’ 탭은 그대로다.
   * 저장은 이 폰(localStorage kt_excluded_kw_v1)에만. */
  function loadKeywords() {
    try { return sanitizeKeywords(JSON.parse(localStorage.getItem(EXCL_STORE) || "[]")); }
    catch (e) { return []; }
  }
  function saveKeywords() {
    try { localStorage.setItem(EXCL_STORE, JSON.stringify(state.excl)); } catch (e) { /* 사생활 모드 등 */ }
  }
  function renderKeywordBadge() {
    var n = state.excl.length, b = $("kwBadge");
    if (b) { b.textContent = String(n); b.hidden = !n; }
    var btn = $("kwOpen");
    if (btn && btn.classList) btn.classList.toggle("has", !!n);
  }
  function renderKeywordList() {
    var box = $("kwList"), clr = $("kwClearAll");
    if (clr) clr.disabled = !state.excl.length;
    if (box) {
      box.innerHTML = state.excl.length
        ? state.excl.map(function (k) {
            return '<button class="kw-chip" type="button" data-kw-del="' + esc(k) + '" aria-label="' + esc(k) +
              ' 제외 키워드 삭제" title="이 키워드 지우기"><span>' + esc(k) + '</span>' +
              '<span class="x" aria-hidden="true">✕</span></button>';
          }).join("")
        : '<p class="kw-empty">등록된 제외 키워드가 없어요.<br>예: 여성, 아동, 화장품, 커피</p>';
    }
    renderPresetState();
  }
  function openExcluded() {
    var box = $("excluded");
    if (!box) return;
    box.hidden = false;
    $("kwMsg").textContent = "";
    renderKeywordList();
    var inp = $("kwInput");
    if (inp) { inp.value = ""; if (inp.focus) inp.focus(); }
  }
  function closeExcluded() {
    var box = $("excluded");
    if (box) box.hidden = true;
  }
  /** 입력칸의 글자를 키워드로 등록하고 목록에 바로 반영 */
  function addKeywordFromInput() {
    var inp = $("kwInput"), msg = $("kwMsg");
    var text = inp ? inp.value : "";
    var before = state.excl.length;
    var next = addKeywords(state.excl, text);
    if (next.length === before) {
      msg.textContent = String(text).trim()
        ? (before >= EXCL_MAX_KW ? "키워드는 " + EXCL_MAX_KW + "개까지 등록할 수 있어요." : "이미 등록된 키워드예요.")
        : "추가할 키워드를 입력해 주세요.";
      return;
    }
    state.excl = next;
    saveKeywords();
    if (inp) inp.value = "";
    renderKeywordList();
    renderAll();
    msg.textContent = "제외 키워드 " + num(state.excl.length) + "개 · 지금 목록에서 " +
      num(excludedCount()) + "건 가리는 중";
  }
  /** 1탭 프리셋 버튼 상태 — 이미 다 들어 있으면 ‘적용됨’으로 보인다 */
  function renderPresetState() {
    var btn = $("kwPreset"), note = $("kwPresetNote");
    var on = hasPreset(state.excl);
    if (btn && btn.classList) btn.classList.toggle("is-on", on);
    if (note) note.textContent = on
      ? "✓ 지금 적용됨 · 목록에서 " + num(excludedCount()) + "건을 가리고 있어요. 키워드를 지우면 바로 풀려요."
      : "여성·유아동·스킨케어·메이크업·향수·주얼리·임산부·육아·생리대 " + PRESET_KEYWORDS.length +
        "개를 한 번에 넣어요. ‘유아동’은 유아동·반려 칸 전체(반려용품 포함)를 가려요. 넣은 키워드는 위에서 하나씩 지울 수 있어요.";
  }
  /** 1탭 프리셋 버튼 — 이미 있는 키워드는 건드리지 않고 빠진 것만 더한다 */
  function applyPresetFromButton() {
    var msg = $("kwMsg");
    var before = state.excl.length;
    var next = applyPreset(state.excl);
    if (next.length === before) {
      if (msg) msg.textContent = "이미 여성·유아동·뷰티 키워드 " + PRESET_KEYWORDS.length +
        "개가 모두 들어 있어요 · 지금 목록에서 " + num(excludedCount()) + "건 가리는 중";
      renderPresetState();
      return;
    }
    state.excl = next;
    saveKeywords();
    renderKeywordList();
    renderAll();
    if (msg) msg.textContent = "👨 여성·유아동·뷰티 " + (next.length - before) + "개를 넣었어요 · 키워드 " +
      num(next.length) + "개 · 지금 목록에서 " + num(excludedCount()) + "건 가리는 중";
  }
  $("kwOpen").addEventListener("click", openExcluded);
  $("excludedClose").addEventListener("click", closeExcluded);
  $("kwAdd").addEventListener("click", addKeywordFromInput);
  $("kwPreset").addEventListener("click", applyPresetFromButton);
  $("kwInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.keyCode === 13) {
      if (e.preventDefault) e.preventDefault();
      addKeywordFromInput();
    }
  });
  $("kwList").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-kw-del]") : null;
    if (!b) return;
    var kw = b.getAttribute("data-kw-del");
    state.excl = removeKeyword(state.excl, kw);
    saveKeywords();
    renderKeywordList();
    renderAll();
    $("kwMsg").textContent = "‘" + kw + "’ 키워드를 지웠어요 · 남은 " + num(state.excl.length) + "개";
  });
  $("kwClearAll").addEventListener("click", function () {
    if (!state.excl.length) return;
    state.excl = [];
    saveKeywords();
    renderKeywordList();
    renderAll();
    $("kwMsg").textContent = "제외 키워드를 모두 지웠어요.";
  });
  $("excluded").addEventListener("click", function (e) {
    var t = e.target;
    if (t === this || (t && t.getAttribute && t.getAttribute("data-excluded-close"))) closeExcluded();
  });
  emptyBox.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("[data-excluded-open]")) openExcluded();
  });

  /* ── 카톡 복귀 원탭 확인 배너 ──────────
   * [모바일 신청 열기]로 카톡에 나간 상품을 기억해 두고, 앱·브라우저로 돌아오면
   * 하단에 “방금 연 ○○ 신청했나요?” 배너를 띄워 한 번에 완료 처리할 수 있게 한다.
   * 평소에는 sessionStorage(탭을 닫으면 사라짐)에 두고, 잠깐 동안은 localStorage 에도 같이 적는다.
   * 카톡에서 돌아오는 사이 웹뷰가 죽어 페이지가 새로 뜨는 경우에도 배너가 뜨게 하기 위해서다. */
  var retId = "", memOpen = null;
  function sessionStore() {
    try { if (typeof sessionStorage !== "undefined" && sessionStorage) return sessionStorage; } catch (e) { /* 막힌 곳 */ }
    return null;
  }
  function localStore() {
    try { if (typeof localStorage !== "undefined" && localStorage) return localStorage; } catch (e) { /* 막힌 곳 */ }
    return null;
  }
  function readLastOpen() {
    var stores = [sessionStore(), localStore()];
    for (var i = 0; i < stores.length; i++) {
      if (!stores[i]) continue;
      try {
        var raw = stores[i].getItem(OPEN_STORE);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* 다음 저장소 */ }
    }
    return memOpen;
  }
  function writeLastOpen(lo) {
    memOpen = lo;
    [sessionStore(), localStore()].forEach(function (st) {
      if (!st) return;
      try { st.setItem(OPEN_STORE, JSON.stringify(lo)); } catch (e) { /* 메모리만 */ }
    });
  }
  function clearLastOpen() {
    memOpen = null;
    [sessionStore(), localStore()].forEach(function (st) {
      if (!st) return;
      try { st.removeItem(OPEN_STORE); } catch (e) { /* 무시 */ }
    });
  }
  function findCampaign(id) {
    var all = allCampaigns();
    for (var i = 0; i < all.length; i++) if (all[i].campaignId === id) return all[i];
    return null;
  }
  function rememberOpen(id) {
    var c = findCampaign(id);
    if (!c) return;
    writeLastOpen({ id: id, title: String(c.title || ""), at: Date.now() });
  }
  function showReturnBar(lo) {
    var bar = $("retBar");
    if (!bar) return;
    retId = lo.id;
    var t = $("retTitle"), title = String(lo.title || "이 상품");
    if (title.length > 42) title = title.slice(0, 41) + "…"; // 아주 긴 제목은 두 줄 안에
    if (t) t.textContent = title;
    bar.hidden = false;
    if (document.body && document.body.classList) document.body.classList.add("has-retbar");
  }
  function hideReturnBar() {
    var bar = $("retBar");
    if (bar) bar.hidden = true;
    retId = "";
    if (document.body && document.body.classList) document.body.classList.remove("has-retbar");
  }
  /** 배너에 뜬 상품이 다른 길로 완료·숨김 처리되면 배너도 함께 닫는다 */
  function dismissReturnIf(id) {
    if (!retId || id !== retId) return;
    hideReturnBar();
    clearLastOpen();
  }
  function maybePromptReturn() {
    // 날짜가 바뀌었거나 처음 불러온 뒤라면 정리·보강할 것이 있다 — 배너보다 먼저 반영한다
    var sync = syncApplied();
    if (sync.changed) {
      if (state.data) renderAll();
      notePrune(sync.removed.length);
    }
    if (document.hidden) return; // 아직 카톡에 가 있는 상태
    var lo = readLastOpen(), bar = $("retBar");
    if (!lo) {
      if (bar && !bar.hidden) hideReturnBar();
      return;
    }
    if (!shouldPromptReturn(lo, now(), isDone, isHidden)) {
      if (bar && !bar.hidden) hideReturnBar();
      clearLastOpen();
      return;
    }
    if (bar && !bar.hidden && retId === lo.id) return;
    showReturnBar(lo);
  }
  $("retDone").addEventListener("click", function () {
    var lo = readLastOpen(), id = retId || (lo && lo.id) || "";
    hideReturnBar();
    clearLastOpen();
    if (!id) return;
    if (isDone(id)) { renderAll(); toast("이미 신청완료로 표시돼 있어요"); return; }
    setDone(id, true);
    renderAll();
    toast("신청완료로 옮겼어요", "되돌리기", function () {
      setDone(id, false);
      renderAll();
      toast("미신청으로 되돌렸어요");
    }, 4000);
  });
  $("retClose").addEventListener("click", function () {
    hideReturnBar();
    clearLastOpen();
  });
  if (document.addEventListener) document.addEventListener("visibilitychange", maybePromptReturn);
  if (global.addEventListener) {
    global.addEventListener("pageshow", maybePromptReturn); // pageshow 는 Window 이벤트다(document 에 걸면 안 온다)
    global.addEventListener("focus", maybePromptReturn);
  }

  /* ── 분할 화면 카톡 (Android 앱 전용) ───────────────────────────────
   * 앱(WebView)이 넣어 둔 AndroidSplitBridge 가 있을 때만 헤더에 버튼이 보인다(일반 브라우저는 그대로).
   * - 분할 화면: 카톡을 옆 칸에 띄운다(앱이 LAUNCH_ADJACENT 로 실행) — 피드 화면을 덮지 않는다
   * - 전체 화면: 갤럭시 폴드 '앱 페어'를 한 번 저장해 두면 1초 만에 같이 열린다는 안내를 띄운다 */
  function splitBridge() {
    return (global && global.AndroidSplitBridge) || null;
  }
  function splitState(bridge) {
    try { return !!(bridge && bridge.isMultiWindow && bridge.isMultiWindow()); } catch (e) { return false; }
  }
  function showSplitTip(on) {
    var tip = $("splitTip");
    if (tip) tip.hidden = !on;
    if (document.body && document.body.classList) document.body.classList.toggle("has-splittip", !!on);
  }
  function syncSplitButton() {
    var btn = $("splitKakao"), bridge = splitBridge();
    if (!btn) return;
    if (!bridge) { btn.hidden = true; return; } // 일반 브라우저에서는 버튼을 두지 않는다
    btn.hidden = false;
    var inSplit = splitState(bridge);
    if (btn.classList) btn.classList.toggle("ready", inSplit);
    btn.title = inSplit ? "카톡을 옆 칸에 열기" : "분할 화면으로 쓰는 방법";
    if (btn.setAttribute) btn.setAttribute("aria-label", btn.title);
  }
  function openKakaoAdjacent() {
    var bridge = splitBridge();
    if (!bridge) return false;
    try {
      if (!splitState(bridge)) { showSplitTip(true); return false; }
      var opened = !!(bridge.openKakaoAdjacent && bridge.openKakaoAdjacent());
      if (!opened) toast("카톡을 열지 못했어요. 카톡 설치를 확인해 주세요.");
      return opened;
    } catch (e) {
      toast("카톡을 열지 못했어요.");
      return false;
    }
  }
  $("splitKakao").addEventListener("click", openKakaoAdjacent);
  $("splitTipClose").addEventListener("click", function () { showSplitTip(false); });
  if (global.addEventListener) global.addEventListener("resize", syncSplitButton);
  syncSplitButton();

  $("refresh").addEventListener("click", load);

  if ("IntersectionObserver" in global) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !more.hidden) {
        state.limit += PAGE;
        renderList(false);
      }
    }, { rootMargin: "600px" }).observe(more);
  }

  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  load();
})(typeof window !== "undefined" ? window : this);
