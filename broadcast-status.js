(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.JeongwaBroadcast = api;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => api.init(), { once: true });
    else api.init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const CHANNEL_ID = "jeongwazzang";
  const CHANNEL_URL = `https://ch.sooplive.co.kr/${CHANNEL_ID}`;
  const PROXY_URL = "https://clever-rhino-36.hanul4269.deno.net";
  const STATUS_URL = `${PROXY_URL}?url=${encodeURIComponent(`https://chapi.sooplive.co.kr/api/${CHANNEL_ID}/station`)}`;
  const REFRESH_MS = 60000;
  const MAX_AGE_MS = 120000;
  const REQUEST_TIMEOUT_MS = 6000;
  const CLOCK_TOLERANCE_MS = 5000;
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const thumbnailRequests = new WeakMap();

  function liveMedia(snapshot) {
    if (snapshot.state !== "live" || !/^[1-9]\d*$/.test(String(snapshot.broadcastId ?? ""))
      || !Number.isSafeInteger(Number(snapshot.broadcastId)) || !Number.isFinite(snapshot.sourceTime)) return null;
    // Verified against SOOP's public mobile broadcast API (2026-10-12):
    // api.m.afreecatv.com/broad/a/items returns this thumbnail per broad_no.
    // The station endpoint itself supplies no thumbnail field.
    return {
      broadcastId: snapshot.broadcastId,
      imageUrl: `https://liveimg.sooplive.co.kr/m/${snapshot.broadcastId}?v=${Math.floor(snapshot.sourceTime / REFRESH_MS)}`,
      liveUrl: `https://play.sooplive.co.kr/${CHANNEL_ID}/${snapshot.broadcastId}`,
    };
  }

  // The station API returns current_timestamp as Korea time, without an offset.
  // Two observed responses advanced with their HTTP Date (2026-10-12 KST).
  // Parse that exact contract explicitly; never substitute the browser fetch time.
  function parseSourceTimestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
    const parts = value.match(/\d+/g).map(Number);
    const [year, month, day, hour, minute, second] = parts;
    if (year < 2020 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    const local = Date.UTC(year, month - 1, day, hour, minute, second);
    if (new Date(local).toISOString().slice(0, 19).replace("T", " ") !== value) return null;
    return local - 9 * 60 * 60 * 1000;
  }

  function unknownSnapshot(reason, now, state = "error") {
    return { state, reason, title: "", sourceTime: null, checkedAt: now, expiresAt: null };
  }

  function readHeader(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return key === undefined ? null : String(headers[key]);
  }

  function normalizeSnapshot(payload, { now = Date.now(), headers } = {}) {
    if (!isRecord(payload) || !isRecord(payload.station) || payload.station.user_id !== CHANNEL_ID
      || !Object.prototype.hasOwnProperty.call(payload, "broad")) return unknownSnapshot("invalid-response", now);

    const broadcast = payload.broad;
    // Only an explicit null in the known station response confirms no broadcast.
    // Missing fields, empty objects and API error responses are not OFFLINE.
    let state = "offline";
    let title = "";
    if (broadcast !== null) {
      if (!isRecord(broadcast) || !/^[1-9]\d*$/.test(String(broadcast.broad_no ?? ""))
        || !Number.isSafeInteger(Number(broadcast.broad_no))
        || (broadcast.user_id != null && broadcast.user_id !== CHANNEL_ID)) return unknownSnapshot("invalid-response", now);
      state = "live";
      const rawTitle = broadcast.broad_title ?? broadcast.title;
      title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    }

    const sourceTime = parseSourceTimestamp(payload.current_timestamp);
    if (sourceTime === null || !Number.isFinite(now) || sourceTime > now + CLOCK_TOLERANCE_MS) return unknownSnapshot("untrusted-time", now);
    let ageMs = Math.max(0, now - sourceTime);
    // Date/Age are currently not CORS-exposed by the proxy. The source timestamp
    // is required even when they are readable; proxy Date alone cannot date data.
    const dateHeader = readHeader(headers, "date");
    const ageHeader = readHeader(headers, "age");
    if (dateHeader !== null) {
      const responseTime = Date.parse(dateHeader);
      if (!Number.isFinite(responseTime) || responseTime > now + CLOCK_TOLERANCE_MS) return unknownSnapshot("untrusted-cache", now);
      ageMs = Math.max(ageMs, now - responseTime);
    }
    if (ageHeader !== null) {
      if (!/^\d+$/.test(ageHeader) || !Number.isSafeInteger(Number(ageHeader))) return unknownSnapshot("untrusted-cache", now);
      ageMs = Math.max(ageMs, Number(ageHeader) * 1000);
    }
    return {
      state: ageMs >= MAX_AGE_MS ? "stale" : state,
      reason: ageMs >= MAX_AGE_MS ? "expired" : "confirmed",
      title,
      broadcastId: state === "live" && ageMs < MAX_AGE_MS ? String(broadcast.broad_no) : null,
      sourceTime,
      checkedAt: now,
      expiresAt: now + Math.max(0, MAX_AGE_MS - ageMs),
    };
  }

  function stateAt(snapshot, now = Date.now()) {
    if ((snapshot.state === "live" || snapshot.state === "offline") && now >= snapshot.expiresAt) {
      return { ...snapshot, state: "stale", reason: "expired" };
    }
    return snapshot;
  }

  function createController(options = {}) {
    const fetchStatus = options.fetch || globalThis.fetch.bind(globalThis);
    const now = options.now || Date.now;
    const later = options.setTimeout || globalThis.setTimeout.bind(globalThis);
    const cancel = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    const isVisible = options.isVisible || (() => true);
    const onChange = options.onChange || (() => {});
    let snapshot = unknownSnapshot("loading", null, "loading");
    let inFlight = null;
    let refreshTimer = null;
    let expirationTimer = null;
    let requestAbort = null;
    let stopped = false;
    const notify = () => {
      snapshot = stateAt(snapshot, now());
      onChange(snapshot, Boolean(inFlight));
    };
    const expire = () => {
      cancel(expirationTimer);
      expirationTimer = null;
      if ((snapshot.state === "live" || snapshot.state === "offline") && snapshot.expiresAt !== null) {
        expirationTimer = later(() => { notify(); expire(); }, Math.max(0, snapshot.expiresAt - now()));
      }
    };
    const schedule = () => {
      cancel(refreshTimer);
      refreshTimer = null;
      if (!stopped && isVisible()) refreshTimer = later(refresh, REFRESH_MS);
    };
    function refresh() {
      if (inFlight) return inFlight;
      if (stopped) return Promise.resolve(snapshot);
      cancel(refreshTimer);
      refreshTimer = null;
      snapshot = stateAt(snapshot, now());
      // A background refresh must not flash a valid, still-fresh broadcast away.
      // Its expiration timer keeps running while this request is in flight.
      if (snapshot.state !== "live" && snapshot.state !== "offline") {
        cancel(expirationTimer);
        expirationTimer = null;
        snapshot = unknownSnapshot("loading", null, "loading");
      }
      inFlight = Promise.resolve().then(async () => {
        requestAbort = new AbortController();
        const timeout = later(() => requestAbort?.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetchStatus(STATUS_URL, { cache: "no-store", credentials: "omit", signal: requestAbort.signal });
          if (!response.ok) throw new Error("HTTP response failed");
          const payload = await response.json();
          if (!stopped) snapshot = normalizeSnapshot(payload, { now: now(), headers: response.headers });
        } catch (error) {
          if (!stopped) snapshot = unknownSnapshot(error?.name === "AbortError" ? "timeout" : "request-failed", now());
        } finally {
          cancel(timeout);
          requestAbort = null;
          inFlight = null;
          if (!stopped) { notify(); expire(); schedule(); }
        }
        return snapshot;
      });
      notify();
      return inFlight;
    }
    return {
      refresh,
      getSnapshot: () => stateAt(snapshot, now()),
      visibilityChanged() {
        notify();
        if (isVisible()) return refresh();
        cancel(refreshTimer);
        refreshTimer = null;
        return Promise.resolve(snapshot);
      },
      stop() {
        stopped = true;
        cancel(refreshTimer);
        cancel(expirationTimer);
        requestAbort?.abort();
      },
    };
  }

  const messages = {
    loading: { label: "조회 중", title: "방송 상태를 확인하고 있어요", detail: "잠시만 기다려 주세요. 노래책은 바로 이용할 수 있어요." },
    live: { label: "LIVE", title: "지금 정와가 방송 중이에요", detail: "SOOP에서 지금 진행 중인 방송을 만나보세요." },
    offline: { label: "방송 중 아님", title: "지금은 방송 중이 아니에요", detail: "다음 방송 소식은 SOOP에서 확인해 주세요." },
    error: { label: "확인 실패", title: "방송 상태를 확인하지 못했어요", detail: "잠시 후 다시 확인하거나 SOOP에서 직접 확인해 주세요." },
    stale: { label: "오래된 정보", title: "최신 방송 상태를 다시 확인해 주세요", detail: "이전 정보의 유효 시간이 지났어요. SOOP에서 현재 상태를 확인해 주세요." },
  };

  function renderThumbnail(snapshot, doc) {
    const link = doc.getElementById("home-live-thumbnail");
    const image = doc.getElementById("home-live-thumbnail-image");
    if (!link || !image) return;
    const media = liveMedia(snapshot);
    const previous = thumbnailRequests.get(image);
    if (!media) {
      thumbnailRequests.delete(image);
      link.hidden = true;
      link.removeAttribute("href");
      image.removeAttribute("src");
      image.onerror = null;
      image.alt = "";
      return;
    }
    image.alt = snapshot.title ? `정와 라이브 방송: ${snapshot.title}` : "정와 라이브 방송 미리보기";
    link.href = media.liveUrl;
    link.setAttribute("aria-label", "정와 라이브 방송 보러 가기 (새 창)");
    if (previous?.imageUrl === media.imageUrl) return;
    // Keep the last loaded frame during a same-broadcast refresh. The new image
    // swaps in only after decoding succeeds; an ended/untrusted broadcast clears
    // it immediately, and a different broadcast never inherits the previous frame.
    if (previous?.broadcastId !== media.broadcastId) {
      link.hidden = true;
      image.removeAttribute("src");
    }
    const request = { ...media };
    thumbnailRequests.set(image, request);
    const preload = doc.createElement("img");
    const isCurrent = () => thumbnailRequests.get(image) === request;
    const hideBrokenImage = () => {
      if (!isCurrent()) return;
      thumbnailRequests.delete(image);
      link.hidden = true;
      image.removeAttribute("src");
    };
    preload.onload = () => {
      if (!isCurrent()) return;
      if (!preload.naturalWidth) { hideBrokenImage(); return; }
      image.onerror = hideBrokenImage;
      image.src = media.imageUrl;
      link.hidden = false;
    };
    preload.onerror = hideBrokenImage;
    preload.referrerPolicy = "no-referrer";
    preload.src = media.imageUrl;
  }

  function render(snapshot, busy, doc) {
    const message = messages[snapshot.state] || messages.error;
    const setText = (id, value) => { const element = doc.getElementById(id); if (element && element.textContent !== value) element.textContent = value; };
    const panel = doc.getElementById("home-broadcast");
    if (panel) {
      panel.dataset.state = snapshot.state;
      panel.setAttribute("aria-busy", String(busy));
    }
    setText("home-live-label", message.label);
    setText("home-live-title", message.title);
    setText("home-live-detail", message.detail);
    renderThumbnail(snapshot, doc);
    const detail = doc.getElementById("home-live-detail");
    const program = doc.getElementById("home-live-title-full");
    const showTitle = snapshot.state === "live" && Boolean(snapshot.title);
    if (program) {
      program.hidden = !showTitle;
      setText("home-live-title-full", showTitle ? snapshot.title : "");
    }
    if (detail) detail.hidden = showTitle && Boolean(program);
    const link = doc.getElementById("home-live-link");
    if (link) {
      link.href = liveMedia(snapshot)?.liveUrl || CHANNEL_URL;
      const linkLabel = snapshot.state === "live" ? "방송 보러 가기" : snapshot.state === "offline" ? "SOOP 채널 보기" : "SOOP에서 확인";
      if (link.textContent !== linkLabel) link.textContent = linkLabel;
    }
    const button = doc.getElementById("home-live-refresh");
    if (button) { button.disabled = busy; button.setAttribute("aria-label", busy ? "방송 상태 확인 중" : "방송 상태 다시 확인"); }
    const badge = doc.getElementById("live-badge");
    if (badge) {
      badge.dataset.state = snapshot.state;
      badge.classList.toggle("is-live", snapshot.state === "live");
      const label = badge.querySelector("span:last-child");
      if (label) label.textContent = snapshot.state === "live" ? "LIVE" : snapshot.state === "offline" ? "SOOP" : message.label;
      badge.setAttribute("aria-label", `정와 SOOP 방송국, ${message.title}${snapshot.state === "live" && snapshot.title ? `, ${snapshot.title}` : ""}`);
      badge.title = message.title;
    }
  }

  const api = { parseSourceTimestamp, normalizeSnapshot, stateAt, createController, liveMedia, renderThumbnail, REFRESH_MS, MAX_AGE_MS, REQUEST_TIMEOUT_MS, STATUS_URL, controller: null };
  api.init = function () {
    if (api.controller || typeof document === "undefined") return api.controller;
    const controller = createController({
      isVisible: () => document.visibilityState !== "hidden",
      onChange: (snapshot, busy) => render(snapshot, busy, document),
    });
    api.controller = controller;
    document.getElementById("home-live-refresh")?.addEventListener("click", () => controller.refresh());
    document.addEventListener("visibilitychange", () => controller.visibilityChanged());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) controller.visibilityChanged();
    });
    controller.refresh();
    return controller;
  };
  return api;
});
