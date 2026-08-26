const baseSongs = Array.isArray(window.JEONGWA_SONGS) ? window.JEONGWA_SONGS : [];
const storageKey = "jeongwa-songbook-added-songs";
const editsStorageKey = "jeongwa-songbook-edited-songs";
const upEventsStorageKey = "jeongwa-songbook-up-events";
const SUPABASE_URL = "https://ftdptxblxijbmgkbqnnh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3_tpgX3yEvfGrGvFdhRUzA_qQuemlEh";
const OWNER_EMAIL = "riosniper12@gmail.com";
const categories = ["K-POP", "J-POP", "POP/OST", "숙제곡"];
const categoryLabels = {
  "K-POP": "K-POP",
  "J-POP": "J-POP",
  "POP/OST": "POP/OST",
  "숙제곡": "숙제곡",
};

const state = {
  category: "K-POP",
  query: "",
};

let legacyCustomSongs = loadCustomSongs();
let legacyEditedSongsById = loadEditedSongs();
let legacyUpEvents = loadUpEvents();
let customSongs = [...legacyCustomSongs];
let editedSongsById = { ...legacyEditedSongsById };
let songs = mergeSongs();
let authUser = null;
let editorEmails = [];
const ownerEmail = OWNER_EMAIL;
let upEvents = [...legacyUpEvents];
let activeAdminTab = "editors";
let legacyMigrationPromise = null;

const authDb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    detectSessionInUrl: false,
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
  },
});

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function uniqueEmails(values) {
  return [...new Set(values.map(normalizeEmail).filter(isValidEmail))];
}

function isSignedIn() {
  return Boolean(authUser?.email);
}

function isEditorEmail(email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && (normalized === ownerEmail || editorEmails.includes(normalized)));
}

function canEdit() {
  return isSignedIn() && isEditorEmail(authUser.email);
}

function canManageEditors() {
  return isSignedIn() && normalizeEmail(authUser.email) === normalizeEmail(ownerEmail);
}

function displayNameFromEmail(email) {
  return normalizeEmail(email).split("@")[0] || "계정";
}

function loadUpEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(upEventsStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeUpEvent).filter((event) => event.title) : [];
  } catch {
    return [];
  }
}

function loadCustomSongs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((song) => normalizeSongRecord({ ...song, custom: true })).filter((song) => song.title)
      : [];
  } catch {
    return [];
  }
}

function loadEditedSongs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(editsStorageKey) || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([id, song]) => {
          const normalized = normalizeSongRecord({ ...song, id, edited: true });
          return normalized.title ? [String(id), normalized] : null;
        })
        .filter(Boolean),
    );
  } catch {
    return {};
  }
}

function applyStoredEdit(song) {
  const normalized = normalizeSongRecord(song);
  const edit = editedSongsById[String(normalized.id)];
  if (!edit) return normalized;

  return normalizeSongRecord({
    ...normalized,
    ...edit,
    id: normalized.id,
    custom: normalized.custom,
    edited: true,
  });
}

function mergeSongs() {
  return [...baseSongs.map(applyStoredEdit), ...customSongs.map(normalizeSongRecord)];
}

function refreshSongs() {
  songs = mergeSongs();
}

function normalizeUrl(value) {
  const text = clean(value);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(youtu\.be|www\.|youtube\.com)/i.test(text)) return `https://${text}`;
  return text;
}

function normalizeSkill(value) {
  const number = Number.parseInt(clean(value).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(5, number));
}

function normalizeCategory(value, fallback = state.category) {
  const text = clean(value);
  return categories.includes(text) ? text : fallback;
}

function normalizeSongRecord(song) {
  return {
    id: song.id ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category: normalizeCategory(song.category, "K-POP"),
    title: clean(song.title),
    artist: clean(song.artist),
    instUrl: normalizeUrl(song.instUrl),
    jeongwaClipUrl: normalizeUrl(song.jeongwaClipUrl),
    skillLevel: normalizeSkill(song.skillLevel),
    memo: clean(song.memo ?? song.note),
    custom: Boolean(song.custom),
    edited: Boolean(song.edited),
  };
}

function normalizeUpEntry(entry) {
  const upCount = Number.parseInt(clean(entry.upCount), 10);
  return {
    id: entry.id ?? `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    nickname: clean(entry.nickname),
    songTitle: clean(entry.songTitle),
    upCount: Number.isFinite(upCount) ? Math.max(0, upCount) : 0,
    memo: clean(entry.memo),
  };
}

function normalizeUpEvent(event) {
  const status = ["예정", "진행중", "종료"].includes(clean(event.status)) ? clean(event.status) : "진행중";
  const entries = Array.isArray(event.entries)
    ? event.entries.map(normalizeUpEntry).filter((entry) => entry.nickname || entry.songTitle)
    : [];

  return {
    id: event.id ?? `up-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: clean(event.title),
    startDate: clean(event.startDate),
    endDate: clean(event.endDate),
    status,
    memo: clean(event.memo),
    entries,
  };
}

function hasLegacyData() {
  return legacyCustomSongs.length > 0
    || Object.keys(legacyEditedSongsById).length > 0
    || legacyUpEvents.length > 0;
}

function clearLegacyData() {
  legacyCustomSongs = [];
  legacyEditedSongsById = {};
  legacyUpEvents = [];
  localStorage.removeItem(storageKey);
  localStorage.removeItem(editsStorageKey);
  localStorage.removeItem(upEventsStorageKey);
}

function songChangeId(songId) {
  return `base:${String(songId)}`;
}

