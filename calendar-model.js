(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JeongwaCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const kinds = {
    broadcast: "소통", singing: "노래", solo: "솔로 콘텐츠", collab: "참여·합방",
    watch: "같이 보기", game: "게임", ad: "광고", off: "휴방",
    cover: "커버곡", relay: "중계", before: "방송 전", event: "기타",
  };
  const minDate = "2000-01-01", maxDate = "2100-12-31";
  const stamp = date => date.toISOString().slice(0, 10);
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < minDate || value > maxDate) return false;
    const date = new Date(value + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && stamp(date) === value;
  }
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = key => parts.find(p => p.type === key).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  function shift(date, days) {
    const next = new Date(date + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + days);
    return stamp(next);
  }
  function weekday(date) { return new Date(date + "T12:00:00Z").getUTCDay(); }
  function monthShift(date, amount) {
    const next = new Date(date.slice(0, 7) + "-01T12:00:00Z");
    next.setUTCMonth(next.getUTCMonth() + amount + 1);
    next.setUTCDate(0);
    next.setUTCDate(Math.min(Number(date.slice(-2)), next.getUTCDate()));
    return stamp(next);
  }
  function range(date, mode) {
    const anchor = mode === "week" ? date : date.slice(0, 7) + "-01";
    const start = shift(anchor, -weekday(anchor));
    const lastDay = new Date(anchor + "T12:00:00Z");
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    const length = mode === "week" ? 7 : Math.ceil((weekday(anchor) + lastDay.getUTCDate()) / 7) * 7;
    const days = Array.from({ length }, (_, index) => shift(start, index));
    return { start, end: days.at(-1), days };
  }
  function normalizeEvent(row) {
    if (!row || !validDate(row.event_date) || !Object.hasOwn(kinds, row.kind) || typeof row.title !== "string" || !row.title.trim()) return null;
    const start = row.start_time == null ? null : String(row.start_time).slice(0, 5);
    if (start !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return null;
    let link = "";
    try { const url = new URL(row.link_url || ""); if (url.protocol === "https:" && !url.username && !url.password) link = url.href; } catch { /* A link is optional. */ }
    return { ...row, title: row.title.slice(0, 120), subtitle: typeof row.subtitle === "string" ? row.subtitle.slice(0, 200) : "", collab_members: typeof row.collab_members === "string" ? row.collab_members.slice(0, 500) : "", description: typeof row.description === "string" ? row.description.slice(0, 2000) : "", start_time: start, link_url: link };
  }
  function orderValue(event) {
    const value = event?.sort_order;
    return value !== null && value !== "" && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  }
  function sortEvents(events) {
    return events.filter(e => !e.is_deleted).map(normalizeEvent).filter(Boolean).sort((a, b) => a.event_date.localeCompare(b.event_date) || ((orderValue(a) ?? Number.MAX_SAFE_INTEGER) - (orderValue(b) ?? Number.MAX_SAFE_INTEGER)) || (a.start_time || "99:99").localeCompare(b.start_time || "99:99") || a.title.localeCompare(b.title, "ko") || String(a.id).localeCompare(String(b.id)));
  }
  function formatDate(date, options = {}) {
    return new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long", ...options }).format(new Date(date + "T12:00:00Z"));
  }
  return { kinds, minDate, maxDate, validDate, today, shift, weekday, monthShift, range, normalizeEvent, sortEvents, formatDate };
});
