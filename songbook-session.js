(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JeongwaSongbookSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const sessionKey = "jeongwa-songbook-session-v1";
  const authKey = "jeongwa-oauth-return-v1";
  const authMaxAge = 30 * 60 * 1000;
  const views = ["home", "songs", "game"];
  const categories = ["전체", "K-POP", "J-POP", "POP/OST", "숙제곡"];
  const text = value => typeof value === "string" ? value.slice(0, 1000) : "";
  const scroll = value => Number.isFinite(value) ? Math.max(0, Math.min(value, 10000000)) : 0;

  function songbook(value = {}) {
    return {
      query: text(value?.query),
      category: categories.includes(value?.category) ? value.category : "전체",
      selectedTags: Array.isArray(value?.selectedTags)
        ? [...new Set(value.selectedTags.filter(tag => typeof tag === "string").map(tag => tag.slice(0, 80)))].slice(0, 30)
        : [],
      favoritesOnly: value?.favoritesOnly === true,
      viewMode: value?.viewMode === "album" ? "album" : "list",
    };
  }

  function snapshot(value) {
    if (!value || value.version !== 1 || !views.includes(value.view)) return null;
    return {
      version: 1,
      view: value.view,
      songbook: songbook(value.songbook),
      scrollY: scroll(value.scrollY),
      homeQuery: text(value.homeQuery),
    };
  }

  function viewForHash(hash) {
    if (!hash || hash === "#home") return "home";
    if (hash === "#game") return "game";
    // Older bookmarks (including #top) historically opened the songbook.
    return "songs";
  }

  function read(storage, key) {
    try { return JSON.parse(storage.getItem(key)); } catch { return null; }
  }

  function write(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ }
  }

  function clearAuth(storage) {
    try { storage.removeItem(authKey); } catch { /* Keep navigation usable without storage. */ }
  }

  function saveAuth(storage, value, now = Date.now()) {
    const safe = snapshot(value);
    if (safe) write(storage, authKey, { createdAt: now, snapshot: safe });
  }

  function takeAuth(storage, success, now = Date.now()) {
    const saved = read(storage, authKey);
    clearAuth(storage);
    if (!success || !saved || !Number.isFinite(saved.createdAt)
      || now < saved.createdAt || now - saved.createdAt > authMaxAge) return null;
    return snapshot(saved.snapshot);
  }

  return { sessionKey, authKey, authMaxAge, songbook, snapshot, viewForHash, scroll, text, read, write, saveAuth, takeAuth, clearAuth };
});
