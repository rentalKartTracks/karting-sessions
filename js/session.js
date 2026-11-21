// ===== GLOBAL VARIABLES =====
let currentSessionData = null;
let comparisonSessions = [];
let chartPoints = [];
let currentDataset = [];
let comparisonDatasets = [];
let activePoint = null;
let allSessionsList = [];
let currentMode = 'pc';
let animationFrameId = null;
let lastTooltipUpdate = 0;
const TOOLTIP_DEBOUNCE = 50;

// Video players
let videoPlayers = {}; // sessionId -> YT.Player
let videoConfigs = {}; // sessionId -> { videoId, startTimeSeconds, label }
let activeVideoIds = []; // ordered list of sessionIds
let activeLayout = 'single';
let firstSelectedVideoId = null; // for swapping videos
let activeAudioSessionId = null; // tracks which video plays sound
let audioMuted = false;
let comparisonRequestNumber = 0;

// Lap tracking
let lapStartTimes = [];
let currentLapMarker = { lapNumber: 1 };
let updateStatsInterval = null;
let playbackRequested = false;
let requestedVideoTime = null;
let pendingSeekTime = null;
let pendingSeekDeadline = 0;

// PeerJS for remote control
let peer = null;
let connections = [];
let statsInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let hostPeerId = null;
let peerReconnectTimer = null;
let peerConnectionTimer = null;
let peerConnectionState = 'disabled';
let remoteAllowed = false;

// URL parameters
const params = new URLSearchParams(window.location.search);
const sessionId = params.get("id") || "example-session";
const compareId = params.get("compare_id");

// Color schemes for comparison
const comparisonColors = [
  { line: '#4caf50', point: '#8bc34a' },
  { line: '#2196f3', point: '#64b5f6' },
  { line: '#ff9800', point: '#ffb74d' },
  { line: '#9c27b0', point: '#ba68c8' },
  { line: '#00bcd4', point: '#4dd0e1' },
  { line: '#ffeb3b', point: '#fff176' },
  { line: '#795548', point: '#a1887f' },
  { line: '#e91e63', point: '#f06292' }
];

// YouTube error messages
const ERROR_MESSAGES = {
  2: 'Invalid video ID or parameters',
  5: 'HTML5 player error - Try refreshing',
  100: 'Video not found or removed',
  101: 'Embedding restricted by owner',
  150: 'Embedding restricted by owner'
};

// ===== UTILITY FUNCTIONS =====

/**
 * Parse time string to seconds
 * Handles formats: "1:23.456", "0:34", "00:034", "34.5"
 */
function parseTime(timeStr) {
  if (timeStr === null || timeStr === undefined || timeStr === "") return 0;
  if (typeof timeStr === 'number') return timeStr;

  const cleanStr = timeStr.toString().trim();

  // Handle malformed formats like "00:034" -> 34 seconds
  if (cleanStr.match(/^00:0\d+$/)) {
    return parseInt(cleanStr.replace(/^00:0/, ''));
  }

  // Handle "0:34" format
  if (cleanStr.match(/^0:\d+$/)) {
    return parseInt(cleanStr.replace(/^0:/, ''));
  }

  const parts = cleanStr.split(':');
  if (parts.length === 2) {
    return (parseInt(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }

  return parseFloat(cleanStr) || 0;
}

/**
 * Validate lap data array
 */
function validateLapData(laps) {
  if (!Array.isArray(laps)) {
    return [];
  }

  return laps.filter(lap => {
    if (!lap || typeof lap !== 'object') return false;
    const time = parseTime(lap.time);
    const isValid = lap.lap > 0 && time > 0 && time < 600 && !isNaN(time);
    return isValid;
  });
}

/**
 * Format seconds to display time
 */
function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return 'N/A';
  if (typeof seconds !== 'number' || isNaN(seconds)) return 'N/A';

  const totalSeconds = Math.max(0, seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = (totalSeconds % 60).toFixed(3);
  const formattedSecs = secs.padStart(6, '0');

  return mins > 0 ? `${mins}:${formattedSecs}` : `${parseFloat(secs).toFixed(3)}s`;
}

/**
 * Calculate consistency (standard deviation)
 */
function calculateConsistency(lapTimes) {
  const validTimes = lapTimes.filter(t => t > 0 && t < 300);
  if (validTimes.length < 3) return 0;

  const sorted = [...validTimes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const filtered = validTimes.filter(t => t <= median * 1.03);
  if (filtered.length < 2) return 0;

  const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const variance = filtered.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / filtered.length;

  return Math.sqrt(variance);
}

/**
 * Get consistency rating
 */
function getConsistencyRating(stdDev) {
  if (stdDev < 0.5) return { text: 'Excellent', class: 'consistency-excellent' };
  if (stdDev < 0.9) return { text: 'Good', class: 'consistency-good' };
  if (stdDev < 1.4) return { text: 'Fair', class: 'consistency-fair' };
  return { text: 'Traffic Affected', class: 'consistency-poor' };
}

/**
 * Extract YouTube video ID from URL
 */
function extractYouTubeId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = url.match(regex);
  return match ? match[1] : null;
}

/**
 * Update slider progress CSS variable
 */
function updateSliderProgress(slider) {
  const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
  slider.style.setProperty('--slider-progress', `${value}%`);
}

// ===== MODE SWITCHING =====

/**
* Detect initial mode from URL or localStorage
*/
function detectInitialMode() {
  const urlMode = params.get('mode');
  const savedMode = localStorage.getItem('kartingViewerMode');

  if (urlMode === 'tv' || urlMode === 'pc') {
    currentMode = urlMode;
  } else if (savedMode && (savedMode === 'tv' || savedMode === 'pc')) {
    currentMode = savedMode;
  } else {
    // Auto-detect based on screen size
    const isLikelyTV = window.innerWidth >= 1920 && window.innerHeight >= 1080;
    currentMode = isLikelyTV ? 'tv' : 'pc';
  }

  applyMode(currentMode);
  updateModeButtons();
}

/**
* Switch between PC and TV modes
*/
function switchMode(mode) {
  currentMode = mode;
  applyMode(mode);
  updateModeButtons();
  localStorage.setItem('kartingViewerMode', mode);

  // Update URL
  const url = new URL(window.location);
  url.searchParams.set('mode', mode);
  window.history.replaceState({}, '', url);
}

/**
* Apply mode-specific styling and visibility
*/
function applyMode(mode) {
  document.body.className = mode + '-mode';

  const videoSection = document.getElementById('video-section');
  const qrPanel = document.getElementById('qr-panel');
  const comparisonSection = document.getElementById('comparison-section');
  const footer = document.querySelector('.footer');
  const detailedChart = document.querySelector('.detailed-chart');
  const statsGrid = document.getElementById('stats-grid');

  if (mode === 'tv') {
    // TV Mode: Simplified view
    if (comparisonSection) comparisonSection.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (detailedChart) detailedChart.style.display = 'none';

    // Show QR panel only if video exists
    const hasVideo = videoSection && videoSection.style.display !== 'none';
    if (qrPanel) qrPanel.style.display = hasVideo ? 'block' : 'none';

    // Show TV-specific stats
    if (statsGrid && currentSessionData) {
      renderTVStats();
    }

  } else {
    // PC Mode: Full view
    if (comparisonSection) comparisonSection.style.display = 'block';
    if (footer) footer.style.display = 'block';
    if (detailedChart) detailedChart.style.display = 'block';

    if (qrPanel) qrPanel.style.display = remoteAllowed ? 'block' : 'none';

    // Show normal stats
    if (statsGrid && currentSessionData) {
      renderStatsGrid(currentSessionData);
    }
  }

  updateModeButtons();
}

/**
* Update mode button active states
*/
function updateModeButtons() {
  const pcBtn = document.getElementById('pc-mode-btn');
  const tvBtn = document.getElementById('tv-mode-btn');

  if (pcBtn && tvBtn) {
    pcBtn.classList.toggle('active', currentMode === 'pc');
    tvBtn.classList.toggle('active', currentMode === 'tv');
  }
}

/**
* Render TV mode stats (simplified, large)
*/
function renderTVStats() {
  const statsGrid = document.getElementById('stats-grid');
  if (!statsGrid || !currentSessionData) return;

  const fastestTime = currentSessionData.fastest_lap || '--:--';
  const currentLap = currentLapMarker.lapNumber;
  const delta = calculateCurrentDelta();

  statsGrid.innerHTML = `
  <div class="stat-card tv-stat">
    <div class="stat-label">Fastest Lap</div>
    <div class="stat-value fastest-time">${fastestTime}</div>
  </div>
  <div class="stat-card tv-stat">
    <div class="stat-label">Current Lap</div>
    <div class="stat-value" id="tv-current-lap">${currentLap}</div>
  </div>
  <div class="stat-card tv-stat">
    <div class="stat-label">Delta</div>
    <div class="stat-value" id="tv-delta" style="color:${delta >= 0 ? 'var(--error)' : 'var(--secondary)'}">
      ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}s
    </div>
  </div>
  `;
}

/**
* Calculate delta for current lap
*/
function calculateCurrentDelta() {
  if (!currentSessionData || !currentSessionData.laps) return 0;

  const currentLap = currentLapMarker.lapNumber;
  const currentLapData = currentSessionData.laps[currentLap - 1];
  if (!currentLapData || !currentLapData.time) return 0;

  const validLaps = validateLapData(currentSessionData.laps);
  const lapTimes = validLaps.map(l => parseTime(l.time));
  const fastestTime = lapTimes.length > 0 ? Math.min(...lapTimes) : 0;
  const currentTime = parseTime(currentLapData.time);

  return currentTime - fastestTime;
}

// ===== STATS RENDERING =====

/**
* Render main stats grid
*/
function renderStatsGrid(data) {
  const statsGrid = document.getElementById('stats-grid');
  if (!statsGrid) return;

  const validLaps = validateLapData(data.laps);
  const lapTimes = validLaps.map(lap => parseTime(lap.time)).filter(time => !isNaN(time));

  const fastestTime = data.fastest_lap ?
    parseTime(data.fastest_lap) :
    (lapTimes.length > 0 ? Math.min(...lapTimes) : 0);

  const fastestIdx = data.fastest_lap ?
    validLaps.findIndex(lap => lap.time === data.fastest_lap) :
    lapTimes.indexOf(fastestTime);

  // Mark best lap
  validLaps.forEach((lap, i) => { lap.best = (i === fastestIdx); });

  const avgTime = lapTimes.length > 0 ?
    lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length : 0;

  const stdDev = calculateConsistency(lapTimes);
  const consistency = getConsistencyRating(stdDev);

  const fastestLapNumber = fastestIdx >= 0 ? fastestIdx + 1 : 1;

  // Deep-link to the fastest lap on YouTube (video_start_time + sum of earlier
  // laps). Computed here because lapStartTimes isn't built until after this.
  let ytShare = '';
  const ytId = data.video_url ? extractYouTubeId(data.video_url) : null;
  if (ytId && fastestIdx >= 0) {
    let startSec = parseTime(data.video_start_time || '0:00');
    for (let i = 0; i < fastestIdx; i++) startSec += parseTime(validLaps[i].time);
    startSec = Math.max(0, Math.floor(startSec));
    ytShare = ` <a class="yt-share" href="https://youtu.be/${ytId}?t=${startSec}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open the fastest lap on YouTube">↗ YT</a>`;
  }

  const w = data.weather;
  const weatherHTML = w ? `
  <div class="stat-card" title="Weather conditions at race time">
    <div class="stat-label">🌤 Weather</div>
    <div class="stat-value" style="font-size:1em;line-height:1.4;">
      ${w.condition}<br>
      <span style="font-size:0.75em;opacity:0.7;">${w.temp_max}°/${w.temp_min}°C · 💨${w.wind_kmh}km/h${w.rain_mm > 0 ? ` · 🌧${w.rain_mm}mm` : ''}</span>
    </div>
  </div>` : '';

  statsGrid.innerHTML = `
  <div class="stat-card stat-card-clickable" onclick="seekToLap(${fastestLapNumber})" title="Jump to fastest lap">
    <div class="stat-label">Fastest Lap${ytShare}</div>
    <div class="stat-value fastest-time">${data.fastest_lap || formatTime(fastestTime)}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Average Lap</div>
    <div class="stat-value small">${formatTime(avgTime)}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Consistency</div>
    <div class="stat-value small ${consistency.class}">
      ${consistency.text}<br>
      <span style="font-size: 0.8em;">(±${stdDev.toFixed(3)}s)</span>
    </div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Track</div>
    <div class="stat-value" style="font-size:1.3em;">
      <a class="track-link" href="${data.track.maps_link}" target="_blank" rel="noopener noreferrer">
        ${data.track.name}
      </a>
    </div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Engine</div>
    <div class="stat-value">${data.kart}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Total Laps</div>
    <div class="stat-value">${validLaps.length}</div>
  </div>
  ${weatherHTML}
  `;
}

// ===== VIDEO PLAYER MANAGEMENT =====

/**
* Load YouTube IFrame API
*/
let youtubeAllowed = false;
let youtubeLoading = false;

function loadYouTubeAPI() {
  if (!youtubeAllowed || youtubeLoading) return;
  if (window.YT && window.YT.Player) {
    window.onYouTubeIframeAPIReady();
    return;
  }
  youtubeLoading = true;

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.async = true;
  tag.onerror = () => {
    youtubeLoading = false;
    tag.remove();
    document.getElementById('video-permission-status').textContent = 'YouTube could not load. Try again or keep browsing the lap data.';
    document.getElementById('allow-youtube').hidden = false;
  };
  document.body.appendChild(tag);
}

/**
 * YouTube API ready callback
 */
window.onYouTubeIframeAPIReady = function () {
  // Initialize all active players that have configs
  activeVideoIds.forEach(id => {
    if (videoConfigs[id] && !videoPlayers[id]) {
      createPlayer(id, videoConfigs[id]);
    }
  });
};

/**
* Create main YouTube player
*/
/**
 * Generic create player function
 */
function createPlayer(id, config) {
  if (!youtubeAllowed) return;
  const { videoId, startTimeSeconds } = config;
  const containerId = `player-${id}`;

  // Ensure container exists (it should via renderVideoGrid)
  if (!document.getElementById(containerId)) {
    return;
  }

  videoPlayers[id] = new YT.Player(containerId, {
    host: 'https://www.youtube-nocookie.com',
    videoId: videoId,
    playerVars: {
      start: startTimeSeconds,
      autoplay: 0,
      rel: 0,
      modestbranding: 1,
      origin: window.location.origin,
      enablejsapi: 1,
      controls: 1,
      playsinline: 1,
      iv_load_policy: 3,
      fs: 1,
      disablekb: 0
    },
    events: {
      'onReady': (e) => onPlayerReady(e, id),
      'onStateChange': onPlayerStateChange,
      'onError': (e) => onPlayerError(e, id)
    }
  });
}

/**
* Create comparison YouTube player
*/
/**
 * Player ready handler
 */
function setHighestQuality(player) {
  if (!player || typeof player.getAvailableQualityLevels !== 'function') return;
  const qualities = player.getAvailableQualityLevels();
  if (!Array.isArray(qualities) || typeof player.setPlaybackQuality !== 'function') return;
  const preferred = ['hd2160', 'hd1440', 'hd1080', 'hd720'];
  for (const q of preferred) {
    if (qualities.includes(q)) {
      player.setPlaybackQuality(q);
      return;
    }
  }
}

function onPlayerReady(event, id) {
  const player = videoPlayers[id];
  if (!player || event.target !== player) return;
  player._hchReady = true;
  updateAudioState();
  // Pause a newly cued player before seeking so seekTo preserves that state.
  if (!playbackRequested && typeof player.pauseVideo === 'function') player.pauseVideo();

  if (id === sessionId) {
    if (requestedVideoTime !== null) seekToVideoTime(requestedVideoTime);
    if (currentMode === 'tv') {
      const qrPanel = document.getElementById('qr-panel');
      if (qrPanel) qrPanel.style.display = 'block';
    }
  } else if (typeof player.seekTo === 'function') {
    const referenceTime = getReferenceVideoTime();
    const initialTime = requestedVideoTime ?? getVideoStartOffset(sessionId);
    const mainTime = referenceTime === null || (!playbackRequested && requestedVideoTime === null && referenceTime < initialTime)
      ? initialTime : referenceTime;
    const target = mapVideoTime(sessionId, id, mainTime);
    player.seekTo(clampPlayerTime(player, target), true);
  }

  // A newly cued comparison may start when sought; it follows the shared intent.
  if (playbackRequested) {
    if (typeof player.playVideo === 'function') player.playVideo();
  } else if (typeof player.pauseVideo === 'function') {
    player.pauseVideo();
  }
}

/**
 * Only the reference player owns shared playback state and the live-stats timer.
 * A comparison buffering, pausing or ending must not freeze the main timeline.
 */
function onPlayerStateChange(event) {
  const senderId = Object.keys(videoPlayers).find(id => videoPlayers[id] === event.target);
  if (!senderId) return;
  const isPlaying = event.data === YT.PlayerState.PLAYING;
  if (isPlaying && !event.target._qualitySet) {
    setHighestQuality(event.target);
    event.target._qualitySet = true;
  }

  if (event.target !== getReferencePlayer()) {
    if (isPlaying && !playbackRequested && typeof event.target.pauseVideo === 'function') {
      event.target.pauseVideo();
    }
    return;
  }

  if (isPlaying) {
    setPlaybackPlaying(true);
  } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
    setPlaybackPlaying(false);
    updateLiveStats();
  }
  // BUFFERING/CUED/UNSTARTED do not change the user's playback intent.
}

/**
 * Player error handler
 */
function onPlayerError(event, id) {
  const errorMsg = ERROR_MESSAGES[event.data] || 'Unknown error occurred';
  const container = document.getElementById(`container-${id}`);

  if (container) {
    container.innerHTML = `
      <div class="error-message" style="padding:40px;text-align:center;">
        <h3>⚠️ Video Error</h3>
        <p>${errorMsg}</p>
      </div>
    `;
  }
}

/**
 * Change Video Layout
 */
function changeVideoLayout(layout) {
  activeLayout = layout;

  // Update Buttons
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === layout);
  });

  // Re-render grid classes
  const grid = document.getElementById('video-grid');
  if (grid) {
    grid.className = `video-grid layout-${layout}`;
  }

  renderVideoGrid();
}

