"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const notices = require("../soop-notices.js");
const post = (id, date = "2026-10-11 15:31:54", extra = {}) => ({ title_no: id, station_no: 27493430, bbs_no: 103532627, auth_no: 101, user_id: "jeongwazzang", title_name: `공지 ${id}`, reg_date: date, ...extra });
const payload = (...data) => ({ data });
const response = (body, ok = true) => ({ ok, json: async () => body });
function harness(overrides = {}) {
  let time = Date.parse("2026-10-12T01:50:00+09:00");
  let visible = true;
  let next = 0;
  const timers = new Map();
  const changes = [];
  const controller = notices.createController({
    now: () => time, isVisible: () => visible,
    setTimeout: (fn, delay) => { timers.set(++next, { fn, delay }); return next; },
    clearTimeout: (id) => timers.delete(id), onChange: (snapshot, busy) => changes.push({ snapshot, busy }),
    fetch: async () => response(payload(post(1))), ...overrides,
  });
  return { controller, timers, changes, advance(ms) { time += ms; }, visible(value) { visible = value; } };
}

test("only public channel notices are used, deduplicated and newest three sorted", () => {
  const result = notices.normalizeNotices(payload(
    post(10, "2026-10-08 10:00:00"), post(12, "2026-10-11 11:00:00"), post(14, "2026-10-12 12:00:00"),
    post(13, "2026-10-11 12:00:00"), post(14, "2026-10-12 12:00:00"),
    post(99, "2026-10-12 12:00:00", { bbs_no: 103609821 }),
    post(98, "2026-10-12 12:00:00", { auth_no: 103 }),
    post(97, "2026-10-12 12:00:00", { user_id: "other" }),
    post(96, "2026-10-12 12:00:00", { station_no: 123 }),
  ));
  assert.deepEqual(result.map((item) => item.id), ["14", "13", "12"]);
  assert.equal(result[0].url, "https://ch.sooplive.co.kr/jeongwazzang/post/14");
  assert.equal(result[0].dateTime, "2026-10-12T12:00:00+09:00");
  assert.equal(result[0].label, "2026.10.12");
});

test("empty is distinct from API errors, invalid and foreign-only lists", () => {
  assert.deepEqual(notices.normalizeNotices({ data: [] }), []);
  for (const body of [null, [], {}, { data: {} }, { code: -1000, data: [] }, payload(post(1, undefined, { bbs_no: 99 }))]) {
    assert.throws(() => notices.normalizeNotices(body));
  }
});

test("invalid dates and IDs cannot fabricate links or reorder notices", () => {
  const result = notices.normalizeNotices(payload(post(1), post("javascript:alert(1)"), post("9007199254740992"), post(3, "2026-02-30 12:00:00"), post(4, "2026-10-10 24:00:00")));
  assert.equal(result.length, 1);
  assert.equal(notices.parseDate("2026-10-11 15:31:54").timestamp, Date.parse("2026-10-11T15:31:54+09:00"));
  assert.equal(notices.parseDate("2026-10-11T15:31:54Z"), null);
});

test("fetch uses verified board path without credentials and concurrent refresh deduplicates", async () => {
  let resolve;
  let calls = 0;
  const h = harness({ fetch: (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get("url"), notices.SOURCE_URL);
    assert.match(notices.SOURCE_URL, /\/board\/103532627\?/);
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return new Promise((done) => { resolve = done; });
  } });
  const first = h.controller.refresh();
  assert.equal(h.controller.refresh(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(h.changes[0].busy, true);
  resolve(response(payload(post(1))));
  assert.equal((await first).state, "ready");
  assert.equal(h.changes.at(-1).busy, false);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, notices.REFRESH_MS);
  h.controller.stop();
});

test("HTTP failures preserve previous notices and successful retry replaces them", async () => {
  let step = 0;
  const h = harness({ fetch: async () => {
    step++;
    if (step === 1) return response(payload(post(1)));
    if (step === 2) return response({}, false);
    return response(payload(post(2)));
  } });
  await h.controller.refresh();
  const firstCheck = h.controller.getSnapshot().checkedAt;
  h.advance(60000);
  const failed = await h.controller.refresh();
  assert.equal(failed.state, "error");
  assert.equal(failed.items[0].id, "1");
  assert.equal(failed.checkedAt, firstCheck);
  const recovered = await h.controller.refresh();
  assert.equal(recovered.state, "ready");
  assert.equal(recovered.items[0].id, "2");
  assert.ok(recovered.checkedAt > firstCheck);
  h.controller.stop();
});

test("initial network failure, malformed API and empty response have separate outcomes", async () => {
  for (const [fetch, expected] of [
    [async () => { throw new Error("network"); }, "error"],
    [async () => response({ code: -1000, message: "Invalid access" }), "error"],
    [async () => response(payload()), "empty"],
  ]) {
    const h = harness({ fetch });
    const result = await h.controller.refresh();
    assert.equal(result.state, expected);
    assert.deepEqual(result.items, []);
    h.controller.stop();
  }
});

test("a slow request times out independently and clears busy state", async () => {
  const h = harness({ fetch: async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })));
  }) });
  const pending = h.controller.refresh();
  await Promise.resolve();
  [...h.timers.values()].find(({ delay }) => delay === notices.REQUEST_TIMEOUT_MS).fn();
  const result = await pending;
  assert.equal(result.state, "error");
  assert.equal(result.reason, "timeout");
  assert.equal(h.changes.at(-1).busy, false);
  h.controller.stop();
});

