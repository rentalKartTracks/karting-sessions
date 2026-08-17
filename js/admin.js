'use strict';

const REPO = 'rentalKartTracks/karting-sessions';
const TOKEN_KEY = 'hch_admin_pat';
const YT_KEY_STORAGE = 'hch_yt_key';

// ── State ──────────────────────────────────────────────────────────────────
let laps = [];
let sessionId = crypto.randomUUID();
let isEditing = false;
let allSessions = [];

// ── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('session_date').valueAsDate = new Date();
  document.getElementById('session-id-label').textContent = 'ID: ' + sessionId;
  renderTokenStatus();
  renderYtKeyStatus();
  loadAllSessions();

  const id = new URLSearchParams(location.search).get('id');
  if (id) loadSessionById(id);

  document.getElementById('champ-year').addEventListener('change', e => {
    if (!currentSeason) return;
    const y = parseInt(e.target.value, 10);
    if (!Number.isFinite(y)) { e.target.value = currentSeason.year; return; }
    currentSeason.year = y;
    champData.seasons.sort((a, b) => a.year - b.year);
    renderChampSeasonSelect();
  });
  document.getElementById('champ-name').addEventListener('input', e => {
    if (currentSeason) currentSeason.name = e.target.value;
  });
  document.getElementById('champ-status').addEventListener('change', e => {
    if (currentSeason) currentSeason.status = e.target.value;
  });

  document.getElementById('track-color-input').value = randomTrackColor();
});

// ── Tabs ───────────────────────────────────────────────────────────────────
function showTab(name) {
  document.getElementById('panel-new').classList.toggle('hidden', name !== 'new');
  document.getElementById('panel-manage').classList.toggle('hidden', name !== 'manage');
  document.getElementById('panel-champ').classList.toggle('hidden', name !== 'champ');
  document.getElementById('panel-track').classList.toggle('hidden', name !== 'track');
  document.getElementById('tab-new').classList.toggle('active', name === 'new');
  document.getElementById('tab-manage').classList.toggle('active', name === 'manage');
  document.getElementById('tab-champ').classList.toggle('active', name === 'champ');
  document.getElementById('tab-track').classList.toggle('active', name === 'track');
  if (name === 'champ' && !champLoaded) loadChampData();
  if (name === 'track' && !manualTracksLoaded) loadManualTracks();
}

// ── Token management ───────────────────────────────────────────────────────
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

function renderTokenStatus() {
  const ok = !!getToken();
  document.getElementById('token-dot').className = 'token-dot' + (ok ? ' ok' : '');
  document.getElementById('token-chip-text').textContent = ok ? 'GitHub: ready' : 'GitHub: set up token';
  document.getElementById('publish-btn').disabled = !ok;
  const champBtn = document.getElementById('champ-publish-btn');
  if (champBtn) champBtn.disabled = !ok;
  const trackBtn = document.getElementById('track-publish-btn');
  if (trackBtn) trackBtn.disabled = !ok;
}

function openTokenModal() {
  document.getElementById('token-input').value = '';
  document.getElementById('modal-bg').classList.remove('hidden');
  setTimeout(() => document.getElementById('token-input').focus(), 50);
}

function closeModal() {
  document.getElementById('modal-bg').classList.add('hidden');
}

function closeModalBg(e) {
  if (e.target === document.getElementById('modal-bg')) closeModal();
}

function saveToken() {
  const val = document.getElementById('token-input').value.trim();
  if (!val) return;
  localStorage.setItem(TOKEN_KEY, val);
  closeModal();
  renderTokenStatus();
  setStatus('', '');
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  document.getElementById('token-input').value = '';
  closeModal();
  renderTokenStatus();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeYtModal(); }
  if (e.key === 'Enter') {
    if (!document.getElementById('modal-bg').classList.contains('hidden'))    saveToken();
    if (!document.getElementById('yt-modal-bg').classList.contains('hidden')) saveYtKey();
  }
});

// ── YouTube key management ─────────────────────────────────────────────────
function getYtKey() { return localStorage.getItem(YT_KEY_STORAGE) || ''; }

function renderYtKeyStatus() {
  const ok = !!getYtKey();
  document.getElementById('yt-dot').className = 'token-dot' + (ok ? ' ok' : '');
  document.getElementById('yt-chip-text').textContent = ok ? 'YouTube: ready' : 'YouTube: set up key';
}

function openYtKeyModal() {
  document.getElementById('yt-key-input').value = '';
  document.getElementById('yt-modal-bg').classList.remove('hidden');
  setTimeout(() => document.getElementById('yt-key-input').focus(), 50);
}

function closeYtModal() { document.getElementById('yt-modal-bg').classList.add('hidden'); }

function closeYtModalBg(e) {
  if (e.target === document.getElementById('yt-modal-bg')) closeYtModal();
}