/**
 * Render Video Grid
 */
function getRenderedVideoIds() {
  const limits = { single: 1, dual: 2, pip: 2, 'main-side': 3, grid: 4 };
  const ids = activeVideoIds.slice(0, limits[activeLayout] || 4);
  // Keep the telemetry reference alive when a narrower layout hides cameras.
  if (activeVideoIds.includes(sessionId) && !ids.includes(sessionId)) {
    ids[ids.length - 1] = sessionId;
  }
  return ids;
}

function renderVideoGrid() {
  const grid = document.getElementById('video-grid');
  if (!grid) {
    return;
  }

  const idsRendering = getRenderedVideoIds();

  // Cleanup removed players
  Object.keys(videoPlayers).forEach(id => {
    if (!idsRendering.includes(id)) {
      if (typeof videoPlayers[id].destroy === 'function') videoPlayers[id].destroy();
      delete videoPlayers[id];
    }
  });

  // Re-build DOM (sync with idsRendering)
  idsRendering.forEach((id, index) => {
    let container = document.getElementById(`container-${id}`);

    if (!container) {
      // Create new
      container = document.createElement('div');
      container.id = `container-${id}`;
      // ... (rest of creation logic unchanged for now, just logging) ...
      container.className = 'video-container';
      container.dataset.sessionId = id;

      const config = videoConfigs[id];
      const label = config ? config.label : 'Session ' + id;

      container.innerHTML = `
          <div class="video-wrapper">
            <div id="player-${id}"></div>
          </div>
          <div class="video-controls-overlay">
             <button class="sound-control-btn" title="Toggle Sound" onclick="event.stopPropagation(); toggleAudio('${id}')">🔇</button>
             <button class="fullscreen-control-btn" title="Toggle Fullscreen" onclick="event.stopPropagation(); toggleFullscreen('${id}')">⛶</button>
          </div>
          <div class="video-overlay" title="Click to select/swap video" onclick="event.stopPropagation(); handleVideoClick('${id}', event)">
          </div>
        `;

      // Setup click listener for swapping/fullscreen
      container.addEventListener('click', (e) => {
        handleVideoClick(id, e);
      });

      if (index < grid.children.length) {
        grid.insertBefore(container, grid.children[index]);
      } else {
        grid.appendChild(container);
      }

      // Initialize player
      if (window.YT && window.YT.Player && config) {
        createPlayer(id, config);
      } else {
      }
    } else {
      // Ensure it's in the right spot
      if (grid.children[index] !== container) {
        grid.insertBefore(container, grid.children[index]);
      }
      container.style.display = 'block';
    }
  });

  // Remove extras
  while (grid.children.length > idsRendering.length) {
    const child = grid.children[idsRendering.length];
    const childId = child.dataset.sessionId;
    if (childId && videoPlayers[childId]) {
      videoPlayers[childId].destroy();
      delete videoPlayers[childId];
    }
    grid.removeChild(child);
  }

  // Update CSS class
  grid.className = `video-grid layout-${activeLayout} ${idsRendering.length === 1 ? 'single-video' : ''}`;

  updateVideoSelector();
  updateVideoSelectionUI();
  updateAudioState();
}

/**
 * Toggles which video has active audio
 */
function toggleAudio(id) {
  if (!getRenderedVideoIds().includes(id)) return;
  if (activeAudioSessionId === id) {
    audioMuted = !audioMuted;
  } else {
    activeAudioSessionId = id;
    audioMuted = false;
  }
  updateAudioState();
}

function toggleMute() {
  audioMuted = !audioMuted;
  updateAudioState();
}

/**
 * Applies the audio state to all players and UI
 */
function updateAudioState() {
  const visibleIds = getRenderedVideoIds();
  if (!visibleIds.includes(activeAudioSessionId)) {
    activeAudioSessionId = visibleIds[0] || null;
  }

  visibleIds.forEach(id => {
    const player = videoPlayers[id];
    const audible = !audioMuted && id === activeAudioSessionId;
    if (player && typeof player.mute === 'function' && typeof player.unMute === 'function') {
      if (audible) player.unMute();
      else player.mute();
    }
    const btn = document.querySelector(`#container-${id} .sound-control-btn`);
    if (btn) {
      btn.textContent = audible ? '🔊' : '🔇';
      btn.title = audible ? 'Mute sound' : 'Play sound from this camera';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', String(audible));
    }
  });
}

// Keep fullscreen on a stable parent so changing layouts cannot remove it.
let fullscreenRequestVersion = 0;

function isVideoFullscreen() {
  const stage = document.getElementById('video-stage');
  return !!stage && (document.fullscreenElement === stage || stage.classList.contains('is-fullscreen'));
}

