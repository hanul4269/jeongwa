"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the production functions with an isolated DOM and memory-only responses.
const source = fs.readFileSync(path.join(__dirname, "../script.js"), "utf8");
function section(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.notEqual(start, -1, `Missing production function: ${name}`);
  const rest = source.slice(start);
  const end = rest.search(/\n(?:async )?function \w+\(/);
  return end === -1 ? rest : rest.slice(0, end);
}
const declarations = ["upEvents", "activeUpEventId", "upRankingRefreshTimer", "upEventSaving", "upEventsLoadGeneration", "upRankingGeneration", "upRankingCache"]
  .map((name) => {
    const line = source.match(new RegExp(`^(?:let|const) ${name} = .*;$`, "m"));
    assert.ok(line, `Missing production state: ${name}`);
    return line[0];
  }).join("\n");
const functions = ["clean", "escapeHtml", "normalizeUrl", "normalizeUpEvent", "upEventFromRow", "parseSoopPostUrl",
  "activeUpEvents", "updateUpRankingButton", "renderUpEvents", "upRankingEvent", "renderUpRankingTabs",
  "renderUpRankingEvent", "rankingCommentUrl", "renderUpRankingList", "fetchSoopRanking", "refreshUpRanking",
  "closeUpRankingModal", "refreshSharedUpEvents"].map(section).join("\n");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const event = (overrides = {}) => ({
  id: "[테스트용]-event", tabName: "[테스트용] 탭", title: "[테스트용] 이벤트",
  soopUrl: "https://ch.sooplive.co.kr/test_only/post/100", sortOrder: 0, isActive: true, showOnStartup: false, ...overrides,
});
const commentResponse = (label) => ({ ok: true, json: async () => ({ data: [
  { pCommentNo: "[테스트용]-reply", userId: "[테스트용]-user", userNick: label, likeCnt: 3, regDate: "2026-10-22 10:00:00" },
], meta: { lastPage: 1 } }) });
const rankingResult = (label) => ({ ranking: [{ replyNo: "[테스트용]-reply", name: label, userId: "[테스트용]-user", likeCount: 3, rank: 1 }], updatedAt: "2026-10-22T01:00:00Z" });
const row = (item) => ({ id: item.id, tab_name: item.tabName, title: item.title, soop_url: item.soopUrl,
  sort_order: item.sortOrder, is_active: item.isActive, show_on_startup: item.showOnStartup });

function harness() {
  const nodes = new Map();
  const requests = [];
  const listRequests = [];
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: "", textContent: "", hidden: false });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    URL, Date, Map, console, $,
    AbortSignal: { timeout: () => ({}) },
    window: { clearInterval() {} },
    closeModal: (selector) => { $(selector).hidden = true; },
    maybeOpenStartupUpRanking() {},
    fetch(url) {
      const pending = deferred();
      requests.push({ url, ...pending });
      return pending.promise;
    },
    authDb: { from(table) {
      assert.equal(table, "up_events");
      const pending = deferred();
      listRequests.push(pending);
      let orders = 0;
      return { select() { return this; }, order() { return ++orders === 2 ? pending.promise : this; } };
    } },
  });
  vm.runInContext(`const legacyUpEvents = [];
    const SOOP_PROXY_URL = "https://[테스트용].invalid/proxy";
    ${declarations}\n${functions}
    globalThis.api = {
      fetchSoopRanking, refreshUpRanking, closeUpRankingModal, refreshSharedUpEvents,
      get events() { return upEvents; }, set events(value) { upEvents = value; },
      get cache() { return upRankingCache; },
      set rankingFetcher(value) { fetchSoopRanking = value; },
      set saving(value) { upEventSaving = value; },
      invalidateList() { ++upEventsLoadGeneration; }
    };`, context, { filename: "script.js UP event test sections" });
  return { api: context.api, nodes, $, requests, listRequests };
}

test("replacing the post or channel never reuses an old event-ID cache", async () => {
  for (const cachedPostKey of [undefined, "test_only/100"]) {
    for (const soopUrl of ["https://ch.sooplive.co.kr/test_only/post/200", "https://ch.sooplive.co.kr/test_other/post/100"]) {
      const h = harness();
      const current = event({ soopUrl });
      h.api.events = [current];
      h.api.cache.set(current.id, { ...rankingResult("[테스트용] 이전"), postKey: cachedPostKey, savedAt: Date.now() });
      const pending = h.api.fetchSoopRanking(current);
      assert.equal(h.requests.length, 1);
      h.requests[0].resolve(commentResponse("[테스트용] 새 게시글"));
      const result = await pending;
      assert.equal(result.ranking[0].name, "[테스트용] 새 게시글");
      assert.equal(h.api.cache.get(current.id), result);
    }
  }
});

test("changing only the highlight comment reuses the same post cache", async () => {
  const h = harness();
  const original = event();
  h.api.events = [original];
  const first = h.api.fetchSoopRanking(original);
  h.requests[0].resolve(commentResponse("[테스트용] 댓글"));
  const cached = await first;
  const highlighted = event({ soopUrl: `${original.soopUrl}#comment_noti123` });
  h.api.events = [highlighted];
  assert.equal(await h.api.fetchSoopRanking(highlighted), cached);
  assert.equal(h.requests.length, 1);
});