function saveYtKey() {
  const val = document.getElementById('yt-key-input').value.trim();
  if (!val) return;
  localStorage.setItem(YT_KEY_STORAGE, val);
  closeYtModal();
  renderYtKeyStatus();
}

function clearYtKey() {
  localStorage.removeItem(YT_KEY_STORAGE);
  document.getElementById('yt-key-input').value = '';
  closeYtModal();
  renderYtKeyStatus();
}

// ── Status bar ─────────────────────────────────────────────────────────────
function setStatus(type, msg) {
  const el = document.getElementById('publish-status');
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

// ── GitHub helpers ─────────────────────────────────────────────────────────
function ghHeaders() {
  return {
    'Authorization': `Bearer ${getToken()}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function getFileSha(path) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      headers: ghHeaders()
    });
    if (!res.ok) return null;
    return (await res.json()).sha;
  } catch {
    return null;
  }
}

// ── Build session object from form ─────────────────────────────────────────
function buildSessionData() {
  if (laps.length === 0) { alert('Please add at least one lap.'); return null; }

  let fastestTime = Infinity, fastestLapStr = '';
  laps.forEach(l => {
    const t = parseTime(l.time);
    if (t < fastestTime) { fastestTime = t; fastestLapStr = l.time; }
  });

  return {
    session_id: sessionId,
    driver: document.getElementById('driver').value.trim(),
    fastest_lap: fastestLapStr,
    track: {
      name: document.getElementById('track_name').value.trim(),
      configuration: document.getElementById('track_config').value.trim(),
      maps_link: document.getElementById('maps_link').value.trim()
    },
    kart: document.getElementById('kart').value.trim(),
    video_start_time: document.getElementById('video_start_time').value.trim(),
    video_url: document.getElementById('video_url').value.trim(),
    session_date: document.getElementById('session_date').value,
    laps
  };
}

// ── Load session data into form ────────────────────────────────────────────
function loadIntoForm(data) {
  sessionId = data.session_id;
  isEditing = true;

  document.getElementById('session-id-label').textContent = 'ID: ' + sessionId;
  document.getElementById('driver').value = data.driver || '';
  document.getElementById('session_date').value = data.session_date || '';
  document.getElementById('kart').value = data.kart || '';
  document.getElementById('track_name').value = data.track?.name || '';
  document.getElementById('track_config').value = data.track?.configuration || '';
  document.getElementById('maps_link').value = data.track?.maps_link || '';
  document.getElementById('video_url').value = data.video_url || '';
  document.getElementById('video_start_time').value = data.video_start_time || '';

  laps = (data.laps || []).map(l => ({ ...l }));
  renderLaps();

  document.getElementById('delete-btn').classList.remove('hidden');
  setStatus('', '');
  showTab('new');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Reset form ─────────────────────────────────────────────────────────────
function clearForm() {
  document.getElementById('session-form').reset();
  laps = [];
  sessionId = crypto.randomUUID();
  isEditing = false;
  document.getElementById('session-id-label').textContent = 'ID: ' + sessionId;
  document.getElementById('session_date').valueAsDate = new Date();
  document.getElementById('delete-btn').classList.add('hidden');
  renderLaps();
}

function resetForm() {
  if (isEditing && !confirm('Discard changes and start a new session?')) return;
  clearForm();
  setStatus('', '');
}

// ── Lap management ─────────────────────────────────────────────────────────
function addLap() {
  laps.push({ lap: laps.length + 1, time: '' });
  renderLaps();
}

function removeLap(i) {
  laps.splice(i, 1);
  laps.forEach((l, idx) => l.lap = idx + 1);
  renderLaps();
}

function updateLapTime(i, val) {
  laps[i].time = val.trim();
}

function renderLaps() {
  const c = document.getElementById('laps-container');
  c.innerHTML = '';
  laps.forEach((lap, i) => {
    const d = document.createElement('div');
    d.className = 'lap-item';
    d.innerHTML = `
      <span class="lap-num">#${lap.lap}</span>
      <input class="lap-input" value="${lap.time}" placeholder="00:00.000"
        onchange="updateLapTime(${i}, this.value)">
      <button class="lap-del" type="button" onclick="removeLap(${i})">✕</button>
    `;
    c.appendChild(d);
  });
}

// ── Bulk import ────────────────────────────────────────────────────────────
function toggleBulk() { document.getElementById('bulk-box').classList.toggle('hidden'); }
function hideBulk()   { document.getElementById('bulk-box').classList.add('hidden'); document.getElementById('bulk-text').value = ''; }

function processBulk() {
  const lines = document.getElementById('bulk-text').value.split('\n');
  const newLaps = [];

  lines.forEach(line => {
    const clean = line.trim();
    if (!clean) return;
    const m = clean.match(/(\d{1,2}:\d{2}(\.\d*)?|\d{1,3}(\.\d*)?)/);
    if (!m) return;
    let t = m[0];
    if (!t.includes(':')) {
      const sec = parseFloat(t);
      const mins = Math.floor(sec / 60);
      const rem = (sec % 60).toFixed(3).padStart(6, '0');
      t = `${String(mins).padStart(2, '0')}:${rem}`;
    } else {
      const [mm, ss] = t.split(':');
      let s = ss;
      if (!s.includes('.')) s += '.000';
      else while (s.split('.')[1].length < 3) s += '0';
      t = `${mm.padStart(2, '0')}:${s}`;
    }
    newLaps.push({ lap: laps.length + newLaps.length + 1, time: t });
  });

  if (!newLaps.length) { alert('No valid lap times found. Format: 00:45.123 or 45.123'); return; }
  laps = [...laps, ...newLaps];
  renderLaps();
  hideBulk();
}

// ── YouTube prefill ────────────────────────────────────────────────────────

function extractYouTubeId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function importYouTube() {
  const url = document.getElementById('video_url').value.trim();
  if (!url) return;
  const id = extractYouTubeId(url);
  if (!id) return;

  const ytKey = getYtKey();
  if (ytKey) {
    try {
      setStatus('busy', 'Fetching YouTube info…');
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${ytKey}`);
      if (!res.ok) { setStatus('err', '✗ YouTube API error'); return; }
      const snippet = (await res.json()).items?.[0]?.snippet;
      if (!snippet) { setStatus('err', '✗ Video not found'); return; }
      prefillFromTitle(snippet.title);
      applyDescription(snippet.description);
    } catch (ex) {
      setStatus('err', '✗ ' + ex.message);
    }
  } else {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (!res.ok) return;
      prefillFromTitle((await res.json()).title);
    } catch {}
  }
}

