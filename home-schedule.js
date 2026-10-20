(() => {
  "use strict";
  const section = document.querySelector("#home-schedule");
  const model = window.JeongwaCalendar, store = window.jeongwaCalendarStore;
  if (!section || !model || !store) return;
  const $ = selector => section.querySelector(selector);
  const visible = () => document.body.dataset.siteView === "home" && !document.hidden;
  const text = (tag, value, className) => {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const shortDate = date => `${Number(date.slice(5,7))}월 ${Number(date.slice(8))}일 (${["일","월","화","수","목","금","토"][model.weekday(date)]})`;
  let todayRows = [], nextRows = [], dataDate = "", loadingDate = "";
  let hasData = false, loading = false, error = "", requestId = 0, timer;

  function card(record, upcoming) {
    const item = document.createElement("li");
    const button = text("button", "", "home-schedule-card");
    button.type = "button"; button.dataset.homeScheduleDate = record.event_date; button.dataset.homeScheduleId = record.id;
    button.setAttribute("aria-label", [shortDate(record.event_date), record.start_time, model.kinds[record.kind], record.title, "캘린더에서 보기"].filter(Boolean).join(" · "));
    if (upcoming || record.start_time) {
      const when = text("p", "", "home-schedule-when");
      if (upcoming) {
        const date = text("time", shortDate(record.event_date)); date.dateTime = record.event_date; when.append(date);
      }
      if (record.start_time) {
        if (upcoming) when.append(document.createTextNode(" · "));
        const time = text("time", record.start_time); time.dateTime = `${record.event_date}T${record.start_time}:00+09:00`; when.append(time);
      }
      button.append(when);
    }
    const titleLine = text("div", "", "home-schedule-title-line");
    const kind = text("span", model.kinds[record.kind], "home-schedule-kind"); kind.dataset.kind = record.kind;
    titleLine.append(kind, text("strong", record.title, "home-schedule-title")); button.append(titleLine);
    if (record.subtitle) button.append(text("p", record.subtitle, "home-schedule-subtitle"));
    if (record.collab_members) button.append(text("p", "함께 · " + record.collab_members, "home-schedule-members"));
    item.append(button); return item;
  }
  function renderList(node, rows, upcoming) {
    node.replaceChildren();
    if (hasData && rows.length) { rows.forEach(record => node.append(card(record, upcoming))); return; }
    const message = !hasData ? (error ? "일정을 확인할 수 없어요." : "일정을 불러오고 있어요.")
      : upcoming ? "다음 일정이 아직 등록되지 않았어요." : "오늘 등록된 일정이 없어요.";
    node.append(text("li", message, "home-schedule-empty"));
  }
  function render() {
    const currentDate = model.today();
    if (dataDate !== currentDate) { hasData = false; todayRows = []; nextRows = []; }
    const focused = document.activeElement?.closest?.("[data-home-schedule-id]");
    const focusedId = section.contains(focused) ? focused.dataset.homeScheduleId : null;
    $("#home-schedule-today-date").textContent = shortDate(currentDate);
    $("#home-schedule-today-date").dateTime = currentDate;
    section.dataset.state = error ? (hasData ? "stale" : "error") : !hasData ? "loading" : "ready";
    section.setAttribute("aria-busy", String(loading && !hasData));
    renderList($("#home-schedule-today-list"), todayRows, false);
    renderList($("#home-schedule-next-list"), nextRows, true);
    const status = $("#home-schedule-status");
    status.textContent = error ? `${error}${hasData ? " 마지막으로 확인한 일정을 표시하고 있어요." : ""}` : !hasData ? "캘린더에서 일정을 불러오고 있어요." : "";
    status.hidden = !status.textContent; status.dataset.error = String(Boolean(error));
    if (focusedId && visible()) {
      ([...section.querySelectorAll("[data-home-schedule-id]")].find(button => button.dataset.homeScheduleId === focusedId) || $("#home-schedule-calendar"))?.focus({ preventScroll: true });
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (!visible()) return;
    const midnight = Date.parse(model.shift(model.today(), 1) + "T00:00:00+09:00");
    timer = setTimeout(refresh, Math.max(100, Math.min(60000, midnight - Date.now() + 50)));
  }
  function normalized(rows, date, upcoming) {
    if (!Array.isArray(rows)) throw new Error("Invalid calendar response");
    const active = rows.filter(row => !row?.is_deleted), result = model.sortEvents(active);
    if (result.length !== active.length || result.some(row => upcoming ? row.event_date <= date : row.event_date !== date)
      || new Set(result.map(row => row.id)).size !== result.length || result.some(row => typeof row.id !== "string" || !row.id)) throw new Error("Invalid calendar response");
    return upcoming ? result.slice(0,3) : result;
  }
  async function refresh() {
    if (!visible()) return;
    const date = model.today();
    if (loading && loadingDate === date) return;
    const id = ++requestId;
    if (dataDate !== date) { hasData = false; todayRows = []; nextRows = []; }
    loading = true; loadingDate = date; error = ""; render();
    try {
      if (typeof store.loadHome !== "function") throw Object.assign(new Error(), { code: "NOT_READY" });
      const result = await store.loadHome(date, 3);
      if (id !== requestId || !visible()) return;
      if (model.today() !== date) { loading = false; await refresh(); return; }
      const today = normalized(result?.today, date, false), next = normalized(result?.upcoming, date, true);
      todayRows = today; nextRows = next; dataDate = date; hasData = true; loading = false; error = ""; render();
    } catch (cause) {
      if (id !== requestId || !visible()) return;
      if (model.today() !== date) { loading = false; await refresh(); return; }
      loading = false;
      error = cause.code === "NOT_READY" ? "일정 서비스를 준비하고 있어요." : "일정을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.";
      render();
    } finally { if (id === requestId) { loading = false; schedule(); } }
  }
  section.addEventListener("click", event => {
    const button = event.target.closest("[data-home-schedule-date][data-home-schedule-id]");
    if (!button || !model.validDate(button.dataset.homeScheduleDate)) return;
    window.dispatchEvent(new CustomEvent("jeongwa:calendar-open-date", { detail: { date: button.dataset.homeScheduleDate, eventId: button.dataset.homeScheduleId } }));
    if (window.jeongwaNavigation?.navigate) window.jeongwaNavigation.navigate("calendar", { top: 0 });
    else location.hash = "calendar";
  });
  function onVisibility() {
    clearTimeout(timer);
    if (visible()) refresh();
    else { ++requestId; loading = false; }
  }
  window.addEventListener("jeongwa:view-change", onVisibility);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", () => { if (visible()) refresh(); });
  window.addEventListener("focus", () => { if (visible()) refresh(); });
  window.addEventListener("jeongwa:auth-change", () => { if (visible()) refresh(); });
  render(); onVisibility();
})();