function songToChangeRow(song, recordType) {
  const normalized = normalizeSongRecord(song);
  const isOverride = recordType === "override";
  return {
    id: isOverride ? songChangeId(normalized.id) : String(normalized.id),
    record_type: recordType,
    source_song_id: isOverride ? String(normalized.id) : null,
    category: normalized.category,
    title: normalized.title,
    artist: normalized.artist,
    inst_url: normalized.instUrl,
    jeongwa_clip_url: normalized.jeongwaClipUrl,
    skill_level: normalized.skillLevel,
    memo: normalized.memo,
    updated_at: new Date().toISOString(),
    updated_by: authUser?.id || null,
  };
}

function songFromChangeRow(row) {
  const custom = row.record_type === "custom";
  return normalizeSongRecord({
    id: custom ? row.id : row.source_song_id,
    category: row.category,
    title: row.title,
    artist: row.artist,
    instUrl: row.inst_url,
    jeongwaClipUrl: row.jeongwa_clip_url,
    skillLevel: row.skill_level,
    memo: row.memo,
    custom,
    edited: !custom,
  });
}

function upEventToRow(event) {
  const normalized = normalizeUpEvent(event);
  return {
    id: String(normalized.id),
    title: normalized.title,
    start_date: normalized.startDate || null,
    end_date: normalized.endDate || null,
    status: normalized.status,
    memo: normalized.memo,
    updated_at: new Date().toISOString(),
    updated_by: authUser?.id || null,
  };
}

function upEntryToRow(eventId, entry) {
  const normalized = normalizeUpEntry(entry);
  return {
    id: String(normalized.id),
    event_id: String(eventId),
    nickname: normalized.nickname,
    song_title: normalized.songTitle,
    up_count: normalized.upCount,
    memo: normalized.memo,
    created_by: authUser?.id || null,
  };
}

function upEventFromRows(row, entries) {
  return normalizeUpEvent({
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    memo: row.memo,
    entries: entries.map((entry) => ({
      id: entry.id,
      nickname: entry.nickname,
      songTitle: entry.song_title,
      upCount: entry.up_count,
      memo: entry.memo,
    })),
  });
}

async function refreshSharedSongData() {
  const { data, error } = await authDb
    .from("song_changes")
    .select("id, record_type, source_song_id, category, title, artist, inst_url, jeongwa_clip_url, skill_level, memo, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("공유 노래 데이터를 불러오지 못했습니다.", error.message);
    return false;
  }

  const remoteCustomSongs = [];
  const remoteEditedSongs = {};

  (data || []).forEach((row) => {
    const song = songFromChangeRow(row);
    if (song.custom) {
      remoteCustomSongs.push(song);
    } else {
      remoteEditedSongs[String(song.id)] = song;
    }
  });

  const customIds = new Set(remoteCustomSongs.map((song) => String(song.id)));
  customSongs = [
    ...remoteCustomSongs,
    ...legacyCustomSongs.filter((song) => !customIds.has(String(song.id))),
  ];
  editedSongsById = { ...remoteEditedSongs };
  Object.entries(legacyEditedSongsById).forEach(([id, song]) => {
    if (!editedSongsById[id]) editedSongsById[id] = song;
  });

  refreshSongs();
  render();
  updateRandomCount();
  return true;
}

async function refreshSharedUpEvents() {
  if (!canEdit()) {
    upEvents = [];
    return true;
  }

  const [eventsResult, entriesResult] = await Promise.all([
    authDb
      .from("up_events")
      .select("id, title, start_date, end_date, status, memo, created_at")
      .order("created_at", { ascending: false }),
    authDb
      .from("up_entries")
      .select("id, event_id, nickname, song_title, up_count, memo, created_at")
      .order("created_at", { ascending: false }),
  ]);

  if (eventsResult.error || entriesResult.error) {
    console.warn(
      "공유 UP 이벤트를 불러오지 못했습니다.",
      eventsResult.error?.message || entriesResult.error?.message,
    );
    return false;
  }

  const entriesByEvent = new Map();
  (entriesResult.data || []).forEach((entry) => {
    const entries = entriesByEvent.get(entry.event_id) || [];
    entries.push(entry);
    entriesByEvent.set(entry.event_id, entries);
  });

  const remoteEvents = (eventsResult.data || []).map((event) => (
    upEventFromRows(event, entriesByEvent.get(event.id) || [])
  ));
  const remoteIds = new Set(remoteEvents.map((event) => String(event.id)));
  upEvents = [
    ...remoteEvents,
    ...legacyUpEvents.filter((event) => !remoteIds.has(String(event.id))),
  ];
  renderUpEvents();
  return true;
}