function prefillFromTitle(title) {
  // Expected title format: "Track - Driver "FastestLap" (YYYY-MM-DD)"
  const m = title.replace(/[‎‏​]/g, '')
    .match(/^(.+?)\s*[-–]\s*(.+?)\s*"[^"]*"\s*\((\d{4}-\d{2}-\d{2})\)$/);
  if (!m) return;
  const [, track, driver, date] = m;
  if (!document.getElementById('track_name').value)  document.getElementById('track_name').value  = track.trim();
  if (!document.getElementById('driver').value)       document.getElementById('driver').value       = driver.trim();
  document.getElementById('session_date').value = date;
}

// ── Description import ─────────────────────────────────────────────────────

function normalizeBold(s) {
  return [...s].map(c => {
    const cp = c.codePointAt(0);
    if (cp >= 0x1D400 && cp <= 0x1D419) return String.fromCharCode(cp - 0x1D400 + 65); // Math Bold A-Z
    if (cp >= 0x1D41A && cp <= 0x1D433) return String.fromCharCode(cp - 0x1D41A + 97); // Math Bold a-z
    if (cp >= 0x1D5D4 && cp <= 0x1D5ED) return String.fromCharCode(cp - 0x1D5D4 + 65); // Sans-Serif Bold A-Z
    if (cp >= 0x1D5EE && cp <= 0x1D607) return String.fromCharCode(cp - 0x1D5EE + 97); // Sans-Serif Bold a-z
    if (cp >= 0x1D7CE && cp <= 0x1D7D7) return String.fromCharCode(cp - 0x1D7CE + 48); // Math Bold 0-9
    if (cp >= 0x1D7EC && cp <= 0x1D7F5) return String.fromCharCode(cp - 0x1D7EC + 48); // Sans-Serif Bold 0-9
    return c;
  }).join('');
}

function fmtLapTime(t) {
  t = t.replace(/[‎‏​‌‍]/g, '');
  if (t.includes(':')) {
    const [mm, ss] = t.split(':');
    const parts = (ss.includes('.') ? ss : ss + '.000').split('.');
    while (parts[1].length < 3) parts[1] += '0';
    return mm.padStart(2, '0') + ':' + parts[0].padStart(2, '0') + '.' + parts[1].slice(0, 3);
  }
  const sec = parseFloat(t);
  const mins = Math.floor(sec / 60);
  const rem = (sec % 60).toFixed(3).padStart(6, '0');
  return String(mins).padStart(2, '0') + ':' + rem;
}

function toggleDescImport() { document.getElementById('desc-box').classList.toggle('hidden'); }
function hideDescImport()   { document.getElementById('desc-box').classList.add('hidden'); document.getElementById('desc-text').value = ''; }

function processDescImport() {
  const raw = document.getElementById('desc-text').value;
  if (!raw.trim()) return;
  applyDescription(raw);
  hideDescImport();
}

