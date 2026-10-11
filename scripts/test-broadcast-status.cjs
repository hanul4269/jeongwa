const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSourceTimestamp, normalizeSnapshot, stateAt, createController, liveMedia, renderThumbnail, MAX_AGE_MS, REFRESH_MS, REQUEST_TIMEOUT_MS } = require("../broadcast-status.js");

const now = Date.parse("2026-10-11T16:01:36Z");
const timestamp = (time) => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
const payload = (broad = { broad_no: 297757753, user_id: "jeongwazzang", broad_title: "오늘의 정와" }, at = now) => ({
  station: { user_id: "jeongwazzang" }, broad, current_timestamp: timestamp(at),
});

test("actual SOOP timestamp is parsed explicitly as KST across local timezones", () => {
  assert.equal(parseSourceTimestamp("2026-10-12 01:01:36"), now);
  for (const value of [null, 1791734496, "2026-10-12T01:01:36", "2026-02-30 01:00:00", "2026-13-12 01:00:00", "2026-10-12 24:00:00", "2026-10-12 01:01:60"]) {
    assert.equal(parseSourceTimestamp(value), null);
  }
});

test("only a valid fresh station broadcast becomes LIVE", () => {
  const result = normalizeSnapshot(payload(), { now });
  assert.equal(result.state, "live");
  assert.equal(result.title, "오늘의 정와");
  assert.equal(result.sourceTime, now);
  assert.equal(result.expiresAt, now + MAX_AGE_MS);
  assert.equal(normalizeSnapshot(payload(null), { now }).state, "offline");
  const longTitle = "긴 방송 제목 ".repeat(100);
  assert.equal(normalizeSnapshot(payload({ broad_no: 1, broad_title: longTitle }), { now }).title, longTitle.trim());
});

test("malformed responses and unrelated stations never become offline or LIVE", () => {
  for (const value of [null, [], {}, { error: "rate limited" }, { ...payload(), broad: undefined }, { ...payload(), broad: {} },
    { ...payload(), broad: false }, { ...payload(), broad: { broad_no: 0 } }, { ...payload(), broad: { broad_no: -1 } },
    { ...payload(), broad: { broad_no: "1e5" } }, { ...payload(), broad: { broad_no: Number.MAX_SAFE_INTEGER + 1 } },
    { ...payload(), broad: { broad_no: 100, user_id: "someone_else" } }, { ...payload(), station: { user_id: "someone_else" } }]) {
    assert.equal(normalizeSnapshot(value, { now }).state, "error", JSON.stringify(value));
  }
});

test("missing source time cannot be replaced by a successful fetch or fresh HTTP Date", () => {
  for (const value of [undefined, null, "", "invalid", timestamp(now + 6000)]) {
    assert.equal(normalizeSnapshot({ ...payload(), current_timestamp: value }, { now, headers: { Date: new Date(now).toUTCString(), Age: "0" } }).state, "error");
  }
  assert.equal(normalizeSnapshot(payload(null, now + 6000), { now }).state, "error");
});

test("expired cached LIVE and offline responses are stale, even with new proxy Date", () => {
  for (const broad of [null, { broad_no: 1 }]) {
    const result = normalizeSnapshot(payload(broad, now - MAX_AGE_MS), { now, headers: { Date: new Date(now).toUTCString(), Age: "0" } });
    assert.equal(result.state, "stale");
    assert.equal(result.sourceTime, now - MAX_AGE_MS);
  }
  assert.equal(normalizeSnapshot(payload(), { now, headers: { Age: "120" } }).state, "stale");
  assert.equal(normalizeSnapshot(payload(), { now, headers: { Date: new Date(now - MAX_AGE_MS).toUTCString() } }).state, "stale");
});

test("Date and Age anomalies cannot promote an untrusted response", () => {
  for (const headers of [{ Age: "-1" }, { Age: "NaN" }, { Age: "1.5" }, { Date: "invalid" }, { Date: new Date(now + 6000).toUTCString() }]) {
    assert.equal(normalizeSnapshot(payload(), { now, headers }).state, "error");
  }
  const result = normalizeSnapshot(payload(), { now, headers: new Headers({ Date: new Date(now).toUTCString(), Age: "100" }) });
  assert.equal(result.state, "live");
  assert.equal(result.expiresAt, now + 20000);
  assert.equal(stateAt(result, now + 19999).state, "live");
  assert.equal(stateAt(result, now + 20000).state, "stale");
});