async function migrateLegacyData() {
  if (!canEdit() || !hasLegacyData()) return true;
  if (legacyMigrationPromise) return legacyMigrationPromise;

  legacyMigrationPromise = (async () => {
    const songRows = [
      ...legacyCustomSongs.map((song) => songToChangeRow(song, "custom")),
      ...Object.values(legacyEditedSongsById).map((song) => songToChangeRow(song, "override")),
    ];
    const eventRows = legacyUpEvents.map(upEventToRow);
    const entryRows = legacyUpEvents.flatMap((event) => (
      event.entries.map((entry) => upEntryToRow(event.id, entry))
    ));

    if (songRows.length) {
      const { error } = await authDb
        .from("song_changes")
        .upsert(songRows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    }

    if (eventRows.length) {
      const { error } = await authDb
        .from("up_events")
        .upsert(eventRows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    }

    if (entryRows.length) {
      const { error } = await authDb
        .from("up_entries")
        .upsert(entryRows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    }

    clearLegacyData();
    return true;
  })().catch((error) => {
    console.warn("기존 브라우저 데이터를 옮기지 못했습니다.", error.message);
    return false;
  }).finally(() => {
    legacyMigrationPromise = null;
  });

  return legacyMigrationPromise;
}

function categoryClass(category) {
  if (category === "J-POP") return "cat-jpop";
  if (category === "POP/OST") return "cat-pop";
  if (category === "숙제곡") return "cat-homework";
  return "cat-kpop";
}

function categoryBadge(category) {
  return `<span class="category-badge ${categoryClass(category)}">${escapeHtml(categoryLabels[category] || category)}</span>`;
}

function memoText(song) {
  return String(song.memo ?? song.note ?? "").trim();
}

function linkButton(url, label) {
  const href = String(url ?? "").trim();
  if (!href) return '<span class="muted">-</span>';
  return `<a class="link-pill" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function skillValue(song) {
  const level = Number.parseInt(song.skillLevel ?? song.skill ?? 0, 10);
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(5, level));
}

function skillFish(song) {
  const level = skillValue(song);
  if (!level) return '<span class="muted">-</span>';

  const filled = "🐟".repeat(level);
  const empty = "🐟".repeat(5 - level);
  return `
    <span class="fish-rating" aria-label="숙련도 ${level}/5">
      <span>${filled}</span><span class="fish-empty">${empty}</span>
    </span>
  `;
}

function categoryCount(category) {
  return songs.filter((song) => song.category === category).length;
}

function matchesQuery(song, query) {
  if (!query) return true;
  const haystack = normalize([
    song.title,
    song.artist,
    memoText(song),
    song.instUrl,
    song.jeongwaClipUrl,
    song.category,
  ].join(" "));
  return haystack.includes(query);
}

function filteredSongs() {
  const query = normalize(state.query);
  return songs.filter((song) => song.category === state.category && matchesQuery(song, query));
}

function renderTabs() {
  const tabs = $("#category-tabs");
  tabs.innerHTML = categories.map((category) => {
    const active = category === state.category ? " active" : "";
    return `
      <button class="tab${active}" type="button" data-category="${escapeHtml(category)}">
        <span>${escapeHtml(categoryLabels[category])}</span>
        <span class="tab-count">${categoryCount(category).toLocaleString("ko-KR")}</span>
      </button>
    `;
  }).join("");

  tabs.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      render();
      updateRandomCount();
    });
  });
}

function populateCategorySelects() {
  document.querySelectorAll("#one-category, #many-category, #edit-category").forEach((select) => {
    select.innerHTML = categories.map((category) => (
      `<option value="${escapeHtml(category)}">${escapeHtml(categoryLabels[category])}</option>`
    )).join("");
    select.value = state.category;
  });
}

function renderTable(items) {
  const body = $("#song-table-body");
  const editable = canEdit();
  body.innerHTML = items.map((song) => `
    <tr class="song-row${editable ? " editable-row" : ""}" data-song-id="${escapeHtml(song.id)}"${editable ? ` tabindex="0" aria-label="${escapeHtml(song.title)} 수정"` : ""}>
      <td>${categoryBadge(song.category)}</td>
      <td>${escapeHtml(song.title)}</td>
      <td>${escapeHtml(song.artist || "")}</td>
      <td>${linkButton(song.instUrl, "Inst")}</td>
      <td>${linkButton(song.jeongwaClipUrl, "클립")}</td>
      <td class="skill-cell">${skillFish(song)}</td>
      <td class="${memoText(song) ? "memo" : "muted"}">${memoText(song) ? escapeHtml(memoText(song)) : "-"}</td>
    </tr>
  `).join("");
}

function renderCards(items) {
  const list = $("#song-card-list");
  const editable = canEdit();
  list.innerHTML = items.map((song) => `
    <article class="song-card${editable ? " editable-card" : ""}" data-song-id="${escapeHtml(song.id)}"${editable ? ` tabindex="0" aria-label="${escapeHtml(song.title)} 수정"` : ""}>
      <div class="song-card-top">
        ${categoryBadge(song.category)}
      </div>
      <div class="song-card-title">${escapeHtml(song.title)}</div>
      <div class="song-card-artist">${escapeHtml(song.artist || "")}</div>
      <div class="song-card-meta">
        <span>Inst ${linkButton(song.instUrl, "열기")}</span>
        <span>정와클립 ${linkButton(song.jeongwaClipUrl, "열기")}</span>
        <span>숙련도 ${skillFish(song)}</span>
      </div>
      ${memoText(song) ? `<div class="song-card-memo">${escapeHtml(memoText(song))}</div>` : ""}
    </article>
  `).join("");
}

function renderSummary(items) {
  const label = categoryLabels[state.category];
  const total = categoryCount(state.category);
  const hasQuery = normalize(state.query).length > 0;
  $("#result-summary").textContent = hasQuery
    ? `${label} 검색 결과 ${items.length.toLocaleString("ko-KR")}곡 / 전체 ${total.toLocaleString("ko-KR")}곡`
    : `${label} ${total.toLocaleString("ko-KR")}곡`;
}

function render() {
  renderTabs();
  const items = filteredSongs();
  renderSummary(items);
  renderTable(items);
  renderCards(items);
  $("#empty-state").hidden = items.length !== 0;
  $("#table-wrap").hidden = items.length === 0;
  $("#song-card-list").hidden = items.length === 0;
  $("#clear-search").classList.toggle("visible", state.query.trim().length > 0);
}

function openModal(id) {
  const modal = $(id);
  modal.hidden = false;
}

function closeModal(id) {
  $(id).hidden = true;
}

function setAuthMenu(open) {
  const menu = $("#auth-menu");
  const button = $("#auth-button");
  menu.hidden = !open;
  button.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
}

function openLoginModal() {
  setAuthMenu(false);
  $("#login-status").textContent = "";
  openModal("#login-modal");
  $("#google-login-button").focus();
}

function closeLoginModal() {
  closeModal("#login-modal");
}

function authRedirectTo() {
  if (location.protocol === "file:") return "";
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (localHosts.has(location.hostname)) return `${location.protocol}//${location.host}/`;
  return "https://jeongwa.com/";
}

async function signInWithGoogle() {
  const status = $("#login-status");
  const button = $("#google-login-button");

  if (location.protocol === "file:") {
    status.textContent = "로컬 로그인은 http://localhost:4000에서 이용해주세요.";
    return;
  }

  status.textContent = "Google 로그인 페이지로 이동하는 중입니다.";
  button.disabled = true;
  const { data, error } = await authDb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authRedirectTo(),
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error) {
    status.textContent = `로그인 준비에 실패했습니다: ${error.message}`;
    button.disabled = false;
    return;
  }

  if (data?.url) {
    window.location.assign(data.url);
    return;
  }

  status.textContent = "로그인 주소를 만들지 못했습니다. 잠시 후 다시 시도해주세요.";
  button.disabled = false;
}

async function logout() {
  await authDb.auth.signOut();
  authUser = null;
  editorEmails = [];
  upEvents = [];
  setAuthMenu(false);
  setFabMenu(false);
  closeAddOneModal();
  closeAddManyModal();
  closeEditSongModal();
  closeAdminModal();
  updateAuthUi();
  render();
}

async function refreshEditorEmails() {
  if (!isSignedIn()) {
    editorEmails = [];
    return;
  }

  const { data, error } = await authDb
    .from("editors")
    .select("email")
    .order("email", { ascending: true });

  if (error) {
    console.warn("편집자 목록을 불러오지 못했습니다.", error.message);
    editorEmails = [];
    return;
  }

  editorEmails = uniqueEmails((data || []).map((row) => row.email));
}

async function applyAuthSession(session) {
  authUser = session?.user
    ? {
        id: session.user.id,
        email: normalizeEmail(session.user.email),
        name: clean(session.user.user_metadata?.full_name || session.user.user_metadata?.name),
        avatarUrl: clean(session.user.user_metadata?.avatar_url),
      }
    : null;

  await refreshEditorEmails();
  if (canEdit()) {
    await migrateLegacyData();
    await Promise.all([refreshSharedSongData(), refreshSharedUpEvents()]);
  } else {
    await refreshSharedSongData();
    upEvents = [];
  }
  updateAuthUi();
  render();
}

async function initAuth() {
  authDb.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => applyAuthSession(session), 0);
  });

  const currentUrl = new URL(window.location.href);
  const authError = currentUrl.searchParams.get("error_description") || currentUrl.searchParams.get("error");
  if (authError) {
    currentUrl.searchParams.delete("error");
    currentUrl.searchParams.delete("error_code");
    currentUrl.searchParams.delete("error_description");
    history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);
    openLoginModal();
    $("#login-status").textContent = `로그인에 실패했습니다: ${authError}`;
  }

  const authCode = currentUrl.searchParams.get("code");
  if (authCode) {
    const { data, error } = await authDb.auth.exchangeCodeForSession(authCode);
    currentUrl.searchParams.delete("code");
    currentUrl.searchParams.delete("state");
    history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);

    if (error) {
      openLoginModal();
      $("#login-status").textContent = `로그인 처리에 실패했습니다: ${error.message}`;
    } else {
      await applyAuthSession(data.session);
      closeLoginModal();
      return;
    }
  }

  const { data, error } = await authDb.auth.getSession();
  if (error) console.warn("로그인 상태를 확인하지 못했습니다.", error.message);
  await applyAuthSession(data?.session || null);
}