function updateFullscreenControls() {
  const active = isVideoFullscreen();
  document.documentElement.classList.toggle('video-fullscreen-open', active);
  const button = document.getElementById('fullscreen-toggle');
  if (button) {
    button.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    button.setAttribute('aria-pressed', String(active));
  }
  document.querySelectorAll('.fullscreen-control-btn').forEach(button => {
    button.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    button.setAttribute('aria-label', button.title);
  });
}

async function exitVideoFullscreen() {
  fullscreenRequestVersion++;
  const stage = document.getElementById('video-stage');
  if (stage) stage.classList.remove('is-fullscreen');
  if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    try {
      await document.exitFullscreen();
    } catch { /* Keep controls in sync if the browser has already exited. */ }
  }
  updateFullscreenControls();
}

/** Use native fullscreen when available, with one keyboard-accessible fallback. */
async function toggleFullscreen() {
  const stage = document.getElementById('video-stage');
  if (!stage) return;
  if (document.fullscreenElement || stage.classList.contains('is-fullscreen')) {
    return exitVideoFullscreen();
  }

  const requestVersion = ++fullscreenRequestVersion;
  if (typeof stage.requestFullscreen === 'function') {
    try {
      await stage.requestFullscreen();
      if (requestVersion !== fullscreenRequestVersion) {
        if (document.fullscreenElement === stage) await exitVideoFullscreen();
        return;
      }
      updateFullscreenControls();
      return;
    } catch { /* Some browsers cannot enter fullscreen; retain an explicit exit. */ }
  }
  if (requestVersion === fullscreenRequestVersion) {
    stage.classList.add('is-fullscreen');
    updateFullscreenControls();
  }
}

/**
 * Handle clicks on the video container for swapping or fullscreen
 */
function handleVideoClick(id, event) {
  // If clicking on controls (like sound button later), ignore
  if (event.target.closest('.sound-control-btn') || event.target.closest('.fullscreen-control-btn')) {
    return;
  }

  // Handle double click for fullscreen? Or just swapping?
  // Per implementation plan choice 1: we can use a dedicated button for fullscreen and swap on click.
  // Wait, the user didn't explicitly choose, but they approved. Let's do single click to select/swap.

  if (firstSelectedVideoId === null) {
    firstSelectedVideoId = id;
  } else if (firstSelectedVideoId === id) {
    // Deselect if clicking the same video
    firstSelectedVideoId = null;
  } else {
    // Swap videos
    swapVideos(firstSelectedVideoId, id);
    firstSelectedVideoId = null; // Reset after swap
  }

  updateVideoSelectionUI();
}

/**
 * Swaps the position of two active videos
 */
function swapVideos(id1, id2) {
  const index1 = activeVideoIds.indexOf(id1);
  const index2 = activeVideoIds.indexOf(id2);

  if (index1 !== -1 && index2 !== -1) {
    // Swap in array
    [activeVideoIds[index1], activeVideoIds[index2]] = [activeVideoIds[index2], activeVideoIds[index1]];

    // Re-render
    renderVideoGrid();
  }
}

/**
 * Updates UI to show which video is currently selected for swapping
 */
function updateVideoSelectionUI() {
  document.querySelectorAll('.video-container').forEach(container => {
    if (container.dataset.sessionId === firstSelectedVideoId) {
      container.classList.add('selected-for-swap');
    } else {
      container.classList.remove('selected-for-swap');
    }
  });
}

/**
 * Toggle Video Selector Panel (Deprecated - replaced by circular buttons)
 */
function toggleVideoSelector() {
  // Keeping this empty just in case there are old references
}

/**
 * Get initials from a name string
 */
function getInitials(name) {
  if (!name) return '?';

  // Remove content in parentheses
  const cleanName = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();

  const words = cleanName.split(' ').filter(w => w.length > 0);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();

  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Update Video Selector List (Circular buttons)
 */
function updateVideoSelector() {
  const container = document.getElementById('driver-selector-container');
  if (!container) return;

  // Collect all available sessions
  const allSessions = [];
  if (sessionId) {
    allSessions.push({
      id: sessionId,
      name: document.getElementById('driver')?.textContent || 'Main',
      date: document.getElementById('session-date')?.textContent || ''
    });
  }

  comparisonSessions.filter(s => videoConfigs[s.id]).forEach(s => {
    allSessions.push({
      id: s.id,
      name: s.driver,
      date: s.date || s.session_date
    });
  });

  if (allSessions.length <= 1) {
    container.style.display = 'none';
    return;
  } else {
    container.style.display = 'flex';
  }

  container.innerHTML = '';

  allSessions.forEach(s => {
    const btn = document.createElement('button');
    const isActive = activeVideoIds.includes(s.id);

    btn.className = `driver-circle-btn ${isActive ? 'active' : ''}`;
    btn.title = `${s.name} ${s.date ? `(${s.date})` : ''}`;
    btn.dataset.id = s.id;
    btn.setAttribute('aria-label', `${s.name}${s.date ? ', ' + s.date : ''}${s.id === sessionId ? ' (reference camera)' : ''}`);
    btn.setAttribute('aria-pressed', String(isActive));
    btn.disabled = s.id === sessionId;

    // Set initials as content
    btn.textContent = getInitials(s.name);

    btn.onclick = () => {
      toggleActiveVideo(s.id, !isActive);
    };

    container.appendChild(btn);
  });
}

/**
 * Toggle active video state
 */
function toggleActiveVideo(id, isActive) {
  if (id === sessionId && !isActive) return;
  if (!videoConfigs[id]) return;
  if (isActive) {
    if (!activeVideoIds.includes(id)) {
      if (activeVideoIds.length >= 4) {
        const replaceId = [...activeVideoIds].reverse().find(vid => vid !== sessionId);
        const replaceIndex = activeVideoIds.indexOf(replaceId);
        if (replaceIndex !== -1) activeVideoIds.splice(replaceIndex, 1);
      }
      activeVideoIds.push(id);
    }
  } else {
    activeVideoIds = activeVideoIds.filter(vid => vid !== id);
  }

  renderVideoGrid();
}

/**
 * Register and display a video
 */
function registerVideo(id, url, startTime, label, render = true) {
  if (typeof url !== 'string') return;
  const vidId = extractYouTubeId(url);
  if (!vidId) return;

  videoConfigs[id] = {
    videoId: vidId,
    startTimeSeconds: parseTime(startTime),
    label: label || 'Session'
  };

  if (!activeVideoIds.includes(id)) {
    if (activeVideoIds.length < 4) {
      activeVideoIds.push(id);
    }
    // If full? Logic in toggleActiveVideo implies replacement, here we just don't add?
    // Or we should force add main?
    // For now, simple logic: if space, add.
  }

  if (render) renderVideoGrid();

  // Ensure section is visible
  const videoSection = document.getElementById('video-section');
  if (videoSection) videoSection.style.display = 'block';
  const toolbar = document.getElementById('video-toolbar');
  if (toolbar) toolbar.style.display = 'flex';
}

/**
* Render video player(s)
*/
/**
 * Render video player(s)
 */
function renderVideoPlayer(videoUrl, videoStartTime, isMainPlayer = true) {
  const videoSection = document.getElementById('video-section');
  const toolbar = document.getElementById('video-toolbar');

  if (!videoUrl || videoUrl.trim() === '') {
    // Hide?
    return;
  }

  // Show section
  if (videoSection) videoSection.style.display = 'block';
  if (toolbar) toolbar.style.display = 'flex';

  if (isMainPlayer) {
    registerVideo(sessionId, videoUrl, videoStartTime, document.getElementById('driver')?.textContent);
  } else {
    // Legacy call for comparison? compareSession should handle this itself via showComparisonVideo.
    // If we are here, it might be a direct call?
    // For safety, warn or try to register if we can guess ID?
  }
}

// ===== PLAYBACK CONTROLS =====

/**
* Toggle play/pause for both players
*/
/**
* Toggle play/pause for all players
*/
function getReferencePlayer() {
  return videoPlayers[sessionId] || activeVideoIds.map(id => videoPlayers[id]).find(Boolean) || null;
}

function getVideoStartOffset(id) {
  const configured = videoConfigs[id]?.startTimeSeconds;
  if (Number.isFinite(configured)) return configured;
  const data = id === sessionId ? currentSessionData : comparisonSessions.find(session => session.id === id);
  return parseTime(data?.video_start_time || '0:00');
}

function getVideoLapTimes(id) {
  const data = id === sessionId ? currentSessionData : comparisonSessions.find(session => session.id === id);
  return validateLapData(data?.laps || []).map(lap => parseTime(lap.time));
}

/** Map the same lap and elapsed seconds into that lap between recordings. */
function mapVideoTime(sourceId, targetId, videoTime) {
  if (sourceId === targetId) return videoTime;
  const sourceTimes = getVideoLapTimes(sourceId);
  const targetTimes = getVideoLapTimes(targetId);
  let elapsed = videoTime - getVideoStartOffset(sourceId);
  const targetOffset = getVideoStartOffset(targetId);
  if (elapsed < 0 || !sourceTimes.length || !targetTimes.length) {
    return Math.max(0, targetOffset + elapsed);
  }
  let lapIndex = 0;
  while (lapIndex < sourceTimes.length - 1 && elapsed >= sourceTimes[lapIndex]) {
    elapsed -= sourceTimes[lapIndex++];
  }
  if (lapIndex >= targetTimes.length) {
    return targetOffset + targetTimes.reduce((total, time) => total + time, 0);
  }
  const lapStart = targetTimes.slice(0, lapIndex).reduce((total, time) => total + time, 0);
  return targetOffset + lapStart + Math.min(elapsed, targetTimes[lapIndex]);
}

function clampPlayerTime(player, time) {
  const duration = typeof player?.getDuration === 'function' ? player.getDuration() : 0;
  return Math.max(0, Number.isFinite(duration) && duration > 0 ? Math.min(time, duration) : time);
}

function getReferenceVideoTime() {
  const player = getReferencePlayer();
  if (!player || typeof player.getCurrentTime !== 'function') return null;
  const time = player.getCurrentTime();
  if (!Number.isFinite(time)) return null;
  const id = Object.keys(videoPlayers).find(key => videoPlayers[key] === player);
  const mappedTime = mapVideoTime(id, sessionId, time);
  if (pendingSeekTime !== null) {
    const buffering = typeof player.getPlayerState === 'function' && player.getPlayerState() === YT.PlayerState.BUFFERING;
    if (Math.abs(mappedTime - pendingSeekTime) > 0.5 && (Date.now() < pendingSeekDeadline || buffering)) {
      return pendingSeekTime;
    }
    pendingSeekTime = null;
  }
  return mappedTime;
}

function getReferenceDuration() {
  const primary = videoPlayers[sessionId];
  const duration = typeof primary?.getDuration === 'function' ? primary.getDuration() : 0;
  if (Number.isFinite(duration) && duration > 0) return duration;
  return getVideoStartOffset(sessionId) + getVideoLapTimes(sessionId).reduce((total, time) => total + time, 0);
}

/** The phone, chart and lap buttons all seek on the main video's timeline. */
function seekToVideoTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !currentSessionData) return false;
  const duration = getReferenceDuration();
  const target = duration > 0 ? Math.min(value, duration) : value;
  requestedVideoTime = target;
  // YouTube reports the old time briefly after seekTo. Late-ready cameras and
  // remote stats must use the requested position until the seek settles.
  pendingSeekTime = target;
  pendingSeekDeadline = Date.now() + 2000;
  Object.entries(videoPlayers).forEach(([id, player]) => {
    if (typeof player.seekTo === 'function') {
      player.seekTo(clampPlayerTime(player, mapVideoTime(sessionId, id, target)), true);
    }
  });
  currentLapMarker.lapNumber = getCurrentLapNumber(target);
  const lapDisplay = document.getElementById('current-lap-display');
  if (lapDisplay) lapDisplay.textContent = `Lap: ${currentLapMarker.lapNumber} / ${currentSessionData.laps.length}`;
  drawLineChart(validateLapData(currentSessionData.laps), comparisonDatasets, target);
  sendStatsToRemotes();
  return true;
}