function applyDescription(raw) {
  const clean = raw.replace(/[‎‏​‌‍﻿]/g, '');
  let driver = '', mapsLink = '', trackName = '', onboardStart = '';
  const newLaps = [];

  for (const line of clean.split('\n')) {
    const norm = normalizeBold(line.trim());

    const driverM = norm.match(/^Driver:\s*(.+)/i);
    if (driverM) { driver = driverM[1].trim(); continue; }

    const lapM = norm.match(/^\*?(\d{1,2}:\d{2})\s+Lap\s+(\d+)\s*-\s*([\d:.]+)/i);
    if (lapM) {
      const [, chapterTime, lapNum, lapTime] = lapM;
      if (parseInt(lapNum) === 1) onboardStart = chapterTime;
      newLaps.push({ lap: parseInt(lapNum), time: fmtLapTime(lapTime) });
      continue;
    }

    const mapM = norm.match(/^(.+?)\s+-\s+(https?:\/\/\S+)/);
    if (mapM) { trackName = mapM[1].trim(); mapsLink = mapM[2]; }
  }

  if (driver      && !document.getElementById('driver').value)            document.getElementById('driver').value            = driver;
  if (trackName   && !document.getElementById('track_name').value)        document.getElementById('track_name').value        = trackName;
  if (mapsLink    && !document.getElementById('maps_link').value)         document.getElementById('maps_link').value         = mapsLink;
  if (onboardStart && !document.getElementById('video_start_time').value) document.getElementById('video_start_time').value = onboardStart;
  if (newLaps.length) { laps = newLaps; renderLaps(); }

  if (newLaps.length) setStatus('ok', `✓ Imported ${newLaps.length} lap${newLaps.length !== 1 ? 's' : ''}` + (onboardStart ? `, start ${onboardStart}` : ''));
}

// ── Download JSON ──────────────────────────────────────────────────────────
function handleDownload() {
  const data = buildSessionData();
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `${data.session_id}.json` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Publish ────────────────────────────────────────────────────────────────
async function handlePublish(e) {
  e.preventDefault();
  const data = buildSessionData();
  if (!data) return;

  const btn = document.getElementById('publish-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Publishing…';
  setStatus('busy', 'Committing to GitHub…');

  const path = `sessions/${data.session_id}.json`;
  const sha = await getFileSha(path);
  const verb = isEditing ? 'Update' : 'Add';

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${verb} session: ${data.driver} @ ${data.track.name} (${data.session_date})`,
        content: toBase64(JSON.stringify(data, null, 2)),
        ...(sha && { sha })
      })
    });

    if (res.ok) {
      setStatus('ok', '✓ Published! Dashboard updates in ~30 seconds.');
      clearForm();
      loadAllSessions();
    } else {
      const err = await res.json();
      setStatus('err', '✗ ' + (err.message || 'GitHub error'));
    }
  } catch (ex) {
    setStatus('err', '✗ Network error: ' + ex.message);
  }

  btn.disabled = false;
  btn.textContent = '🚀 Publish to GitHub';
  renderTokenStatus();
}

// ── Delete (current form session) ─────────────────────────────────────────
async function handleDelete() {
  if (!confirm('Delete this session from GitHub?\n\nThis cannot be undone and will update the dashboard.')) return;

  setStatus('busy', 'Deleting…');
  const path = `sessions/${sessionId}.json`;
  const sha = await getFileSha(path);

  if (!sha) {
    setStatus('err', '✗ File not found on GitHub (has it been published?)');
    return;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'DELETE',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Delete session: ${sessionId}`, sha })
    });

    if (res.ok) {
      setStatus('ok', '✓ Deleted. Dashboard updates in ~30 seconds.');
      document.getElementById('delete-btn').classList.add('hidden');
      isEditing = false;
      loadAllSessions();
    } else {
      const err = await res.json();
      setStatus('err', '✗ ' + (err.message || 'GitHub error'));
    }
  } catch (ex) {
    setStatus('err', '✗ Network error: ' + ex.message);
  }
}

// ── Sessions list ──────────────────────────────────────────────────────────
async function loadAllSessions() {
  try {
    const res = await fetch('sessions/sessions-list.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    allSessions = (data.sessions || []).sort((a, b) =>
      (b.session_date || '').localeCompare(a.session_date || '')
    );
    renderSessionList();
    populateDatalists();
  } catch {}
}

// Feed the form's <datalist> autocompletes with existing values so names are
// picked, not retyped — preventing spelling variants like "Ignas M" vs
// "Ignas M." at the source.
function populateDatalists() {
  const fill = (id, values) => {
    const dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = [...new Set(values.filter(Boolean))].sort()
      .map(v => `<option value="${String(v).replace(/"/g, '&quot;')}"></option>`).join('');
  };
  fill('driver-options', allSessions.map(s => s.driver));
  fill('track-options',  allSessions.map(s => s.track?.name));
  fill('config-options', allSessions.map(s => s.track?.configuration));
  fill('kart-options',   allSessions.map(s => s.kart));
}

