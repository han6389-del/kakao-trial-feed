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
  var RETURN_TTL = 30 * 60e3;             // 카톡에서 돌아온 걸 확인 배너로 묻는 시간(30분)

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
  function todayKST(nowMs) {
    var d = new Date((nowMs || Date.now()) + 9 * 3600e3);
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
    { key: "pet", label: "반려", re: /^(유아동·반려|반려|유아동)/ },
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
  var TABS = { all: "미신청", new: "오늘 신규", done: "신청완료" };
  /** 칩·검색 조건 통과 여부. opts = {filter, cat, q, isDone} */
  function matches(c, opts) {
    var o = opts || {};
    var done = !!(o.isDone && o.isDone(c.campaignId));
    if (o.filter === "done") {
      if (!done) return false;              // 신청완료 탭은 체크한 것만
    } else {
      if (done) return false;               // 전체·오늘 신규 탭은 미신청만
      if (o.filter === "new" && !c.isNew) return false;
      // 제외 키워드는 미신청 목록(전체·오늘 신규)에만 건다 — 신청완료 탭은 그대로 보여준다
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
  function scopeRows(rows, filter, isDone, exclude) {
    rows = rows || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      var done = !!(isDone && isDone(c.campaignId));
      if (filter === "done" ? !done : (done || (filter === "new" && !c.isNew))) continue;
      if (filter !== "done" && excludedBy(c, exclude)) continue;
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
    } else {
      out.sort(function (a, b) {
        return (b.winRate - a.winRate) || (a.remainingDays - b.remainingDays) ||
          (a.applicationCount - b.applicationCount);
      });
    }
    return out;
  }
  function query(all, opts) {
    return sortList((all || []).filter(function (c) { return matches(c, opts); }), (opts || {}).sort);
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
    var base = { filter: o.filter, q: o.q, isDone: o.isDone, exclude: o.exclude };
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
    [["A", recordIds(applied)], ["H", recordIds(hidden)]].forEach(function (pair) {
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
  /** 붙여넣은 글자 → {applied, hidden, keywords, hasKeywords}. 형식이 아니면 Error */
  function unpackRecords(text) {
    var s = String(text == null ? "" : text).replace(/^\uFEFF/, "").trim();
    if (!s) throw new Error("붙여넣은 내용이 비어 있어요.");
    var applied = {}, hidden = {}, keywords = [], read = 0, hasKeywords = false;
    s.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === "#") return;
      if (/^KTF\d*$/i.test(line)) return; // 머리말
      var m = /^([AHK]|applied|hidden|kw|keywords)\b[\s:|]*(.*)$/i.exec(line);
      if (!m) return;
      var kind = m[1].toUpperCase().charAt(0);
      if (kind === "K") {                // 제외 키워드 줄
        hasKeywords = true;
        parseKeywords(m[2]).forEach(function (k) { keywords.push(k); });
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
    return { applied: applied, hidden: hidden, keywords: sanitizeKeywords(keywords), hasKeywords: hasKeywords };
  }
  /** base 위에 extra 를 얹은 새 객체(원본 불변) */
  function mergeRecords(base, extra) {
    var out = {};
    [base, extra].forEach(function (src) {
      Object.keys(src || {}).forEach(function (k) {
        if (!recordIdOk(k)) return;
        out[k] = src[k] || { at: new Date().toISOString() };
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
    var now = nowMs || Date.now();
    if (at > now) at = now;                  // 기기 시계가 앞서 있어도 30분 규칙은 지킨다
    if (now - at > RETURN_TTL) return false;
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
    esc: esc, num: num, pct: pct, dday: dday, todayKST: todayKST, fmtUpdated: fmtUpdated,
    matches: matches, sortList: sortList, query: query, summarize: summarize, cardHTML: cardHTML,
    scopeRows: scopeRows, TABS: TABS,
    deepLink: deepLink, groupKeyOf: groupKeyOf, catLabel: catLabel, CAT_GROUPS: CAT_GROUPS,
    isHiddenId: isHiddenId, filterHidden: filterHidden, catCounts: catCounts,
    packRecords: packRecords, unpackRecords: unpackRecords, mergeRecords: mergeRecords,
    recordIds: recordIds, recordIdOk: recordIdOk, TRANSFER_HEAD: TRANSFER_HEAD,
    parseKeywords: parseKeywords, sanitizeKeywords: sanitizeKeywords, addKeywords: addKeywords,
    removeKeyword: removeKeyword, hitKeyword: hitKeyword, excludedBy: excludedBy,
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
      var cut = Date.now() - KEEP_DAYS * 864e5, out = {};
      Object.keys(raw).forEach(function (k) {
        var at = raw[k] && raw[k].at ? Date.parse(raw[k].at) : 0;
        if (!at || at > cut) out[k] = raw[k] || { at: new Date().toISOString() };
      });
      return out;
    } catch (e) { return {}; }
  }
  function saveApplied() {
    try { localStorage.setItem(STORE, JSON.stringify(state.applied)); } catch (e) { /* 사생활 모드 등 */ }
  }
  function isDone(id) { return !!state.applied[id]; }
  function setDone(id, done) {
    if (done) state.applied[id] = { at: new Date().toISOString() };
    else delete state.applied[id];
    saveApplied();
  }

  /* ── 숨김 저장소 ─────────────────────── */
  function loadHidden() {
    try {
      var raw = JSON.parse(localStorage.getItem(HIDDEN_STORE) || "{}");
      var cut = Date.now() - HIDDEN_DAYS * 864e5, out = {}, dropped = false;
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
        renderAll();
      })
      .catch(function (err) {
        // 단일 파일(오프라인) 배포본은 데이터가 파일 안에 들어 있다
        if (global.__DATA__) { state.data = global.__DATA__; state.limit = PAGE; renderAll(); return; }
        $("updatedAt").textContent = "데이터를 불러오지 못했어요";
        emptyBox.hidden = false;
        emptyBox.innerHTML = '<span class="big">⚠️</span>campaigns.json 을 못 읽었어요.<br>' +
          "인터넷 연결을 확인하거나 잠시 뒤 새로고침해 주세요." +
          '<br><span style="font-size:11px;color:#bbb">' + esc(err.message) + "</span>";
      });
  }

  function allCampaigns() { return (state.data && state.data.campaigns) || []; }
  /** 숨긴 상품을 뺀, 화면·건수에 실제로 쓰는 목록 */
  function visibleCampaigns() { return filterHidden(allCampaigns(), state.hidden); }
  function hiddenCount() { return allCampaigns().length - visibleCampaigns().length; }

  /* ── 렌더 ─────────────────────────────── */
  function cardHTML(c, done, inDoneTab) {
    var dd = dday(c.endDate);
    done = !!done;
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
    return '<article class="card' + (done ? " is-done" : "") + '" data-id="' + esc(c.campaignId) + '">' +
      (done ? '<span class="doneflag">신청 완료</span>' : "") +
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
        '<span class="dday' + (dd.cls ? " " + dd.cls : "") + '">' + dd.label + "</span>" +
        (c.isNew ? '<span class="newtag">NEW</span>' : "") +
        '<button class="del" type="button" data-hide="' + esc(c.campaignId) + '" ' +
          'aria-label="이 상품을 목록에서 숨기기" title="목록에서 숨기기">' +
          '<span class="x" aria-hidden="true">✕</span>숨기기</button>' +
      "</div>" +
      '<div class="actions">' +
        '<a class="open" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" ' +
          'data-open="' + esc(c.campaignId) + '">모바일 신청 열기</a>' +
        '<button class="toggle" type="button" data-toggle="' + esc(c.campaignId) + '" aria-pressed="' +
          (done ? "true" : "false") + '" aria-label="' + esc(toggleLabel) + '" title="' + esc(toggleLabel) +
          '">' + esc(toggleText) + "</button>" +
      "</div>" +
    "</article>";
  }

  function renderSummary() {
    // 숨기기(✕)를 뺀 목록을 기준으로, 수치는 모두 현재 탭 기준으로 센다.
    var all = visibleCampaigns();
    var doneAll = all.filter(function (c) { return isDone(c.campaignId); }).length;
    var tabRows = scopeRows(all, state.filter, isDone, state.excl);
    var s = summarize(tabRows, isDone);
    $("stScope").textContent = num(s.total);
    $("stScopeLabel").textContent = TABS[state.filter] || "미신청";
    $("stNew").textContent = num(s.newCount);
    $("stDone").textContent = num(doneAll);
    $("stBest").textContent = tabRows.length ? pct(s.best) : "–";
    // 탭 건수: 전체·오늘 신규는 제외 키워드까지 걸러서 세고, 신청완료는 체크한 것만
    var inList = filterExcluded(all, state.excl);
    $("cAll").textContent = num(inList.length - inList.filter(function (c) { return isDone(c.campaignId); }).length);
    $("cNew").textContent = num(scopeRows(all, "new", isDone, state.excl).length);
    $("cDone").textContent = num(doneAll);
    $("progressBar").style.width = (all.length ? (doneAll / all.length) * 100 : 0) + "%";

    var upd = state.data && state.data.updatedAt;
    $("updatedAt").textContent = fmtUpdated(upd);
    $("staleNote").hidden = !(upd && (Date.now() - Date.parse(upd)) > 30 * 3600e3);

    var d = state.data || {};
    var hiddenN = hiddenCount();
    $("foot").innerHTML = "수집 " + num(d.rawTotalCount) + "건 중 내 기준 통과 " + num(d.totalCount) +
      "건 · 제외 " + num(d.excludedCount) + "건<br>" +
      "신규 기준: " + esc(d.newRule || "-") + "<br>" +
      "카테고리 칩은 카카오 대분류를 묶은 것이고, 분류가 없는 상품은 상품명으로 보정합니다.<br>" +
      "[완료 체크]를 누르면 그 상품이 ‘신청완료’ 탭으로 옮겨집니다(이 폰에만 저장).<br>" +
      "카드의 [✕ 숨기기]를 누르면 목록에서 빠집니다(이 폰에만 저장)." +
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
    return { filter: state.filter, cat: state.cat, q: state.q, sort: state.sort, isDone: isDone, exclude: state.excl };
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
      return cardHTML(c, isDone(c.campaignId), state.filter === "done");
    }).join("");
    while (frag.firstChild) list.appendChild(frag.firstChild);

    more.hidden = rows.length <= shown.length;
    if (!more.hidden) more.textContent = "더 보기 (" + Math.min(rows.length - shown.length, PAGE) + "건)";

    emptyBox.hidden = rows.length !== 0;
    if (!rows.length) {
      var bits = [];
      if (state.filter === "new") bits.push("오늘 신규");
      if (state.filter === "done") bits.push("신청완료");
      if (state.cat !== "all") bits.push(catLabel(state.cat));
      if (state.q) {
        emptyBox.innerHTML = '<span class="big">🔍</span>‘' + esc(state.q) + "’ " +
          (bits.length ? esc(bits.join(" · ")) + " 안에서 " : "") + "검색 결과가 없어요.";
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
    var openA = e.target.closest("[data-open]");
    if (openA) {
      var id = openA.getAttribute("data-open");
      rememberOpen(id); // 카톡을 열고 돌아오면 하단 배너에서 한 번에 완료 처리하게 묻는다
      return; // 링크는 그대로 새 탭·앱으로 열린다
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll(".chip[data-filter]"), function (chip) {
    chip.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".chip[data-filter]"), function (c) {
        c.classList.remove("on", "new-on");
        c.setAttribute("aria-selected", "false");
      });
      chip.setAttribute("aria-selected", "true");
      chip.classList.add("on");
      if (chip.getAttribute("data-filter") === "new") chip.classList.add("new-on");
      state.filter = chip.getAttribute("data-filter");
      state.limit = PAGE;
      renderAll(); // 상단 수치도 탭 기준으로 다시 센다
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
    return { applied: recordIds(state.applied).length, hidden: recordIds(state.hidden).length, kw: state.excl.length };
  }
  function openTransfer() {
    var box = $("transfer");
    if (!box) return;
    var n = transferCounts();
    box.hidden = false;
    $("transferNote").textContent = "지금 이 기기 기록 — 신청완료 " + num(n.applied) + "건 · 숨김 " + num(n.hidden) + "건" +
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
    var counted = "신청완료 " + num(n.applied) + "건 · 숨김 " + num(n.hidden) + "건" +
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
    renderAll();
    closeTransfer();
    toast((replace ? "기록을 덮어썼어요" : "기록을 불러왔어요") +
      " · 신청완료 " + num(recordIds(state.applied).length) + "건 · 숨김 " +
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
    if (!box) return;
    if (!state.excl.length) {
      box.innerHTML = '<p class="kw-empty">등록된 제외 키워드가 없어요.<br>예: 여성, 아동, 화장품, 커피</p>';
      return;
    }
    box.innerHTML = state.excl.map(function (k) {
      return '<button class="kw-chip" type="button" data-kw-del="' + esc(k) + '" aria-label="' + esc(k) +
        ' 제외 키워드 삭제" title="이 키워드 지우기"><span>' + esc(k) + '</span>' +
        '<span class="x" aria-hidden="true">✕</span></button>';
    }).join("");
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
  $("kwOpen").addEventListener("click", openExcluded);
  $("excludedClose").addEventListener("click", closeExcluded);
  $("kwAdd").addEventListener("click", addKeywordFromInput);
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
    if (document.hidden) return; // 아직 카톡에 가 있는 상태
    var lo = readLastOpen(), bar = $("retBar");
    if (!lo) {
      if (bar && !bar.hidden) hideReturnBar();
      return;
    }
    if (!shouldPromptReturn(lo, Date.now(), isDone, isHidden)) {
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

  /* 진단용 — 주소에 ?debug=1 이 붙어 있을 때만 내부 상태를 꺼내 볼 수 있게 둔다 */
  if (/[?&]debug=1\b/.test(location.search)) {
    global.__ktDebug = function () {
      var lo = readLastOpen();
      return {
        lastOpen: lo, retId: retId, barHidden: $("retBar") ? $("retBar").hidden : null,
        docHidden: !!document.hidden, applied: Object.keys(state.applied).length,
        excl: state.excl, filter: state.filter, at: Date.now()
      };
    };
  }

  load();
})(typeof window !== "undefined" ? window : this);