function updatePlaybackControls() {
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const playIconTV = document.getElementById('play-icon-tv');
  if (playIcon) playIcon.textContent = playbackRequested ? '⏸️' : '▶️';
  if (playText) playText.textContent = playbackRequested ? 'Pause' : 'Play';
  if (playIconTV) playIconTV.textContent = playbackRequested ? '⏸️' : '▶️';
}

function setPlaybackPlaying(playing) {
  playbackRequested = Boolean(playing);
  updatePlaybackControls();
  const reference = getReferencePlayer();
  Object.values(videoPlayers).forEach(player => {
    if (typeof player.getPlayerState !== 'function') return;
    const state = player.getPlayerState();
    if (playbackRequested) {
      // A shorter comparison that has ended stays at its end until the next seek.
      if (player !== reference && state === YT.PlayerState.ENDED) return;
      if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING && typeof player.playVideo === 'function') {
        player.playVideo();
      }
    } else if ((state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) && typeof player.pauseVideo === 'function') {
      player.pauseVideo();
    }
  });
  if (playbackRequested) startStatsUpdateInterval();
  else stopStatsUpdateInterval();
  sendStatsToRemotes();
}

function togglePlayPause() {
  if (!getReferencePlayer()) return;
  setPlaybackPlaying(!playbackRequested);
}

/**
* Go to next lap
*/
function nextLap() {
  if (!currentSessionData || !currentSessionData.laps) return;
  const maxLap = currentSessionData.laps.length;
  const nextVal = (currentLapMarker.lapNumber || 0) + 1;

  if (nextVal <= maxLap) { seekToLap(nextVal); }
}
/**
 * Go to previous lap
 */
function previousLap() {
  const prevVal = (currentLapMarker.lapNumber || 1) - 1;
  if (prevVal >= 1) {
    seekToLap(prevVal);
  }
}

/**
 * Seek to specific lap
 */
/**
 * Seek to specific lap
 */
function seekToLap(lapNumber) {
  if (!currentSessionData?.laps?.length || !Number.isFinite(lapNumber)) return;
  const clamped = Math.max(1, Math.min(Math.trunc(lapNumber), currentSessionData.laps.length));
  const lapStart = lapStartTimes.find(lap => lap.lapNumber === clamped);
  if (lapStart) seekToVideoTime(lapStart.videoTime);
}

/**
* Get current lap number from video time
*/
function getCurrentLapNumber(currentVideoTime) {
  for (let i = lapStartTimes.length - 1; i >= 0; i--) {
    if (currentVideoTime >= lapStartTimes[i].videoTime) {
      return lapStartTimes[i].lapNumber;
    }
  }
  return 1;
}

// ===== LIVE STATS UPDATE =====

/**
* Start interval to update live stats during playback
*/
function startStatsUpdateInterval() {
  if (updateStatsInterval) return;

  updateStatsInterval = setInterval(() => {
    updateLiveStats();
  }, 100); // Update every 100ms for smooth updates
}

/**
* Stop stats update interval
*/
function stopStatsUpdateInterval() {
  if (updateStatsInterval) {
    clearInterval(updateStatsInterval);
    updateStatsInterval = null;
  }
}

/**
 * Update live stats overlays and detect lap changes
 */
function updateLiveStats() {
  const videoTime = getReferenceVideoTime();
  if (videoTime === null) return;
  const newLapNumber = getCurrentLapNumber(videoTime);

  // Update lap if changed
  if (newLapNumber !== currentLapMarker.lapNumber) {
    currentLapMarker.lapNumber = newLapNumber;

    const lapDisplay = document.getElementById('current-lap-display');
    if (lapDisplay) {
      const maxLap = currentSessionData && currentSessionData.laps ? currentSessionData.laps.length : 0;
      lapDisplay.textContent = `Lap: ${newLapNumber} / ${maxLap}`;
    }

    // Redraw chart
    if (currentSessionData) {
      const currentLaps = validateLapData(currentSessionData.laps);
      drawLineChart(currentLaps, comparisonDatasets, videoTime);
    }
  } else {
    // Even if lap hasn't changed, we want to update the playhead on the chart
    // We throttle this to avoid too many redraws?
    // Actually 100ms interval is fine for 10fps chart update.
    if (currentSessionData) {
      const currentLaps = validateLapData(currentSessionData.laps);
      drawLineChart(currentLaps, comparisonDatasets, videoTime);
    }
  }

  // Update TV mode stats
  if (currentMode === 'tv') {
    updateTVStats(newLapNumber);
  }

  // Comparison video overlay removed.




  // Send stats to remote devices
  sendStatsToRemotes();
}

/**
 * Update TV mode stats
 */