function updateAuthUi() {
  const signedIn = isSignedIn();
  const editable = canEdit();
  const label = $("#auth-label");
  const button = $("#auth-button");
  const menuUser = $("#auth-menu-user");
  const adminButton = $("#open-admin-settings");
  const fabWrap = $("#add-fab-wrap");

  document.body.classList.toggle("edit-mode", editable);
  button.classList.toggle("signed-in", signedIn && editable);
  button.classList.toggle("viewer", signedIn && !editable);
  label.textContent = signedIn ? (authUser.name || displayNameFromEmail(authUser.email)) : "로그인";
  menuUser.textContent = signedIn ? authUser.email : "";
  adminButton.hidden = !editable;
  fabWrap.hidden = !editable;

  if (!signedIn) {
    setAuthMenu(false);
  }
}

function ensureEditMode() {
  if (canEdit()) return true;
  if (!isSignedIn()) openLoginModal();
  return false;
}

function openAdminModal() {
  if (!ensureEditMode()) return;
  setAuthMenu(false);
  renderAdmin();
  openModal("#admin-modal");
}

function closeAdminModal() {
  closeModal("#admin-modal");
}

function setAdminTab(tab) {
  activeAdminTab = tab;
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const active = button.dataset.adminTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    const active = panel.dataset.adminPanel === tab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function renderAdmin() {
  setAdminTab(activeAdminTab);
  $("#editor-form").hidden = !canManageEditors();
  renderEditorList();
  renderUpEvents();
}

function renderEditorList() {
  const list = $("#editor-list");
  const emails = uniqueEmails([ownerEmail, ...editorEmails]);

  if (!emails.length) {
    list.innerHTML = '<p class="admin-empty">편집자가 없습니다.</p>';
    return;
  }

  list.innerHTML = emails.map((email) => {
    const owner = email === ownerEmail;
    return `
      <div class="editor-item">
        <div>
          <div class="editor-email">${escapeHtml(email)}</div>
          ${owner ? '<span class="role-badge">소유자</span>' : '<span class="role-badge">편집자</span>'}
        </div>
        ${canManageEditors() && !owner
          ? `<button class="admin-mini-btn" type="button" data-remove-editor="${escapeHtml(email)}">삭제</button>`
          : ""}
      </div>
    `;
  }).join("");
}

async function addEditorEmail(email) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    $("#editor-status").textContent = "이메일 형식을 확인해주세요.";
    return;
  }

  if (!canManageEditors()) {
    $("#editor-status").textContent = "소유자만 편집자를 관리할 수 있습니다.";
    return;
  }

  const { error } = await authDb
    .from("editors")
    .upsert({ email: normalized, created_by: authUser.id }, { onConflict: "email" });

  if (error) {
    $("#editor-status").textContent = `추가하지 못했습니다: ${error.message}`;
    return;
  }

  editorEmails = uniqueEmails([...editorEmails, normalized]);
  $("#editor-email").value = "";
  $("#editor-status").textContent = "추가되었습니다.";
  renderEditorList();
  updateAuthUi();
  render();
}

