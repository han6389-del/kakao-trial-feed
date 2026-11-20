/* 카카오 체험단 피드 — 로직
 * 순수 함수는 KT 로 내보내 테스트할 수 있게 두고, 화면 동작은 아래 UI 블록에 있다. */
(function (global) {
  "use strict";

  var STORE = "ktApp.applied.v1";
  var PAGE = 30;
  var KEEP_DAYS = 45;

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
  /** 칩·검색 조건 통과 여부. opts = {filter, q, isDone} */
  function matches(c, opts) {
    var o = opts || {};
    if (o.filter === "new" && !c.isNew) return false;
    if (o.filter === "todo" && o.isDone && o.isDone(c.campaignId)) return false;
    if (o.q) {
      var hay = (c.title + " " + (c.brandName || "") + " " + (c.category || "")).toLowerCase();
      if (hay.indexOf(o.q) === -1) return false;
    }
    return true;
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
    deepLink: deepLink,
    STORE: STORE, PAGE: PAGE, KEEP_DAYS: KEEP_DAYS
  };

  if (typeof document === "undefined") return; // 테스트(순수 함수) 환경

  /* ── 상태 ─────────────────────────────── */
  var state = { data: null, filter: "all", sort: "rate", q: "", limit: PAGE, applied: loadApplied() };
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

  /* ── 렌더 ─────────────────────────────── */
  function cardHTML(c, done) {
    var dd = dday(c.endDate);
    done = !!done;
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
      "</div>" +
      '<div class="actions">' +
        '<a class="open" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" ' +
          'data-open="' + esc(c.campaignId) + '">모바일 신청 열기</a>' +
        '<button class="toggle" type="button" data-toggle="' + esc(c.campaignId) + '" aria-pressed="' +
          (done ? "true" : "false") + '">' + (done ? "✓ 완료" : "완료 체크") + "</button>" +
      "</div>" +
    "</article>";
  }

  function renderSummary() {
    var all = allCampaigns();
    var s = summarize(all, isDone);
    $("stTotal").textContent = num(s.total);
    $("stNew").textContent = num(s.newCount);
    $("stDone").textContent = num(s.doneCount);
    $("stBest").textContent = all.length ? pct(s.best) : "–";
    $("cAll").textContent = num(s.total);
    $("cNew").textContent = num(s.newCount);
    $("cTodo").textContent = num(s.total - s.doneCount);
    $("progressBar").style.width = (s.total ? (s.doneCount / s.total) * 100 : 0) + "%";

    var upd = state.data && state.data.updatedAt;
    $("updatedAt").textContent = fmtUpdated(upd);
    $("staleNote").hidden = !(upd && (Date.now() - Date.parse(upd)) > 30 * 3600e3);

    var d = state.data || {};
    $("foot").innerHTML = "수집 " + num(d.rawTotalCount) + "건 중 내 기준 통과 " + num(d.totalCount) +
      "건 · 제외 " + num(d.excludedCount) + "건<br>" +
      "신규 기준: " + esc(d.newRule || "-") + "<br>" +
      "신청 버튼을 누르면 그 상품을 ‘신청 완료’로 표시해 둡니다(이 폰에만 저장).";
  }

  function renderAll() {
    renderSummary();
    renderList(true);
  }

  function renderList(reset) {
    var rows = query(allCampaigns(), {
      filter: state.filter, q: state.q, sort: state.sort, isDone: isDone
    });
    $("shownCount").textContent = rows.length + "건";
    if (reset) list.innerHTML = "";
    var shown = rows.slice(0, state.limit);
    var from = reset ? 0 : list.children.length;
    var frag = document.createElement("div");
    frag.innerHTML = shown.slice(from).map(function (c) { return cardHTML(c, isDone(c.campaignId)); }).join("");
    while (frag.firstChild) list.appendChild(frag.firstChild);

    more.hidden = rows.length <= shown.length;
    if (!more.hidden) more.textContent = "더 보기 (" + Math.min(rows.length - shown.length, PAGE) + "건)";

    emptyBox.hidden = rows.length !== 0;
    if (!rows.length) {
      emptyBox.innerHTML = '<span class="big">🔍</span>' +
        (state.q ? "‘" + esc(state.q) + "’ 검색 결과가 없어요." :
          state.filter === "new" ? "새로 올라온 체험단이 아직 없어요.<br>보통 10~11시에 새 목록이 열립니다.<br>(데이터는 매일 10:05 갱신)" :
          state.filter === "todo" ? "미신청 상품이 없어요. 전부 체크되어 있습니다 🎉" :
          "모집 중인 체험단이 없어요.");
    }
  }

  /* ── 토스트 ───────────────────────────── */
  var toastTimer = null, undoFn = null;
  function toast(msg, actionLabel, action) {
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
      toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 6000);
    } else {
      toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
    }
  }

  /* ── 카드 상태 그리기 ─────────────────── */
  function paintDone(card, done) {
    if (!card) return;
    card.classList.toggle("is-done", done);
    var btn = card.querySelector("[data-toggle]");
    if (btn) {
      btn.setAttribute("aria-pressed", done ? "true" : "false");
      btn.textContent = done ? "✓ 완료" : "완료 체크";
    }
    var flag = card.querySelector(".doneflag");
    if (done && !flag) {
      flag = document.createElement("span");
      flag.className = "doneflag";
      flag.textContent = "신청 완료";
      card.appendChild(flag);
    } else if (!done && flag) {
      flag.remove();
    }
  }
  function refreshCounts() {
    var all = allCampaigns();
    var doneCount = all.filter(function (c) { return isDone(c.campaignId); }).length;
    $("stDone").textContent = num(doneCount);
    $("cTodo").textContent = num(all.length - doneCount);
    $("progressBar").style.width = (all.length ? (doneCount / all.length) * 100 : 0) + "%";
  }

  /* ── 이벤트 ───────────────────────────── */
  list.addEventListener("click", function (e) {
    var openA = e.target.closest("[data-open]");
    if (openA) {
      var id = openA.getAttribute("data-open");
      if (!isDone(id)) {
        var card = openA.closest(".card");
        setDone(id, true);
        paintDone(card, true);
        refreshCounts();
        toast("신청 완료로 체크했어요", "되돌리기", function () {
          setDone(id, false);
          paintDone(card, false);
          refreshCounts();
        });
      }
      return; // 링크는 그대로 새 탭으로 열린다
    }
    var btn = e.target.closest("[data-toggle]");
    if (!btn) return;
    var cid = btn.getAttribute("data-toggle");
    var next = !isDone(cid);
    var cardEl = btn.closest(".card");
    setDone(cid, next);
    paintDone(cardEl, next);
    refreshCounts();
    if (state.filter === "todo" && next) { renderList(true); return; }
    toast(next ? "신청 완료로 체크했어요" : "체크를 해제했어요",
      next ? "되돌리기" : null,
      next ? function () { setDone(cid, false); paintDone(cardEl, false); refreshCounts(); } : null);
  });

  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (chip) {
    chip.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
        c.classList.remove("on", "new-on");
        c.setAttribute("aria-selected", "false");
      });
      chip.setAttribute("aria-selected", "true");
      chip.classList.add("on");
      if (chip.getAttribute("data-filter") === "new") chip.classList.add("new-on");
      state.filter = chip.getAttribute("data-filter");
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