test("previously confirmed LIVE expires without another network response", () => {
  const result = normalizeSnapshot(payload(), { now });
  assert.equal(stateAt(result, now + MAX_AGE_MS - 1).state, "live");
  assert.equal(stateAt(result, now + MAX_AGE_MS).state, "stale");
  assert.equal(result.state, "live");
});

test("live thumbnails use only a fresh verified broadcast number and minute cache key", () => {
  const snapshot = normalizeSnapshot(payload(), { now });
  const media = liveMedia(snapshot);
  assert.equal(media.imageUrl, `https://liveimg.sooplive.co.kr/m/297757753?v=${Math.floor(now / REFRESH_MS)}`);
  assert.equal(media.liveUrl, "https://play.sooplive.co.kr/jeongwazzang/297757753");
  assert.equal(liveMedia({ ...snapshot, sourceTime: now + 1000 }).imageUrl, media.imageUrl);
  assert.notEqual(liveMedia({ ...snapshot, sourceTime: now + REFRESH_MS }).imageUrl, media.imageUrl);
  for (const value of [normalizeSnapshot(payload(null), { now }), normalizeSnapshot({}, { now }),
    normalizeSnapshot(payload(undefined, now - MAX_AGE_MS), { now }), stateAt(snapshot, now + MAX_AGE_MS),
    { ...snapshot, state: "loading" }, { ...snapshot, broadcastId: "bad/id" }, { ...snapshot, sourceTime: null }]) {
    assert.equal(liveMedia(value), null);
  }
});

function thumbnailDocument() {
  const create = () => ({ hidden: true, naturalWidth: 640, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; } });
  const link = create();
  const image = create();
  const preloads = [];
  return { link, image, preloads,
    getElementById: (id) => id === "home-live-thumbnail" ? link : id === "home-live-thumbnail-image" ? image : null,
    createElement(tag) { assert.equal(tag, "img"); const preload = create(); preloads.push(preload); return preload; },
  };
}

test("thumbnail appears after a valid image loads, with no flash or duplicate fetch on refresh", () => {
  const doc = thumbnailDocument();
  const snapshot = normalizeSnapshot(payload(), { now });
  renderThumbnail(snapshot, doc);
  assert.equal(doc.link.hidden, true);
  assert.equal(doc.image.src, undefined);
  doc.preloads[0].onload();
  assert.equal(doc.link.hidden, false);
  assert.equal(doc.image.src, liveMedia(snapshot).imageUrl);
  assert.equal(doc.link.href, liveMedia(snapshot).liveUrl);
  renderThumbnail(snapshot, doc);
  assert.equal(doc.preloads.length, 1);
  const refreshed = normalizeSnapshot(payload(undefined, now + REFRESH_MS), { now: now + REFRESH_MS });
  renderThumbnail(refreshed, doc);
  assert.equal(doc.link.hidden, false);
  assert.equal(doc.image.src, liveMedia(snapshot).imageUrl);
  doc.preloads[1].onload();
  assert.equal(doc.image.src, liveMedia(refreshed).imageUrl);
});

test("ended or unknown broadcasts remove images and reject a late image load", () => {
  for (const state of ["offline", "error", "stale", "loading"]) {
    const doc = thumbnailDocument();
    renderThumbnail(normalizeSnapshot(payload(), { now }), doc);
    doc.preloads[0].onload();
    assert.equal(doc.link.hidden, false);
    renderThumbnail({ state }, doc);
    assert.equal(doc.link.hidden, true);
    assert.equal(doc.image.src, undefined);
    assert.equal(doc.link.href, undefined);
    doc.preloads[0].onload();
    assert.equal(doc.link.hidden, true);
  }
});

test("failed images stay hidden without changing LIVE, and old frames cannot leak to another broadcast", () => {
  const doc = thumbnailDocument();
  const snapshot = normalizeSnapshot(payload(), { now });
  renderThumbnail(snapshot, doc);
  doc.preloads[0].onerror();
  assert.equal(doc.link.hidden, true);
  assert.equal(snapshot.state, "live");
  const second = normalizeSnapshot(payload({ broad_no: 297757754 }, now + REFRESH_MS), { now: now + REFRESH_MS });
  renderThumbnail(second, doc);
  doc.preloads[0].onload();
  assert.equal(doc.link.hidden, true);
  doc.preloads[1].onload();
  assert.equal(doc.link.hidden, false);
  doc.image.onerror();
  assert.equal(doc.link.hidden, true);
  assert.equal(doc.image.src, undefined);
});

