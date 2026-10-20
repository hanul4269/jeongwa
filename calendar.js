(() => {
  "use strict";
  const model = window.JeongwaCalendar;
  const store = window.jeongwaCalendarStore;
  const section = document.querySelector("#calendar-section");
  if (!model || !store || !section) return;
  const $ = selector => section.querySelector(selector);
  const dialog = document.querySelector("#calendar-editor");
  const form = dialog.querySelector("form");
  const field = name => form.elements.namedItem(name);
  const formStatus = dialog.querySelector("#calendar-form-status");
  const dayDetails = $("#calendar-day-details");
  let detailsReturnFocus, pendingCalendarOpen = null;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem("jeongwa-calendar-view-v1")); } catch { /* Storage is optional. */ }
  let selected = model.validDate(saved?.date) ? saved.date : model.today();
  let mode = saved?.mode === "week" ? "week" : "month";
  let events = [], hasData = false, loading = false, error = "", requestId = 0, timer;
  let editing = null, draftId = null, busy = false, removed = null, fetchedRange = "", returnFocus, renderedToday = "";
  const visible = () => document.body.dataset.siteView === "calendar" && !document.hidden;
  const currentRange = () => model.range(selected, mode);
  const rangeKey = range => range.start + "/" + range.end;
  const forDay = date => events.filter(event => event.event_date === date);
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const clipboardKey = "jeongwa-calendar-clipboard-v1";
  const copyFields = ["event_date", "start_time", "kind", "title", "subtitle", "collab_members", "description", "link_url"];
  let clipboard = readClipboard(), activeEventId = null, menuTarget = null;
  let actionBusy = false, dragState = null, dropPlan = null, suppressClickUntil = 0, noticeTimer;
  function copyValues(record) {
    if (!record || !model.validDate(record.event_date) || !Object.hasOwn(model.kinds, record.kind) || typeof record.title !== "string" || !record.title.trim()) return null;
    const value = Object.fromEntries(copyFields.map(key => [key, record[key] ?? (key === "start_time" ? null : "")]));
    if (copyFields.filter(key => key !== "start_time").some(key => typeof value[key] !== "string") || (value.start_time !== null && typeof value.start_time !== "string")) return null;
    if (value.title.length > 120 || value.subtitle.length > 200 || value.collab_members.length > 500 || value.description.length > 2000 || value.link_url.length > 2000) return null;
    if (value.start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start_time)) return null;
    return value;
  }
  function readClipboard() {
    try { return copyValues(JSON.parse(sessionStorage.getItem(clipboardKey))); } catch { return null; }
  }
  function renderClipboard() {
    $("#calendar-edit-help").hidden = !store.canEdit();
    $("#calendar-clipboard-bar").hidden = !store.canEdit() || !clipboard;
    $("#calendar-clipboard-title").textContent = clipboard ? `‘${clipboard.title}’ 복사됨` : "";
    $("#calendar-paste-selected").textContent = `${Number(selected.slice(5,7))}월 ${Number(selected.slice(8))}일에 붙여넣기`;
    $("#calendar-paste-selected").disabled = actionBusy || busy;
  }
  function notice(message, failed = false) {
    clearTimeout(noticeTimer);
    const node = $("#calendar-action-status");
    node.textContent = message; node.hidden = !message; node.dataset.error = String(failed);
    const detailsStatus = $("#calendar-details-status");
    detailsStatus.textContent = message; detailsStatus.hidden = !dayDetails.open || !message; detailsStatus.dataset.error = String(failed);
    if (message && !failed) noticeTimer = setTimeout(() => { node.hidden = true; detailsStatus.hidden = true; }, 7000);
  }
  function copyEvent(record) {
    if (!store.canEdit()) return;
    const value = copyValues(record);
    if (!value) { notice("복사할 일정 내용을 확인해 주세요.", true); return; }
    clipboard = value;
    try { sessionStorage.setItem(clipboardKey, JSON.stringify(value)); } catch { /* In-memory copying still works. */ }
    renderClipboard(); notice(`‘${value.title}’ 일정을 복사했어요. 붙여넣을 날짜를 선택해 주세요.`);
  }
  function pasteEvent(date = selected, source = clipboard) {
    if (!store.canEdit() || busy || actionBusy || !source || !model.validDate(date)) return;
    selectDate(date);
    openEditor(null, { ...source, event_date: date });
    dialog.querySelector("#calendar-editor-title").textContent = "복사한 일정 추가";
  }
  function activeRecord(target) {
    const id = target?.closest?.("[data-calendar-event],[data-event-id]")?.dataset;
    return events.find(row => row.id === (id?.calendarEvent || id?.eventId));
  }
  function closeMenu(focus = false) {
    const previous = menuTarget; menuTarget = null;
    $("#calendar-context-menu").hidden = true;
    if (focus && previous) {
      const target = previous.id ? $("#calendar-days").querySelector(`[data-calendar-event="${previous.id}"]`) : null;
      (target || $("#calendar-days").querySelector(`[data-calendar-date="${previous.date}"]`))?.focus({ preventScroll: true });
    }
  }
  function showMenu(target, x, y) {
    if (!store.canEdit() || actionBusy || busy) return;
    const record = target.closest("[data-calendar-event],[data-event-id]");
    const id = record?.dataset.calendarEvent || record?.dataset.eventId;
    const event = events.find(row => row.id === id);
    const date = event?.event_date || target.closest("[data-calendar-day]")?.dataset.calendarDay || selected;
    if (!model.validDate(date)) return;
    selected = date; persist(); activeEventId = event?.id || null;
    menuTarget = { date, id: event?.id || null };
    const rows = forDay(date), index = rows.findIndex(row => row.id === event?.id);
    const menu = $("#calendar-context-menu");
    const menuHost = dayDetails.open ? dayDetails : section;
    if (menu.parentNode !== menuHost) menuHost.append(menu);
    for (const button of menu.querySelectorAll("[data-calendar-action]")) {
      const action = button.dataset.calendarAction;
      button.hidden = ["edit","copy","duplicate","next-week","up","down","change-date","delete"].includes(action) && !event;
      button.disabled = (action === "paste" && !clipboard) || (action === "up" && index <= 0) || (action === "down" && index >= rows.length - 1) || (action === "next-week" && !model.validDate(model.shift(date, 7)));
    }
    menu.hidden = false; menu.style.left = "0px"; menu.style.top = "0px";
    const bounds = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, (document.documentElement.clientWidth || innerWidth) - bounds.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, innerHeight - bounds.height - 8)) + "px";
    menu.querySelector("button:not([hidden]):not(:disabled)")?.focus();
    renderClipboard();
  }
  function updateUndo() {
    $("#calendar-undo-message").hidden = !removed;
    $("#calendar-undo-message span").textContent = removed ? removed.message : "";
    $("#calendar-undo").disabled = actionBusy;
  }
  function beginAction(message) {
    actionBusy = true; ++requestId; clearTimeout(timer); closeMenu(); clearDrag();
    notice(message); render();
  }
  async function finishAction() {
    actionBusy = false; render(); await refresh();
  }
  function mergeDays(rows, dates) {
    const affected = new Set(dates);
    events = model.sortEvents([...events.filter(row => !affected.has(row.event_date)), ...rows]);
  }
  async function moveEvent(record, date, beforeId = null) {
    if (!store.canEdit() || busy || actionBusy || !record || !model.validDate(date)) return;
    const sourceRows = forDay(record.event_date), sourceIndex = sourceRows.findIndex(row => row.id === record.id);
    const targetRows = forDay(date).filter(row => row.id !== record.id);
    const index = beforeId ? targetRows.findIndex(row => row.id === beforeId) : targetRows.length;
    if (index < 0) { notice("이동할 위치의 일정을 다시 확인해 주세요.", true); return; }
    const nextIds = targetRows.map(row => row.id); nextIds.splice(index, 0, record.id);
    if (date === record.event_date && nextIds.join() === sourceRows.map(row => row.id).join()) return;
    const expected = events.filter(row => row.event_date === record.event_date || row.event_date === date).map(row => ({ ...row }));
    const nextSource = sourceRows[sourceIndex + 1]?.id || null;
    beginAction("일정 위치를 저장하고 있어요…");
    try {
      const rows = await store.move(record, date, beforeId, expected);
      const moved = rows.find(row => row.id === record.id);
      if (!moved) throw new Error("이동한 일정 정보를 다시 확인해 주세요.");
      mergeDays(rows, [record.event_date, date]); selected = date; persist(); activeEventId = record.id;
      removed = { kind: "move", record: moved, date: record.event_date, beforeId: nextSource, message: `‘${record.title}’ ${date === record.event_date ? "순서를 변경했어요." : "일정을 이동했어요."}` };
      updateUndo(); notice(removed.message);
    } catch (cause) { notice(cause.message || "일정을 이동하지 못했어요. 최신 일정을 다시 확인해 주세요.", true); }
    finally { await finishAction(); }
  }
  function relativeMove(record, amount) {
    const rows = forDay(record.event_date), index = rows.findIndex(row => row.id === record.id);
    if (index < 0 || index + amount < 0 || index + amount >= rows.length) return;
    moveEvent(record, record.event_date, amount < 0 ? rows[index - 1].id : rows[index + 2]?.id || null);
  }
  async function archiveEvent(record) {
    if (!store.canEdit() || busy || actionBusy || !record) return;
    const fromEditor = dialog.open && editing?.id === record.id;
    if (fromEditor) { setBusy(true); formStatus.textContent = "삭제하고 있어요…"; }
    beginAction("일정을 삭제하고 있어요…");
    try {
      const saved = await store.archive(record);
      if (fromEditor) setBusy(false);
      removed = { kind: "delete", record: saved, message: `‘${record.title}’ 일정을 삭제했어요.` };
      if (dialog.open) dialog.close(); activeEventId = null; updateUndo(); notice(removed.message);
    } catch (cause) {
      const message = cause.message || "일정을 삭제하지 못했어요.";
      if (fromEditor) { setBusy(false); formStatus.textContent = message; }
      notice(message, true);
    }
    finally { await finishAction(); }
  }
  async function undoAction() {
    if (!removed || !store.canEdit() || busy || actionBusy) return;
    const target = removed;
    beginAction("마지막 변경을 되돌리고 있어요…");
    try {
      if (target.kind === "move") {
        const dates = [...new Set([target.record.event_date, target.date])];
        const rows = (await Promise.all(dates.map(date => store.load(date, date)))).flat();
        const current = rows.find(row => row.id === target.record.id);
        if (!current || current.updated_at !== target.record.updated_at || (target.beforeId && !rows.some(row => row.id === target.beforeId && row.event_date === target.date))) throw new Error("그 뒤 일정이 변경되어 원래 위치로 되돌릴 수 없어요. 최신 일정을 확인해 주세요.");
        const restored = await store.move(target.record, target.date, target.beforeId, rows);
        mergeDays(restored, dates); selected = target.date; persist();
      } else if (target.kind === "create") await store.archive(target.record);
      else await store.restore(target.record);
      if (removed === target) removed = null;
      updateUndo(); notice("마지막 변경을 되돌렸어요.");
    } catch (cause) { notice(cause.message || "되돌리지 못했어요. 최신 일정을 확인해 주세요.", true); }
    finally { await finishAction(); }
  }
  function closeDayDetails() {
    closeMenu();
    if (dayDetails.open) dayDetails.close();
  }
  function showDayDetails(eventId = null) {
    if (busy || actionBusy) return;
    closeMenu();
    if (!dayDetails.open) {
      detailsReturnFocus = document.activeElement;
      $("#calendar-details-status").hidden = true;
      dayDetails.showModal();
    }
    const heading = eventId ? $("#calendar-agenda-list").querySelector(`[data-event-id="${eventId}"] h3`) : $("#calendar-selected-date");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: "nearest", behavior: "instant" }); }
  }
  function persist() {
    try { sessionStorage.setItem("jeongwa-calendar-view-v1", JSON.stringify({ date: selected, mode })); } catch { /* Keep browsing usable. */ }
  }
  function timeLabel(event) { return event.start_time || ""; }
  function renderStatus() {
    const message = $("#calendar-status");
    message.hidden = !error && !(loading && !hasData);
    message.dataset.error = String(Boolean(error));
    message.querySelector("span").textContent = error ? `${error}${hasData ? " 마지막으로 확인한 일정을 표시하고 있어요." : ""}` : loading && !hasData ? "일정을 불러오고 있어요." : "";
    $("#calendar-retry").hidden = !error;
    $("#calendar-retry").disabled = loading;
  }
  function renderAgenda() {
    $("#calendar-selected-date").textContent = model.formatDate(selected);
    $("#calendar-selected-number").textContent = Number(selected.slice(-2));
    const list = $("#calendar-agenda-list");
    list.replaceChildren();
    const dayEvents = forDay(selected);
    $("#calendar-selected-count").textContent = !hasData ? (error ? "일정 확인 필요" : "일정 확인 중") : dayEvents.length ? `${dayEvents.length}개의 일정` : "등록된 일정 없음";
    if (!dayEvents.length) {
      const item = text("li", "", "calendar-empty");
      if (hasData) {
        const avatar = document.createElement("img");
        avatar.src = "jeongwa-profile-still.webp"; avatar.alt = "";
        avatar.width = 66; avatar.height = 66; avatar.className = "calendar-empty-avatar";
        item.append(avatar);
      }
      const copy = text("div", "");
      copy.append(text("strong", !hasData ? (error ? "일정을 확인할 수 없어요." : "일정을 불러오고 있어요.") : "등록된 일정이 없어요."));
      copy.append(text("small", !hasData ? (error ? "잠시 후 다시 불러와 주세요." : "정와의 소식을 확인하고 있어요.") : "새로운 일정이 올라오면 이곳에서 만나요."));
      item.append(copy); list.append(item);
      return;
    }
    for (const event of dayEvents) {
      const item = text("li", "", "calendar-event-detail");
      item.dataset.eventId = event.id; item.dataset.kind = event.kind;
      const meta = text("div", "", "calendar-event-meta");
      meta.append(text("span", model.kinds[event.kind], "calendar-event-kind"));
      if (timeLabel(event)) meta.append(text("span", timeLabel(event), "calendar-event-time"));
      const heading = text("h3", event.title); heading.tabIndex = -1;
      item.append(meta, heading);
      if (event.subtitle) item.append(text("p", event.subtitle, "calendar-event-subtitle"));
      if (event.collab_members) item.append(text("p", "합방멤버 · " + event.collab_members, "calendar-event-members"));
      if (event.description) item.append(text("p", event.description, "calendar-event-note"));
      if (event.link_url) {
        const link = text("a", "관련 링크 열기 ↗");
        link.href = event.link_url; link.target = "_blank"; link.rel = "noopener noreferrer";
        item.append(link);
      }
      if (store.canEdit()) {
        const edit = text("button", "일정 수정", "calendar-event-edit");
        edit.type = "button"; edit.dataset.editId = event.id;
        edit.setAttribute("aria-label", event.title + " 일정 수정");
        edit.disabled = actionBusy;
        const copy = text("button", "복사"); copy.type = "button"; copy.dataset.copyId = event.id; copy.disabled = actionBusy;
        copy.setAttribute("aria-label", event.title + " 일정 복사");
        const more = text("button", "⋯", "calendar-event-menu"); more.type = "button"; more.dataset.eventActions = event.id; more.disabled = actionBusy;
        more.setAttribute("aria-label", event.title + " 일정 메뉴"); more.setAttribute("aria-haspopup", "menu");
        const actions = text("div", "", "calendar-event-actions"); actions.append(edit, copy, more); item.append(actions);
      }
      list.append(item);
    }
  }
  function eventChip(event) {
    const chip = text("button", "", "calendar-event-chip");
    chip.type = "button"; chip.disabled = actionBusy; chip.draggable = store.canEdit() && !actionBusy;
    chip.dataset.kind = event.kind; chip.dataset.calendarEvent = event.id;
    chip.setAttribute("aria-label", [timeLabel(event), model.kinds[event.kind], event.title, event.subtitle, event.collab_members].filter(Boolean).join(" · ") + (store.canEdit() ? " · 수정" : " · 상세 보기"));
    const meta = text("span", "", "calendar-chip-meta");
    if (timeLabel(event)) meta.append(text("span", timeLabel(event), "calendar-chip-time"));
    meta.append(text("span", model.kinds[event.kind], "calendar-chip-kind"));
    chip.append(meta, text("span", event.title, "calendar-chip-title"));
    if (event.subtitle) chip.append(text("span", event.subtitle, "calendar-chip-subtitle"));
    if (event.collab_members) chip.append(text("span", "함께 · " + event.collab_members, "calendar-chip-members"));
    if (event.description) chip.append(text("span", event.description.split("\n")[0], "calendar-chip-note"));
    return chip;
  }
  function render() {
    const active = document.activeElement;
    const focusedDate = active?.dataset.calendarDate;
    const focusedCard = active?.dataset.calendarEvent;
    const focusedEvent = active?.closest("[data-event-id]")?.dataset.eventId;
    const focusedControl = active?.matches("a") ? "a" : active?.matches("h3") ? "h3" : "button";
    const range = currentRange(), today = model.today();
    renderedToday = today; section.dataset.mode = mode; section.dataset.editable = String(store.canEdit());
    $("#calendar-period").textContent = mode === "month" ? `${Number(selected.slice(0, 4))}년 ${Number(selected.slice(5, 7))}월` : `${Number(range.start.slice(5, 7))}.${Number(range.start.slice(8))} – ${Number(range.end.slice(5, 7))}.${Number(range.end.slice(8))}`;
    const englishMonths = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
    $("#calendar-period-caption").textContent = mode === "month" ? englishMonths[Number(selected.slice(5, 7)) - 1] : (range.start.slice(0,4) === range.end.slice(0,4) ? range.start.slice(0,4) : `${range.start.slice(0,4)} — ${range.end.slice(0,4)}`) + " · WEEKLY";
    $("#calendar-weekdays").hidden = false;
    $("#calendar-prev").disabled = actionBusy || !model.validDate(mode === "month" ? model.monthShift(selected, -1) : model.shift(selected, -7));
    $("#calendar-next").disabled = actionBusy || !model.validDate(mode === "month" ? model.monthShift(selected, 1) : model.shift(selected, 7));
    $("#calendar-prev").setAttribute("aria-label", mode === "month" ? "이전 달" : "이전 주");
    $("#calendar-next").setAttribute("aria-label", mode === "month" ? "다음 달" : "다음 주");
    section.querySelectorAll("[data-calendar-mode]").forEach(button => { button.setAttribute("aria-pressed", String(button.dataset.calendarMode === mode)); button.disabled = actionBusy; });
    $("#calendar-today").disabled = actionBusy; $("#calendar-add").disabled = actionBusy;
    $("#calendar-add").hidden = !store.canEdit();
    const periodEvents = events.filter(event => mode === "week" ? event.event_date >= range.start && event.event_date <= range.end : event.event_date.slice(0,7) === selected.slice(0,7));
    $("#calendar-month-summary").textContent = !hasData ? (error ? "일정 확인이 필요해요" : "일정을 확인하고 있어요") : `${mode === "month" ? Number(selected.slice(5,7)) + "월" : "이번 주"} · ${periodEvents.length ? periodEvents.length + "개의 일정" : "등록된 일정이 없어요"}`;
    const legend = $("#calendar-legend");
    legend.replaceChildren();
    const visibleKinds = new Set(periodEvents.map(event => event.kind));
    for (const [kind, label] of Object.entries(model.kinds)) {
      if (!visibleKinds.has(kind)) continue;
      const item = text("span", label); item.dataset.kind = kind; legend.append(item);
    }
    legend.hidden = visibleKinds.size === 0;
    const days = $("#calendar-days");
    days.dataset.mode = mode; days.dataset.empty = String(periodEvents.length === 0);
    days.style.setProperty("--calendar-rows", range.days.length / 7);
    days.replaceChildren();
    for (const date of range.days) {
      const records = forDay(date);
      const day = text("div", "", "calendar-day");
      day.dataset.calendarDay = date; day.dataset.weekday = model.weekday(date); day.dataset.selected = String(date === selected);
      day.classList.toggle("is-other-month", mode === "month" && date.slice(0, 7) !== selected.slice(0, 7));
      day.classList.toggle("is-today", date === today);
      day.setAttribute("role", "group");
      const dateLabel = model.formatDate(date, { year: "numeric" }) + (date === today ? ", 오늘" : "") + (hasData ? `, 일정 ${records.length}개` : error ? ", 일정 확인 불가" : ", 일정 확인 중");
      day.setAttribute("aria-label", dateLabel);
      const dateLine = text("button", "", "calendar-date-line");
      dateLine.type = "button"; dateLine.dataset.calendarDate = date;
      dateLine.disabled = actionBusy || !model.validDate(date); dateLine.tabIndex = date === selected ? 0 : -1;
      dateLine.setAttribute("aria-pressed", String(date === selected)); dateLine.setAttribute("aria-label", dateLabel + (records.length ? ", 일정 보기" : store.canEdit() ? ", 새 일정 추가" : ""));
      if (records.length) dateLine.setAttribute("aria-haspopup", "dialog");
      const dateNumber = text("span", String(Number(date.slice(-2))), "calendar-date-number");
      if (mode === "week") {
        const dateGroup = text("span", "");
        dateGroup.append(dateNumber, text("span", ["일요일","월요일","화요일","수요일","목요일","금요일","토요일"][model.weekday(date)], "calendar-weekday-label"));
        dateLine.append(dateGroup);
      } else dateLine.append(dateNumber);
      if (date === today) dateLine.append(text("span", "TODAY", "calendar-today-mark"));
      day.append(dateLine);
      records.slice(0, mode === "week" ? records.length : 3).forEach(event => day.append(eventChip(event)));
      if (mode === "month" && records.length > 3) {
        const more = text("button", `+${records.length - 3}개 더 보기`, "calendar-day-count");
        more.type = "button"; more.dataset.calendarMore = date; more.disabled = actionBusy; day.append(more);
      }
      if (store.canEdit() && model.validDate(date)) {
        const add = text("button", "+", "calendar-day-add"); add.type = "button"; add.dataset.calendarAddDate = date;
        add.setAttribute("aria-label", model.formatDate(date) + " 일정 추가"); add.disabled = actionBusy; day.append(add);
      }
      if (mode === "week" && !records.length && hasData) day.append(text("span", "등록된 일정 없음", "calendar-day-count"));
      const dots = text("span", "", "calendar-day-dots");
      dots.setAttribute("aria-hidden", "true");
      [...new Set(records.map(e => e.kind))].forEach(kind => { const dot = text("span", "", "calendar-dot"); dot.dataset.kind = kind; dots.append(dot); });
      day.append(dots); days.append(day);
    }
    renderAgenda(); renderStatus(); renderClipboard(); updateUndo();
    if (focusedEvent) {
      const control = $("#calendar-agenda-list").querySelector(`[data-event-id="${focusedEvent}"] ${focusedControl}`);
      (control || days.querySelector(`[data-calendar-date="${selected}"]`))?.focus({ preventScroll: true });
    }
    if (focusedCard) days.querySelector(`[data-calendar-event="${focusedCard}"]`)?.focus({ preventScroll: true });
    if (focusedDate) days.querySelector(`[data-calendar-date="${focusedDate}"]`)?.focus({ preventScroll: true });
  }

  function prepareHomeDate() {
    if (!pendingCalendarOpen || busy || actionBusy || selected === pendingCalendarOpen.date) return;
    selected = pendingCalendarOpen.date; persist(); ++requestId;
    hasData = false; events = []; error = ""; render();
  }
  function openHomeSchedule() {
    if (!pendingCalendarOpen || !visible() || !hasData || busy || actionBusy || dialog.open) return;
    const target = pendingCalendarOpen;
    if (selected !== target.date) return;
    pendingCalendarOpen = null;
    const record = events.find(row => row.event_date === target.date && row.id === target.eventId);
    if (target.eventId && !record) { notice("선택한 일정이 변경되었어요. 캘린더에서 최신 내용을 확인해 주세요.", true); return; }
    if (!forDay(target.date).length) return;
    $("#calendar-days").querySelector(`[data-calendar-date="${selected}"]`)?.focus({ preventScroll: true });
    showDayDetails(record?.id || null);
  }
  window.addEventListener("jeongwa:calendar-open-date", event => {
    const value = event.detail;
    if (!value || !model.validDate(value.date)) return;
    pendingCalendarOpen = { date: value.date, eventId: typeof value.eventId === "string" ? value.eventId : null };
    closeDayDetails(); clearDrag(); prepareHomeDate();
    if (visible()) refresh();
  });
  function schedule() {
    clearTimeout(timer);
    if (visible()) timer = setTimeout(() => refresh(), 60000);
  }
  async function refresh() {
    if (!visible()) return;
    if (actionBusy || dragState || (pendingCalendarOpen && busy)) { schedule(); return; }
    prepareHomeDate();
    const id = ++requestId, range = currentRange();
    const key = rangeKey(range);
    if (fetchedRange !== key) { hasData = false; events = []; }
    loading = true; error = ""; renderStatus();
    try {
      const rows = await store.load(range.start < model.minDate ? model.minDate : range.start, range.end > model.maxDate ? model.maxDate : range.end);
      if (id !== requestId) return;
      const next = model.sortEvents(rows);
      const changed = renderedToday !== model.today() || !hasData || JSON.stringify(next) !== JSON.stringify(events);
      events = next; hasData = true; fetchedRange = key; loading = false;
      if (changed) render(); else renderStatus();
      openHomeSchedule();
    } catch (cause) {
      if (id !== requestId) return;
      loading = false;
      error = cause.code === "NOT_READY" ? "일정 서비스를 준비하고 있어요." : "일정을 불러오지 못했어요.";
      render();
    } finally { if (id === requestId) schedule(); }
  }
  function selectDate(date, focus = false) {
    if (actionBusy || !model.validDate(date)) return;
    pendingCalendarOpen = null;
    const previous = rangeKey(currentRange());
    selected = date; persist();
    if (previous !== rangeKey(currentRange())) { hasData = false; events = []; error = ""; ++requestId; }
    render();
    if (focus) $("#calendar-days").querySelector(`[data-calendar-date="${selected}"]`)?.focus({ preventScroll: true });
    if (previous !== rangeKey(currentRange())) refresh();
  }
  function openEditor(event = null, seed = null) {
    if (!store.canEdit() || busy || actionBusy) return;
    pendingCalendarOpen = null;
    closeDayDetails();
    const values = event || seed || {};
    editing = event ? { ...event } : null;
    draftId = event ? null : crypto.randomUUID();
    if (!dialog.open) returnFocus = document.activeElement;
    form.reset(); field("link_url").setCustomValidity(""); formStatus.textContent = "";
    dialog.querySelector("#calendar-editor-title").textContent = event ? "일정 수정" : "새 일정";
    for (const name of copyFields) field(name).value = values[name] || (name === "event_date" ? selected : name === "kind" ? "broadcast" : "");
    field("start_time").disabled = field("kind").value === "off";
    for (const id of ["#calendar-delete", "#calendar-copy", "#calendar-duplicate"]) dialog.querySelector(id).hidden = !event;
    if (!dialog.open) dialog.showModal();
    if (seed || !event) field("title").focus();
  }
  function setBusy(value) {
    busy = value;
    form.querySelectorAll("button,input,select,textarea").forEach(input => { input.disabled = value; });
    field("start_time").disabled = value || field("kind").value === "off";
    dialog.querySelector("#calendar-editor-close").disabled = value;
    form.setAttribute("aria-busy", String(value));
  }
  function closeEditor() { if (!busy) dialog.close(); }
  $("#calendar-add").addEventListener("click", () => openEditor());
  $("#calendar-agenda-list").addEventListener("click", event => {
    if (actionBusy) return;
    const edit = event.target.closest("[data-edit-id]");
    if (edit) openEditor(events.find(e => e.id === edit.dataset.editId));
    const copy = event.target.closest("[data-copy-id]");
    if (copy) copyEvent(events.find(e => e.id === copy.dataset.copyId));
    const more = event.target.closest("[data-event-actions]");
    if (more) { const rect = more.getBoundingClientRect(); showMenu(more, rect.left, rect.bottom); }
  });
  $("#calendar-days").addEventListener("click", event => {
    if (actionBusy || busy || Date.now() < suppressClickUntil) return;
    const day = event.target.closest("[data-calendar-day]");
    if (!day || !model.validDate(day.dataset.calendarDay)) return;
    const id = event.target.closest("[data-calendar-event]")?.dataset.calendarEvent;
    const more = event.target.closest("[data-calendar-more]");
    const record = events.find(row => row.id === id);
    selectDate(day.dataset.calendarDay, !record);
    if (record) activeEventId = record.id;
    const add = event.target.closest("[data-calendar-add-date]");
    if (record && store.canEdit()) openEditor(record);
    else if (record || more || (!add && forDay(selected).length)) showDayDetails(record?.id || null);
    else if (store.canEdit()) openEditor();
  });
  $("#calendar-days").addEventListener("keydown", event => {
    if (actionBusy || !event.target.dataset.calendarDate || event.altKey || event.ctrlKey || event.metaKey) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -model.weekday(selected), End: 6 - model.weekday(selected) };
    let next;
    if (Object.hasOwn(offsets, event.key)) next = model.shift(selected, offsets[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown") next = mode === "month" ? model.monthShift(selected, event.key === "PageUp" ? -1 : 1) : model.shift(selected, event.key === "PageUp" ? -7 : 7);
    if (next) { event.preventDefault(); selectDate(next, true); }
  });
  for (const [id, offset] of [["#calendar-prev", -1], ["#calendar-next", 1]]) $(id).addEventListener("click", () => selectDate(mode === "month" ? model.monthShift(selected, offset) : model.shift(selected, offset * 7)));
  $("#calendar-today").addEventListener("click", () => selectDate(model.today()));
  section.querySelectorAll("[data-calendar-mode]").forEach(button => button.addEventListener("click", () => {
    if (actionBusy || mode === button.dataset.calendarMode) return;
    mode = button.dataset.calendarMode; ++requestId; events = []; hasData = false; error = "";
    persist(); render(); refresh();
  }));
  $("#calendar-details-close").addEventListener("click", closeDayDetails);
  dayDetails.addEventListener("cancel", closeMenu);
  dayDetails.addEventListener("close", () => {
    closeMenu();
    if (dialog.open || !visible()) return;
    const previous = detailsReturnFocus;
    const previousId = previous?.closest?.("[data-calendar-event]")?.dataset.calendarEvent;
    const target = previous?.isConnected ? previous : previousId ? $("#calendar-days").querySelector(`[data-calendar-event="${previousId}"]`) : null;
    (target || $("#calendar-days").querySelector(`[data-calendar-date="${selected}"]`))?.focus({ preventScroll: true });
  });
  $("#calendar-retry").addEventListener("click", refresh);
  dialog.querySelector("#calendar-editor-close").addEventListener("click", closeEditor);
  dialog.querySelector("#calendar-editor-cancel").addEventListener("click", closeEditor);
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else $("#calendar-add").focus({ preventScroll: true });
  });
  form.addEventListener("change", event => {
    if (event.target.name !== "kind") return;
    field("start_time").disabled = field("kind").value === "off";
    if (field("kind").value === "off") field("start_time").value = "";
  });
  field("link_url").addEventListener("input", () => field("link_url").setCustomValidity(""));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || actionBusy || !store.canEdit()) return;
    const values = Object.fromEntries(new FormData(form));
    if (!editing) values.id = draftId;
    values.start_time = field("kind").value === "off" ? null : values.start_time || null;
    if (!values.title.trim()) { formStatus.textContent = "일정 제목을 입력해 주세요."; field("title").focus(); return; }
    if (values.link_url) {
      try { const url = new URL(values.link_url); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
      catch { field("link_url").setCustomValidity("https://로 시작하는 공개 링크를 입력해 주세요."); field("link_url").reportValidity(); return; }
    }
    setBusy(true); formStatus.textContent = "저장하고 있어요…";
    try {
      const result = await store.save(values, editing);
      setBusy(false); dialog.close();
      removed = editing ? null : { kind: "create", record: result, message: `‘${result.title}’ 일정을 추가했어요.` }; updateUndo();
      notice(editing ? "일정을 수정했어요." : removed.message);
      selected = result.event_date; persist();
      await refresh();
    } catch (cause) { setBusy(false); formStatus.textContent = cause.message || "저장하지 못했어요. 다시 시도해 주세요."; }
  });
  dialog.querySelector("#calendar-delete").addEventListener("click", () => archiveEvent(editing));
  $("#calendar-undo").addEventListener("click", undoAction);
  function clearDrag() {
    dragState = null; dropPlan = null;
    section.querySelectorAll(".is-dragging,.is-drop-target,.is-drop-before,.is-drop-after").forEach(node => node.classList.remove("is-dragging","is-drop-target","is-drop-before","is-drop-after"));
  }
  function getDrop(event) {
    const day = event.target.closest("[data-calendar-day]");
    if (!day || !dragState || !model.validDate(day.dataset.calendarDay)) return null;
    const date = day.dataset.calendarDay, copy = Boolean(event.ctrlKey || event.metaKey);
    const rows = forDay(date).filter(row => row.id !== dragState.record.id);
    const card = event.target.closest("[data-calendar-event]");
    let beforeId = null, edge = "end";
    if (!copy && card) {
      const index = rows.findIndex(row => row.id === card.dataset.calendarEvent);
      if (card.dataset.calendarEvent === dragState.record.id) {
        const source = forDay(date), position = source.findIndex(row => row.id === dragState.record.id);
        beforeId = source[position + 1]?.id || null;
      } else if (index >= 0) {
        const bounds = card.getBoundingClientRect();
        edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
        beforeId = edge === "before" ? rows[index].id : rows[index + 1]?.id || null;
      }
    }
    return { date, beforeId, copy, edge, card, day };
  }
  $("#calendar-days").addEventListener("dragstart", event => {
    const card = event.target.closest("[data-calendar-event]");
    const record = events.find(row => row.id === card?.dataset.calendarEvent);
    if (!record || !store.canEdit() || busy || actionBusy || !hasData) { event.preventDefault(); return; }
    closeMenu(); dragState = { record: { ...record } }; activeEventId = record.id;
    card.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData("application/x-jeongwa-calendar-event", record.id);
      event.dataTransfer.setData("text/plain", record.title);
    }
  });
  function allowDrop(event) {
    if (!dragState || !store.canEdit() || actionBusy) return;
    const plan = getDrop(event);
    if (!plan) return;
    event.preventDefault(); dropPlan = plan;
    section.querySelectorAll(".is-drop-target,.is-drop-before,.is-drop-after").forEach(node => node.classList.remove("is-drop-target","is-drop-before","is-drop-after"));
    plan.day.classList.add("is-drop-target"); plan.day.dataset.dropCopy = String(plan.copy);
    if (plan.card && !plan.copy && plan.card.dataset.calendarEvent !== dragState.record.id) plan.card.classList.add(plan.edge === "before" ? "is-drop-before" : "is-drop-after");
    if (event.dataTransfer) event.dataTransfer.dropEffect = plan.copy ? "copy" : "move";
  }
  // Accept a new child target immediately, including a quick release after entry.
  $("#calendar-days").addEventListener("dragenter", allowDrop);
  $("#calendar-days").addEventListener("dragover", allowDrop);
  $("#calendar-days").addEventListener("drop", event => {
    if (!dragState || !store.canEdit() || actionBusy) return;
    const plan = getDrop(event) || dropPlan, record = dragState.record;
    if (!plan) { clearDrag(); return; }
    event.preventDefault(); suppressClickUntil = Date.now() + 350; clearDrag();
    if (plan.copy) pasteEvent(plan.date, record);
    else moveEvent(record, plan.date, plan.beforeId);
  });
  $("#calendar-days").addEventListener("dragend", () => {
    suppressClickUntil = Date.now() + 350; clearDrag(); schedule();
  });
  section.addEventListener("focusin", event => {
    const card = event.target.closest("[data-calendar-event],[data-event-id]");
    if (card) activeEventId = card.dataset.calendarEvent || card.dataset.eventId;
  });
  section.addEventListener("contextmenu", event => {
    if (!store.canEdit() || !event.target.closest("[data-calendar-day],[data-event-id]")) return;
    event.preventDefault(); showMenu(event.target, event.clientX, event.clientY);
  });
  $("#calendar-context-menu").addEventListener("click", event => {
    const action = event.target.closest("[data-calendar-action]")?.dataset.calendarAction;
    const target = menuTarget;
    if (!action || !target || actionBusy || busy) return;
    const record = events.find(row => row.id === target.id); closeMenu();
    if (action === "add") { selectDate(target.date); openEditor(); }
    if (action === "paste") pasteEvent(target.date);
    if (action === "edit" && record) { selectDate(record.event_date); openEditor(record); }
    if (action === "copy" && record) copyEvent(record);
    if (action === "duplicate" && record) pasteEvent(record.event_date, record);
    if (action === "next-week" && record) pasteEvent(model.shift(record.event_date, 7), record);
    if (action === "up" && record) relativeMove(record, -1);
    if (action === "down" && record) relativeMove(record, 1);
    if (action === "change-date" && record) { selectDate(record.event_date); openEditor(record); field("event_date").focus(); }
    if (action === "delete" && record) archiveEvent(record);
  });
  $("#calendar-context-menu").addEventListener("keydown", event => {
    const buttons = [...$("#calendar-context-menu").querySelectorAll("button:not([hidden]):not(:disabled)")];
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    if (["ArrowDown","ArrowUp","Home","End"].includes(event.key)) {
      event.preventDefault(); const index = buttons.indexOf(document.activeElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
    if (event.key === "Tab") closeMenu();
  });
  document.addEventListener("pointerdown", event => { if (!event.target.closest("#calendar-context-menu")) closeMenu(); });
  window.addEventListener("blur", () => { closeMenu(); clearDrag(); });
  $("#calendar-paste-selected").addEventListener("click", () => pasteEvent());
  $("#calendar-clipboard-clear").addEventListener("click", () => {
    clipboard = null; try { sessionStorage.removeItem(clipboardKey); } catch { /* Optional storage. */ }
    renderClipboard();
  });
  dialog.querySelector("#calendar-copy").addEventListener("click", () => {
    if (!editing || busy || actionBusy || !store.canEdit()) return;
    copyEvent({ ...Object.fromEntries(new FormData(form)), start_time: field("kind").value === "off" ? null : field("start_time").value || null });
    formStatus.textContent = "입력 내용을 복사했어요. 창을 닫고 다른 날짜에 붙여넣을 수 있어요.";
  });
  dialog.querySelector("#calendar-duplicate").addEventListener("click", () => {
    if (!editing || busy || actionBusy || !store.canEdit()) return;
    const values = copyValues({ ...Object.fromEntries(new FormData(form)), start_time: field("kind").value === "off" ? null : field("start_time").value || null });
    if (values) pasteEvent(values.event_date, values);
  });
  section.addEventListener("keydown", event => {
    if (!visible() || !store.canEdit() || busy || actionBusy || dialog.open || event.target.closest("input,textarea,select,[contenteditable],dialog")) return;
    const record = activeRecord(event.target), key = event.key.toLowerCase();
    const date = event.target.closest("[data-calendar-day]")?.dataset.calendarDay || selected;
    if (key === "escape") { closeMenu(true); clearDrag(); return; }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      const r = event.target.getBoundingClientRect(); event.preventDefault(); showMenu(event.target, r.left, r.bottom); return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && record && ["ArrowUp","ArrowDown"].includes(event.key)) {
      event.preventDefault(); relativeMove(record, event.key === "ArrowUp" ? -1 : 1); return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (key === "c" && record && !window.getSelection()?.toString()) { event.preventDefault(); copyEvent(record); }
      if (key === "v" && clipboard) { event.preventDefault(); pasteEvent(date); }
      if (key === "d" && record) { event.preventDefault(); pasteEvent(record.event_date, record); }
      if (key === "z" && !event.shiftKey && removed) { event.preventDefault(); undoAction(); }
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && key === "n") { event.preventDefault(); selectDate(date); openEditor(); }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Delete" && record) { event.preventDefault(); archiveEvent(record); }
  });
  window.addEventListener("jeongwa:auth-change", () => {
    closeMenu(); clearDrag();
    if (!store.canEdit()) { removed = null; updateUndo(); if (dialog.open && !busy) dialog.close(); }
    render();
  });
  function onVisibility() {
    clearTimeout(timer);
    if (visible()) refresh();
    else { ++requestId; loading = false; pendingCalendarOpen = null; closeDayDetails(); clearDrag(); }
  }
  window.addEventListener("jeongwa:view-change", onVisibility);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", () => { if (visible()) refresh(); });
  render(); onVisibility();
})();