function updateTVStats(lapNumber) {
  const currentLapEl = document.getElementById('tv-current-lap');
  const deltaEl = document.getElementById('tv-delta');

  if (currentLapEl) {
    currentLapEl.textContent = lapNumber;
  }

  if (deltaEl && currentSessionData) {
    const delta = calculateCurrentDelta();
    deltaEl.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}s`;
    deltaEl.style.color = delta >= 0 ? 'var(--error)' : 'var(--secondary)';
  }
}

// ===== CHART DRAWING =====

/**
 * Draw lap time progression chart
 */
function drawLineChart(mainLaps, compareLapsArray = [], currentVideoTime = null) {
  const canvas = document.getElementById('lap-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const padding = 60;
  const chartWidth = rect.width - padding * 2;
  const chartHeight = rect.height - padding * 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  chartPoints = [];
  currentDataset = mainLaps;
  comparisonDatasets = compareLapsArray;

  const allDatasets = [mainLaps, ...compareLapsArray];
  const allLaps = allDatasets.flat();
  const lapTimes = allLaps.map(lap => parseTime(lap.time)).filter(time => !isNaN(time));

  if (lapTimes.length === 0) {
    ctx.fillStyle = '#999';
    ctx.textAlign = 'center';
    ctx.font = '16px Arial';
    ctx.fillText("No lap data available", rect.width / 2, rect.height / 2);
    return;
  }

  const minTime = Math.min(...lapTimes);
  const maxTime = Math.max(...lapTimes);
  const timeRange = maxTime - minTime || 1;
  const maxLapsCount = allDatasets.reduce((max, dataset) => Math.max(max, dataset.length), 0);
  const overallFastest = minTime;

  // Helper function to get coordinates
  function getCoords(i, lapTime) {
    const x = padding + (chartWidth / (maxLapsCount - 1 || 1)) * i;
    const y = padding + chartHeight - ((lapTime - minTime) / timeRange) * chartHeight;
    return { x, y };
  }

  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;

  // Horizontal grid lines
  for (let i = 0; i <= 5; i++) {
    const y = padding + (chartHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(rect.width - padding, y);
    ctx.stroke();
  }

  // Vertical grid lines
  for (let i = 0; i < maxLapsCount; i++) {
    const x = padding + (chartWidth / (maxLapsCount - 1 || 1)) * i;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, rect.height - padding);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.stroke();
  }

  // Draw fastest lap baseline
  if (overallFastest) {
    const { y: baselineY } = getCoords(0, overallFastest);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(padding, baselineY);
    ctx.lineTo(rect.width - padding, baselineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px var(--font-family)';
    ctx.fillText(`Best: ${formatTime(overallFastest)}`, padding + 8, baselineY - 8);
  }
  // ===== Playheads — one independent line per video =====
  // Each driver finishes laps at a different pace, so a single shared playhead
  // is misleading. We draw one playhead per video, mapped through THAT session's
  // own lap timing, coloured to match its line, with a driver-initial badge on
  // top so it's obvious which line belongs to which video.

  // Per-lap start video-times derived from durations. The main session reuses
  // the global lapStartTimes (computed once at load) so there is a single
  // source of truth for lap detection; comparison sessions derive their own.
  function lapStartsFromDurations(laps, videoStartTime) {
    const starts = [];
    let cum = videoStartTime;
    for (let i = 0; i < laps.length; i++) { starts.push(cum); cum += parseTime(laps[i].time); }
    return starts;
  }

  // Map a video time to an X position on the (lap-number) axis for one session,
  // given that session's per-lap start times.
  function effectiveIndexFor(videoTime, laps, starts) {
    if (!laps || laps.length === 0 || !starts || starts.length === 0) return null;
    let lapIdx = 0;
    for (let i = laps.length - 1; i >= 0; i--) {
      if (videoTime >= starts[i]) { lapIdx = i; break; }
    }
    const lapDur = parseTime(laps[lapIdx].time);
    let prog = lapDur > 0 ? (videoTime - starts[lapIdx]) / lapDur : 0;
    prog = Math.max(0, Math.min(1, prog));
    return lapIdx + prog;
  }

  function initialsOf(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
  }

  function drawPlayhead(effIndex, color, label) {
    const xPos = padding + (chartWidth / (maxLapsCount - 1 || 1)) * effIndex;
    ctx.save();
    ctx.shadowBlur = 0;
    // Vertical line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xPos, padding);
    ctx.lineTo(xPos, rect.height - padding);
    ctx.stroke();
    // Bottom handle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(xPos, rect.height - padding, 4, 0, Math.PI * 2);
    ctx.fill();
    // Top driver badge (coloured circle + initials)
    const r = 9;
    const by = padding - r - 1;
    ctx.beginPath();
    ctx.arc(xPos, by, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px var(--font-family)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialsOf(label), xPos, by);
    ctx.restore();
  }

  // Collect a playhead for the main session and every comparison session that
  // has a live video player.
  const playheads = [];
  let mainVideoTime = currentVideoTime;
  const mainPlayerForHead = videoPlayers[sessionId];
  if ((mainVideoTime === null || mainVideoTime === undefined) &&
      mainPlayerForHead && typeof mainPlayerForHead.getCurrentTime === 'function') {
    mainVideoTime = mainPlayerForHead.getCurrentTime();
  }
  if (mainVideoTime !== null && mainVideoTime !== undefined && mainLaps.length > 0) {
    // Reuse the global lapStartTimes (single source of truth); fall back to
    // deriving from durations only if it isn't populated/in sync yet.
    const mainStarts = (lapStartTimes && lapStartTimes.length === mainLaps.length)
      ? lapStartTimes.map(l => l.videoTime)
      : lapStartsFromDurations(mainLaps, parseTime((currentSessionData && currentSessionData.video_start_time) || "0:00"));
    const ei = effectiveIndexFor(mainVideoTime, mainLaps, mainStarts);
    if (ei !== null) {
      playheads.push({ ei, color: '#ff5252', label: currentSessionData ? currentSessionData.driver : '' });
    }
  }
  comparisonSessions.forEach((session, index) => {
    const player = videoPlayers[session.id];
    if (!player || typeof player.getCurrentTime !== 'function') return;
    const laps = comparisonDatasets[index];
    if (!laps || laps.length === 0) return;
    const starts = lapStartsFromDurations(laps, parseTime(session.video_start_time || "0:00"));
    const ei = effectiveIndexFor(player.getCurrentTime(), laps, starts);
    if (ei === null) return;
    playheads.push({ ei, color: comparisonColors[index % comparisonColors.length].line, label: session.driver });
  });

  if (playheads.length > 0) {
    playheads.forEach(p => drawPlayhead(p.ei, p.color, p.label));
  } else if (currentLapMarker.lapNumber > 0 && currentLapMarker.lapNumber <= mainLaps.length) {
    // Fallback to old lap marker if no time provided
    const currentIndex = currentLapMarker.lapNumber - 1;
    const xPos = padding + (chartWidth / (maxLapsCount - 1 || 1)) * currentIndex;

    // Highlight area 
    ctx.fillStyle = 'rgba(244, 67, 54, 0.1)';
    ctx.fillRect(xPos - 20, padding, 40, chartHeight);

    // Vertical line
    ctx.strokeStyle = 'rgba(244, 67, 54, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xPos, padding);
    ctx.lineTo(xPos, rect.height - padding);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Function to draw a line for a dataset
  function drawLapLine(laps, color, pointColor, isComparison = false, sessionIndex = -1) {
    if (laps.length === 0) return;

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();

    laps.forEach((lap, i) => {
      const lapTime = parseTime(lap.time);
      if (isNaN(lapTime)) return;

      const { x, y } = getCoords(i, lapTime);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      chartPoints.push({
        x,
        y,
        lap,
        lapNumber: lap.lap,
        isComparison,
        sessionIndex
      });
    });

    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw points
    laps.forEach((lap, i) => {
      const lapTime = parseTime(lap.time);
      if (isNaN(lapTime)) return;

      const { x, y } = getCoords(i, lapTime);

      // Larger hit area (invisible)
      ctx.fillStyle = 'rgba(255, 255, 255, 0)';
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();

      // Visible point
      ctx.fillStyle = pointColor;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Point border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
  function drawBestLapMarkers(laps) {
    const bestIdx = laps.findIndex(lap => lap.best);
    if (bestIdx === -1) return;

    const lapTime = parseTime(laps[bestIdx].time);
    if (isNaN(lapTime)) return;

    const { x, y } = getCoords(bestIdx, lapTime);

    ctx.fillStyle = 'rgba(255, 215, 0, 1)';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();

    for (let i = 0; i < 5; i++) {
      const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const radius = i % 2 === 0 ? 10 : 5;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  compareLapsArray.forEach((laps, index) => {
    const colors = comparisonColors[index % comparisonColors.length];
    drawLapLine(laps, colors.line, colors.point, true, index);
  });

  // Draw main line on top of comparison lines
  drawLapLine(mainLaps, '#f44336', '#ff5252', false, -1);

  // Draw best lap stars
  allDatasets.forEach(laps => drawBestLapMarkers(laps));

  // Draw axis labels
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '11px var(--font-family)';
  ctx.textAlign = 'center';

  // X-axis (lap numbers)
  for (let i = 0; i < maxLapsCount; i++) {
    const x = padding + (chartWidth / (maxLapsCount - 1 || 1)) * i;
    if (i % Math.ceil(maxLapsCount / 10) === 0 || i === maxLapsCount - 1) {
      ctx.fillText(`L${i + 1}`, x, rect.height - 25);
    }
  }

  // Y-axis (times)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const y = padding + (chartHeight / 5) * i;
    const time = maxTime - (timeRange / 5) * i;
    ctx.fillText(formatTime(time), padding - 10, y);
  }

  // Update legend
  updateChartLegend();

  // Setup tooltip interactions
  setupTooltipInteractions(maxLapsCount, rect, padding, chartWidth);
}

/**
 * Update chart legend
 */
function updateChartLegend() {

  const
    legend = document.getElementById('chart-legend'); if (!legend) return; let legendHTML = ''; // Main session
  legendHTML += ` <div class="legend-item" role="listitem">
            <div class="legend-color" style="background: linear-gradient(135deg, #f44336, #ff5252);"></div>
            <span>${currentSessionData.driver} (${currentDataset.length} laps)</span>
            </div>
            `;

  // Comparison sessions
  comparisonSessions.forEach((session, index) => {
    const colors = comparisonColors[index % comparisonColors.length];
    legendHTML += `
            <div class="legend-item" role="listitem">
              <div class="legend-color" style="background: linear-gradient(135deg, ${colors.line}, ${colors.point});">
              </div>
              <span>${session.driver} (${comparisonDatasets[index].length} laps)</span>
            </div>
            `;
  });

  // Best lap indicator
  legendHTML += `
            <div class="legend-item" role="listitem">
              <div class="legend-color" style="background: #ffd700;"></div>
              <span>★ Best Lap</span>
            </div>
            `;

  legend.innerHTML = legendHTML;
}

// ===== TOOLTIP =====

/**
* Setup tooltip interactions for chart
*/
function setupTooltipInteractions(maxLapsCount, rect, padding, chartWidth) {
  const canvas = document.getElementById('lap-chart');
  if (!canvas) return;

  // Remove old listeners
  if (canvas.currentMouseMoveHandler) {
    canvas.removeEventListener('mousemove', canvas.currentMouseMoveHandler);
  }
  if (canvas.currentMouseLeaveHandler) {
    canvas.removeEventListener('mouseleave', canvas.currentMouseLeaveHandler);
  }
  if (canvas.currentTouchMoveHandler) {
    canvas.removeEventListener('touchmove', canvas.currentTouchMoveHandler);
  }
  if (canvas.currentTouchEndHandler) {
    canvas.removeEventListener('touchend', canvas.currentTouchEndHandler);
  }

  // Mouse events
  canvas.currentMouseMoveHandler = (e) => {
    const now = Date.now();
    if (now - lastTooltipUpdate >= TOOLTIP_DEBOUNCE) {
      handleTooltipInteraction(e.clientX, e.clientY);
      lastTooltipUpdate = now;
    }
  };

  canvas.currentMouseLeaveHandler = () => {
    activePoint = null;
    hideTooltip();
  };

  // Touch events
  canvas.currentTouchMoveHandler = (e) => {
    if (e.touches.length > 0) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastTooltipUpdate >= TOOLTIP_DEBOUNCE) {
        handleTooltipInteraction(e.touches[0].clientX, e.touches[0].clientY);
        lastTooltipUpdate = now;
      }
    }
  };

  canvas.currentTouchEndHandler = () => {
    setTimeout(() => {
      activePoint = null;
      hideTooltip();
    }, 500);
  };

  canvas.addEventListener('mousemove', canvas.currentMouseMoveHandler);
  canvas.addEventListener('mouseleave', canvas.currentMouseLeaveHandler);
  canvas.addEventListener('touchmove', canvas.currentTouchMoveHandler, { passive: false });
  canvas.addEventListener('touchend', canvas.currentTouchEndHandler);

  canvas.seekGeometry = { maxLapsCount, padding };
  if (!canvas.currentClickHandler) {
    canvas.currentClickHandler = event => {
      const rect = canvas.getBoundingClientRect();
      const { maxLapsCount, padding } = canvas.seekGeometry;
      const chartWidth = rect.width - padding * 2;
      const relativeX = event.clientX - rect.left - padding;
      if (chartWidth <= 0 || relativeX < 0 || relativeX > chartWidth || !currentSessionData) return;
      const effectiveIndex = relativeX / chartWidth * Math.max(1, maxLapsCount - 1);
      const lapIndex = Math.floor(effectiveIndex);
      const laps = validateLapData(currentSessionData.laps);
      if (lapIndex >= laps.length) return;
      const lapStart = lapStartTimes[lapIndex]?.videoTime;
      if (!Number.isFinite(lapStart)) return;
      seekToVideoTime(lapStart + parseTime(laps[lapIndex].time) * (effectiveIndex - lapIndex));
    };
    canvas.addEventListener('click', canvas.currentClickHandler);
  }
}

/**
* Handle tooltip interaction
*/
function handleTooltipInteraction(clientX, clientY) {
  const canvas = document.getElementById('lap-chart');
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  let closestPoint = null;
  let minDistance = Infinity;

  chartPoints.forEach(point => {
    const distance = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
    if (distance < 15 && distance < minDistance) { minDistance = distance; closestPoint = point; }
  }); if
    (closestPoint) {
    const
      pointId = `${closestPoint.lapNumber}-${closestPoint.isComparison}-${closestPoint.sessionIndex}`; if
      (!activePoint || activePoint.identifier !== pointId) {
      activePoint = {
        ...closestPoint, identifier: pointId
      }; showTooltip(activePoint, clientX, clientY);
    }
  } else { activePoint = null; hideTooltip(); }
} /** * Show
              tooltip */ function showTooltip(point, mouseX, mouseY) {
  const
    tooltip = document.getElementById('chart-tooltip'); const canvas = document.getElementById('lap-chart'); const
      canvasRect = canvas.getBoundingClientRect(); let session = currentSessionData; let dataset = currentDataset; let
        lineColor = '#f44336'; let driverLabel = ''; if (point.isComparison && point.sessionIndex !== undefined) {
          session = comparisonSessions[point.sessionIndex]; dataset = comparisonDatasets[point.sessionIndex];
          lineColor = comparisonColors[point.sessionIndex % comparisonColors.length].line; driverLabel = `<span
              class="tooltip-driver" style="color:${lineColor};">
              ${session.driver}</span>`;
        } else {
    driverLabel = `<span class="tooltip-driver" style="color:#ffd700;">${session.driver}</span>`;
  }

  const fastestTime = Math.min(...dataset.map(l => parseTime(l.time)));
  const currentTime = parseTime(point.lap.time);
  const delta = currentTime - fastestTime;
  const deltaStr = delta === 0 ? 'Fastest' : (delta > 0 ? `+${delta.toFixed(3)}s` :
    `${delta.toFixed(3)}s`);

  tooltip.innerHTML = `
              <div class="tooltip-header">
                ${driverLabel}
                <span class="tooltip-lap">Lap ${point.lapNumber}</span>
              </div>
              <div class="tooltip-time">${point.lap.time}</div>
              ${point.lap.best ? '<div class="tooltip-best">★ Best Lap</div>' : ''}
              <div class="tooltip-delta">Delta: ${deltaStr}</div>
              <div class="tooltip-footer">
                ${new Date(session.session_date).toLocaleDateString()}<br>
                Engine: ${session.kart}
              </div>
              <div class="tooltip-arrow"></div>
              `;

  tooltip.classList.add('tooltip-visible');
  tooltip.setAttribute('aria-hidden', 'false');

  // Position tooltip
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  const pointX = canvasRect.left + scrollX + point.x;
  const pointY = canvasRect.top + scrollY + point.y;

  let left = pointX - tooltipWidth / 2;
  let top = pointY - tooltipHeight - 20;

  // Keep tooltip in viewport
  if (left < scrollX + 20) left = scrollX + 20; if (left + tooltipWidth > scrollX + window.innerWidth - 20) {
    left = scrollX + window.innerWidth - tooltipWidth - 20;
  }

  const arrow = tooltip.querySelector('.tooltip-arrow');

  if (top < scrollY + 20) {
    // Show below point
    top = pointY + 30;
    arrow.style.borderTop = 'none';
    arrow.style.borderBottom = `8px solid ${lineColor}`;
    arrow.style.top = '-8px';
    arrow.style.bottom = 'auto';
  } else {
    // Show above point
    arrow.style.borderTop = `8px solid ${lineColor}`;
    arrow.style.borderBottom = 'none';
    arrow.style.bottom = '-8px';
    arrow.style.top = 'auto';
  }

  // Position arrow
  const arrowOffsetX = pointX - (left + tooltipWidth / 2);
  arrow.style.marginLeft = `${arrowOffsetX}px`;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

/**
 * Hide tooltip
 */
function hideTooltip() {
  const tooltip = document.getElementById('chart-tooltip');
  tooltip.classList.remove('tooltip-visible');
  tooltip.setAttribute('aria-hidden', 'true');
}
// ===== SESSION COMPARISON =====

/**
* Compare sessions
*/
async function compareSession() {
  const requestNumber = ++comparisonRequestNumber;
  const compareIdsInput = document.getElementById('compare-id-input').value.trim();

  let sessionIds = compareIdsInput
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0 && id !== sessionId);

  // Remove duplicates
  sessionIds = Array.from(new Set(sessionIds));

  if (!currentSessionData) return;

  const currentLaps = validateLapData(currentSessionData.laps);

  // If no comparison IDs, just show main session
  if (sessionIds.length === 0) {
    comparisonSessions = [];
    comparisonDatasets = [];
    reconcileComparisonVideos();
    drawLineChart(currentLaps, []);
    renderComparisonResults([]);
    return;
  }

  // Show loading state
  const comparisonGrid = document.getElementById('comparison-grid');
  if (comparisonGrid) {
    comparisonGrid.innerHTML = '<div class="loading">Loading comparison data...</div>';
  }

  // Fetch all comparison sessions
  const fetchPromises = sessionIds.map(id =>
    fetch(`sessions/${id}.json`, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : Promise.reject(`Session ${id} not found`))
      .then(data => {
        if (!data || typeof data !== 'object' || !Array.isArray(data.laps)) {
          throw new Error(`Invalid session data for ${id}`);
        }
        // Preserve the requested ID even when an earlier lookup failed.
        return { ...data, id };
      })
      .catch(err => ({ error: err.message || String(err) }))
  );

  const results = await Promise.all(fetchPromises);
  if (requestNumber !== comparisonRequestNumber) return;
  const successfulSessions = results.filter(r => !r.error);
  const errorSessions = results.filter(r => r.error);
  comparisonSessions = [];
  comparisonDatasets = [];

  // Process successful sessions
  successfulSessions.forEach(sessionData => {
    const compareLaps = validateLapData(sessionData.laps);
    const compareTimes = compareLaps.map(l => parseTime(l.time));
    const compareFastest = compareTimes.length > 0 ? Math.min(...compareTimes) : 0;
    const compareFastestIdx = compareTimes.indexOf(compareFastest);

    // Mark best lap
    compareLaps.forEach((lap, i) => {
      lap.best = (i === compareFastestIdx);
    });

    comparisonSessions.push(sessionData);
    comparisonDatasets.push(compareLaps);
  });

  // Mark best lap in current session
  const currentTimes = currentLaps.map(l => parseTime(l.time));
  const currentFastest = currentTimes.length > 0 ? Math.min(...currentTimes) : 0;
  const currentFastestIdx = currentTimes.indexOf(currentFastest);
  currentLaps.forEach((lap, i) => {
    lap.best = (i === currentFastestIdx);
  });

  // Update chart
  drawLineChart(currentLaps, comparisonDatasets);

  // Render comparison results
  renderComparisonResults(errorSessions);

  // Viewing mode changes presentation; both PC and TV restore the same cameras.
  reconcileComparisonVideos();
}

function reconcileComparisonVideos() {
  const desiredIds = videoConfigs[sessionId] ? [sessionId] : [];
  comparisonSessions.forEach(session => {
    if (typeof session.video_url !== 'string' || !extractYouTubeId(session.video_url)) return;
    registerVideo(session.id, session.video_url, session.video_start_time, session.driver, false);
    desiredIds.push(session.id);
  });

  const desired = new Set(desiredIds);
  Object.keys(videoConfigs).forEach(id => {
    if (!desired.has(id)) delete videoConfigs[id];
  });
  Object.keys(videoPlayers).forEach(id => {
    if (desired.has(id)) return;
    if (typeof videoPlayers[id].destroy === 'function') videoPlayers[id].destroy();
    delete videoPlayers[id];
    document.getElementById(`container-${id}`)?.remove();
  });
  activeVideoIds = desiredIds.slice(0, 4);
  if (!desired.has(firstSelectedVideoId)) firstSelectedVideoId = null;
  const layout = activeVideoIds.length >= 4 ? 'grid' :
    activeVideoIds.length === 3 ? 'main-side' : activeVideoIds.length === 2 ? 'dual' : 'single';
  changeVideoLayout(layout);
}

/**
* Render comparison results cards
*/
function renderComparisonResults(errorSessions = []) {
  const comparisonGrid = document.getElementById('comparison-grid');
  if (!comparisonGrid) return;

  let resultHTML = '';

  // Current session card
  const currentTimes = currentDataset.map(l => parseTime(l.time));
  const currentFastest = currentTimes.length > 0 ? Math.min(...currentTimes) : 0;
  const currentAvg = currentTimes.length > 0 ?
    currentTimes.reduce((sum, t) => sum + t, 0) / currentTimes.length : 0;

  resultHTML += createComparisonCard(
    currentSessionData,
    currentFastest,
    currentAvg,
    currentDataset.length,
    '#f44336'
  );

  // Comparison session cards
  comparisonSessions.forEach((session, index) => {
    const laps = comparisonDatasets[index];
    const times = laps.map(l => parseTime(l.time));
    const fastest = times.length > 0 ? Math.min(...times) : 0;
    const avg = times.length > 0 ? times.reduce((sum, t) => sum + t, 0) / times.length : 0;
    const color = comparisonColors[index % comparisonColors.length].line;

    resultHTML += createComparisonCard(session, fastest, avg, laps.length, color);
  });

  // Overall fastest card
  if (comparisonSessions.length > 0) {
    const allFastest = [
      { time: currentFastest, driver: currentSessionData.driver, color: '#f44336' },
      ...comparisonSessions.map((s, i) => ({
        time: Math.min(...comparisonDatasets[i].map(l => parseTime(l.time))),
        driver: s.driver,
        color: comparisonColors[i % comparisonColors.length].line
      }))
    ];

    const overallBest = allFastest.reduce((best, current) =>
      current.time < best.time ? current : best, allFastest[0]); resultHTML += ` <div class="comparison-card"
    style="border-top-color: ${overallBest.color}; background: linear-gradient(135deg, rgba(255,215,0,0.1), var(--surface-1));">
    <h3>🏆 Overall Fastest</h3>
    <p>
      <strong>Driver:</strong>
      <strong style="color: ${overallBest.color};">${overallBest.driver}</strong>
    </p>
    <p>
      <strong>Time:</strong>
      <strong class="fastest-time" style="font-size:1.5em; color: ${overallBest.color};">
        ${formatTime(overallBest.time)}
      </strong>
    </p>
    </div>
    `;
  }

  // Error messages
  errorSessions.forEach(err => {
    resultHTML += `<div class="error-message">${err.error}</div>`;
  });

  comparisonGrid.innerHTML = resultHTML;
}

/**
* Create comparison card HTML
*/
function createComparisonCard(data, fastest, average, lapCount, color) {
  const stdDev = calculateConsistency(
    data.laps.filter(l => l.lap !== null).map(l => parseTime(l.time))
  );
  const consistency = getConsistencyRating(stdDev);
  const sessionDate = new Date(data.session_date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return `
    <div class="comparison-card" style="border-top-color: ${color};">
      <h3>${data.driver}</h3>
      <p><strong>Date:</strong> <span>${sessionDate}</span></p>
      <p><strong>ID:</strong> <code>${data.id || 'N/A'}</code></p>
      <p><strong>Track:</strong> <span>${data.track.name}</span></p>
      <p>
        <strong>Fastest:</strong>
        <span style="font-weight:700; color:${color === '#f44336' ? '#ffd700' : color};">
          ${formatTime(fastest)}
        </span>
      </p>
      <p><strong>Average:</strong> <span>${formatTime(average)}</span></p>
      <p><strong>Laps:</strong> <span>${lapCount}</span></p>
      <p>
        <strong>Consistency:</strong>
        <span class="${consistency.class}">
          ${consistency.text} (±${stdDev.toFixed(3)}s)
        </span>
      </p>
      <p><strong>Engine:</strong> <span>${data.kart}</span></p>
    </div>
    `;
}

/**
* Show comparison video
*/
/**
 * Show comparison video
 */
function showComparisonVideo(comparisonSession) {
  if (!comparisonSession.video_url || comparisonSession.video_url === 'pending') {
    // maybe show placeholder or nothing?
    return;
  }

  // Register and show
  registerVideo(
    comparisonSession.id,
    comparisonSession.video_url,
    comparisonSession.video_start_time || '0:00',
    comparisonSession.driver
  );

  // Update layout if needed (e.g. switch to dual/grid)
  if (activeLayout === 'single' && activeVideoIds.length > 1) {
    if (activeVideoIds.length === 2) changeVideoLayout('dual');
    else if (activeVideoIds.length === 3) changeVideoLayout('main-side');
    else changeVideoLayout('grid');
  }
}

/**
 * Hide comparison video
 */
function hideComparisonVideo(idToHide) {
  activeVideoIds = activeVideoIds.filter(id => id === sessionId || (idToHide && id !== idToHide));
  renderVideoGrid();
}

/**
 * Clear comparison
 */
function clearComparison() {
  comparisonRequestNumber++;
  comparisonSessions = [];
  comparisonDatasets = [];

  const compareInput = document.getElementById('compare-id-input');
  if (compareInput) {
    compareInput.value = '';
  }

  reconcileComparisonVideos();

  if (currentSessionData) {
    const validLaps = validateLapData(currentSessionData.laps);
    drawLineChart(validLaps, []);
    renderComparisonResults([]);
  }

  // Reset layout
  changeVideoLayout('single');
  updateVideoSelector();
}

/**
* Share comparison link
*/
function shareCompareLink() {
  const compareInput = document.getElementById('compare-id-input');
  const compareIds = compareInput ? compareInput.value.trim() : '';

  let shareUrl = window.location.href.split('?')[0] + `?id=${sessionId}`;

  if (compareIds) {
    shareUrl += `&compare_id=${encodeURIComponent(compareIds)}`;
  }

  if (currentMode === 'tv') {
    shareUrl += '&mode=tv';
  }

  navigator.clipboard.writeText(shareUrl).then(() => {
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
      const originalHTML = shareBtn.innerHTML;
      shareBtn.innerHTML = '<span>✅</span><span>Copied!</span>';
      shareBtn.classList.add('copied');

      setTimeout(() => {
        shareBtn.innerHTML = originalHTML;
        shareBtn.classList.remove('copied');
      }, 2000);
    }
  }).catch(err => {
    alert('Failed to copy link to clipboard');
  });
}


/**
 * Copy Session UUID
 */
function copySessionUUID() {
  const uuidDisplay = document.getElementById('session-uuid-display');
  const uuid = uuidDisplay ? uuidDisplay.textContent : sessionId;

  navigator.clipboard.writeText(uuid).then(() => {
    const btn = document.getElementById('copy-uuid-btn');
    if (btn) {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '✅';
      btn.classList.add('copied');

      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.classList.remove('copied');
      }, 2000);
    }
  }).catch(err => {
  });
}

// ===== AUTOCOMPLETE =====

/**
* Setup autocomplete for session search
*/
function setupAutocomplete() {
  const input = document.getElementById('compare-id-input');
  const resultsBox = document.getElementById('autocomplete-results');

  if (!input || !resultsBox) return;

  let selectedIndex = -1;

  input.addEventListener('input', () => {
    const currentIds = input.value.split(',').map(id => id.trim());
    const lastQuery = currentIds[currentIds.length - 1].toLowerCase();

    resultsBox.innerHTML = '';
    selectedIndex = -1;

    if (lastQuery.length < 2) { resultsBox.style.display = 'none'; return; } const
      filtered = allSessionsList.filter(session =>
        session.id !== sessionId &&
        (session.id.toLowerCase().includes(lastQuery) ||
        session.driver.toLowerCase().includes(lastQuery) ||
        session.track.name.toLowerCase().includes(lastQuery))
      ).slice(0, 8);

    if (filtered.length > 0) {
      resultsBox.style.display = 'block';

      filtered.forEach((session, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.textContent = `${session.driver} @ ${session.track.name} (${new
          Date(session.session_date).toLocaleDateString()})`;
        item.dataset.id = session.id;

        item.addEventListener('click', () => {
          currentIds[currentIds.length - 1] = session.id;
          input.value = currentIds.join(', ') + ', ';
          resultsBox.style.display = 'none';
          input.focus();
        });

        resultsBox.appendChild(item);
      });
    } else {
      resultsBox.style.display = 'none';
    }
  });

  input.addEventListener('keydown', (e) => {
    const items = resultsBox.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      items[selectedIndex].click();
      return;
    } else if (e.key === 'Escape') {
      resultsBox.style.display = 'none';
      selectedIndex = -1;
      return;
    } else {
      return;
    }

    items.forEach((item, index) => {
      const isSelected = index === selectedIndex;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', isSelected.toString());
      if (isSelected) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!resultsBox.contains(e.target) && e.target !== input) {
      resultsBox.style.display = 'none';
    }
  });
}

// ===== PEERJS REMOTE CONTROL =====

/**
* Initialize PeerJS connection
*/
function generateShortPeerId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'HCH';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function enablePhoneRemote() {
  if (remoteAllowed) return;
  remoteAllowed = true;
  reconnectAttempts = 0;
  const qrPanel = document.getElementById('qr-panel');
  if (qrPanel) qrPanel.style.display = 'block';
  initializePeer();
}

function disablePhoneRemote() {
  remoteAllowed = false;
  cleanupPeerConnection();
  hostPeerId = null;
  reconnectAttempts = 0;
  peerConnectionState = 'disabled';
  const qrCode = document.getElementById('qr-code');
  const remoteUrl = document.getElementById('remote-url');
  const qrPanel = document.getElementById('qr-panel');
  if (qrPanel && currentMode === 'pc') qrPanel.style.display = 'none';
  if (qrCode) qrCode.innerHTML = '';
  if (remoteUrl) remoteUrl.textContent = 'Enable phone remote to create a pairing link.';
  updateConnectionUI();
}

function cleanupPeerConnection() {
  clearTimeout(peerReconnectTimer);
  clearTimeout(peerConnectionTimer);
  peerReconnectTimer = null;
  peerConnectionTimer = null;
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = null;

  const oldConnections = connections;
  const oldPeer = peer;
  connections = [];
  peer = null;
  oldConnections.forEach(conn => {
    conn.removeAllListeners?.();
    try { conn.close(); } catch (_) { /* Already closed. */ }
  });
  if (oldPeer) {
    oldPeer.removeAllListeners?.();
    try { oldPeer.destroy(); } catch (_) { /* Already destroyed. */ }
  }
  peerConnectionState = 'offline';
  updateConnectionUI();
}

function schedulePeerReconnect(instance, replaceId = false) {
  if (!remoteAllowed || peer !== instance || peerReconnectTimer) return;
  clearTimeout(peerConnectionTimer);
  peerConnectionTimer = null;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    peerConnectionState = 'offline';
    updateConnectionUI();
    return;
  }
  reconnectAttempts++;
  peerConnectionState = 'reconnecting';
  updateConnectionUI();
  peerReconnectTimer = setTimeout(() => {
    peerReconnectTimer = null;
    if (!remoteAllowed || peer !== instance) return;
    if (replaceId || instance.destroyed || !instance.disconnected) {
      cleanupPeerConnection();
      if (replaceId) hostPeerId = generateShortPeerId();
      initializePeer();
    } else {
      try {
        instance.reconnect();
        // Some network failures produce no further event. Bound those attempts too.
        peerReconnectTimer = setTimeout(() => {
          peerReconnectTimer = null;
          if (peer === instance && !instance.open) schedulePeerReconnect(instance);
        }, 5000);
      } catch (_) {
        schedulePeerReconnect(instance);
      }
    }
  }, Math.min(1000 * 2 ** (reconnectAttempts - 1), 5000));
}

function initializePeer() {
  if (!remoteAllowed) return;
  if (peer && !peer.destroyed) {
    if (peer.disconnected) schedulePeerReconnect(peer);
    return;
  }
  if (typeof Peer !== 'function') {
    peerConnectionState = 'offline';
    updateConnectionUI();
    return;
  }

  hostPeerId = hostPeerId || generateShortPeerId();
  peerConnectionState = reconnectAttempts ? 'reconnecting' : 'connecting';
  const instance = new Peer(hostPeerId);
  peer = instance;
  updateConnectionUI();

  instance.on('open', id => {
    if (peer !== instance) return;
    clearTimeout(peerReconnectTimer);
    clearTimeout(peerConnectionTimer);
    peerReconnectTimer = null;
    peerConnectionTimer = null;
    reconnectAttempts = 0;
    hostPeerId = id;
    peerConnectionState = 'ready';
    const base = window.location.origin + window.location.pathname.replace('session.html', 'remote.html');
    const remoteUrl = `${base}?host=${encodeURIComponent(id)}`;
    const remoteUrlEl = document.getElementById('remote-url');
    if (remoteUrlEl) remoteUrlEl.textContent = remoteUrl;
    const qrContainer = document.getElementById('qr-code');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      try {
        new QRCode(qrContainer, {
          text: remoteUrl, width: 300, height: 300,
          colorDark: '#000000', colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.L
        });
      } catch (_) {
        qrContainer.innerHTML = '<p>QR code unavailable. Open the remote link above.</p>';
      }
    }
    updateConnectionUI();
  });

  instance.on('connection', conn => {
    if (peer !== instance) { conn.close(); return; }
    connections.push(conn);
    const removeConnection = () => {
      connections = connections.filter(current => current !== conn);
      if (!connections.some(current => current.open) && statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
      updateConnectionUI();
    };
    conn.on('open', () => {
      if (peer !== instance || !connections.includes(conn)) return;
      startStatsSync();
      updateConnectionUI();
      sendStatsToRemotes();
    });
    conn.on('data', data => {
      if (peer === instance && conn.open && data && typeof data.type === 'string') {
        handleRemoteCommand(data);
      }
    });
    conn.on('close', removeConnection);
    conn.on('error', () => {
      removeConnection();
      try { conn.close(); } catch (_) { /* Already closed. */ }
    });
    updateConnectionUI();
  });

  instance.on('disconnected', () => schedulePeerReconnect(instance));
  instance.on('close', () => {
    if (peer === instance) schedulePeerReconnect(instance);
  });
  instance.on('error', err => {
    if (peer !== instance) return;
    if (err.type === 'unavailable-id') {
      // A replacement must go through initialization so every handler is attached.
      schedulePeerReconnect(instance, true);
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
      schedulePeerReconnect(instance);
    } else {
      peerConnectionState = 'offline';
      updateConnectionUI();
    }
  });
  peerConnectionTimer = setTimeout(() => {
    peerConnectionTimer = null;
    if (peer === instance && !instance.open) schedulePeerReconnect(instance);
  }, 10000);
}

/**
* Handle remote command
*/
function handleRemoteCommand(data) {
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return false;
  switch (data.type) {
    case 'NEXT_LAP': nextLap(); return true;
    case 'PREV_LAP': previousLap(); return true;
    case 'PLAY_PAUSE': togglePlayPause(); return true;
    case 'SEEK': return seekToVideoTime(data.value);
    default: return false;
  }
}

/**
* Send command to remotes
*/
function sendCommandToRemote(command) {
  connections.forEach(conn => {
    if (conn.open) {
      try {
        conn.send({ type: command });
      } catch (error) {
      }
    }
  });

  // Also execute locally
  handleRemoteCommand({ type: command });
}

/**
* Update connection UI
*/
function updateConnectionUI() {
  const count = connections.filter(conn => conn.open).length;
  const countEl = document.getElementById('connected-count');
  const panel = document.getElementById('qr-panel');
  const statusText = document.getElementById('connection-status');
  const peerStatus = document.getElementById('peer-status');
  const allowButton = document.getElementById('allow-remote');
  const stopButton = document.getElementById('stop-remote');
  const permissionStatus = document.getElementById('remote-permission-status');
  if (allowButton) allowButton.hidden = remoteAllowed;
  if (stopButton) stopButton.hidden = !remoteAllowed;
  if (permissionStatus) permissionStatus.textContent = remoteAllowed
    ? 'Phone remote is enabled for this page. Disable it to close all remote connections and invalidate the pairing link.'
    : 'Phone remote is off. No remote connection starts until you enable it.';
  if (countEl) countEl.textContent = count;
  if (peerStatus) {
    peerStatus.textContent = count ? 'Connected' : ({
      connecting: 'Connecting…', reconnecting: 'Reconnecting…', ready: 'Ready',
      offline: 'Offline — disable and enable to retry', disabled: 'Disabled'
    }[peerConnectionState] || 'Offline');
  }
  if (panel) panel.classList.toggle('connected', count > 0);
  if (statusText) {
    statusText.textContent = count ? `✅ ${count} Device${count > 1 ? 's' : ''} Connected` : '📱 Phone Remote Control';
  }
}

/**
* Start syncing stats to remotes
*/
function startStatsSync() {
  if (statsInterval || !connections.some(conn => conn.open)) return;
  statsInterval = setInterval(sendStatsToRemotes, 500);
}

/**
* Send stats to remote devices
*/
function sendStatsToRemotes() {
  if (!connections.some(conn => conn.open)) return;
  const mainPlayer = getReferencePlayer();
  const validLaps = validateLapData(currentSessionData?.laps || []);
  const currentTime = getReferenceVideoTime();
  const duration = getReferenceDuration();
  // Remote polling continues while the host chart timer is suspended in a
  // hidden tab. Derive the lap from the clock so remote lap controls stay live.
  const currentLap = Number.isFinite(currentTime) ? getCurrentLapNumber(currentTime) : currentLapMarker.lapNumber;
  currentLapMarker.lapNumber = currentLap;
  const stats = {
    type: 'STATS', lap: currentLap, totalLaps: validLaps.length,
    fastestLap: currentSessionData?.fastest_lap || '--:--',
    time: validLaps[currentLap - 1]?.time || '--:--',
    currentTime: Number.isFinite(currentTime) ? currentTime : 0,
    duration: Number.isFinite(duration) ? duration : 0,
    isPlaying: mainPlayer?.getPlayerState?.() === 1
  };
  connections.forEach(conn => {
    if (!conn.open) return;
    try { conn.send(stats); } catch (_) { /* Close/error events handle recovery. */ }
  });
}

/**
* Toggle QR panel
*/
function toggleQRPanel() {
  const qrPanel = document.getElementById('qr-panel');
  const toggleIcon = document.getElementById('qr-toggle-icon');

  if (qrPanel && toggleIcon) {
    if (qrPanel.classList.contains('collapsed')) {
      qrPanel.classList.remove('collapsed');
      toggleIcon.textContent = '▼';
    } else {
      qrPanel.classList.add('collapsed');
      toggleIcon.textContent = '▶';
    }
  }
}

// ===== BROWSE MODAL =====

function updateSameTrackBtn() {
  const btn = document.getElementById('same-track-btn');
  if (!btn || !currentSessionData || allSessionsList.length === 0) return;
  const hasSameTrack = allSessionsList.some(s =>
    s.id !== sessionId &&
    s.track.name === currentSessionData.track.name &&
    s.track.configuration === currentSessionData.track.configuration
  );
  btn.style.display = hasSameTrack ? 'inline-flex' : 'none';
}

function compareSameTrack() {
  if (!currentSessionData) return;
  const match = allSessionsList
    .filter(s =>
      s.id !== sessionId &&
      s.track.name === currentSessionData.track.name &&
      s.track.configuration === currentSessionData.track.configuration
    )
    .sort((a, b) => new Date(b.session_date) - new Date(a.session_date))[0];
  if (!match) return;
  const input = document.getElementById('compare-id-input');
  if (input) input.value = match.id;
  compareSession();
}

function openBrowseModal() {
  const modal = document.getElementById('browse-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const search = document.getElementById('browse-search');
  if (search) { search.value = ''; search.focus(); }
  renderBrowseList('');
}

function closeBrowseModal(e) {
  if (e && e.target !== document.getElementById('browse-modal')) return;
  const modal = document.getElementById('browse-modal');
  if (modal) modal.style.display = 'none';
}

function renderBrowseList(query) {
  const list = document.getElementById('browse-list');
  if (!list) return;
  const q = (query || '').toLowerCase().trim();
  const filtered = allSessionsList
    .filter(s =>
      s.id !== sessionId &&
      (!q ||
        s.driver.toLowerCase().includes(q) ||
        s.track.name.toLowerCase().includes(q) ||
        (s.track.configuration || '').toLowerCase().includes(q))
    )
    .sort((a, b) => new Date(b.session_date) - new Date(a.session_date));

  if (filtered.length === 0) {
    list.innerHTML = '<div class="browse-empty">No sessions found</div>';
    return;
  }

  list.innerHTML = filtered.map(s => {
    const date = new Date(s.session_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    const dot = s.has_video
      ? '<div class="browse-video-dot" title="Has video"></div>'
      : '<div class="browse-no-video-dot"></div>';
    return `<div class="browse-item" onclick="selectBrowseSession('${s.id}')">
      ${dot}
      <div class="browse-item-info">
        <div class="browse-item-title">${s.driver} · ${s.track.name}</div>
        <div class="browse-item-meta">${s.track.configuration || ''} · ${date}</div>
      </div>
      <div class="browse-item-lap">${s.fastest_lap || '—'}</div>
    </div>`;
  }).join('');
}

function selectBrowseSession(id) {
  const modal = document.getElementById('browse-modal');
  if (modal) modal.style.display = 'none';
  const input = document.getElementById('compare-id-input');
  if (input) input.value = id;
  compareSession();
}

// ===== DATA LOADING =====

/**
* Load sessions list for autocomplete
*/
function loadSessionsList() {
  fetch('sessions/sessions-list.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      allSessionsList = data.sessions || [];
      setupAutocomplete();
      updateSameTrackBtn();
    })
    .catch(err => {
    });
}

/**
* Load main session data
*/
function loadSessionData() {
  fetch(`sessions/${sessionId}.json`, { cache: 'no-cache' })
    .then(r => {
      if (!r.ok) throw new Error('Session not found');
      return r.json();
    })
    .then(data => {
      data.id = sessionId;
      data.laps = validateLapData(data.laps);

      if (data.laps.length === 0) {
        throw new Error('No valid lap data found');
      }

      currentSessionData = data;
      renderSession(data);

      // Auto-compare if compare_id in URL
      if (compareId) {
        const compareInput = document.getElementById('compare-id-input');
        if (compareInput) {
          compareInput.value = compareId;
          compareSession();
        }
      }
    })
    .catch(err => {
      showErrorPage(err.message);
    });
}

/**
* Show error page
*/
function showErrorPage(message) {
  document.body.innerHTML = `
  <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          text-align: center;
          padding: 20px;
          background: linear-gradient(135deg, var(--surface-0), var(--surface-1));
          color: var(--text-primary);
        ">
    <div style="
            background: var(--surface-2);
            padding: 40px;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-xl);
            max-width: 500px;
          ">
      <h1 style="font-size: 3em; margin-bottom: 20px;">⚠️</h1>
      <h2 style="margin-bottom: 10px; color: var(--error);">Error Loading Session</h2>
      <p style="color: var(--text-secondary); margin-bottom: 30px;">${message}</p>
      <a href="sessions.html" class="btn btn-primary" style="
              display: inline-block;
              padding: 12px 24px;
              text-decoration: none;
            ">
        🏠 Return Home
      </a>
    </div>
  </div>
  `;
}

// ===== SESSION RENDERING =====

/**
* Render session data
*/
function renderSession(data) {
  const validLaps = validateLapData(data.laps);

  // Update header
  const driverEl = document.getElementById('driver');
  if (driverEl) {
    driverEl.textContent = data.driver;
  }

  const sessionDateEl = document.getElementById('session-date');
  if (sessionDateEl) {
    const dateStr = new Date(data.session_date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    sessionDateEl.innerHTML = `<span>📅</span><span>${dateStr}</span>`;
  }

  const sessionTrackEl = document.getElementById('session-track');
  if (sessionTrackEl) {
    sessionTrackEl.innerHTML = `<span>🏁</span><span>${data.track.name}</span>`;
  }

  // Update page title, canonical and OG tags for SEO
  const shortDate = new Date(data.session_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  const pageTitle = `${data.driver} @ ${data.track.name} · ${shortDate} — Helmet Cam Heroes`;
  const pageDesc = `Karting session telemetry for ${data.driver} at ${data.track.name} (${data.track.configuration}), ${shortDate}. Fastest lap: ${data.fastest_lap || 'N/A'}.`;
  const canonicalUrl = `https://helmetcamheroes.com/session.html?id=${data.id}`;
  document.title = pageTitle;
  document.querySelector('meta[name="description"]')?.setAttribute('content', pageDesc);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', pageTitle);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', pageDesc);
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', pageTitle);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', pageDesc);

  // Render UUID
  const uuidContainer = document.getElementById('session-uuid-container');
  const uuidDisplay = document.getElementById('session-uuid-display');
  if (uuidContainer && uuidDisplay) {
    uuidDisplay.textContent = data.id;
    // Visible only in PC mode (handled by CSS .pc-only)
    // uuidContainer.style.display = 'flex'; // CSS handles this now via classes, but we ensure it's removed style override
    uuidContainer.removeAttribute('style'); // Remove display:none from HTML
  }

  // Render stats
  renderStatsGrid(data);

  // Setup video player
  renderVideoPlayer(data.video_url, data.video_start_time, true);

  // Setup video slider (Time based)
  // Setup video slider (Time based) - REMOVED
  // const slider = document.getElementById('lap-selector-slider');
  // ... code removed ...

  // Calculate lap start times for video seeking
  const videoStartTime = parseTime(data.video_start_time || "0:00");
  let cumulativeTime = videoStartTime;
  lapStartTimes = [];

  lapStartTimes.push({ lapNumber: 1, videoTime: cumulativeTime });

  for (let i = 0; i < validLaps.length - 1; i++) {
    cumulativeTime += parseTime(validLaps[i].time);
    lapStartTimes.push({
      lapNumber: i + 2,
      videoTime: cumulativeTime
    });
  }

  // Draw initial chart
  drawLineChart(validLaps);

  // Update lap display
  const
    lapDisplay = document.getElementById('current-lap-display'); if (lapDisplay) {
      lapDisplay.textContent = `Lap: 1 / ${validLaps.length}`;
    }

  updateSameTrackBtn();
}