async function loadSessionById(id) {
  try {
    const res = await fetch(`sessions/${id}.json`);
    if (!res.ok) throw new Error('Not found');
    loadIntoForm(await res.json());
  } catch (ex) {
    alert('Could not load session: ' + ex.message);
  }
}

function renderSessionList() {
  const query = (document.getElementById('search-input')?.value || '').toLowerCase();
  const filtered = allSessions.filter(s => {
    const text = [s.driver, s.track?.name, s.track?.configuration, s.session_date, s.kart, s.id].join(' ').toLowerCase();
    return !query || text.includes(query);
  });

  const el = document.getElementById('sessions-list');
  if (!filtered.length) {
    el.innerHTML = '<div style="color:rgba(255,255,255,0.3);padding:24px;text-align:center;font-size:13px">No sessions found.</div>';
    return;
  }

  el.innerHTML = '';
  filtered.forEach(s => {
    const row = document.createElement('div');
    row.className = 'session-row';

    const trackLabel = [s.track?.name, s.track?.configuration].filter(Boolean).join(' · ');
    const meta = [s.session_date, s.kart ? 'Kart ' + s.kart : '', `${s.laps_count ?? '?'} laps`, 'Best: ' + (s.fastest_lap || '—')].filter(Boolean).join(' · ');

    row.innerHTML = `
      <div class="session-info">
        <div class="session-title">${s.driver} — ${trackLabel}</div>
        <div class="session-meta">${meta}</div>
      </div>
      <div class="session-acts">
        <a href="session.html?id=${s.id}" target="_blank" class="btn btn-secondary btn-sm">View</a>
        <button class="btn btn-secondary btn-sm" onclick="loadSessionById('${s.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteById('${s.id}', '${esc(s.driver)}')">Delete</button>
      </div>
    `;
    el.appendChild(row);
  });
}