test("a late old-post response cannot replace the new post's cached ranking", async () => {
  const h = harness();
  const original = event();
  h.api.events = [original];
  const oldRequest = h.api.fetchSoopRanking(original);
  const replacement = event({ soopUrl: "https://ch.sooplive.co.kr/test_only/post/200" });
  h.api.events = [replacement];
  const newRequest = h.api.fetchSoopRanking(replacement);
  h.requests[1].resolve(commentResponse("[테스트용] 새 댓글"));
  const fresh = await newRequest;
  h.requests[0].resolve(commentResponse("[테스트용] 이전 댓글"));
  await oldRequest;
  assert.equal(h.api.cache.get(original.id), fresh);
  assert.equal(fresh.postKey, "test_only/200");
});

test("late responses cannot populate cache for a removed or inactive event", async () => {
  for (const remaining of [[], [event({ isActive: false })]]) {
    const h = harness();
    h.api.events = [event()];
    const pending = h.api.fetchSoopRanking(h.api.events[0]);
    h.api.events = remaining;
    h.requests[0].resolve(commentResponse("[테스트용] 늦은 댓글"));
    await pending;
    assert.equal(h.api.cache.size, 0);
  }
});

test("an older refresh success or error cannot overwrite a newer successful refresh", async () => {
  for (const oldFails of [false, true]) {
    const h = harness();
    h.api.events = [event()];
    const oldResponse = deferred();
    const newResponse = deferred();
    const queue = [oldResponse, newResponse];
    h.api.rankingFetcher = () => queue.shift().promise;
    const older = h.api.refreshUpRanking(true);
    const newer = h.api.refreshUpRanking(true);
    newResponse.resolve(rankingResult("[테스트용] 최신 순위"));
    await newer;
    const list = h.$("#up-ranking-list").innerHTML;
    const status = h.$("#up-ranking-updated").textContent;
    assert.match(list, /최신 순위/);
    if (oldFails) oldResponse.reject(new Error("[테스트용] 이전 요청 실패"));
    else oldResponse.resolve(rankingResult("[테스트용] 이전 순위"));
    await older;
    assert.equal(h.$("#up-ranking-list").innerHTML, list);
    assert.equal(h.$("#up-ranking-updated").textContent, status);
  }
});

test("closing or deactivating invalidates pending refresh successes and errors", async () => {
  for (const action of ["close", "deactivate"]) {
    for (const fails of [false, true]) {
      const h = harness();
      h.api.events = [event()];
      const response = deferred();
      h.api.rankingFetcher = () => response.promise;
      const pending = h.api.refreshUpRanking(true);
      if (action === "close") {
        h.api.closeUpRankingModal();
        assert.equal(h.$("#up-ranking-modal").hidden, true);
      } else {
        h.api.events = [event({ isActive: false })];
        await h.api.refreshUpRanking();
        assert.match(h.$("#up-ranking-list").innerHTML, /진행 중인 UP 이벤트가 없습니다/);
      }
      const list = h.$("#up-ranking-list").innerHTML;
      const status = h.$("#up-ranking-updated").textContent;
      if (fails) response.reject(new Error("[테스트용] 늦은 오류"));
      else response.resolve(rankingResult("[테스트용] 늦은 순위"));
      await pending;
      assert.equal(h.$("#up-ranking-list").innerHTML, list);
      assert.equal(h.$("#up-ranking-updated").textContent, status);
    }
  }
});

test("a shared list started before save cannot overwrite the locally saved event", async () => {
  for (const saveStillPending of [false, true]) {
    const h = harness();
    h.api.events = [event()];
    const pending = h.api.refreshSharedUpEvents();
    // The save path increments this revision before awaiting its DB response.
    h.api.invalidateList();
    h.api.saving = saveStillPending;
    const saved = event({ title: "[테스트용] 저장된 제목", soopUrl: "https://ch.sooplive.co.kr/test_only/post/200" });
    h.api.events = [saved];
    h.listRequests[0].resolve({ data: [row(event())], error: null });
    assert.equal(await pending, false);
    assert.equal(h.api.events[0], saved);
  }
});

test("saving suppresses new shared reads and newer list results beat older reads", async () => {
  const h = harness();
  h.api.saving = true;
  assert.equal(await h.api.refreshSharedUpEvents(), false);
  assert.equal(h.listRequests.length, 0);
  h.api.saving = false;
  const older = h.api.refreshSharedUpEvents();
  const newer = h.api.refreshSharedUpEvents();
  h.listRequests[1].resolve({ data: [row(event({ title: "[테스트용] 최신 목록" }))], error: null });
  assert.equal(await newer, true);
  h.listRequests[0].resolve({ data: [row(event({ title: "[테스트용] 이전 목록" }))], error: null });
  assert.equal(await older, false);
  assert.equal(h.api.events[0].title, "[테스트용] 최신 목록");
  assert.match(h.$("#up-event-list").innerHTML, /최신 목록/);
});
