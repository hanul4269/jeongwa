(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.jeongwaCalendarStore = api.createStore(() => root.jeongwaCalendarAccess);
})(typeof window === "object" ? window : null, function () {
  "use strict";

  const LEGACY_FIELDS = "id,event_date,start_time,title,description,kind,link_url,updated_at,is_deleted";
  const CONTENT_FIELDS = "id,event_date,start_time,title,subtitle,collab_members,description,kind,link_url,updated_at,is_deleted";
  const FIELDS = `${CONTENT_FIELDS},sort_order`;
  const KINDS = new Set(["broadcast", "singing", "solo", "collab", "watch", "game", "ad", "off", "cover", "relay", "before", "event"]);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function failure(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > "2100-12-31") return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validateEvent(record) {
    if (!record || typeof record !== "object") throw failure("VALIDATION", "일정 내용을 확인해 주세요.");
    const eventDate = String(record.event_date || "");
    const title = String(record.title || "").trim();
    const subtitle = String(record.subtitle || "").trim();
    const collabMembers = String(record.collab_members || "").trim();
    const description = String(record.description || "").trim();
    const kind = String(record.kind || "");
    const time = kind === "off" || record.start_time == null || record.start_time === "" ? null : String(record.start_time);
    const link = String(record.link_url || "").trim();
    if (!validDate(eventDate)) throw failure("VALIDATION", "올바른 날짜를 선택해 주세요.");
    if (!title || title.length > 120) throw failure("VALIDATION", "일정 제목은 1~120자로 입력해 주세요.");
    if (subtitle.length > 200) throw failure("VALIDATION", "부제는 200자 이내로 입력해 주세요.");
    if (collabMembers.length > 500) throw failure("VALIDATION", "합방멤버는 500자 이내로 입력해 주세요.");
    if (description.length > 2000) throw failure("VALIDATION", "메모는 2,000자 이내로 입력해 주세요.");
    if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw failure("VALIDATION", "시간은 00:00~23:59 사이로 입력해 주세요.");
    if (!KINDS.has(kind)) throw failure("VALIDATION", "일정 종류를 선택해 주세요.");
    let linkUrl = "";
    if (link) {
      try {
        const parsed = new URL(link);
        if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || /[\s\\]/.test(link) || link.length > 2000) throw new Error();
        linkUrl = parsed.href;
        if (linkUrl.length > 2000) throw new Error();
      } catch {
        throw failure("VALIDATION", "연결 주소는 올바른 https:// 주소로 입력해 주세요.");
      }
    }
    // Ordering and database-owned versions are deliberately never writable here.
    return { event_date: eventDate, start_time: time, title, subtitle, collab_members: collabMembers, description, kind, link_url: linkUrl };
  }

  function normalizedRow(row) {
    if (!row || !UUID.test(row.id || "") || !Number.isFinite(Date.parse(row.updated_at)) || typeof row.is_deleted !== "boolean") {
      throw failure("RESPONSE", "일정 정보를 확인하지 못했습니다. 다시 불러와 주세요.");
    }
    const time = row.start_time == null ? null : String(row.start_time).replace(/:00$/, (match, offset) => offset === 5 ? "" : match);
    let fields;
    try { fields = validateEvent({ ...row, start_time: time }); }
    catch { throw failure("RESPONSE", "일정 정보를 확인하지 못했습니다. 다시 불러와 주세요."); }
    const ordering = {};
    if (Object.hasOwn(row, "sort_order")) {
      if (row.sort_order === null || row.sort_order === "" || !Number.isSafeInteger(Number(row.sort_order)) || Number(row.sort_order) < 0) throw failure("RESPONSE", "일정 순서를 확인하지 못했습니다. 다시 불러와 주세요.");
      ordering.sort_order = Number(row.sort_order);
    }
    return { id: row.id, ...fields, ...ordering, updated_at: row.updated_at, is_deleted: row.is_deleted };
  }

  function contentSchemaFailure() {
    const error = failure("NOT_READY", "부제와 합방멤버를 저장할 준비가 아직 되지 않았어요. 입력 내용은 유지되니 관리자에게 일정 저장소 업데이트를 요청해 주세요.");
    error.missingContentFields = true;
    return error;
  }

  function orderingSchemaFailure() {
    return failure("NOT_READY", "일정 순서와 날짜를 이동할 저장소가 아직 준비되지 않았어요. 관리자에게 일정 정렬 기능 업데이트를 요청해 주세요.");
  }

  function databaseFailure(error, writing) {
    if (["42703", "PGRST204"].includes(error?.code)) return contentSchemaFailure();
    if (["42883", "PGRST202"].includes(error?.code)) return orderingSchemaFailure();
    if (error?.code === "40001") return failure("CONFLICT", "다른 곳에서 일정이 변경되었어요. 다시 불러온 뒤 순서와 날짜를 확인해 주세요.");
    if (["55P03", "40P01"].includes(error?.code)) return failure("CONFLICT", "다른 일정 변경을 처리하고 있어요. 잠시 후 다시 불러와 주세요.");
    if (error?.code === "23505") return failure("DUPLICATE", "이미 저장된 일정인지 확인하고 있어요.");
    if (["42P01", "PGRST205"].includes(error?.code)) return failure("NOT_READY", "일정 서비스를 준비하고 있어요. 잠시 후 다시 확인해 주세요.");
    if (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(error?.code)) return failure("PERMISSION", writing
      ? "일정을 변경할 권한을 확인하지 못했습니다. 로그인 상태를 확인해 주세요."
      : "일정에 접근하지 못했습니다. 잠시 후 다시 확인해 주세요.");
    if (["23514", "22007", "22008", "22023", "22P02"].includes(error?.code)) return failure("VALIDATION", "일정의 날짜와 입력 내용을 다시 확인해 주세요.");
    return failure("NETWORK", writing
      ? "저장 결과를 확인하지 못했습니다. 다시 불러와 반영 여부를 확인해 주세요."
      : "일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  function createStore(getAccess, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;
    const pageSize = options.pageSize ?? 200;
    let contentSchemaReady = null;
    let orderingSchemaReady = null;

    function access() {
      const value = getAccess();
      if (!value || typeof value.fromEvents !== "function") throw failure("NOT_READY", "일정 서비스를 준비하고 있어요. 잠시 후 다시 확인해 주세요.");
      return value;
    }

    function canEdit() {
      try { return Boolean(getAccess()?.canEdit()); } catch { return false; }
    }

    function requireEditor() {
      if (!canEdit()) throw failure("PERMISSION", "관리자 또는 편집자 로그인 후 일정을 변경할 수 있어요.");
    }

    async function request(makeQuery, writing = false, source = null) {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(failure("TIMEOUT", writing
            ? "저장 응답이 늦어지고 있어요. 다시 불러와 반영 여부를 확인해 주세요."
            : "일정 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요."));
        }, timeoutMs);
      });
      try {
        const connection = access();
        const result = await Promise.race([makeQuery(source ? source(connection) : connection.fromEvents()).abortSignal(controller.signal), timeout]);
        if (result?.error) throw databaseFailure(result.error, writing);
        return result?.data;
      } catch (error) {
        if (["NOT_READY", "PERMISSION", "VALIDATION", "NETWORK", "TIMEOUT", "DUPLICATE", "CONFLICT"].includes(error?.code)) throw error;
        throw databaseFailure(error, writing);
      } finally {
        clearTimeout(timer);
      }
    }

    async function load(startDate, endDate) {
      if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) throw failure("VALIDATION", "조회할 날짜 범위를 확인해 주세요.");
      async function readFields(fields) {
        const records = new Map();
        let offset = 0;
        while (true) {
          if (offset >= 20000) throw failure("RESPONSE", "일정이 너무 많아 한 번에 불러오지 못했습니다. 조회 기간을 줄여 주세요.");
          const data = await request((query) => {
            let ordered = query.select(fields).gte("event_date", startDate).lte("event_date", endDate).eq("is_deleted", false).order("event_date", { ascending: true });
            if (fields === FIELDS) ordered = ordered.order("sort_order", { ascending: true });
            return ordered.order("start_time", { ascending: true, nullsFirst: true }).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
          });
          if (!Array.isArray(data)) throw failure("RESPONSE", "일정 정보를 확인하지 못했습니다. 다시 불러와 주세요.");
          for (const raw of data) {
            const record = normalizedRow(fields === LEGACY_FIELDS ? { ...raw, subtitle: "", collab_members: "" } : raw);
            if (!record.is_deleted && record.event_date >= startDate && record.event_date <= endDate) records.set(record.id, record);
          }
          if (data.length < pageSize) break;
          offset += data.length;
        }
        return [...records.values()];
      }
      return readWithSchema(readFields);
    }

    async function readWithSchema(readFields) {
      // Additive frontend releases can precede their SQL. Prefer rank+content,
      // then content, then the original schema; never discard subtitle/members
      // merely because the ordering service has not been installed yet.
      try {
        const records = await readFields(FIELDS);
        contentSchemaReady = true;
        orderingSchemaReady = true;
        return records;
      } catch (error) {
        if (!error?.missingContentFields) throw error;
        orderingSchemaReady = false;
      }
      try {
        const records = await readFields(CONTENT_FIELDS);
        contentSchemaReady = true;
        return records;
      } catch (error) {
        if (!error?.missingContentFields) throw error;
        contentSchemaReady = false;
        return readFields(LEGACY_FIELDS);
      }
    }

    async function loadHome(date, limit = 3) {
      if (!validDate(date) || !Number.isInteger(limit) || limit < 1 || limit > 10) throw failure("VALIDATION", "조회할 날짜와 일정 개수를 확인해 주세요.");
      // Today's complete list uses the same pagination and validation as the
      // calendar. Future cards are a bounded server query, never a bulk download.
      const today = await load(date, date);
      if (date === "2100-12-31") return { today, upcoming: [] };
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const tomorrow = next.toISOString().slice(0, 10);
      const upcoming = await readWithSchema(async fields => {
        const data = await request(query => {
          let ordered = query.select(fields).gte("event_date", tomorrow).lte("event_date", "2100-12-31")
            .eq("is_deleted", false).order("event_date", { ascending: true });
          if (fields === FIELDS) ordered = ordered.order("sort_order", { ascending: true });
          return ordered.order("start_time", { ascending: true, nullsFirst: false })
            .order("id", { ascending: true }).range(0, limit - 1);
        });
        if (!Array.isArray(data) || data.length > limit) throw failure("RESPONSE", "다음 일정 정보를 확인하지 못했습니다. 다시 불러와 주세요.");
        const records = [];
        const ids = new Set();
        for (const raw of data) {
          const record = normalizedRow(fields === LEGACY_FIELDS ? { ...raw, subtitle: "", collab_members: "" } : raw);
          if (record.is_deleted || record.event_date < tomorrow || record.event_date > "2100-12-31" || ids.has(record.id)) throw failure("RESPONSE", "다음 일정 정보를 확인하지 못했습니다. 다시 불러와 주세요.");
          ids.add(record.id);
          records.push(record);
        }
        return records;
      });
      return { today, upcoming };
    }

    function originalVersion(record) {
      if (!record || !UUID.test(record.id || "") || !Number.isFinite(Date.parse(record.updated_at))) {
        throw failure("CONFLICT", "일정의 최신 정보를 다시 불러온 뒤 수정해 주세요.");
      }
      return record;
    }

    const writeFields = () => orderingSchemaReady === true ? FIELDS : CONTENT_FIELDS;

    async function update(fields, original, deletedBefore) {
      requireEditor();
      if (contentSchemaReady === false) throw contentSchemaFailure();
      const previous = originalVersion(original);
      const result = await request((query) => query.update(fields)
        .eq("id", previous.id).eq("updated_at", previous.updated_at).eq("is_deleted", deletedBefore)
        .select(writeFields()).maybeSingle(), true);
      if (!result) throw failure("CONFLICT", "다른 곳에서 일정이 변경되었거나 권한이 바뀌었어요. 다시 불러온 뒤 확인해 주세요.");
      return normalizedRow(result);
    }

    async function save(record, original) {
      requireEditor();
      const fields = validateEvent(record);
      if (contentSchemaReady === false) throw contentSchemaFailure();
      if (original) return update(fields, original, false);
      // The editor keeps this ID until close, so a lost response cannot duplicate
      // a new event when the user retries. Existing events are never upserted.
      const id = record.id ?? globalThis.crypto?.randomUUID?.();
      if (!UUID.test(id || "")) throw failure("VALIDATION", "새 일정을 준비하지 못했습니다. 등록 창을 다시 열어 주세요.");
      try {
        const result = await request((query) => query.insert({ id, ...fields }).select(writeFields()).single(), true);
        return normalizedRow(result);
      } catch (error) {
        if (error?.code !== "DUPLICATE") throw error;
        const existing = await request((query) => query.select(writeFields()).eq("id", id).maybeSingle());
        const saved = existing ? normalizedRow(existing) : null;
        if (saved && !saved.is_deleted && Object.keys(fields).every((key) => fields[key] === saved[key])) return saved;
        throw failure("CONFLICT", "같은 일정이 이미 저장된 뒤 변경되었어요. 다시 불러온 뒤 확인해 주세요.");
      }
    }

    async function move(record, targetDate, beforeId = null, expectedEvents) {
      requireEditor();
      const previous = originalVersion(record);
      if (previous.is_deleted || !validDate(previous.event_date) || !validDate(targetDate) || (beforeId !== null && !UUID.test(beforeId || ""))) throw failure("VALIDATION", "이동할 일정과 날짜를 확인해 주세요.");
      if (!Array.isArray(expectedEvents) || expectedEvents.length > 20000) throw failure("CONFLICT", "현재 일정을 다시 불러온 뒤 이동해 주세요.");
      const dates = new Set([previous.event_date, targetDate]);
      const expected = expectedEvents.filter(row => row && !row.is_deleted && dates.has(row.event_date));
      const seen = new Set();
      const snapshots = expected.map(row => {
        originalVersion(row);
        if (seen.has(row.id)) throw failure("CONFLICT", "현재 일정을 다시 불러온 뒤 이동해 주세요.");
        seen.add(row.id);
        return { id: row.id, event_date: row.event_date, updated_at: row.updated_at };
      });
      const sourceSnapshot = snapshots.find(row => row.id === previous.id);
      if (!sourceSnapshot || sourceSnapshot.event_date !== previous.event_date || sourceSnapshot.updated_at !== previous.updated_at || (beforeId !== null && !expected.some(row => row.id === beforeId && row.event_date === targetDate))) throw failure("CONFLICT", "현재 일정을 다시 불러온 뒤 이동해 주세요.");
      if (orderingSchemaReady === false || typeof access().rpc !== "function") throw orderingSchemaFailure();
      let rows;
      try {
        rows = await request(query => query, true, connection => connection.rpc("jeongwa_calendar_move", {
          p_event_id: previous.id,
          p_source_date: previous.event_date,
          p_target_date: targetDate,
          p_before_id: beforeId,
          p_expected_version: previous.updated_at,
          p_expected_events: snapshots,
        }));
      } catch (error) {
        if (error?.missingContentFields) { orderingSchemaReady = false; throw orderingSchemaFailure(); }
        throw error;
      }
      if (!Array.isArray(rows)) throw failure("RESPONSE", "변경된 일정 순서를 확인하지 못했습니다. 다시 불러와 주세요.");
      const normalized = rows.map(normalizedRow);
      const ids = new Set();
      const invalid = normalized.some(row => {
        if (row.is_deleted || !dates.has(row.event_date) || ids.has(row.id) || !seen.has(row.id) || !Object.hasOwn(row, "sort_order")) return true;
        ids.add(row.id);
        return false;
      });
      if (normalized.length !== snapshots.length || invalid || !normalized.some(row => row.id === previous.id && row.event_date === targetDate)) throw failure("RESPONSE", "변경된 일정 순서를 확인하지 못했습니다. 다시 불러와 주세요.");
      orderingSchemaReady = true;
      return normalized;
    }

    return Object.freeze({
      canEdit,
      load,
      loadHome,
      save,
      move,
      archive: (record) => update({ is_deleted: true }, record, false),
      restore: (record) => update({ is_deleted: false }, record, true),
    });
  }

  return { createStore, validateEvent };
});
