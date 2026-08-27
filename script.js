const baseSongs = Array.isArray(window.JEONGWA_SONGS) ? window.JEONGWA_SONGS : [];
const storageKey = "jeongwa-songbook-added-songs";
const editsStorageKey = "jeongwa-songbook-edited-songs";
const upEventsStorageKey = "jeongwa-songbook-up-events";
const viewModeStorageKey = "jeongwa-songbook-view-mode";
const SUPABASE_URL = "https://ftdptxblxijbmgkbqnnh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3_tpgX3yEvfGrGvFdhRUzA_qQuemlEh";
const OWNER_EMAIL = "riosniper12@gmail.com";
const SOOP_PROXY_URL = "https://clever-rhino-36.hanul4269.deno.net";
const SOOP_CHANNEL_ID = "jeongwazzang";
const UP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const LIVE_REFRESH_INTERVAL_MS = 60 * 1000;
const ALL_CATEGORY = "전체";
const categories = ["K-POP", "J-POP", "POP/OST", "숙제곡"];
const categoryLabels = {
  "전체": "전체",
  "K-POP": "K-POP",
  "J-POP": "J-POP",
  "POP/OST": "POP/OST",
  "숙제곡": "숙제곡",
};

const state = {
  category: ALL_CATEGORY,
  query: "",
  viewMode: loadViewMode(),
  favoritesOnly: false,
  selectedTags: [],
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
let activeUpEventId = null;
let upRankingRefreshTimer = null;
let upStartupHandled = false;
const upRankingCache = new Map();
let activeAdminTab = "editors";
let legacyMigrationPromise = null;
let songCoverColumnReady = null;
let songTagsColumnReady = null;
let coverFillCancelled = false;
let coverFillRunning = false;
let songReactionsReady = null;
const likeCountsBySong = new Map();
const myReactionsBySong = new Map();
const pendingReactionSongs = new Set();
let liveStatusRefreshTimer = null;

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

function loadViewMode() {
  try {
    return localStorage.getItem(viewModeStorageKey) === "album" ? "album" : "list";
  } catch {
    return "list";
  }
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

function normalizeCategory(value, fallback = "K-POP") {
  const text = clean(value);
  return categories.includes(text) ? text : fallback;
}

function normalizeTags(value) {
  const values = Array.isArray(value)
    ? value
    : clean(value).split(/[,/\n]/);
  const seen = new Set();
  return values
    .map((tag) => clean(tag).replace(/^#+/, ""))
    .filter((tag) => {
      const key = normalize(tag);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function normalizeSongRecord(song) {
  return {
    id: song.id ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category: normalizeCategory(song.category, "K-POP"),
    title: clean(song.title),
    artist: clean(song.artist),
    coverUrl: normalizeUrl(song.coverUrl ?? song.cover_url),
    instUrl: normalizeUrl(song.instUrl),
    jeongwaClipUrl: normalizeUrl(song.jeongwaClipUrl),
    skillLevel: normalizeSkill(song.skillLevel),
    tags: normalizeTags(song.tags),
    memo: clean(song.memo ?? song.note),
    custom: Boolean(song.custom),
    edited: Boolean(song.edited),
  };
}

function normalizeUpEvent(event) {
  const sortOrder = Number.parseInt(event.sortOrder ?? event.sort_order, 10);

  return {
    id: event.id ?? `up-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    tabName: clean(event.tabName ?? event.tab_name) || "UP 이벤트",
    title: clean(event.title),
    soopUrl: normalizeUrl(event.soopUrl ?? event.soop_url),
    sortOrder: Number.isFinite(sortOrder) ? Math.max(0, sortOrder) : 0,
    isActive: event.isActive ?? event.is_active ?? true,
    showOnStartup: event.showOnStartup ?? event.show_on_startup ?? false,
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
  const row = {
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

  if (songCoverColumnReady !== false) row.cover_url = normalized.coverUrl;
  if (songTagsColumnReady !== false) row.tags = normalized.tags;
  return row;
}

function songFromChangeRow(row) {
  const custom = row.record_type === "custom";
  return normalizeSongRecord({
    id: custom ? row.id : row.source_song_id,
    category: row.category,
    title: row.title,
    artist: row.artist,
    coverUrl: row.cover_url,
    instUrl: row.inst_url,
    jeongwaClipUrl: row.jeongwa_clip_url,
    skillLevel: row.skill_level,
    tags: row.tags,
    memo: row.memo,
    custom,
    edited: !custom,
  });
}

function upEventToRow(event) {
  const normalized = normalizeUpEvent(event);
  return {
    id: String(normalized.id),
    tab_name: normalized.tabName,
    title: normalized.title,
    soop_url: normalized.soopUrl,
    sort_order: normalized.sortOrder,
    is_active: Boolean(normalized.isActive),
    show_on_startup: Boolean(normalized.showOnStartup),
    updated_at: new Date().toISOString(),
    updated_by: authUser?.id || null,
  };
}

function upEventFromRow(row) {
  return normalizeUpEvent({
    id: row.id,
    tabName: row.tab_name,
    title: row.title,
    soopUrl: row.soop_url,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    showOnStartup: row.show_on_startup,
  });
}

async function refreshSharedSongData() {
  const requiredColumns = ["id", "record_type", "source_song_id", "category", "title", "artist", "inst_url", "jeongwa_clip_url", "skill_level", "memo", "created_at"];
  let data = null;
  let error = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const columns = [...requiredColumns];
    if (songCoverColumnReady !== false) columns.splice(6, 0, "cover_url");
    if (songTagsColumnReady !== false) columns.splice(columns.length - 2, 0, "tags");

    ({ data, error } = await authDb
      .from("song_changes")
      .select(columns.join(", "))
      .order("created_at", { ascending: true }));

    if (!error) {
      if (columns.includes("cover_url")) songCoverColumnReady = true;
      if (columns.includes("tags")) songTagsColumnReady = true;
      break;
    }

    let retry = false;
    if (/cover_url/i.test(error.message || "") && songCoverColumnReady !== false) {
      songCoverColumnReady = false;
      retry = true;
    }
    if (/\btags?\b/i.test(error.message || "") && songTagsColumnReady !== false) {
      songTagsColumnReady = false;
      retry = true;
    }
    if (!retry) break;
  }

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
  const { data, error } = await authDb
    .from("up_events")
    .select("id, tab_name, title, soop_url, sort_order, is_active, show_on_startup, updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("공유 UP 이벤트를 불러오지 못했습니다.", error.message);
    upEvents = [];
    updateUpRankingButton();
    return false;
  }

  upEvents = (data || []).map(upEventFromRow);
  updateUpRankingButton();
  renderUpEvents();
  maybeOpenStartupUpRanking();
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
    if (songRows.length) {
      const { error } = await authDb
        .from("song_changes")
        .upsert(songRows, { onConflict: "id", ignoreDuplicates: true });
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

function coverMarkup(song, variant = "thumb") {
  const url = clean(song.coverUrl);
  const label = `${song.title || "노래"} 앨범 커버`;
  return `
    <span class="song-cover song-cover-${escapeHtml(variant)}${url ? " has-image" : ""}">
      <span class="song-cover-placeholder" aria-hidden="true">♪</span>
      ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" data-cover-image>` : ""}
    </span>
  `;
}

function bindCoverImageErrors(root = document) {
  root.querySelectorAll("img[data-cover-image]").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
      image.closest(".song-cover")?.classList.remove("has-image");
    }, { once: true });
  });
}

function reactionState(songId) {
  return myReactionsBySong.get(String(songId)) || { liked: false, favorited: false };
}

function reactionMarkup(song) {
  const songId = String(song.id);
  const reaction = reactionState(songId);
  const likeCount = likeCountsBySong.get(songId) || 0;
  const pending = pendingReactionSongs.has(songId);
  return `
    <div class="song-reactions" aria-label="${escapeHtml(song.title)} 반응">
      <button class="song-reaction-btn like${reaction.liked ? " active" : ""}" type="button" data-song-reaction="like" data-reaction-song-id="${escapeHtml(songId)}" aria-label="좋아요${reaction.liked ? " 취소" : ""}" title="좋아요" aria-pressed="${reaction.liked}"${pending ? " disabled" : ""}>
        <i data-lucide="heart" aria-hidden="true"></i>
        <span>${Number(likeCount).toLocaleString("ko-KR")}</span>
      </button>
      <button class="song-reaction-btn favorite${reaction.favorited ? " active" : ""}" type="button" data-song-reaction="favorite" data-reaction-song-id="${escapeHtml(songId)}" aria-label="즐겨찾기${reaction.favorited ? " 해제" : ""}" title="즐겨찾기" aria-pressed="${reaction.favorited}"${pending ? " disabled" : ""}>
        <i data-lucide="star" aria-hidden="true"></i>
      </button>
    </div>
  `;
}

function showNotice(message) {
  let notice = $("#site-toast");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "site-toast";
    notice.className = "site-toast";
    notice.setAttribute("role", "status");
    document.body.append(notice);
  }

  notice.textContent = message;
  notice.classList.add("visible");
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.remove("visible"), 2600);
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

function tagsMarkup(song) {
  const tags = normalizeTags(song.tags);
  if (!tags.length) return "";
  return `<div class="song-tags" aria-label="태그">${tags.map((tag) => `<span class="song-tag">#${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function categoryCount(category) {
  if (category === ALL_CATEGORY) return songs.length;
  return songs.filter((song) => song.category === category).length;
}

function availableTagCounts() {
  const counts = new Map();
  songs
    .filter((song) => state.category === ALL_CATEGORY || song.category === state.category)
    .forEach((song) => normalizeTags(song.tags).forEach((tag) => {
      const key = normalize(tag);
      const current = counts.get(key) || { label: tag, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }));
  return [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
}

function syncSelectedTags(availableTags = availableTagCounts()) {
  const available = new Set(availableTags.map((tag) => tag.key));
  state.selectedTags = state.selectedTags.filter((tag) => available.has(normalize(tag)));
}

function renderTagFilter(availableTags = availableTagCounts()) {
  const wrap = $("#tag-filter");
  const list = $("#tag-filter-list");
  wrap.hidden = availableTags.length === 0;
  if (!availableTags.length) {
    list.innerHTML = "";
    return;
  }

  const selected = new Set(state.selectedTags.map(normalize));
  list.innerHTML = `
    <button class="tag-filter-chip${selected.size ? "" : " active"}" type="button" data-filter-tag="" aria-pressed="${!selected.size}">전체</button>
    ${availableTags.map((tag) => `
      <button class="tag-filter-chip${selected.has(tag.key) ? " active" : ""}" type="button" data-filter-tag="${escapeHtml(tag.label)}" aria-pressed="${selected.has(tag.key)}">
        #${escapeHtml(tag.label)} <span>${tag.count.toLocaleString("ko-KR")}</span>
      </button>
    `).join("")}
  `;
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
    normalizeTags(song.tags).join(" "),
  ].join(" "));
  return haystack.includes(query);
}

function filteredSongs() {
  const query = normalize(state.query);
  return songs.filter((song) => (
    (state.category === ALL_CATEGORY || song.category === state.category)
    && matchesQuery(song, query)
    && state.selectedTags.every((selectedTag) => normalizeTags(song.tags).some((tag) => normalize(tag) === normalize(selectedTag)))
    && (!state.favoritesOnly || reactionState(song.id).favorited)
  ));
}

function renderTabs() {
  const tabs = $("#category-tabs");
  tabs.innerHTML = [ALL_CATEGORY, ...categories].map((category) => {
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
      syncSelectedTags();
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
    select.value = categories.includes(state.category) ? state.category : categories[0];
  });
}

function renderTable(items) {
  const body = $("#song-table-body");
  const editable = canEdit();
  body.innerHTML = items.map((song) => `
    <tr class="song-row${editable ? " editable-row" : ""}" data-song-id="${escapeHtml(song.id)}"${editable ? ` tabindex="0" aria-label="${escapeHtml(song.title)} 수정"` : ""}>
      <td>${categoryBadge(song.category)}</td>
      <td>${coverMarkup(song)}</td>
      <td>
        <div class="song-title-cell">
          <span>${escapeHtml(song.title)}</span>
          ${tagsMarkup(song)}
          ${reactionMarkup(song)}
        </div>
      </td>
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
      <div class="song-card-layout">
        ${coverMarkup(song, "mobile")}
        <div class="song-card-body">
          <div class="song-card-top">
            ${categoryBadge(song.category)}
            ${reactionMarkup(song)}
          </div>
          <div class="song-card-title">${escapeHtml(song.title)}</div>
          <div class="song-card-artist">${escapeHtml(song.artist || "")}</div>
          ${tagsMarkup(song)}
        </div>
      </div>
      <div class="song-card-meta">
        <span>Inst ${linkButton(song.instUrl, "열기")}</span>
        <span>정와클립 ${linkButton(song.jeongwaClipUrl, "열기")}</span>
        <span>숙련도 ${skillFish(song)}</span>
      </div>
      ${memoText(song) ? `<div class="song-card-memo">${escapeHtml(memoText(song))}</div>` : ""}
    </article>
  `).join("");
}

function renderAlbumGrid(items) {
  const grid = $("#album-grid");
  const editable = canEdit();
  grid.innerHTML = items.map((song) => `
    <article class="album-card${editable ? " editable-card" : ""}" data-song-id="${escapeHtml(song.id)}"${editable ? ` tabindex="0" aria-label="${escapeHtml(song.title)} 수정"` : ""}>
      ${coverMarkup(song, "album")}
      <div class="album-card-copy">
        <div class="album-card-badges">
          ${categoryBadge(song.category)}
          ${skillValue(song) ? skillFish(song) : ""}
        </div>
        <h3>${escapeHtml(song.title)}</h3>
        <p>${escapeHtml(song.artist || "아티스트 미등록")}</p>
        ${tagsMarkup(song)}
        ${reactionMarkup(song)}
        <div class="album-card-links">
          ${song.instUrl ? linkButton(song.instUrl, "Inst") : ""}
          ${song.jeongwaClipUrl ? linkButton(song.jeongwaClipUrl, "클립") : ""}
        </div>
        ${memoText(song) ? `<div class="album-card-memo">${escapeHtml(memoText(song))}</div>` : ""}
      </div>
    </article>
  `).join("");
}

function renderViewToggle() {
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    const active = button.dataset.viewMode === state.viewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#favorite-filter").classList.toggle("active", state.favoritesOnly);
  $("#favorite-filter").setAttribute("aria-pressed", String(state.favoritesOnly));
}

function renderSummary(items) {
  const label = categoryLabels[state.category];
  const total = categoryCount(state.category);
  const isFiltered = normalize(state.query).length > 0 || state.favoritesOnly || state.selectedTags.length > 0;
  const resultLabel = state.favoritesOnly ? "즐겨찾기" : state.selectedTags.length ? "필터 결과" : "검색 결과";
  $("#result-summary").textContent = isFiltered
    ? `${label} ${resultLabel} ${items.length.toLocaleString("ko-KR")}곡 / 전체 ${total.toLocaleString("ko-KR")}곡`
    : `${label} ${total.toLocaleString("ko-KR")}곡`;
}

function render() {
  const availableTags = availableTagCounts();
  syncSelectedTags(availableTags);
  renderTabs();
  renderTagFilter(availableTags);
  const items = filteredSongs();
  renderSummary(items);
  renderTable(items);
  renderCards(items);
  renderAlbumGrid(items);
  renderViewToggle();
  $("#empty-state").hidden = items.length !== 0;
  const albumMode = state.viewMode === "album";
  $("#table-wrap").hidden = items.length === 0 || albumMode;
  $("#song-card-list").hidden = items.length === 0 || albumMode;
  $("#album-grid").hidden = items.length === 0 || !albumMode;
  $("#clear-search").classList.toggle("visible", state.query.trim().length > 0);
  bindCoverImageErrors($(".songbook"));
  window.lucide?.createIcons();
}

function openModal(id) {
  const modal = $(id);
  modal.hidden = false;
}

function closeModal(id) {
  $(id).hidden = true;
}

function renderLiveStatus(isLive, title = "", unavailable = false) {
  const badge = $("#live-badge");
  if (!badge) return;

  badge.classList.toggle("is-live", isLive);
  const label = isLive
    ? `정와 SOOP 방송 중${title ? `, ${title}` : ""}`
    : unavailable
      ? "정와 SOOP 방송국, 방송 상태를 확인하지 못함"
      : "정와 SOOP 방송국, 현재 오프라인";
  badge.setAttribute("aria-label", label);
  badge.title = isLive ? (title || "정와 방송 보러 가기") : unavailable ? "방송 상태 확인 실패" : "현재 오프라인";
}

async function refreshLiveStatus() {
  const target = `https://chapi.sooplive.co.kr/api/${encodeURIComponent(SOOP_CHANNEL_ID)}/station`;
  try {
    const response = await fetch(`${SOOP_PROXY_URL}?url=${encodeURIComponent(target)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`SOOP 응답 오류 (${response.status})`);

    const payload = await response.json();
    const broadcast = payload?.broad;
    renderLiveStatus(Boolean(broadcast?.broad_no), clean(broadcast?.broad_title || broadcast?.title));
  } catch (error) {
    console.warn("SOOP LIVE 상태를 확인하지 못했습니다.", error.message);
    renderLiveStatus(false, "", true);
  }
}

function initLiveStatus() {
  refreshLiveStatus();
  window.clearInterval(liveStatusRefreshTimer);
  liveStatusRefreshTimer = window.setInterval(refreshLiveStatus, LIVE_REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshLiveStatus();
  });
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
  myReactionsBySong.clear();
  state.favoritesOnly = false;
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

async function refreshSongReactions() {
  likeCountsBySong.clear();
  myReactionsBySong.clear();

  const { data: counts, error: countsError } = await authDb.rpc("jeongwa_song_like_counts");
  if (countsError) {
    songReactionsReady = false;
    return false;
  }

  songReactionsReady = true;
  (counts || []).forEach((row) => {
    likeCountsBySong.set(String(row.song_id), Number(row.like_count) || 0);
  });

  if (!isSignedIn()) return true;

  const { data: mine, error: mineError } = await authDb
    .from("song_reactions")
    .select("song_id, liked, favorited")
    .eq("user_id", authUser.id);

  if (mineError) {
    songReactionsReady = false;
    return false;
  }

  (mine || []).forEach((row) => {
    myReactionsBySong.set(String(row.song_id), {
      liked: Boolean(row.liked),
      favorited: Boolean(row.favorited),
    });
  });
  return true;
}

async function toggleSongReaction(songId, type) {
  if (!isSignedIn()) {
    openLoginModal();
    $("#login-status").textContent = "좋아요와 즐겨찾기는 로그인 후 사용할 수 있습니다.";
    return;
  }

  if (songReactionsReady !== true) {
    showNotice("먼저 Supabase 반응 기능 SQL을 실행해주세요.");
    return;
  }

  const id = String(songId);
  if (pendingReactionSongs.has(id)) return;
  const before = { ...reactionState(id) };
  const after = {
    liked: type === "like" ? !before.liked : before.liked,
    favorited: type === "favorite" ? !before.favorited : before.favorited,
  };
  const beforeCount = likeCountsBySong.get(id) || 0;

  pendingReactionSongs.add(id);
  myReactionsBySong.set(id, after);
  if (type === "like") {
    likeCountsBySong.set(id, Math.max(0, beforeCount + (after.liked ? 1 : -1)));
  }
  render();

  let error = null;
  if (!after.liked && !after.favorited) {
    ({ error } = await authDb
      .from("song_reactions")
      .delete()
      .eq("user_id", authUser.id)
      .eq("song_id", id));
  } else {
    ({ error } = await authDb
      .from("song_reactions")
      .upsert({
        user_id: authUser.id,
        song_id: id,
        liked: after.liked,
        favorited: after.favorited,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,song_id" }));
  }

  pendingReactionSongs.delete(id);
  if (error) {
    myReactionsBySong.set(id, before);
    likeCountsBySong.set(id, beforeCount);
    showNotice(`저장하지 못했습니다: ${error.message}`);
  } else if (!after.liked && !after.favorited) {
    myReactionsBySong.delete(id);
  }
  render();
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
    await Promise.all([refreshSharedSongData(), refreshSharedUpEvents(), refreshSongReactions()]);
  } else {
    await Promise.all([refreshSharedSongData(), refreshSharedUpEvents(), refreshSongReactions()]);
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

function activeUpEvents() {
  return upEvents.filter((event) => event.isActive && parseSoopPostUrl(event.soopUrl));
}

function updateUpRankingButton() {
  const button = $("#open-up-ranking");
  const activeEvents = activeUpEvents();
  button.hidden = activeEvents.length === 0;
  if (!activeEvents.some((event) => event.id === activeUpEventId)) {
    activeUpEventId = activeEvents[0]?.id || null;
  }
}

function parseSoopPostUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    const allowed = host === "sooplive.com"
      || host.endsWith(".sooplive.com")
      || host === "sooplive.co.kr"
      || host.endsWith(".sooplive.co.kr")
      || host === "afreecatv.com"
      || host.endsWith(".afreecatv.com");
    if (!allowed) return null;

    const match = url.pathname.match(/\/(?:station\/)?([\w-]+)\/post\/(\d+)/i);
    if (!match) return null;
    const highlightMatch = url.hash.match(/^#comment_noti(\d+)$/i);
    return {
      bjId: match[1],
      postNo: match[2],
      highlightReplyNo: highlightMatch?.[1] || "",
      baseUrl: `${url.origin}${url.pathname}`,
      originalUrl: normalized,
    };
  } catch {
    return null;
  }
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
          <div class="up-event-tab-name">${escapeHtml(event.tabName)}</div>
          <h3 class="up-event-title">${escapeHtml(event.title)}</h3>
          <a class="up-event-url" href="${escapeHtml(event.soopUrl)}" target="_blank" rel="noopener noreferrer">SOOP 게시글 보기</a>
        </div>
        <span class="up-status">${event.isActive ? "활성" : "비활성"}</span>
      </div>
      <div class="up-event-meta">표시 순서 ${event.sortOrder}${event.showOnStartup ? " · 접속 시 먼저 표시" : ""}</div>
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
    tabName: data.get("tabName"),
    title: data.get("title"),
    soopUrl: data.get("soopUrl"),
    sortOrder: data.get("sortOrder"),
    isActive: data.get("isActive") === "on",
    showOnStartup: data.get("showOnStartup") === "on",
  });
}

function clearUpEventForm() {
  $("#up-event-form").reset();
  $("#up-event-id").value = "";
  $("#up-event-active").checked = true;
  $("#up-event-startup").checked = false;
  $("#up-event-order").value = String(upEvents.length);
  $("#up-event-status").textContent = "";
}

function editUpEvent(eventId) {
  const event = upEvents.find((item) => item.id === eventId);
  if (!event) return;

  $("#up-event-id").value = event.id;
  $("#up-event-tab-name").value = event.tabName;
  $("#up-event-title").value = event.title;
  $("#up-event-soop-url").value = event.soopUrl;
  $("#up-event-order").value = String(event.sortOrder);
  $("#up-event-active").checked = event.isActive;
  $("#up-event-startup").checked = event.showOnStartup;
  $("#up-event-title").focus();
}

async function saveUpEvent(form) {
  const event = upEventFromForm(form);
  if (!event.tabName || !event.title) return false;
  if (!parseSoopPostUrl(event.soopUrl)) {
    $("#up-event-status").textContent = "올바른 SOOP 게시글 또는 댓글 URL을 입력해주세요.";
    return false;
  }

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
    : [...upEvents, event];
  upEvents.sort((a, b) => a.sortOrder - b.sortOrder);
  clearUpEventForm();
  renderUpEvents();
  updateUpRankingButton();
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
  updateUpRankingButton();
  return true;
}

function upRankingEvent() {
  return activeUpEvents().find((event) => event.id === activeUpEventId) || activeUpEvents()[0] || null;
}

function renderUpRankingTabs() {
  const events = activeUpEvents();
  $("#up-ranking-tabs").innerHTML = events.map((event) => `
    <button class="up-ranking-tab${event.id === activeUpEventId ? " active" : ""}" type="button" role="tab" aria-selected="${event.id === activeUpEventId}" data-up-ranking-event="${escapeHtml(event.id)}">
      ${escapeHtml(event.tabName)}
    </button>
  `).join("");
}

function renderUpRankingEvent(event) {
  if (!event) {
    $("#up-ranking-event").innerHTML = "";
    $("#up-ranking-list").innerHTML = '<p class="admin-empty">진행 중인 UP 이벤트가 없습니다.</p>';
    return;
  }

  const parsed = parseSoopPostUrl(event.soopUrl);
  const originalLink = parsed?.highlightReplyNo
    ? `<a class="secondary-btn compact-link" href="${escapeHtml(parsed.baseUrl)}" target="_blank" rel="noopener noreferrer">원문 보기</a>`
    : "";
  $("#up-ranking-event").innerHTML = `
    <div>
      <h3>${escapeHtml(event.title)}</h3>
      <p>댓글의 좋아요 수를 기준으로 자동 집계됩니다.</p>
    </div>
    <div class="up-ranking-actions">
      <a class="draw-btn compact-link" href="${escapeHtml(event.soopUrl)}" target="_blank" rel="noopener noreferrer">UP하러 가기</a>
      ${originalLink}
    </div>
  `;
}

function rankingCommentUrl(event, replyNo) {
  const parsed = parseSoopPostUrl(event.soopUrl);
  if (!parsed) return event.soopUrl;
  return replyNo ? `${parsed.baseUrl}#comment_noti${replyNo}` : parsed.baseUrl;
}

function renderUpRankingList(event, ranking, updatedAt) {
  const parsed = parseSoopPostUrl(event?.soopUrl);
  if (!event || !ranking?.length) {
    $("#up-ranking-list").innerHTML = '<p class="admin-empty">등록된 댓글이 없거나 순위를 불러오지 못했습니다.</p>';
    $("#up-ranking-updated").textContent = "랭킹 데이터가 없습니다.";
    return;
  }

  const highlightedReply = parsed?.highlightReplyNo || "";
  const ordered = ranking.map((entry) => ({
    ...entry,
    highlighted: highlightedReply && String(entry.replyNo) === highlightedReply,
  }));
  const highlighted = ordered.find((entry) => entry.highlighted);
  const displayRows = highlighted
    ? [highlighted, ...ordered.filter((entry) => !entry.highlighted)]
    : ordered;

  $("#up-ranking-list").innerHTML = displayRows.map((entry) => `
    <a class="up-rank-item${entry.highlighted ? " highlighted" : ""}" href="${escapeHtml(rankingCommentUrl(event, entry.replyNo))}" target="_blank" rel="noopener noreferrer">
      <span class="up-rank-number">${entry.rank}</span>
      ${entry.profileUrl
        ? `<img class="up-rank-profile" src="${escapeHtml(entry.profileUrl)}" alt="" loading="lazy">`
        : '<span class="up-rank-profile-fallback" aria-hidden="true">UP</span>'}
      <span class="up-rank-person">
        <strong>${escapeHtml(entry.name || entry.userId || "-")}${entry.highlighted ? '<span class="up-highlight-badge">하이라이트</span>' : ""}</strong>
        <small>@${escapeHtml(entry.userId || "-")} · ${escapeHtml(entry.timestamp || "")}</small>
      </span>
      <span class="up-rank-likes">${entry.likeCount.toLocaleString("ko-KR")} UP</span>
    </a>
  `).join("");
  $("#up-ranking-updated").textContent = `마지막 업데이트 ${new Date(updatedAt).toLocaleString("ko-KR")}`;
}

async function fetchSoopRanking(event, force = false) {
  const parsed = parseSoopPostUrl(event.soopUrl);
  if (!parsed) throw new Error("SOOP 게시글 URL을 확인해주세요.");

  const cached = upRankingCache.get(event.id);
  if (!force && cached && Date.now() - cached.savedAt < 2 * 60 * 1000) return cached;

  const items = [];
  let page = 1;
  let lastPage = 1;
  do {
    const target = `https://api-channel.sooplive.com/v1.1/channel/${encodeURIComponent(parsed.bjId)}/post/${encodeURIComponent(parsed.postNo)}/comment?page=${page}&orderBy=reg_date&cCommentNo=0&perPage=100`;
    const response = await fetch(`${SOOP_PROXY_URL}?url=${encodeURIComponent(target)}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`SOOP 응답 오류 (${response.status})`);

    const payload = await response.json();
    (payload.data || []).forEach((comment) => {
      if (!comment.pCommentNo) return;
      items.push({
        userId: clean(comment.userId),
        name: clean(comment.userNick),
        profileUrl: normalizeUrl(comment.profileImage),
        timestamp: clean(comment.regDate),
        likeCount: Math.max(0, Number.parseInt(comment.likeCnt, 10) || 0),
        replyNo: clean(comment.pCommentNo),
      });
    });
    lastPage = Math.min(100, Number.parseInt(payload.meta?.lastPage, 10) || 1);
    page += 1;
  } while (page <= lastPage);

  items.sort((a, b) => b.likeCount - a.likeCount || a.timestamp.localeCompare(b.timestamp));
  items.forEach((item, index) => { item.rank = index + 1; });
  const result = { ranking: items, updatedAt: new Date().toISOString(), savedAt: Date.now() };
  upRankingCache.set(event.id, result);
  return result;
}

async function refreshUpRanking(force = false) {
  const event = upRankingEvent();
  renderUpRankingTabs();
  renderUpRankingEvent(event);
  if (!event) return;

  $("#up-ranking-list").innerHTML = '<p class="admin-empty">좋아요 순위를 불러오는 중입니다.</p>';
  $("#up-ranking-updated").textContent = "SOOP 게시글을 확인하고 있습니다.";
  try {
    const result = await fetchSoopRanking(event, force);
    renderUpRankingList(event, result.ranking, result.updatedAt);
  } catch (error) {
    $("#up-ranking-list").innerHTML = `<p class="admin-empty">${escapeHtml(error.message)}</p>`;
    $("#up-ranking-updated").textContent = "랭킹을 불러오지 못했습니다.";
  }
}

function openUpRankingModal(options = {}) {
  const events = activeUpEvents();
  if (!events.length) return;
  activeUpEventId = options.eventId || activeUpEventId || events[0].id;
  openModal("#up-ranking-modal");
  refreshUpRanking(Boolean(options.force));
  window.clearInterval(upRankingRefreshTimer);
  upRankingRefreshTimer = window.setInterval(() => refreshUpRanking(true), UP_REFRESH_INTERVAL_MS);
}

function closeUpRankingModal() {
  window.clearInterval(upRankingRefreshTimer);
  upRankingRefreshTimer = null;
  closeModal("#up-ranking-modal");
}

function maybeOpenStartupUpRanking() {
  if (upStartupHandled) return;
  upStartupHandled = true;
  const events = activeUpEvents();
  const startupEvent = events.find((event) => event.showOnStartup) || events[0];
  if (!startupEvent) return;
  window.setTimeout(() => openUpRankingModal({ eventId: startupEvent.id }), 250);
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
    ${tagsMarkup(song)}
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

function updateCoverPreview(inputId, previewId, value) {
  const input = $(inputId);
  const preview = $(previewId);
  const url = clean(value ?? input?.value);
  if (!preview) return;

  preview.innerHTML = url
    ? `<span class="cover-preview-image song-cover has-image"><span class="song-cover-placeholder" aria-hidden="true">♪</span><img src="${escapeHtml(url)}" alt="커버 미리보기" data-cover-image></span>`
    : "";
  preview.classList.toggle("visible", Boolean(url));
  bindCoverImageErrors(preview);
}

function openAddOneModal() {
  if (!ensureEditMode()) return;
  setFabMenu(false);
  populateCategorySelects();
  const formCategory = categories.includes(state.category) ? state.category : categories[0];
  $("#one-category").value = formCategory;
  $("#add-one-form").reset();
  $("#one-category").value = formCategory;
  $("#one-status").textContent = "";
  setRatingValue("one-skill", 0);
  updateCoverPreview("#one-cover", "#one-cover-preview", "");
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
  const formCategory = categories.includes(state.category) ? state.category : categories[0];
  $("#many-category").value = formCategory;
  $("#add-many-form").reset();
  $("#many-category").value = formCategory;
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
  $("#edit-cover").value = song.coverUrl || "";
  updateCoverPreview("#edit-cover", "#edit-cover-preview", song.coverUrl);
  $("#edit-inst").value = song.instUrl || "";
  $("#edit-clip").value = song.jeongwaClipUrl || "";
  setRatingValue("edit-skill", skillValue(song));
  $("#edit-tags").value = normalizeTags(song.tags).join(", ");
  $("#edit-memo").value = memoText(song);
  $("#edit-status").textContent = "";
  $("#reset-edit-song").hidden = song.custom || !isEditedBaseSong(song.id);
  $("#delete-edit-song").hidden = !song.custom;
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
  if (normalized.tags.length && songTagsColumnReady !== true) {
    $("#edit-status").textContent = "태그 저장 설정이 아직 필요합니다. Supabase 태그 SQL을 먼저 실행해주세요.";
    return false;
  }

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

  if (state.category !== ALL_CATEGORY) state.category = normalized.category;
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
    if (state.category !== ALL_CATEGORY) state.category = restored.category;
  }

  render();
  updateRandomCount();
  return true;
}

async function deleteCustomSong(songId) {
  const song = findSongById(songId);
  if (!song?.custom) return false;

  const { error } = await authDb
    .from("song_changes")
    .delete()
    .eq("id", song.id)
    .eq("record_type", "custom");

  if (error) {
    $("#edit-status").textContent = `삭제하지 못했습니다: ${error.message}`;
    return false;
  }

  customSongs = customSongs.filter((item) => String(item.id) !== String(song.id));
  refreshSongs();
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
  if (normalized.some((song) => song.tags.length) && songTagsColumnReady !== true) {
    throw new Error("태그 저장 설정이 아직 필요합니다. Supabase 태그 SQL을 먼저 실행해주세요.");
  }

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
    coverUrl: data.get("coverUrl"),
    instUrl: data.get("instUrl"),
    jeongwaClipUrl: data.get("jeongwaClipUrl"),
    skillLevel: data.get("skillLevel"),
    tags: data.get("tags"),
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

function songFromBulkLine(line, fallbackCategory, headerHasTags = null) {
  const cols = splitBulkLine(line).map(clean);
  if (cols.length < 2 || isBulkHeader(cols)) return null;

  const hasCategory = categories.includes(cols[0]);
  const offset = hasCategory ? 1 : 0;
  const hasCoverColumn = cols.length - offset >= 7;
  const mediaOffset = hasCoverColumn ? 1 : 0;
  const tagIndex = offset + 5 + mediaOffset;
  const hasTagsColumn = headerHasTags ?? cols.length > tagIndex + 1;

  return {
    category: hasCategory ? cols[0] : fallbackCategory,
    title: cols[offset],
    artist: cols[offset + 1],
    coverUrl: hasCoverColumn ? cols[offset + 2] : "",
    instUrl: cols[offset + 2 + mediaOffset],
    jeongwaClipUrl: cols[offset + 3 + mediaOffset],
    skillLevel: cols[offset + 4 + mediaOffset],
    tags: hasTagsColumn ? cols[tagIndex] : "",
    memo: cols.slice(tagIndex + (hasTagsColumn ? 1 : 0)).join(" "),
  };
}

function parseBulkSongs(text, fallbackCategory) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const header = lines
    .map((line) => splitBulkLine(line).map(clean))
    .find((cols) => isBulkHeader(cols));
  const headerHasTags = header
    ? header.some((column) => normalize(column) === "태그")
    : null;

  return lines
    .map((line) => songFromBulkLine(line, fallbackCategory, headerHasTags))
    .filter((song) => song && clean(song.title));
}

function catalogText(value) {
  return normalize(value)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat|featuring|ft|remaster(?:ed)?|version|ver)\b.*$/i, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left, right) {
  const a = new Set(catalogText(left).split(" ").filter(Boolean));
  const b = new Set(catalogText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((token) => b.has(token)).length;
  return common / new Set([...a, ...b]).size;
}

function catalogVariants(value) {
  const raw = normalize(value);
  const variants = [catalogText(raw)];
  for (const match of raw.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)) {
    variants.push(catalogText(match[1] || match[2]));
  }
  variants.push(raw.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim());
  return [...new Set(variants.filter(Boolean))];
}

function directTextSimilarity(left, right) {
  const a = catalogText(left);
  const b = catalogText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.88;
  return tokenSimilarity(a, b);
}

function textSimilarity(left, right) {
  let best = 0;
  catalogVariants(left).forEach((leftVariant) => {
    catalogVariants(right).forEach((rightVariant) => {
      best = Math.max(best, directTextSimilarity(leftVariant, rightVariant));
    });
  });
  return best;
}

function itunesCountryFor(song) {
  if (song.category === "J-POP") return "JP";
  if (song.category === "POP/OST") return "US";
  return "KR";
}

function itunesSearch(song) {
  return new Promise((resolve, reject) => {
    const callbackName = `jeongwaItunes_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => finish(reject, new Error("검색 시간이 초과되었습니다.")), 12000);

    function cleanup() {
      window.clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    function finish(done, value) {
      cleanup();
      done(value);
    }

    window[callbackName] = (payload) => finish(resolve, Array.isArray(payload?.results) ? payload.results : []);
    script.onerror = () => finish(reject, new Error("커버 검색 서버에 연결하지 못했습니다."));

    const params = new URLSearchParams({
      term: `${song.title} ${song.artist}`.trim(),
      country: itunesCountryFor(song),
      media: "music",
      entity: "song",
      limit: "12",
      callback: callbackName,
    });
    script.src = `https://itunes.apple.com/search?${params.toString()}`;
    document.head.append(script);
  });
}

function bestCoverMatch(song, results) {
  const ranked = results.map((result) => {
    const titleScore = textSimilarity(song.title, result.trackName);
    const artistScore = song.artist ? textSimilarity(song.artist, result.artistName) : 0.72;
    return { result, titleScore, artistScore, score: titleScore * 0.74 + artistScore * 0.26 };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.titleScore < 0.78 || best.artistScore < 0.32 || best.score < 0.7) return null;
  return best.result;
}

function upscaleItunesArtwork(url) {
  return clean(url)
    .replace(/\/\d+x\d+bb\.(jpg|png)$/i, "/600x600bb.$1")
    .replace(/\/\d+x\d+bb\//i, "/600x600bb/");
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function persistSongCover(song, coverUrl) {
  const normalized = normalizeSongRecord({
    ...song,
    coverUrl,
    edited: song.edited || !song.custom,
  });
  const recordType = song.custom ? "custom" : "override";
  const { error } = await authDb
    .from("song_changes")
    .upsert(songToChangeRow(normalized, recordType), { onConflict: "id" });
  if (error) throw error;

  if (song.custom) {
    customSongs = customSongs.map((item) => String(item.id) === String(song.id) ? normalized : item);
  } else {
    editedSongsById[String(song.id)] = normalized;
  }
}

function coverFillCandidates() {
  const scope = $("#cover-fill-scope").value;
  const pool = scope === "all" ? songs : filteredSongs();
  return pool.filter((song) => !clean(song.coverUrl));
}

function openCoverFillModal() {
  if (!ensureEditMode()) return;
  setFabMenu(false);
  coverFillCancelled = false;
  const ready = songCoverColumnReady === true;
  $("#cover-fill-scope").disabled = false;
  $("#start-cover-fill").disabled = !ready;
  $("#stop-cover-fill").disabled = true;
  $("#cover-fill-progress").value = 0;
  $("#cover-fill-progress").max = 1;
  $("#cover-fill-status").textContent = ready
    ? "커버가 비어 있는 곡만 처리합니다."
    : "먼저 Supabase에서 최신 마이그레이션 SQL을 실행한 뒤 페이지를 새로고침해주세요.";
  openModal("#cover-fill-modal");
}

function closeCoverFillModal() {
  if (coverFillRunning) coverFillCancelled = true;
  closeModal("#cover-fill-modal");
}

async function startCoverFill() {
  if (coverFillRunning || songCoverColumnReady !== true) return;
  const candidates = coverFillCandidates();
  const progress = $("#cover-fill-progress");
  const status = $("#cover-fill-status");
  if (!candidates.length) {
    status.textContent = "선택한 범위에는 커버가 비어 있는 곡이 없습니다.";
    return;
  }

  coverFillRunning = true;
  coverFillCancelled = false;
  $("#start-cover-fill").disabled = true;
  $("#stop-cover-fill").disabled = false;
  $("#cover-fill-scope").disabled = true;
  progress.max = candidates.length;
  progress.value = 0;

  let matched = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    if (coverFillCancelled) break;
    const song = candidates[index];
    status.textContent = `${index + 1}/${candidates.length} · ${song.artist || "아티스트 미등록"} - ${song.title}`;

    try {
      const result = bestCoverMatch(song, await itunesSearch(song));
      const coverUrl = upscaleItunesArtwork(result?.artworkUrl100 || result?.artworkUrl60);
      if (result && coverUrl) {
        await persistSongCover(song, coverUrl);
        matched += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      console.warn("커버 자동채우기 실패", song.title, error.message);
      failed += 1;
    }

    progress.value = index + 1;
    if (index < candidates.length - 1 && !coverFillCancelled) await wait(450);
  }

  refreshSongs();
  render();
  coverFillRunning = false;
  $("#start-cover-fill").disabled = false;
  $("#stop-cover-fill").disabled = true;
  $("#cover-fill-scope").disabled = false;
  const prefix = coverFillCancelled ? "중지됨" : "완료";
  status.textContent = `${prefix} · 채움 ${matched}곡 · 일치 결과 없음 ${skipped}곡 · 오류 ${failed}곡`;
}

function bindEvents() {
  $("#view-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-mode]");
    if (!button) return;
    state.viewMode = button.dataset.viewMode === "album" ? "album" : "list";
    localStorage.setItem(viewModeStorageKey, state.viewMode);
    render();
  });

  $("#favorite-filter").addEventListener("click", () => {
    if (!isSignedIn()) {
      openLoginModal();
      $("#login-status").textContent = "즐겨찾기는 로그인 후 사용할 수 있습니다.";
      return;
    }
    if (songReactionsReady !== true) {
      showNotice("먼저 Supabase 반응 기능 SQL을 실행해주세요.");
      return;
    }
    state.favoritesOnly = !state.favoritesOnly;
    render();
    updateRandomCount();
  });

  $("#tag-filter-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter-tag]");
    if (!button) return;

    const tag = clean(button.dataset.filterTag);
    if (!tag) {
      state.selectedTags = [];
    } else {
      const key = normalize(tag);
      const selected = state.selectedTags.some((item) => normalize(item) === key);
      state.selectedTags = selected
        ? state.selectedTags.filter((item) => normalize(item) !== key)
        : [...state.selectedTags, tag];
    }

    render();
    updateRandomCount();
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-song-reaction]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    toggleSongReaction(button.dataset.reactionSongId, button.dataset.songReaction);
  });

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
  $("#album-grid").addEventListener("click", (event) => {
    if (isInteractiveTarget(event.target)) return;
    openSongEditFromElement(event.target);
  });
  $("#album-grid").addEventListener("keydown", (event) => {
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
  $("#open-cover-fill").addEventListener("click", openCoverFillModal);
  $("#close-add-one").addEventListener("click", closeAddOneModal);
  $("#close-add-many").addEventListener("click", closeAddManyModal);
  $("#close-edit-song").addEventListener("click", closeEditSongModal);
  $("#close-cover-fill").addEventListener("click", closeCoverFillModal);
  $("#start-cover-fill").addEventListener("click", startCoverFill);
  $("#stop-cover-fill").addEventListener("click", () => {
    coverFillCancelled = true;
    $("#stop-cover-fill").disabled = true;
    $("#cover-fill-status").textContent = "현재 곡까지만 처리하고 중지합니다.";
  });
  $("#one-cover").addEventListener("input", () => updateCoverPreview("#one-cover", "#one-cover-preview"));
  $("#edit-cover").addEventListener("input", () => updateCoverPreview("#edit-cover", "#edit-cover-preview"));
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
  $("#cover-fill-modal").addEventListener("click", (event) => {
    if (event.target.id === "cover-fill-modal") closeCoverFillModal();
  });
  $("#up-ranking-modal").addEventListener("click", (event) => {
    if (event.target.id === "up-ranking-modal") closeUpRankingModal();
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

    if (editButton) {
      editUpEvent(editButton.dataset.editUpEvent);
      return;
    }

    if (deleteButton) {
      await deleteUpEvent(deleteButton.dataset.deleteUpEvent);
    }
  });

  $("#open-up-ranking").addEventListener("click", () => openUpRankingModal());
  $("#close-up-ranking").addEventListener("click", closeUpRankingModal);
  $("#refresh-up-ranking").addEventListener("click", () => refreshUpRanking(true));
  $("#up-ranking-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-up-ranking-event]");
    if (!button) return;
    activeUpEventId = button.dataset.upRankingEvent;
    refreshUpRanking();
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

  $("#delete-edit-song").addEventListener("click", async () => {
    const songId = $("#edit-id").value;
    const song = findSongById(songId);
    if (!song?.custom) return;
    if (!window.confirm(`'${song.title}' 곡을 삭제할까요?`)) return;

    $("#edit-status").textContent = "삭제 중입니다.";
    if (await deleteCustomSong(songId)) closeEditSongModal();
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
      if (!$("#cover-fill-modal").hidden) closeCoverFillModal();
      if (!$("#up-ranking-modal").hidden) closeUpRankingModal();
    }
  });
}

bindEvents();
populateCategorySelects();
bindRatingPickers();
updateAuthUi();
render();
window.lucide?.createIcons();
initLiveStatus();
refreshSharedSongData().finally(initAuth);