async function removeEditorEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized === ownerEmail) return;

  if (!canManageEditors()) {
    $("#editor-status").textContent = "소유자만 편집자를 관리할 수 있습니다.";
    return;
  }

  const { error } = await authDb
    .from("editors")
    .delete()
    .eq("email", normalized);

  if (error) {
    $("#editor-status").textContent = `삭제하지 못했습니다: ${error.message}`;
    return;
  }

  editorEmails = editorEmails.filter((editorEmail) => editorEmail !== normalized);
  $("#editor-status").textContent = "삭제되었습니다.";
  renderEditorList();
  updateAuthUi();
  render();
}

function dateRangeText(event) {
  const start = clean(event.startDate);
  const end = clean(event.endDate);
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} 시작`;
  if (end) return `${end} 종료`;
  return "기간 미정";
}

function renderUpEntryList(event) {
  if (!event.entries.length) {
    return '<p class="admin-empty">등록된 참여자가 없습니다.</p>';
  }

  return `
    <ul class="up-entry-list">
      ${event.entries.map((entry) => `
        <li class="up-entry-item">
          <div class="up-entry-main">
            <strong>${escapeHtml(entry.nickname || "-")}</strong>
            ${entry.songTitle ? ` · ${escapeHtml(entry.songTitle)}` : ""}
            ${entry.memo ? ` · ${escapeHtml(entry.memo)}` : ""}
          </div>
          <span class="up-count">${Number(entry.upCount || 0).toLocaleString("ko-KR")} UP</span>
          <button class="admin-mini-btn" type="button" data-delete-up-entry="${escapeHtml(entry.id)}" data-event-id="${escapeHtml(event.id)}">삭제</button>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderUpEvents() {
  const list = $("#up-event-list");
  if (!upEvents.length) {
    list.innerHTML = '<p class="admin-empty">등록된 UP 이벤트가 없습니다.</p>';
    return;
  }

  list.innerHTML = upEvents.map((event) => `
    <article class="up-event-card">
      <div class="up-event-head">
        <div>
          <h3 class="up-event-title">${escapeHtml(event.title)}</h3>
          <div class="up-event-meta">${escapeHtml(dateRangeText(event))}</div>
        </div>
        <span class="up-status">${escapeHtml(event.status)}</span>
      </div>
      ${event.memo ? `<div class="up-event-memo">${escapeHtml(event.memo)}</div>` : ""}
      ${renderUpEntryList(event)}
      <form class="up-entry-form" data-event-id="${escapeHtml(event.id)}">
        <input name="nickname" type="text" placeholder="닉네임" autocomplete="off">
        <input name="songTitle" type="text" placeholder="곡명" autocomplete="off">
        <input name="upCount" type="number" min="0" step="1" placeholder="UP">
        <input name="memo" type="text" placeholder="메모" autocomplete="off">
        <button type="submit">등록</button>
      </form>
      <div class="up-event-actions">
        <button class="admin-mini-btn" type="button" data-edit-up-event="${escapeHtml(event.id)}">수정</button>
        <button class="admin-mini-btn" type="button" data-delete-up-event="${escapeHtml(event.id)}">삭제</button>
      </div>
    </article>
  `).join("");
}

function upEventFromForm(form) {
  const data = new FormData(form);
  return normalizeUpEvent({
    id: data.get("id") || undefined,
    title: data.get("title"),
    startDate: data.get("startDate"),
    endDate: data.get("endDate"),
    status: data.get("status"),
    memo: data.get("memo"),
    entries: upEvents.find((event) => event.id === data.get("id"))?.entries || [],
  });
}

function clearUpEventForm() {
  $("#up-event-form").reset();
  $("#up-event-id").value = "";
  $("#up-event-status-select").value = "진행중";
  $("#up-event-status").textContent = "";
}

function editUpEvent(eventId) {
  const event = upEvents.find((item) => item.id === eventId);
  if (!event) return;

  $("#up-event-id").value = event.id;
  $("#up-event-title").value = event.title;
  $("#up-event-start").value = event.startDate;
  $("#up-event-end").value = event.endDate;
  $("#up-event-status-select").value = event.status;
  $("#up-event-memo").value = event.memo;
  $("#up-event-title").focus();
}

async function saveUpEvent(form) {
  const event = upEventFromForm(form);
  if (!event.title) return false;

  const { error } = await authDb
    .from("up_events")
    .upsert(upEventToRow(event), { onConflict: "id" });

  if (error) {
    $("#up-event-status").textContent = `저장하지 못했습니다: ${error.message}`;
    return false;
  }

  const exists = upEvents.some((item) => item.id === event.id);
  upEvents = exists
    ? upEvents.map((item) => (item.id === event.id ? event : item))
    : [event, ...upEvents];
  clearUpEventForm();
  renderUpEvents();
  return true;
}

async function deleteUpEvent(eventId) {
  const { error } = await authDb
    .from("up_events")
    .delete()
    .eq("id", String(eventId));

  if (error) {
    $("#up-event-status").textContent = `삭제하지 못했습니다: ${error.message}`;
    return false;
  }

  upEvents = upEvents.filter((event) => event.id !== eventId);
  renderUpEvents();
  return true;
}

async function addUpEntry(form) {
  const eventId = form.dataset.eventId;
  const data = new FormData(form);
  const entry = normalizeUpEntry({
    nickname: data.get("nickname"),
    songTitle: data.get("songTitle"),
    upCount: data.get("upCount"),
    memo: data.get("memo"),
  });

  if (!entry.nickname && !entry.songTitle) return false;

  const { error } = await authDb
    .from("up_entries")
    .insert(upEntryToRow(eventId, entry));

  if (error) {
    $("#up-event-status").textContent = `참여자를 등록하지 못했습니다: ${error.message}`;
    return false;
  }

  upEvents = upEvents.map((event) => (
    event.id === eventId ? { ...event, entries: [entry, ...event.entries] } : event
  ));
  renderUpEvents();
  return true;
}

async function deleteUpEntry(eventId, entryId) {
  const { error } = await authDb
    .from("up_entries")
    .delete()
    .eq("id", String(entryId));

  if (error) {
    $("#up-event-status").textContent = `참여자를 삭제하지 못했습니다: ${error.message}`;
    return false;
  }

  upEvents = upEvents.map((event) => (
    event.id === eventId
      ? { ...event, entries: event.entries.filter((entry) => entry.id !== entryId) }
      : event
  ));
  renderUpEvents();
  return true;
}

function ratingInputForPicker(picker) {
  return document.getElementById(picker.dataset.ratingFor);
}

function renderRatingPicker(picker) {
  const input = ratingInputForPicker(picker);
  const value = normalizeSkill(input?.value);

  picker.querySelectorAll(".skill-pick").forEach((button) => {
    const level = normalizeSkill(button.dataset.level);
    const active = level <= value;
    button.classList.toggle("active", active);
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(active && level === value));
  });
}

function setRatingValue(inputId, value) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.value = String(normalizeSkill(value));
  document.querySelectorAll(`.skill-picker[data-rating-for="${inputId}"]`).forEach(renderRatingPicker);
}

function bindRatingPickers() {
  document.querySelectorAll(".skill-picker").forEach((picker) => {
    renderRatingPicker(picker);
    picker.addEventListener("click", (event) => {
      const button = event.target.closest(".skill-pick");
      if (!button) return;

      const input = ratingInputForPicker(picker);
      const current = normalizeSkill(input?.value);
      const next = normalizeSkill(button.dataset.level);
      setRatingValue(input.id, current === next ? 0 : next);
    });
  });
}

function setFabMenu(open) {
  const menu = $("#add-fab-menu");
  const button = $("#add-fab");
  menu.hidden = !open;
  button.classList.toggle("open", open);
  button.setAttribute("aria-expanded", String(open));
}

function toggleFabMenu() {
  setFabMenu($("#add-fab-menu").hidden);
}

function currentRandomPool() {
  const scope = document.querySelector('input[name="random-scope"]:checked')?.value || "current";
  const excludeHomework = $("#exclude-homework").checked;
  let pool = scope === "all" ? [...songs] : filteredSongs();

  if (excludeHomework) {
    pool = pool.filter((song) => song.category !== "숙제곡");
  }

  return pool;
}

function updateRandomCount() {
  const pool = currentRandomPool();
  $("#random-count").textContent = `조건에 맞는 곡 ${pool.length.toLocaleString("ko-KR")}곡`;
}

function renderRandomResult(song) {
  $("#random-result").innerHTML = `
    <span class="picked-category">${categoryBadge(song.category)}</span>
    <h3>${escapeHtml(song.title)}</h3>
    <p>${escapeHtml(song.artist || "")}</p>
    <div class="picked-meta">
      <span>Inst ${linkButton(song.instUrl, "열기")}</span>
      <span>정와클립 ${linkButton(song.jeongwaClipUrl, "열기")}</span>
      <span>숙련도 ${skillFish(song)}</span>
    </div>
    ${memoText(song) ? `<div class="picked-note">${escapeHtml(memoText(song))}</div>` : ""}
  `;
}

function drawRandom() {
  const pool = currentRandomPool();
  if (!pool.length) {
    $("#random-result").innerHTML = '<span class="result-placeholder">조건에 맞는 곡이 없습니다.</span>';
    return;
  }

  const result = $("#random-result");
  const button = $("#draw-random");
  let ticks = 0;
  button.disabled = true;
  button.textContent = "뽑는 중";

  const timer = setInterval(() => {
    const sample = pool[Math.floor(Math.random() * pool.length)];
    renderRandomResult(sample);
    ticks += 1;

    if (ticks >= 12) {
      clearInterval(timer);
      const finalSong = pool[Math.floor(Math.random() * pool.length)];
      renderRandomResult(finalSong);
      result.animate(
        [
          { transform: "scale(0.98)", opacity: 0.78 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 180, easing: "ease-out" },
      );
      button.disabled = false;
      button.textContent = "다시 뽑기";
    }
  }, 60);
}

function openRandomModal() {
  openModal("#random-modal");
  updateRandomCount();
  $("#draw-random").focus();
}

function closeRandomModal() {
  closeModal("#random-modal");
}

function openAddOneModal() {
  if (!ensureEditMode()) return;
  setFabMenu(false);
  populateCategorySelects();
  $("#one-category").value = state.category;
  $("#add-one-form").reset();
  $("#one-category").value = state.category;
  $("#one-status").textContent = "";
  setRatingValue("one-skill", 0);
  openModal("#add-one-modal");
  $("#one-title").focus();
}

function closeAddOneModal() {
  closeModal("#add-one-modal");
}

function openAddManyModal() {
  if (!ensureEditMode()) return;
  setFabMenu(false);
  populateCategorySelects();
  $("#many-category").value = state.category;
  $("#add-many-form").reset();
  $("#many-category").value = state.category;
  $("#many-status").textContent = "";
  openModal("#add-many-modal");
  $("#many-rows").focus();
}

function closeAddManyModal() {
  closeModal("#add-many-modal");
}

function findSongById(songId) {
  return songs.find((song) => String(song.id) === String(songId));
}

function isEditedBaseSong(songId) {
  return Boolean(editedSongsById[String(songId)]);
}

function setEditFormValues(song) {
  $("#edit-id").value = song.id;
  $("#edit-category").value = song.category;
  $("#edit-title").value = song.title;
  $("#edit-artist").value = song.artist || "";
  $("#edit-inst").value = song.instUrl || "";
  $("#edit-clip").value = song.jeongwaClipUrl || "";
  setRatingValue("edit-skill", skillValue(song));
  $("#edit-memo").value = memoText(song);
  $("#edit-status").textContent = "";
  $("#reset-edit-song").hidden = song.custom || !isEditedBaseSong(song.id);
}

function openEditSongModal(songId) {
  if (!ensureEditMode()) return;
  const song = findSongById(songId);
  if (!song) return;

  setFabMenu(false);
  populateCategorySelects();
  setEditFormValues(song);
  openModal("#edit-song-modal");
  $("#edit-title").focus();
}

function closeEditSongModal() {
  closeModal("#edit-song-modal");
}

function isInteractiveTarget(target) {
  return Boolean(target.closest("a, button, input, select, textarea, label"));
}

function openSongEditFromElement(element) {
  if (!canEdit()) return;
  const target = element.closest("[data-song-id]");
  if (target) openEditSongModal(target.dataset.songId);
}

async function updateSong(songId, updates) {
  const original = findSongById(songId);
  if (!original) return false;

  const normalized = normalizeSongRecord({
    ...original,
    ...updates,
    id: original.id,
    custom: original.custom,
    edited: original.edited || !original.custom,
  });

  if (!normalized.title) return false;

  const recordType = original.custom ? "custom" : "override";
  const { error } = await authDb
    .from("song_changes")
    .upsert(songToChangeRow(normalized, recordType), { onConflict: "id" });

  if (error) {
    $("#edit-status").textContent = `저장하지 못했습니다: ${error.message}`;
    return false;
  }

  if (original.custom) {
    customSongs = customSongs.map((song) => (
      String(song.id) === String(songId) ? normalized : song
    ));
  } else {
    editedSongsById[String(original.id)] = normalized;
  }

  state.category = normalized.category;
  refreshSongs();
  render();
  updateRandomCount();
  return true;
}

async function resetEditedSong(songId) {
  const { error } = await authDb
    .from("song_changes")
    .delete()
    .eq("id", songChangeId(songId));

  if (error) {
    $("#edit-status").textContent = `원래대로 되돌리지 못했습니다: ${error.message}`;
    return false;
  }

  delete editedSongsById[String(songId)];
  refreshSongs();

  const restored = findSongById(songId);
  if (restored) {
    state.category = restored.category;
  }

  render();
  updateRandomCount();
  return true;
}

async function addCustomSongs(newSongs) {
  const now = Date.now();
  const normalized = newSongs.map((song, index) => normalizeSongRecord({
    ...song,
    id: `custom-${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    custom: true,
  })).filter((song) => song.title);

  if (!normalized.length) return 0;

  const { error } = await authDb
    .from("song_changes")
    .insert(normalized.map((song) => songToChangeRow(song, "custom")));

  if (error) throw error;

  customSongs = [...customSongs, ...normalized];
  refreshSongs();
  render();
  updateRandomCount();
  return normalized.length;
}