async function deleteById(id, driver) {
  if (!confirm(`Delete session for ${driver}?\n\nThis cannot be undone.`)) return;

  const path = `sessions/${id}.json`;
  const sha = await getFileSha(path);
  if (!sha) { alert('File not found on GitHub.'); return; }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'DELETE',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Delete session: ${id}`, sha })
    });

    if (res.ok) {
      allSessions = allSessions.filter(s => s.id !== id);
      renderSessionList();
    } else {
      const err = await res.json();
      alert('Error: ' + (err.message || 'Unknown error'));
    }
  } catch (ex) {
    alert('Network error: ' + ex.message);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function parseTime(t) {
  if (!t) return Infinity;
  const parts = t.split(':');
  return parts.length === 2 ? parseInt(parts[0]) * 60 + parseFloat(parts[1]) : (parseFloat(t) || Infinity);
}

function esc(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Championship editor ──────────────────────────────────────────────────
const CHAMP_COLORS = ['gold', 'green', 'blue', 'purple', 'red', 'cyan'];
let champData = null;
let currentSeason = null;
let champLoaded = false;

async function loadChampData() {
  try {
    const res = await fetch('championship-data.json', { cache: 'no-cache' });
    champData = res.ok ? await res.json() : { seasons: [] };
  } catch {
    champData = { seasons: [] };
  }
  champData.seasons = (champData.seasons || []).sort((a, b) => a.year - b.year);
  champData.seasons.forEach(s => {
    s.venues = s.venues || [];
    s.drivers = s.drivers || [];
    s.times = s.times || {};
  });
  currentSeason = champData.seasons.find(s => s.status === 'active') || champData.seasons[champData.seasons.length - 1] || null;
  champLoaded = true;
  renderChampSeasonSelect();
  renderChampForm();
}

function renderChampSeasonSelect() {
  const sel = document.getElementById('champ-season-select');
  if (!champData || !champData.seasons.length) {
    sel.innerHTML = '<option>No seasons yet</option>';
    return;
  }
  sel.innerHTML = champData.seasons.map((s, i) =>
    `<option value="${i}" ${s === currentSeason ? 'selected' : ''}>${s.year} — ${escHtml(s.name)} (${s.status})</option>`
  ).join('');
}

function selectSeason(idxStr) {
  currentSeason = champData.seasons[parseInt(idxStr, 10)] || null;
  renderChampForm();
}

function newSeason() {
  if (!champData) return;
  const years = champData.seasons.map(s => s.year);
  const year = years.length ? Math.max(...years) + 1 : new Date().getFullYear();
  const season = {
    year,
    name: champData.seasons[champData.seasons.length - 1]?.name || 'Spring Challenge',
    status: 'upcoming',
    venues: [],
    drivers: [],
    times: {}
  };
  champData.seasons.push(season);
  champData.seasons.sort((a, b) => a.year - b.year);
  currentSeason = season;
  renderChampSeasonSelect();
  renderChampForm();
  setChampStatus('', '');
}

function renderChampForm() {
  const yearInput = document.getElementById('champ-year');
  const nameInput = document.getElementById('champ-name');
  const statusSelect = document.getElementById('champ-status');
  const deleteBtn = document.getElementById('champ-delete-btn');

  if (!currentSeason) {
    yearInput.value = '';
    nameInput.value = '';
    statusSelect.value = 'upcoming';
    deleteBtn.classList.add('hidden');
    document.getElementById('champ-venues-list').innerHTML = '';
    document.getElementById('champ-drivers-list').innerHTML = '';
    document.getElementById('champ-times-table').innerHTML = '';
    return;
  }

  deleteBtn.classList.remove('hidden');
  yearInput.value = currentSeason.year;
  nameInput.value = currentSeason.name;
  statusSelect.value = currentSeason.status;

  renderVenues();
  renderDrivers();
  renderTimesTable();
}

// ── Venues ──────────────────────────────────────────────────────────────
function renderVenues() {
  const c = document.getElementById('champ-venues-list');
  const venues = currentSeason.venues;
  if (!venues.length) { c.innerHTML = '<div class="champ-empty">No venues yet. Add one above.</div>'; return; }
  c.innerHTML = venues.map((v, i) => `
    <div class="venue-row">
      <input type="text" value="${escHtml(v.label)}" placeholder="Venue name" onchange="renameVenue(${i}, this.value)">
      <select onchange="setVenueColor(${i}, this.value)">
        ${CHAMP_COLORS.map(c => `<option value="${c}" ${v.color === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <label class="done-label"><input type="checkbox" ${v.done ? 'checked' : ''} onchange="setVenueDone(${i}, this.checked)"> Done</label>
      <button type="button" class="row-btn" title="Move up" onclick="moveVenue(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button type="button" class="row-btn" title="Move down" onclick="moveVenue(${i}, 1)" ${i === venues.length - 1 ? 'disabled' : ''}>▼</button>
      <button type="button" class="row-btn row-del" title="Remove venue" onclick="removeVenue(${i})">✕</button>
    </div>
  `).join('');
}

function addVenue() {
  if (!currentSeason) return;
  const used = currentSeason.venues.map(v => v.color);
  const color = CHAMP_COLORS.find(c => !used.includes(c)) || CHAMP_COLORS[currentSeason.venues.length % CHAMP_COLORS.length];
  currentSeason.venues.push({ label: 'New Venue', color, done: false });
  renderVenues();
  renderTimesTable();
}

function renameVenue(i, newLabelRaw) {
  const newLabel = newLabelRaw.trim();
  const venue = currentSeason.venues[i];
  if (!newLabel) { renderVenues(); return; }
  if (newLabel !== venue.label) {
    if (currentSeason.times[venue.label]) {
      currentSeason.times[newLabel] = currentSeason.times[venue.label];
      delete currentSeason.times[venue.label];
    }
    venue.label = newLabel;
    renderTimesTable();
  }
}

function setVenueColor(i, val) { currentSeason.venues[i].color = val; }
function setVenueDone(i, val) { currentSeason.venues[i].done = val; }

function moveVenue(i, dir) {
  const arr = currentSeason.venues;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderVenues();
  renderTimesTable();
}

function removeVenue(i) {
  const venue = currentSeason.venues[i];
  if (!confirm(`Remove venue "${venue.label}"? This also clears its recorded lap times.`)) return;
  delete currentSeason.times[venue.label];
  currentSeason.venues.splice(i, 1);
  renderVenues();
  renderTimesTable();
}

// ── Drivers ─────────────────────────────────────────────────────────────
function renderDrivers() {
  const c = document.getElementById('champ-drivers-list');
  const drivers = currentSeason.drivers;
  if (!drivers.length) { c.innerHTML = '<div class="champ-empty">No drivers yet. Add one above.</div>'; return; }
  c.innerHTML = drivers.map((d, i) => `
    <div class="driver-row">
      <input type="text" value="${escHtml(d)}" placeholder="Driver name" list="driver-options" onchange="renameDriver(${i}, this.value)">
      <button type="button" class="row-btn" title="Move up" onclick="moveDriver(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button type="button" class="row-btn" title="Move down" onclick="moveDriver(${i}, 1)" ${i === drivers.length - 1 ? 'disabled' : ''}>▼</button>
      <button type="button" class="row-btn row-del" title="Remove driver" onclick="removeDriver(${i})">✕</button>
    </div>
  `).join('');
}

function addDriver() {
  if (!currentSeason) return;
  currentSeason.drivers.push('');
  renderDrivers();
  renderTimesTable();
  const inputs = document.querySelectorAll('#champ-drivers-list input[type="text"]');
  inputs[inputs.length - 1]?.focus();
}

function renameDriver(i, newNameRaw) {
  const newName = newNameRaw.trim();
  const oldName = currentSeason.drivers[i];
  if (!newName) { renderDrivers(); return; }
  if (newName !== oldName) {
    Object.values(currentSeason.times).forEach(venueTimes => {
      if (venueTimes[oldName] !== undefined) {
        venueTimes[newName] = venueTimes[oldName];
        delete venueTimes[oldName];
      }
    });
    currentSeason.drivers[i] = newName;
    renderTimesTable();
  }
}

function moveDriver(i, dir) {
  const arr = currentSeason.drivers;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderDrivers();
  renderTimesTable();
}

function removeDriver(i) {
  const name = currentSeason.drivers[i];
  if (!confirm(`Remove driver "${name}"? This also clears their recorded lap times.`)) return;
  Object.values(currentSeason.times).forEach(venueTimes => { delete venueTimes[name]; });
  currentSeason.drivers.splice(i, 1);
  renderDrivers();
  renderTimesTable();
}

// ── Lap times grid ──────────────────────────────────────────────────────
function normalizeLapTime(raw) {
  const clean = raw.trim();
  if (!clean) return '';
  const looksLikeTime = /^\d{1,2}:\d{2}(\.\d+)?$|^\d{1,3}(\.\d+)?$/.test(clean);
  return looksLikeTime ? fmtLapTime(clean) : clean;
}

function setTime(vi, di, value) {
  const label = currentSeason.venues[vi].label;
  const driver = currentSeason.drivers[di];
  const clean = normalizeLapTime(value);
  if (!currentSeason.times[label]) currentSeason.times[label] = {};
  if (clean) currentSeason.times[label][driver] = clean;
  else delete currentSeason.times[label][driver];
}

function renderTimesTable() {
  const table = document.getElementById('champ-times-table');
  const { venues, drivers, times } = currentSeason;
  if (!venues.length || !drivers.length) {
    table.innerHTML = '<tr><td class="champ-empty">Add at least one venue and one driver to enter lap times.</td></tr>';
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Driver</th>${venues.map(v => `<th>${escHtml(v.label)}</th>`).join('')}</tr></thead>
    <tbody>
      ${drivers.map((d, di) => `
        <tr>
          <td>${escHtml(d)}</td>
          ${venues.map((v, vi) => `<td><input type="text" placeholder="00:00.000" value="${escHtml(times[v.label]?.[d] || '')}" onchange="setTime(${vi}, ${di}, this.value)"></td>`).join('')}
        </tr>
      `).join('')}
    </tbody>
  `;
}

// ── Status / download / publish / delete ───────────────────────────────
function setChampStatus(type, msg) {
  const el = document.getElementById('champ-status-msg');
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function handleChampDownload() {
  if (!champData) return;
  const blob = new Blob([JSON.stringify(champData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'championship-data.json' });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function commitChampData(message) {
  if (!getToken()) { setChampStatus('err', '✗ Set a GitHub token first'); return; }

  const btn = document.getElementById('champ-publish-btn');
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Publishing…';
  setChampStatus('busy', 'Committing to GitHub…');

  const path = 'championship-data.json';
  const sha = await getFileSha(path);

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: toBase64(JSON.stringify(champData, null, 2)),
        ...(sha && { sha })
      })
    });

    if (res.ok) {
      setChampStatus('ok', '✓ Published! Championship page updates in ~30 seconds.');
    } else {
      const err = await res.json();
      setChampStatus('err', '✗ ' + (err.message || 'GitHub error'));
    }
  } catch (ex) {
    setChampStatus('err', '✗ Network error: ' + ex.message);
  }

  btn.disabled = false;
  btn.textContent = prevText;
  renderTokenStatus();
}

async function handleChampPublish() {
  if (!champData) return;
  await commitChampData(currentSeason ? `Update championship: ${currentSeason.year} ${currentSeason.name}` : 'Update championship data');
}

async function handleChampDelete() {
  if (!currentSeason) return;
  if (!confirm(`Delete the ${currentSeason.year} season? This cannot be undone once published.`)) return;
  const removed = currentSeason;
  champData.seasons = champData.seasons.filter(s => s !== removed);
  currentSeason = champData.seasons.find(s => s.status === 'active') || champData.seasons[champData.seasons.length - 1] || null;
  renderChampSeasonSelect();
  renderChampForm();
  await commitChampData(`Delete championship season: ${removed.year}`);
}

// ── Track registry (sessions/tracks-manual.json) ───────────────────────────
let manualTracks = [];
let manualTracksLoaded = false;
let editingTrackName = null;

function randomTrackColor() {
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 65, 60);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

async function loadManualTracks() {
  try {
    const res = await fetch('sessions/tracks-manual.json', { cache: 'no-cache' });
    manualTracks = res.ok ? await res.json() : [];
  } catch {
    manualTracks = [];
  }
  manualTracksLoaded = true;
  renderManualTracksList();
}

function renderManualTracksList() {
  const el = document.getElementById('manual-tracks-list');
  if (!manualTracks.length) {
    el.innerHTML = '<div class="champ-empty">No manually-registered tracks yet.</div>';
    return;
  }
  el.innerHTML = manualTracks.map(t => `
    <div class="venue-row">
      <span style="width:12px;height:12px;border-radius:50%;background:${escHtml(t.color || '#aaaaaa')};flex-shrink:0"></span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px">${escHtml(t.name)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35)">${escHtml(t.note || '')}</div>
      </div>
      <button type="button" class="row-btn" title="Edit" onclick="editManualTrack('${esc(t.name)}')">✎</button>
      <button type="button" class="row-btn row-del" title="Remove" onclick="deleteManualTrack('${esc(t.name)}')">✕</button>
    </div>
  `).join('');
}

function buildTrackData() {
  const name = document.getElementById('track-name-input').value.trim();
  if (!name) { alert('Track name is required.'); return null; }
  return {
    name,
    note: document.getElementById('track-note-input').value.trim(),
    configuration: document.getElementById('track-config-input').value.trim(),
    color: document.getElementById('track-color-input').value,
    mapsLink: document.getElementById('track-maps-link-input').value.trim()
  };
}

function setTrackStatus(type, msg) {
  const el = document.getElementById('track-status');
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function resetTrackForm() {
  document.getElementById('track-form').reset();
  document.getElementById('track-color-input').value = randomTrackColor();
  editingTrackName = null;
  document.getElementById('track-form-label').textContent = 'New track';
  setTrackStatus('', '');
}

function editManualTrack(name) {
  const t = manualTracks.find(t => t.name === name);
  if (!t) return;
  editingTrackName = t.name;
  document.getElementById('track-name-input').value = t.name || '';
  document.getElementById('track-note-input').value = t.note || '';
  document.getElementById('track-config-input').value = t.configuration || '';
  document.getElementById('track-color-input').value = t.color || '#4ab8e8';
  document.getElementById('track-maps-link-input').value = t.mapsLink || '';
  document.getElementById('track-form-label').textContent = 'Editing: ' + t.name;
  setTrackStatus('', '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function commitManualTracks(message) {
  const path = 'sessions/tracks-manual.json';
  const sha = await getFileSha(path);
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(JSON.stringify(manualTracks, null, 2)),
      ...(sha && { sha })
    })
  });
}

async function handleTrackPublish(e) {
  e.preventDefault();
  const data = buildTrackData();
  if (!data) return;

  const nameTaken = [
    ...allSessions.map(s => s.track?.name),
    ...manualTracks.map(t => t.name)
  ].some(n => n && n === data.name && n !== editingTrackName);
  if (nameTaken) { alert('A track with this name already exists.'); return; }

  const btn = document.getElementById('track-publish-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Publishing…';
  setTrackStatus('busy', 'Committing to GitHub…');

  const idx = editingTrackName ? manualTracks.findIndex(t => t.name === editingTrackName) : -1;
  if (idx >= 0) manualTracks[idx] = data;
  else manualTracks.push(data);

  try {
    const res = await commitManualTracks(`${editingTrackName ? 'Update' : 'Add'} track: ${data.name}`);
    if (res.ok) {
      setTrackStatus('ok', '✓ Published! Map updates in ~30 seconds.');
      editingTrackName = null;
      document.getElementById('track-form-label').textContent = 'New track';
      renderManualTracksList();
    } else {
      const err = await res.json();
      setTrackStatus('err', '✗ ' + (err.message || 'GitHub error'));
    }
  } catch (ex) {
    setTrackStatus('err', '✗ Network error: ' + ex.message);
  }

  btn.disabled = false;
  btn.textContent = '🚀 Publish to GitHub';
  renderTokenStatus();
}

async function deleteManualTrack(name) {
  if (!confirm(`Remove track "${name}" from the registry?\n\nIf it already has sessions it'll still appear on the map — this only removes the manual pre-registration.`)) return;
  manualTracks = manualTracks.filter(t => t.name !== name);
  try {
    const res = await commitManualTracks(`Remove track: ${name}`);
    if (res.ok) renderManualTracksList();
    else { const err = await res.json(); alert('Error: ' + (err.message || 'Unknown error')); }
  } catch (ex) {
    alert('Network error: ' + ex.message);
  }
}
