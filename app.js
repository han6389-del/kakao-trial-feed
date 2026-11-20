/* 카카오 체험단 피드 — 로직
 * 순수 함수는 KT 로 내보내 테스트할 수 있게 두고, 화면 동작은 아래 UI 블록에 있다. */
(function (global) {
  "use strict";

  var STORE = "ktApp.applied.v1";
  var HIDDEN_STORE = "kt_hidden_v1";
  var PAGE = 30;
  var KEEP_DAYS = 45;
  var HIDDEN_DAYS = 60; // 숨김은 60일 뒤 정리(모집 기간이 7일이라 목록에서 이미 빠져 있다)

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
    }
    if (o.cat && o.cat !== "all" && groupKeyOf(c) !== o.cat) return false;
    if (o.q) {
      var hay = (c.title + " " + (c.brandName || "") + " " + (c.category || "")).toLowerCase();
      if (hay.indexOf(o.q) === -1) return false;
    }
    return true;
  }
  /** 탭 기준으로 거른 배열 — 상단 수치용이라 카테고리·검색어는 반영하지 않는다 */
  function scopeRows(rows, filter, isDone) {
    rows = rows || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      var done = !!(isDone && isDone(c.campaignId));
      if (filter === "done" ? done : (!done && (filter !== "new" || !!c.isNew))) out.push(c);
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
    var base = { filter: o.filter, q: o.q, isDone: o.isDone };
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
    STORE: STORE, HIDDEN_STORE: HIDDEN_STORE, PAGE: PAGE, KEEP_DAYS: KEEP_DAYS, HIDDEN_DAYS: HIDDEN_DAYS
  };

  if (typeof document === "undefined") return; // 테스트(순수 함수) 환경

  /* ── 상태 ─────────────────────────────── */
  var state = {
    data: null, filter: "all", cat: "all", sort: "rate", q: "", limit: PAGE,
    applied: loadApplied(), hidden: loadHidden()
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
    var tabRows = scopeRows(all, state.filter, isDone);
    var s = summarize(tabRows, isDone);
    $("stScope").textContent = num(s.total);
    $("stScopeLabel").textContent = TABS[state.filter] || "미신청";
    $("stNew").textContent = num(s.newCount);
    $("stDone").textContent = num(doneAll);
    $("stBest").textContent = tabRows.length ? pct(s.best) : "–";
    // 탭 건수: 전체·오늘 신규는 미신청만, 신청완료는 체크한 것만
    $("cAll").textContent = num(all.length - doneAll);
    $("cNew").textContent = num(scopeRows(all, "new", isDone).length);
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
      (hiddenN
        ? '<br><button type="button" class="linkish" data-unhide-all="1">숨긴 상품 ' + num(hiddenN) + "개 모두 되돌리기</button>"
        : "");
  }

  function currentOpts() {
    return { filter: state.filter, cat: state.cat, q: state.q, sort: state.sort, isDone: isDone };
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
      if (!isDone(id)) moveCard(id, true, openA.closest(".card")); // 신청하러 나가면 신청완료로 옮겨 둔다
      return; // 링크는 그대로 새 탭으로 열린다
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
    if (!e.target.closest("[data-unhide-all]")) return;
    var n = hiddenCount();
    clearHidden();
    renderAll();
    toast(n ? "숨긴 상품 " + num(n) + "개를 되돌렸어요" : "되돌릴 상품이 없어요");
  });

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
