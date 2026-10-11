(() => {
  "use strict";
  const session = window.JeongwaSongbookSession;
  const app = window.jeongwaSongbook;
  if (!session || !app) return;
  let storage;
  try { storage = window.sessionStorage; } catch { storage = null; }
  const saved = session.read(storage, session.sessionKey) || {};
  const scrollByView = Object.fromEntries(["home", "songs", "game"].map(view => [view, session.scroll(saved.scroll?.[view])]));
  const homeInput = document.querySelector("#home-song-search");
  let currentView = session.viewForHash(location.hash);
  let currentUrl = location.href;
  let applying = false;
  let scrollTicket = 0;
  let scrollPending = false;
  let intendedScroll = null;
  const buttons = [...document.querySelectorAll("[data-site-view]")];
  const frame = document.querySelector("#game-frame");

  function getSnapshot() {
    return session.snapshot({
      version: 1, view: currentView, songbook: app.getState(),
      scrollY: intendedScroll ?? window.scrollY, homeQuery: homeInput?.value || "",
    });
  }

  function persist() {
    if (applying) return;
    const value = getSnapshot();
    scrollByView[currentView] = value.scrollY;
    history.replaceState({ ...history.state, jeongwa: value }, "");
    session.write(storage, session.sessionKey, {
      songbook: value.songbook, scroll: scrollByView, homeQuery: value.homeQuery,
    });
  }

  function restoreScroll(top) {
    const ticket = ++scrollTicket;
    intendedScroll = session.scroll(top);
    requestAnimationFrame(() => {
      if (ticket !== scrollTicket) return;
      window.scrollTo({ top: intendedScroll, behavior: "instant" });
      // Favorites and shared-only results may initially be empty. Keep the
      // destination until their first load settles instead of saving a clamp.
      if (currentView !== "songs" || app.isReady()) intendedScroll = null;
      persist();
    });
  }

  function cancelScrollRestoration() {
    ++scrollTicket;
    intendedScroll = null;
  }

  function updateHomeCatalog(count) {
    const label = document.querySelector("#home-song-count");
    if (label) label.textContent = !app.isReady() ? "노래책을 불러오는 중" : count > 0 ? `총 ${count.toLocaleString("ko-KR")}곡` : "등록된 곡이 없습니다";
    const random = document.querySelector("#home-random");
    if (random) random.disabled = !app.isReady() || count === 0;
  }

  function showView(view, top = 0) {
    currentView = view;
    currentUrl = location.href;
    document.body.dataset.siteView = view;
    for (const [selector, visible] of [
      ["#home-section", view === "home"],
      [".intro", view === "songs"], [".songbook", view === "songs"],
      ["#game-section", view === "game"],
    ]) {
      const element = document.querySelector(selector);
      if (element) element.hidden = !visible;
    }
    buttons.forEach(button => {
      const active = button.dataset.siteView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (view === "game" && frame && !frame.getAttribute("src")) frame.src = frame.dataset.src;
    restoreScroll(top);
    window.dispatchEvent(new CustomEvent("jeongwa:view-change", { detail: { view } }));
  }

  function applySnapshot(value) {
    applying = true;
    app.applyState(value.songbook);
    if (homeInput) homeInput.value = value.homeQuery;
    showView(value.view, value.scrollY);
    applying = false;
  }

  function navigate(view, options = {}) {
    if (!["home", "songs", "game"].includes(view)) return;
    persist();
    const previousView = currentView;
    applying = true;
    if (typeof options.query === "string") app.search(options.query);
    if (view === "home" && previousView !== "home" && homeInput) homeInput.value = app.getState().query;
    const value = session.snapshot({
      version: 1, view, songbook: app.getState(),
      scrollY: options.top ?? scrollByView[view], homeQuery: homeInput?.value || "",
    });
    const url = `${location.pathname}${location.search}#${view}`;
    if (view !== previousView || location.hash !== `#${view}` || typeof options.query === "string") {
      history.pushState({ jeongwa: value }, "", url);
    } else history.replaceState({ ...history.state, jeongwa: value }, "", url);
    showView(view, value.scrollY);
    applying = false;
    session.write(storage, session.sessionKey, {
      songbook: value.songbook, scroll: { ...scrollByView, [view]: value.scrollY }, homeQuery: value.homeQuery,
    });
    if (options.focusSearch) {
      cancelScrollRestoration();
      document.querySelector("#song-search")?.focus({ preventScroll: true });
      document.querySelector(".songbook")?.scrollIntoView({ block: "start" });
      persist();
    }
  }

  function onHistoryChange(event) {
    if (event.type === "hashchange" && currentUrl === location.href) return;
    const view = session.viewForHash(location.hash);
    const value = session.snapshot(history.state?.jeongwa);
    if (value && value.view === view) applySnapshot(value);
    else {
      showView(view, location.hash === "#top" ? 0 : scrollByView[view]);
      persist();
    }
  }

  window.jeongwaNavigation = {
    navigate,
    prepareLogin() { persist(); session.saveAuth(storage, getSnapshot()); },
    cancelLogin() { session.clearAuth(storage); },
    finishLogin(success) {
      const value = session.takeAuth(storage, success);
      if (!value) return;
      history.replaceState({ ...history.state, jeongwa: value }, "", `${location.pathname}${location.search}#${value.view}`);
      applySnapshot(value);
      session.write(storage, session.sessionKey, {
        songbook: value.songbook, scroll: { ...scrollByView, [value.view]: value.scrollY }, homeQuery: value.homeQuery,
      });
    },
  };

  buttons.forEach(button => button.addEventListener("click", event => {
    event.preventDefault();
    navigate(button.dataset.siteView);
  }));
  document.addEventListener("click", event => {
    const link = event.target.closest('a[href="#home"], a[href="#songs"], a[href="#game"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.hash.slice(1));
  });
  document.querySelector("#home-song-search-form")?.addEventListener("submit", event => {
    event.preventDefault();
    navigate("songs", { query: homeInput?.value || "", top: 0, focusSearch: true });
  });
  homeInput?.addEventListener("input", persist);
  document.querySelector("#home-random")?.addEventListener("click", () => app.openRandom());
  document.querySelectorAll("[data-open-site-updates]").forEach(button => button.addEventListener("click", () => app.openUpdates()));
  document.querySelectorAll("[data-open-song-guide]").forEach(button => button.addEventListener("click", () => app.openGuide()));
  document.querySelectorAll("[data-open-song-rules]").forEach(button => button.addEventListener("click", () => {
    navigate("songs", { top: 0 });
    cancelScrollRestoration();
    const guide = document.querySelector("#song-request-guide");
    guide?.focus({ preventScroll: true });
    guide?.scrollIntoView({ block: "start" });
    persist();
  }));


  window.addEventListener("jeongwa:songbook-change", event => {
    updateHomeCatalog(event.detail.count);
    if (currentView === "songs" && homeInput && !applying) homeInput.value = event.detail.state.query;
    persist();
  });
  window.addEventListener("jeongwa:songbook-ready", () => {
    updateHomeCatalog(app.count());
    if (intendedScroll !== null) restoreScroll(intendedScroll);
  });
  // A deliberate interaction takes precedence over a delayed automatic restore.
  const onUserInteraction = () => {
    if (intendedScroll !== null) {
      cancelScrollRestoration();
      persist();
    }
  };
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    window.addEventListener(type, onUserInteraction, { capture: true, passive: true });
  }
  window.addEventListener("scroll", () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => { scrollPending = false; persist(); });
  }, { passive: true });
  window.addEventListener("pagehide", persist);
  window.addEventListener("popstate", onHistoryChange);
  window.addEventListener("hashchange", onHistoryChange);
  window.addEventListener("message", event => {
    if (!frame || event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== "jeongwa-game-height") return;
    const height = event.data.height;
    if (Number.isFinite(height) && height > 0 && height < 10000) frame.style.height = `${height + 2}px`;
  });

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const entry = session.snapshot(history.state?.jeongwa);
  const initial = entry && entry.view === currentView ? entry : {
    version: 1, view: currentView, songbook: saved.songbook || app.getState(),
    scrollY: location.hash === "#top" ? 0 : scrollByView[currentView], homeQuery: session.text(saved.homeQuery),
  };
  applySnapshot(initial);
  history.replaceState({ ...history.state, jeongwa: session.snapshot(initial) }, "");
  updateHomeCatalog(app.count());
})();
