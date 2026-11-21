const el = id => document.getElementById(id);
const channel = 'https://www.youtube.com/@HelmetCamHeroes';
const validId = value => /^[A-Za-z0-9_-]{11}$/.test(value || '');
const dates = new Intl.DateTimeFormat('en-GB', {dateStyle:'medium', timeZone:'UTC'});
let featured, map, requestNumber = 0;
let tracks = [], sessions = [];
let previewsAllowed = false, currentVideoId = null, mapLoading = false;
const markers = new Map();

async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path);
  return response.json();
}

function render(label, title, meta, id, href) {
  currentVideoId = validId(id) ? id : null;
  el('label').textContent = label;
  el('title').textContent = title;
  el('meta').textContent = meta;
  el('watch').hidden = !href;
  el('watch').href = href || channel;
  el('cover').hidden = !validId(id);
  if (validId(id)) {
    el('cover').href = href;
    el('cover').setAttribute('aria-label', 'Watch ' + title);
  }
  updatePreview();
}

function updatePreview() {
  el('thumbnail').src = previewsAllowed && currentVideoId
    ? 'https://i.ytimg.com/vi/' + currentVideoId + '/hqdefault.jpg'
    : 'og-image.png';
}

function videoId(raw) {
  try {
    const url = new URL(raw);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1);
    if (['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)) {
      return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    }
  } catch { /* Older sessions may have no URL. */ }
}

function showAllMarkers() {
  if (markers.size) {
    const positions = Array.from(markers.values(), marker => marker.getLatLng());
    map.fitBounds(positions, {padding:[24,24], maxZoom:12});
  }
}

function showLatest() {
  requestNumber++;
  el('track').value = '';
  el('view-ride').hidden = el('archive').hidden = el('reset').hidden = true;
  for (const marker of markers.values()) marker.closeTooltip();
  showAllMarkers();
  render('Latest on HelmetCamHeroes', featured?.title || 'Watch the latest upload',
    featured ? dates.format(new Date(featured.published)) : '', featured?.id,
    featured ? 'https://youtu.be/' + featured.id : channel);
}

async function selectTrack(name) {
  if (!name) return showLatest();
  const current = ++requestNumber;
  el('track').value = name;
  const marker = markers.get(name);
  if (marker) {
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 8));
    marker.openTooltip();
  }
  el('archive').href = 'sessions.html?track=' + encodeURIComponent(name);
  el('view-ride').hidden = el('archive').hidden = el('reset').hidden = false;
  render('Latest recorded ride', name, 'Looking up recorded sessions…');
  try {
    const candidates = sessions.filter(s => s.track?.name === name && s.has_video)
      .sort((a,b) => b.session_date.localeCompare(a.session_date));
    for (const session of candidates) {
      const detail = await readJson('sessions/' + encodeURIComponent(session.id) + '.json');
      if (current !== requestNumber) return;
      const id = videoId(detail.video_url);
      if (!validId(id) || detail.video_available === false) continue;
      render('Latest recorded ride', name, [session.driver, dates.format(new Date(session.session_date))].filter(Boolean).join(' · '),
        id, 'https://youtu.be/' + id);
      return;
    }
    render('Recorded rides', name, 'No available video for this track.');
  } catch {
    if (current === requestNumber) render('Recorded rides', name, 'Could not load this ride. Open the session archive below.');
  }
}

async function loadTracks() {
  try {
    [tracks, {sessions}] = await Promise.all([readJson('sessions/tracks-list.json'), readJson('sessions/sessions-list.json')]);
    for (const track of tracks.sort((a,b) => a.name.localeCompare(b.name))) {
      el('track').add(new Option(track.name, track.name));
    }
    el('track').options[0].text = 'All ' + tracks.length + ' tracks';
  } catch {
    el('map-status').textContent = 'Track data unavailable. Browse the session archive.';
    el('map-status').hidden = false;
  }
}

async function loadMap() {
  if (map || mapLoading) return;
  mapLoading = true;
  el('allow-map').disabled = true;
  try {
    await tracksReady;
    if (!tracks.length) throw new Error('No track data');
    el('map-status').hidden = true;
    el('map').hidden = false;
    map = L.map('map', {scrollWheelZoom:false}).setView([55.25,23.8], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom:19
    }).addTo(map);
    for (const track of tracks) {
      if (!Number.isFinite(track.lat) || !Number.isFinite(track.lng) || (!track.lat && !track.lng)) continue;
      const label = document.createElement('span');
      label.textContent = track.name;
      const marker = L.marker([track.lat,track.lng], {title:track.name,alt:track.name})
        .addTo(map).bindTooltip(label).on('click', () => selectTrack(track.name));
      markers.set(track.name,marker);
    }
    showAllMarkers();
    const selected = markers.get(el('track').value);
    if (selected) {
      map.setView(selected.getLatLng(), 8);
      selected.openTooltip();
    }
    el('map-permission').hidden = true;
    el('stop-map').hidden = false;
    map.invalidateSize();
  } catch {
    if (map) map.remove();
    map = null;
    markers.clear();
    el('map').hidden = true;
    el('map-status').textContent = tracks.length ? 'Map unavailable. Choose a track above.' : 'Track data unavailable. Browse the session archive below.';
    el('map-status').hidden = false;
  } finally {
    mapLoading = false;
    el('allow-map').disabled = false;
  }
}

el('track').addEventListener('change', event => selectTrack(event.target.value));
el('reset').addEventListener('click', showLatest);
el('allow-preview').addEventListener('click', () => {
  previewsAllowed = true;
  el('allow-preview').hidden = true;
  el('stop-preview').hidden = false;
  el('preview-status').textContent = 'YouTube images are enabled for this page. Reloading resets this choice. Disabling cannot undo information already sent to Google.';
  updatePreview();
});
el('stop-preview').addEventListener('click', () => {
  previewsAllowed = false;
  updatePreview();
  window.location.reload();
});
el('allow-map').addEventListener('click', loadMap);
el('stop-map').addEventListener('click', () => window.location.reload());
readJson('latest-video.json').then(data => {
  if (validId(data.id) && data.title && Number.isFinite(Date.parse(data.published))) featured = data;
  if (!el('track').value) showLatest();
}).catch(() => { /* The channel link works even when the cache cannot be read. */ });
const tracksReady = loadTracks();
