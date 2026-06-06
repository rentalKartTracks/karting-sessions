'use strict';

const REPO = 'rentalKartTracks/karting-sessions';
const TOKEN_KEY = 'hch_admin_pat';

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
  loadAllSessions();

  const id = new URLSearchParams(location.search).get('id');
  if (id) loadSessionById(id);
});

// ── Tabs ───────────────────────────────────────────────────────────────────
function showTab(name) {
  document.getElementById('panel-new').classList.toggle('hidden', name !== 'new');
  document.getElementById('panel-manage').classList.toggle('hidden', name !== 'manage');
  document.getElementById('tab-new').classList.toggle('active', name === 'new');
  document.getElementById('tab-manage').classList.toggle('active', name === 'manage');
}

// ── Token management ───────────────────────────────────────────────────────
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

function renderTokenStatus() {
  const ok = !!getToken();
  document.getElementById('token-dot').className = 'token-dot' + (ok ? ' ok' : '');
  document.getElementById('token-chip-text').textContent = ok ? 'GitHub: ready' : 'GitHub: set up token';
  document.getElementById('publish-btn').disabled = !ok;
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
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && !document.getElementById('modal-bg').classList.contains('hidden')) {
    saveToken();
  }
});

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
  laps[i].time = val;
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

async function importYouTubeTitle() {
  const url = document.getElementById('video_url').value.trim();
  if (!url) return;
  const id = extractYouTubeId(url);
  if (!id) return;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!res.ok) return;
    prefillFromTitle((await res.json()).title);
  } catch {}
}

function prefillFromTitle(title) {
  // Expected title format: "Track - Driver "FastestLap" (YYYY-MM-DD)"
  const m = title.replace(/[‎‏​]/g, '')
    .match(/^(.+?)\s*[-–]\s*(.+?)\s*"[^"]*"\s*\((\d{4}-\d{2}-\d{2})\)$/);
  if (!m) return;
  const [, track, driver, date] = m;
  if (!document.getElementById('track_name').value)   document.getElementById('track_name').value   = track.trim();
  if (!document.getElementById('driver').value)        document.getElementById('driver').value        = driver.trim();
  if (!document.getElementById('session_date').value)  document.getElementById('session_date').value  = date;
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

  const clean = raw.replace(/[‎‏​‌‍﻿]/g, '');
  let driver = '', mapsLink = '', trackName = '', onboardStart = '';
  const newLaps = [];

  for (const line of clean.split('\n')) {
    const norm = normalizeBold(line.trim());

    // "Driver: Name"
    const driverM = norm.match(/^Driver:\s*(.+)/i);
    if (driverM) { driver = driverM[1].trim(); continue; }

    // "*MM:SS Lap N - laptime*" (RaceChrono)
    const lapM = norm.match(/^\*?(\d{1,2}:\d{2})\s+Lap\s+(\d+)\s*-\s*([\d:.]+)/i);
    if (lapM) {
      const [, chapterTime, lapNum, lapTime] = lapM;
      if (parseInt(lapNum) === 1) onboardStart = chapterTime;
      newLaps.push({ lap: parseInt(lapNum), time: fmtLapTime(lapTime) });
      continue;
    }

    // "Track Name - https://maps..." (maps line)
    const mapM = norm.match(/^(.+?)\s+-\s+(https?:\/\/\S+)/);
    if (mapM) { trackName = mapM[1].trim(); mapsLink = mapM[2]; }
  }

  if (driver      && !document.getElementById('driver').value)             document.getElementById('driver').value             = driver;
  if (trackName   && !document.getElementById('track_name').value)         document.getElementById('track_name').value         = trackName;
  if (mapsLink    && !document.getElementById('maps_link').value)          document.getElementById('maps_link').value          = mapsLink;
  if (onboardStart && !document.getElementById('video_start_time').value)  document.getElementById('video_start_time').value  = onboardStart;
  if (newLaps.length) { laps = newLaps; renderLaps(); }

  hideDescImport();
  setStatus('ok', `✓ Imported ${newLaps.length} lap${newLaps.length !== 1 ? 's' : ''}` + (onboardStart ? `, start ${onboardStart}` : ''));
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
    const res = await fetch('sessions/sessions-list.json?_=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    allSessions = (data.sessions || []).sort((a, b) =>
      (b.session_date || '').localeCompare(a.session_date || '')
    );
    renderSessionList();
  } catch {}
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