function songFromForm(form) {
  const data = new FormData(form);
  return {
    category: data.get("category"),
    title: data.get("title"),
    artist: data.get("artist"),
    instUrl: data.get("instUrl"),
    jeongwaClipUrl: data.get("jeongwaClipUrl"),
    skillLevel: data.get("skillLevel"),
    memo: data.get("memo"),
  };
}

function splitBulkLine(line) {
  if (line.includes("\t")) return line.split("\t");
  return line.split(",");
}

function isBulkHeader(cols) {
  const joined = cols.map(normalize).join(" ");
  return joined.includes("분류") && (joined.includes("노래 제목") || joined.includes("제목"));
}

function songFromBulkLine(line, fallbackCategory) {
  const cols = splitBulkLine(line).map(clean);
  if (cols.length < 2 || isBulkHeader(cols)) return null;

  const hasCategory = categories.includes(cols[0]);
  const offset = hasCategory ? 1 : 0;

  return {
    category: hasCategory ? cols[0] : fallbackCategory,
    title: cols[offset],
    artist: cols[offset + 1],
    instUrl: cols[offset + 2],
    jeongwaClipUrl: cols[offset + 3],
    skillLevel: cols[offset + 4],
    memo: cols.slice(offset + 5).join(" "),
  };
}

function parseBulkSongs(text, fallbackCategory) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => songFromBulkLine(line, fallbackCategory))
    .filter((song) => song && clean(song.title));
}

