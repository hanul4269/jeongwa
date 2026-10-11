(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.JeongwaSoopNotices = api;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => api.init(), { once: true });
    else api.init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const CHANNEL_ID = "jeongwazzang";
  const STATION_NO = 27493430;
  // Verified against the channel station.menus entry named 방송공지.
  // A board_number query alone does not filter this API; use the board path.
  const BOARD_NO = 103532627;
  const CHANNEL_URL = `https://ch.sooplive.co.kr/${CHANNEL_ID}`;
  const BOARD_URL = `${CHANNEL_URL}/board/${BOARD_NO}`;
  const SOURCE_URL = `https://chapi.sooplive.co.kr/api/${CHANNEL_ID}/board/${BOARD_NO}?per_page=10&field=title&keyword=&type=all&order_by=reg_date&page=1`;
  const NOTICES_URL = `https://clever-rhino-36.hanul4269.deno.net?url=${encodeURIComponent(SOURCE_URL)}`;
  const REFRESH_MS = 60000;
  const REQUEST_TIMEOUT_MS = 6000;
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const validId = (value) => /^[1-9]\d*$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value));

  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
    const parts = value.match(/\d+/g).map(Number);
    const [year, month, day, hour, minute, second] = parts;
    if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    const local = Date.UTC(year, month - 1, day, hour, minute, second);
    if (new Date(local).toISOString().slice(0, 19).replace("T", " ") !== value) return null;
    return { timestamp: local - 9 * 60 * 60 * 1000, dateTime: `${value.replace(" ", "T")}+09:00`, label: value.slice(0, 10).replaceAll("-", ".") };
  }

  function normalizeNotices(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.data) || (payload.code != null && Number(payload.code) < 0)) {
      throw new Error("Invalid notice response");
    }
    const seen = new Set();
    const items = [];
    for (const post of payload.data) {
      if (!isRecord(post) || Number(post.bbs_no) !== BOARD_NO || Number(post.station_no) !== STATION_NO
        || post.user_id !== CHANNEL_ID || Number(post.auth_no) !== 101 || !validId(post.title_no)) continue;
      const title = typeof post.title_name === "string" ? post.title_name.trim() : "";
      const date = parseDate(post.reg_date);
      const id = String(post.title_no);
      if (!title || !date || seen.has(id)) continue;
      seen.add(id);
      // Construct links from validated numeric IDs, never from upstream HTML/URLs.
      items.push({ id, title, ...date, url: `${CHANNEL_URL}/post/${id}` });
    }
    // An incompatible response is not evidence that the notice board is empty.
    if (payload.data.length && !items.length) throw new Error("No valid public notices");
    return items.sort((a, b) => b.timestamp - a.timestamp || Number(b.id) - Number(a.id)).slice(0, 3);
  }

  function createController(options = {}) {
    const fetchNotices = options.fetch || globalThis.fetch.bind(globalThis);
    const now = options.now || Date.now;
    const later = options.setTimeout || globalThis.setTimeout.bind(globalThis);
    const cancel = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    const isVisible = options.isVisible || (() => true);
    const onChange = options.onChange || (() => {});
    let snapshot = { state: "loading", items: [], checkedAt: null, reason: "loading" };
    let inFlight = null;
    let timer = null;
    let requestAbort = null;
    let stopped = false;
    const notify = () => onChange(snapshot, Boolean(inFlight));
    const schedule = () => {
      cancel(timer);
      timer = null;
      if (!stopped && isVisible()) {
        const age = snapshot.checkedAt === null ? 0 : Math.max(0, now() - snapshot.checkedAt);
        const delay = snapshot.state === "ready" || snapshot.state === "empty" ? Math.max(0, REFRESH_MS - age) : REFRESH_MS;
        timer = later(refresh, delay);
      }
    };
    function refresh() {
      if (inFlight) return inFlight;
      if (stopped || !isVisible()) return Promise.resolve(snapshot);
      cancel(timer);
      timer = null;
      inFlight = Promise.resolve().then(async () => {
        requestAbort = new AbortController();
        const timeout = later(() => requestAbort?.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetchNotices(NOTICES_URL, { cache: "no-store", credentials: "omit", signal: requestAbort.signal });
          if (!response.ok) throw new Error("HTTP response failed");
          const items = normalizeNotices(await response.json());
          if (!stopped) snapshot = { state: items.length ? "ready" : "empty", items, checkedAt: now(), reason: "confirmed" };
        } catch (error) {
          if (!stopped) snapshot = { ...snapshot, state: "error", reason: error?.name === "AbortError" ? "timeout" : "request-failed" };
        } finally {
          cancel(timeout);
          requestAbort = null;
          inFlight = null;
          if (!stopped) { notify(); schedule(); }
        }
        return snapshot;
      });
      notify();
      return inFlight;
    }
    return {
      refresh,
      getSnapshot: () => snapshot,
      visibilityChanged() {
        cancel(timer);
        timer = null;
        if (isVisible()) {
          if (snapshot.checkedAt === null || snapshot.state === "error" || now() - snapshot.checkedAt >= REFRESH_MS) return refresh();
          schedule();
        }
        return Promise.resolve(snapshot);
      },
      stop() { stopped = true; cancel(timer); requestAbort?.abort(); },
    };
  }

  function render(snapshot, busy, doc) {
    const list = doc.getElementById("home-soop-notices-list");
    if (!list) return;
    const section = doc.getElementById("home-soop-notices");
    if (section) section.dataset.state = snapshot.state;
    list.setAttribute("aria-busy", String(busy));
    const status = doc.getElementById("home-soop-notices-status");
    let message;
    if (snapshot.state === "error") message = snapshot.items.length
      ? "업데이트를 다시 확인하고 있어요. 마지막 공지를 표시하며 자동으로 재시도해요."
      : "공지를 불러오지 못했어요. 자동으로 재시도해요. SOOP에서 직접 확인할 수 있어요.";
    else if (busy && !snapshot.items.length && snapshot.state !== "empty") message = "SOOP 공지를 확인하고 있어요.";
    else if (snapshot.state === "empty") message = "등록된 방송공지가 없어요. 새로운 소식은 SOOP에서 확인해 주세요.";
    else message = `최근 공지 ${snapshot.items.length}개 · 자동 업데이트`;
    if (status && status.textContent !== message) status.textContent = message;
    const all = doc.getElementById("home-soop-notices-all");
    if (all) { all.href = BOARD_URL; all.target = "_blank"; all.rel = "noopener noreferrer"; }
    // Reuse current rows during refresh so keyboard focus is not discarded.
    const signature = JSON.stringify(snapshot.items.map(({ id, title, dateTime }) => [id, title, dateTime]));
    if (list.dataset.content === signature) return;
    list.dataset.content = signature;
    list.replaceChildren(...snapshot.items.map((item) => {
      const row = doc.createElement("li");
      const link = doc.createElement("a");
      link.className = "home-soop-notice-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const title = doc.createElement("span");
      title.className = "home-soop-notice-title";
      title.textContent = item.title;
      const date = doc.createElement("time");
      date.className = "home-soop-notice-date";
      date.dateTime = item.dateTime;
      date.textContent = item.label;
      const arrow = doc.createElement("span");
      arrow.className = "home-soop-notice-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      link.append(title, date, arrow);
      row.append(link);
      return row;
    }));
  }

  function init(doc = document) {
    const list = doc.getElementById("home-soop-notices-list");
    if (!list || list.dataset.initialized) return null;
    list.dataset.initialized = "true";
    let currentView = doc.body?.dataset.siteView || "home";
    const controller = createController({ isVisible: () => !doc.hidden && currentView === "home", onChange: (snapshot, busy) => render(snapshot, busy, doc) });
    doc.addEventListener("visibilitychange", () => controller.visibilityChanged());
    doc.defaultView?.addEventListener("jeongwa:view-change", (event) => {
      currentView = event.detail?.view || doc.body?.dataset.siteView;
      controller.visibilityChanged();
    });
    controller.visibilityChanged();
    return controller;
  }
  return { BOARD_NO, BOARD_URL, SOURCE_URL, NOTICES_URL, REFRESH_MS, REQUEST_TIMEOUT_MS, parseDate, normalizeNotices, createController, render, init };
});