test("a failed thumbnail can retry on a manual refresh within the same source minute", () => {
  const doc = thumbnailDocument();
  const snapshot = normalizeSnapshot(payload(), { now });
  renderThumbnail(snapshot, doc);
  doc.preloads[0].onerror();
  renderThumbnail(snapshot, doc);
  assert.equal(doc.preloads.length, 2);
  assert.equal(doc.preloads[1].src, doc.preloads[0].src);
  doc.preloads[0].onload();
  assert.equal(doc.link.hidden, true);
  doc.preloads[1].onload();
  assert.equal(doc.link.hidden, false);
  assert.equal(doc.image.src, liveMedia(snapshot).imageUrl);
});

function clock() {
  let current = now;
  let id = 0;
  const timers = new Map();
  return {
    now: () => current,
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: current + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
    async tick(ms) {
      const end = current + ms;
      while (true) {
        const [key, timer] = [...timers.entries()].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0] || [];
        if (!timer) break;
        timers.delete(key);
        current = timer.at;
        timer.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      current = end;
    },
    count: () => timers.size,
  };
}

test("initial/manual/visibility requests dedupe and use one six-second timeout", async () => {
  const timer = clock();
  let calls = 0;
  let resolve;
  const states = [];
  const controller = createController({ ...timer, onChange: (value) => states.push(value.state), fetch: (_url, options) => {
    calls++;
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    return new Promise((done) => { resolve = done; });
  } });
  const first = controller.refresh();
  const second = controller.refresh();
  const third = controller.visibilityChanged();
  assert.equal(first, second);
  assert.equal(first, third);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(timer.count(), 1);
  resolve({ ok: true, json: async () => payload() });
  await first;
  assert.equal(controller.getSnapshot().state, "live");
  assert.equal(timer.count(), 2);
  assert.ok(states.includes("loading"));
  assert.equal(states.at(-1), "live");
  controller.stop();
  assert.equal(timer.count(), 0);
});

test("network, HTTP, JSON errors and timeouts stay unknown, never offline", async () => {
  for (const fetch of [async () => { throw new Error("network"); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })]) {
    const timer = clock();
    const controller = createController({ ...timer, fetch });
    await controller.refresh();
    assert.equal(controller.getSnapshot().state, "error");
    assert.equal(controller.getSnapshot().sourceTime, null);
    controller.stop();
  }
  const timer = clock();
  const controller = createController({ ...timer, fetch: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }) });
  const request = controller.refresh();
  await Promise.resolve();
  await timer.tick(REQUEST_TIMEOUT_MS);
  await request;
  assert.equal(controller.getSnapshot().state, "error");
  assert.equal(controller.getSnapshot().reason, "timeout");
  controller.stop();
});

test("hidden tabs stop polling, expire status, and revalidate on return", async () => {
  const timer = clock();
  let visible = true;
  let calls = 0;
  const states = [];
  const controller = createController({ ...timer, isVisible: () => visible, onChange: (value) => states.push(value.state),
    fetch: async () => { calls++; return { ok: true, json: async () => payload(null, timer.now()) }; },
  });
  await controller.refresh();
  assert.equal(controller.getSnapshot().state, "offline");
  visible = false;
  await controller.visibilityChanged();
  await timer.tick(MAX_AGE_MS);
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().state, "stale");
  assert.equal(states.at(-1), "stale");
  visible = true;
  await controller.visibilityChanged();
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().state, "offline");
  await timer.tick(REFRESH_MS);
  await Promise.resolve();
  assert.equal(calls, 3);
  controller.stop();
});

test("refresh preserves fresh status but cannot extend its lifetime while pending", async () => {
  const timer = clock();
  let calls = 0;
  let complete;
  const states = [];
  const controller = createController({ ...timer, onChange: (value, busy) => states.push({ state: value.state, busy }), fetch: async () => {
    if (++calls === 1) return { ok: true, json: async () => payload({ broad_no: 1 }, now - MAX_AGE_MS + 3000) };
    return new Promise((resolve) => { complete = resolve; });
  } });
  await controller.refresh();
  const refresh = controller.refresh();
  await Promise.resolve();
  assert.equal(controller.getSnapshot().state, "live");
  assert.deepEqual(states.at(-1), { state: "live", busy: true });
  await timer.tick(3000);
  assert.equal(controller.getSnapshot().state, "stale");
  assert.deepEqual(states.at(-1), { state: "stale", busy: true });
  complete({ ok: true, json: async () => payload(null, timer.now()) });
  await refresh;
  assert.equal(controller.getSnapshot().state, "offline");
  controller.stop();
});