// ===== EVENT HANDLERS =====

/**
 * Window resize handler
 */
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (currentSessionData) {
      const validLaps = validateLapData(currentSessionData.laps);
      drawLineChart(validLaps, comparisonDatasets);
    }
  }, 250);
});

/**
* Keyboard shortcuts
*/
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') {
    const modal = document.getElementById('browse-modal');
    if (modal && modal.style.display !== 'none') {
      closeBrowseModal();
      e.preventDefault();
    } else if (isVideoFullscreen()) {
      e.preventDefault();
      exitVideoFullscreen();
    }
    return;
  }

  // Preserve normal activation/navigation inside native controls and dialogs.
  if (e.altKey || e.ctrlKey || e.metaKey || e.target.isContentEditable ||
      e.target.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"], [role="slider"]')) {
    return;
  }
  if (e.repeat && [' ', 'k', 'f', 'm'].includes(e.key.toLowerCase())) return;

  switch (e.key.toLowerCase()) {
    case 'arrowleft':
      e.preventDefault();
      previousLap();
      break;
    case 'arrowright':
      e.preventDefault();
      nextLap();
      break;
    case ' ':
    case 'k':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'f':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'm':
      e.preventDefault();
      toggleMute();
      break;
  }
});

/**
* Visibility change handler
*/
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (playbackRequested) startStatsUpdateInterval();

    // Redraw chart
    if (currentSessionData) {
      const validLaps = validateLapData(currentSessionData.laps);
      drawLineChart(validLaps, comparisonDatasets);
    }
  } else {
    stopStatsUpdateInterval();
    // Pause animation frames
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }
});