test("hidden tabs pause polling and stale tab return refreshes", async () => {
  let calls = 0;
  const h = harness({ fetch: async () => { calls++; return response(payload(post(1))); } });
  await h.controller.refresh();
  h.visible(false);
  await h.controller.visibilityChanged();
  assert.equal(h.timers.size, 0);
  h.advance(notices.REFRESH_MS);
  h.visible(true);
  await h.controller.visibilityChanged();
  assert.equal(calls, 2);
  h.controller.stop();
  assert.equal(h.timers.size, 0);
  await h.controller.refresh();
  assert.equal(calls, 2);
});

class Element {
  constructor(tagName) { this.tagName = tagName; this.dataset = {}; this.attributes = {}; this.children = []; this.textContent = ""; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
function documentFixture() {
  const ids = Object.fromEntries(["home-soop-notices", "home-soop-notices-list", "home-soop-notices-status", "home-soop-notices-all"].map((id) => [id, new Element("div")]));
  return { ids, getElementById: (id) => ids[id], createElement: (tag) => new Element(tag) };
}
test("render treats markup as plain text, creates only trusted links and preserves rows during refresh", () => {
  const doc = documentFixture();
  const title = '<img src=x onerror="alert(1)">';
  const snapshot = { state: "ready", items: notices.normalizeNotices(payload(post(1, undefined, { title_name: title, url: "javascript:alert(1)" }))), checkedAt: Date.parse("2026-10-12T01:50:00+09:00") };
  notices.render(snapshot, false, doc);
  const row = doc.ids["home-soop-notices-list"].children[0];
  const link = row.children[0];
  assert.equal(link.children[0].textContent, title);
  assert.equal(link.href, "https://ch.sooplive.co.kr/jeongwazzang/post/1");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(doc.ids["home-soop-notices-all"].href, notices.BOARD_URL);
  assert.equal(doc.ids["home-soop-notices-status"].textContent, "최근 공지 1개 · 자동 업데이트");
  notices.render(snapshot, true, doc);
  assert.equal(doc.ids["home-soop-notices-list"].children[0], row);
  assert.equal(doc.ids["home-soop-notices-status"].textContent, "최근 공지 1개 · 자동 업데이트");
});

test("render distinguishes empty and failure and exposes retained data as previous notices", () => {
  const doc = documentFixture();
  notices.render({ state: "empty", items: [], checkedAt: Date.now() }, false, doc);
  assert.match(doc.ids["home-soop-notices-status"].textContent, /등록된 방송공지가 없어요/);
  notices.render({ state: "error", items: [], checkedAt: null }, false, doc);
  assert.match(doc.ids["home-soop-notices-status"].textContent, /불러오지 못했어요/);
  notices.render({ state: "error", items: notices.normalizeNotices(payload(post(1))), checkedAt: Date.now() }, false, doc);
  assert.match(doc.ids["home-soop-notices-status"].textContent, /마지막 공지.*자동으로 재시도/);
  assert.equal(doc.ids["home-soop-notices"].dataset.state, "error");
});

test("automatic refresh inserts a newly published notice and keeps only the newest three", async () => {
  let latest = false;
  const h = harness({ fetch: async () => response(payload(
    ...(latest ? [post(4, "2026-10-12 02:00:00")] : []),
    post(3, "2026-10-11 15:00:00"), post(2, "2026-10-10 15:00:00"), post(1, "2026-10-09 15:00:00"),
  )) });
  assert.equal(notices.REFRESH_MS, 60000);
  await h.controller.refresh();
  latest = true;
  h.advance(notices.REFRESH_MS);
  const poll = [...h.timers.values()].find(({ delay }) => delay === notices.REFRESH_MS);
  await poll.fn();
  assert.deepEqual(h.controller.getSnapshot().items.map(({ id }) => id), ["4", "3", "2"]);
  h.controller.stop();
});

test("inactive HOME starts without a request and returning fresh waits only the remaining interval", async () => {
  let calls = 0;
  const h = harness({ fetch: async () => { calls++; return response(payload(post(1))); } });
  h.visible(false);
  await h.controller.refresh();
  assert.equal(calls, 0);
  h.visible(true);
  await h.controller.visibilityChanged();
  assert.equal(calls, 1);
  h.visible(false);
  await h.controller.visibilityChanged();
  h.advance(10000);
  h.visible(true);
  await h.controller.visibilityChanged();
  assert.equal(calls, 1);
  assert.equal([...h.timers.values()][0].delay, 50000);
  h.controller.stop();
});

test("unchanged automatic responses reuse DOM rows; changed notices replace rows with quiet status", () => {
  const doc = documentFixture();
  const snapshot = { state: "ready", items: notices.normalizeNotices(payload(post(1))), checkedAt: Date.now() };
  notices.render(snapshot, false, doc);
  const original = doc.ids["home-soop-notices-list"].children[0];
  const text = doc.ids["home-soop-notices-status"].textContent;
  notices.render({ ...snapshot, checkedAt: snapshot.checkedAt + 60000 }, true, doc);
  notices.render({ ...snapshot, checkedAt: snapshot.checkedAt + 60000 }, false, doc);
  assert.equal(doc.ids["home-soop-notices-list"].children[0], original);
  assert.equal(doc.ids["home-soop-notices-status"].textContent, text);
  notices.render({ ...snapshot, items: notices.normalizeNotices(payload(post(2))) }, false, doc);
  assert.notEqual(doc.ids["home-soop-notices-list"].children[0], original);
  assert.equal(doc.ids["home-soop-notices-status"].textContent, text);
});