function bindEvents() {
  $("#song-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
    updateRandomCount();
  });

  $("#clear-search").addEventListener("click", () => {
    state.query = "";
    $("#song-search").value = "";
    $("#song-search").focus();
    render();
    updateRandomCount();
  });

  $("#auth-button").addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isSignedIn()) {
      openLoginModal();
      return;
    }

    setAuthMenu($("#auth-menu").hidden);
  });
  $("#auth-menu").addEventListener("click", (event) => {
    event.stopPropagation();
  });
  $("#open-admin-settings").addEventListener("click", openAdminModal);
  $("#logout-button").addEventListener("click", logout);
  $("#google-login-button").addEventListener("click", signInWithGoogle);
  $("#close-login").addEventListener("click", closeLoginModal);
  $("#close-admin").addEventListener("click", closeAdminModal);
  $("#open-random").addEventListener("click", openRandomModal);
  $("#close-random").addEventListener("click", closeRandomModal);
  $("#song-table-body").addEventListener("click", (event) => {
    if (isInteractiveTarget(event.target)) return;
    openSongEditFromElement(event.target);
  });
  $("#song-table-body").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSongEditFromElement(event.target);
  });
  $("#song-card-list").addEventListener("click", (event) => {
    if (isInteractiveTarget(event.target)) return;
    openSongEditFromElement(event.target);
  });
  $("#song-card-list").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSongEditFromElement(event.target);
  });
  $("#add-fab").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFabMenu();
  });
  $("#open-add-one").addEventListener("click", openAddOneModal);
  $("#open-add-many").addEventListener("click", openAddManyModal);
  $("#close-add-one").addEventListener("click", closeAddOneModal);
  $("#close-add-many").addEventListener("click", closeAddManyModal);
  $("#close-edit-song").addEventListener("click", closeEditSongModal);
  $("#draw-random").addEventListener("click", drawRandom);
  $("#random-modal").addEventListener("click", (event) => {
    if (event.target.id === "random-modal") closeRandomModal();
  });
  $("#login-modal").addEventListener("click", (event) => {
    if (event.target.id === "login-modal") closeLoginModal();
  });
  $("#admin-modal").addEventListener("click", (event) => {
    if (event.target.id === "admin-modal") closeAdminModal();
  });
  $("#add-one-modal").addEventListener("click", (event) => {
    if (event.target.id === "add-one-modal") closeAddOneModal();
  });
  $("#add-many-modal").addEventListener("click", (event) => {
    if (event.target.id === "add-many-modal") closeAddManyModal();
  });
  $("#edit-song-modal").addEventListener("click", (event) => {
    if (event.target.id === "edit-song-modal") closeEditSongModal();
  });

  document.addEventListener("click", (event) => {
    const wrap = $("#add-fab-wrap");
    if (!$("#add-fab-menu").hidden && !wrap.contains(event.target)) {
      setFabMenu(false);
    }
    if (!$("#auth-menu").hidden && !$("#auth-area").contains(event.target)) {
      setAuthMenu(false);
    }
  });

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => setAdminTab(button.dataset.adminTab));
  });

  $("#editor-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await addEditorEmail($("#editor-email").value);
  });

  $("#editor-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-editor]");
    if (!button) return;
    await removeEditorEmail(button.dataset.removeEditor);
  });

  $("#up-event-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveUpEvent(event.currentTarget);
  });

  $("#clear-up-event-form").addEventListener("click", clearUpEventForm);

  $("#up-event-list").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-up-event]");
    const deleteButton = event.target.closest("[data-delete-up-event]");
    const deleteEntryButton = event.target.closest("[data-delete-up-entry]");

    if (editButton) {
      editUpEvent(editButton.dataset.editUpEvent);
      return;
    }

    if (deleteButton) {
      await deleteUpEvent(deleteButton.dataset.deleteUpEvent);
      return;
    }

    if (deleteEntryButton) {
      await deleteUpEntry(deleteEntryButton.dataset.eventId, deleteEntryButton.dataset.deleteUpEntry);
    }
  });

  $("#up-event-list").addEventListener("submit", async (event) => {
    const form = event.target.closest(".up-entry-form");
    if (!form) return;
    event.preventDefault();
    await addUpEntry(form);
  });

  $("#add-one-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#one-status").textContent = "저장 중입니다.";
    try {
      const count = await addCustomSongs([songFromForm(event.currentTarget)]);
      if (count) closeAddOneModal();
    } catch (error) {
      $("#one-status").textContent = `추가하지 못했습니다: ${error.message}`;
    }
  });

  $("#add-many-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const rows = parseBulkSongs($("#many-rows").value, $("#many-category").value);
    $("#many-status").textContent = "저장 중입니다.";
    try {
      const count = await addCustomSongs(rows);
      $("#many-status").textContent = `${count.toLocaleString("ko-KR")}곡 추가됨`;
      if (count) {
        $("#many-rows").value = "";
      }
    } catch (error) {
      $("#many-status").textContent = `추가하지 못했습니다: ${error.message}`;
    }
  });

  $("#edit-song-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const songId = $("#edit-id").value;
    $("#edit-status").textContent = "저장 중입니다.";
    if (await updateSong(songId, songFromForm(event.currentTarget))) {
      closeEditSongModal();
    }
  });

  $("#reset-edit-song").addEventListener("click", async () => {
    const songId = $("#edit-id").value;
    $("#edit-status").textContent = "되돌리는 중입니다.";
    if (await resetEditedSong(songId)) closeEditSongModal();
  });

  document.querySelectorAll('input[name="random-scope"], #exclude-homework').forEach((input) => {
    input.addEventListener("change", updateRandomCount);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setAuthMenu(false);
      setFabMenu(false);
      if (!$("#login-modal").hidden) closeLoginModal();
      if (!$("#admin-modal").hidden) closeAdminModal();
      if (!$("#random-modal").hidden) closeRandomModal();
      if (!$("#add-one-modal").hidden) closeAddOneModal();
      if (!$("#add-many-modal").hidden) closeAddManyModal();
      if (!$("#edit-song-modal").hidden) closeEditSongModal();
    }
  });
}

bindEvents();
populateCategorySelects();
bindRatingPickers();
updateAuthUi();
render();
refreshSharedSongData().finally(initAuth);