/**
* Page show/hide handlers (for BFCache)
*/
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    detectInitialMode();

    // Reconnect peer if needed
    if (remoteAllowed) initializePeer();
  }
});

window.addEventListener('pagehide', () => {
  // Cleanup
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }

  if (updateStatsInterval) {
    clearInterval(updateStatsInterval);
    updateStatsInterval = null;
  }

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  cleanupPeerConnection();

  // Stop videos
  // Stop videos
  Object.values(videoPlayers).forEach(p => {
    if (typeof p.stopVideo === 'function') p.stopVideo();
  });
});

/**
* Before unload handler
*/
window.addEventListener('beforeunload', () => {
  Object.values(videoPlayers).forEach(p => {
    if (typeof p.pauseVideo === 'function') p.pauseVideo();
  });
});

/**
* Fullscreen change handler
*/
document.addEventListener('fullscreenchange', () => {
  updateFullscreenControls();
});

// ===== INITIALIZATION =====

/**
* Initialize application
*/
function initializeApp() {

  // Detect and apply mode
  detectInitialMode();

  // Remote networking is optional and starts only on an explicit request.
  document.getElementById('allow-remote').addEventListener('click', enablePhoneRemote);
  document.getElementById('stop-remote').addEventListener('click', disablePhoneRemote);
  updateConnectionUI();

  document.getElementById('allow-youtube').addEventListener('click', () => {
    youtubeAllowed = true;
    document.getElementById('allow-youtube').hidden = true;
    document.getElementById('stop-youtube').hidden = false;
    document.getElementById('video-permission-status').textContent = 'YouTube videos are enabled for this page. Disable them to reload with video connections blocked.';
    loadYouTubeAPI();
  });
  document.getElementById('stop-youtube').addEventListener('click', () => {
    window.location.reload();
  });

  // Load sessions list for autocomplete
  loadSessionsList();

  // Load main session data
  loadSessionData();

}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
