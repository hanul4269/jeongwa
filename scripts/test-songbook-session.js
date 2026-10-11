const assert = require("node:assert/strict");
const test = require("node:test");
const session = require("../songbook-session.js");

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

function target() {
  return { version: 1, view: "songs", scrollY: 560, homeQuery: "밤", songbook: { query: "밤", category: "K-POP", selectedTags: ["발라드"], favoritesOnly: true, viewMode: "album" } };
}

test("root is HOME while all legacy songbook fragments still work", () => {
  for (const hash of ["", "#home"]) assert.equal(session.viewForHash(hash), "home");
  assert.equal(session.viewForHash("#game"), "game");
  for (const hash of ["#songs", "#top", "#old-bookmark"]) assert.equal(session.viewForHash(hash), "songs");
});

test("OAuth return preserves approved UI state and strips URLs and tokens", () => {
  const storage = memoryStorage();
  session.saveAuth(storage, { ...target(), url: "https://evil.example", access_token: "secret", songbook: { ...target().songbook, refresh_token: "secret" } }, 100);
  const serialized = storage.getItem(session.authKey);
  assert(!serialized.includes("secret"));
  assert(!serialized.includes("evil.example"));
  assert.deepEqual(session.takeAuth(storage, true, 200), target());
  assert.equal(session.takeAuth(storage, true, 201), null, "a callback cannot replay a consumed target");
});

test("failure, expiry, future timestamps and unsafe destinations do not restore", () => {
  for (const [success, now] of [[false, 200], [true, session.authMaxAge + 101], [true, 99]]) {
    const storage = memoryStorage();
    session.saveAuth(storage, target(), 100);
    assert.equal(session.takeAuth(storage, success, now), null);
    assert.equal(storage.getItem(session.authKey), null);
  }
  const storage = memoryStorage();
  session.saveAuth(storage, { ...target(), view: "https://evil.example" }, 100);
  assert.equal(session.takeAuth(storage, true, 200), null);
});

test("damaged or unavailable browser storage leaves defaults usable", () => {
  assert.equal(session.read(null, session.sessionKey), null);
  assert.doesNotThrow(() => session.write(null, session.sessionKey, target()));
  assert.doesNotThrow(() => session.clearAuth(null));
  const storage = memoryStorage();
  storage.setItem(session.authKey, "{broken");
  assert.equal(session.takeAuth(storage, true), null);
  assert.deepEqual(session.songbook({ category: "invalid", favoritesOnly: "true", viewMode: "invalid", selectedTags: ["태그", "태그", null] }), {
    query: "", category: "전체", favoritesOnly: false, viewMode: "list", selectedTags: ["태그"],
  });
});
