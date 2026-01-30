// ===== GLOBAL VARIABLES =====
let currentSessionData = null;
let comparisonSessions = [];
let chartPoints = [];
let currentDataset = [];
let comparisonDatasets = [];
let activePoint = null;
let allSessionsList = [];
let currentMode = 'pc';
let autoFullscreenTriggered = false;
let animationFrameId = null;
let lastTooltipUpdate = 0;
const TOOLTIP_DEBOUNCE = 50;

// Video players
let mainPlayer = null;
let comparePlayer = null;
let pendingMainVideoConfig = null;
let pendingCompareVideoConfig = null;

// Lap tracking
let lapStartTimes = [];
let currentLapMarker = { lapNumber: 1 };
let updateStatsInterval = null;

// PeerJS for remote control
let peer = null;
let connections = [];
let statsInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

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
    console.warn('Invalid laps data: not an array');
    return [];
  }

  return laps.filter(lap => {
    if (!lap || typeof lap !== 'object') return false;
    const time = parseTime(lap.time);
    const isValid = lap.lap > 0 && time > 0 && time < 600 && !isNaN(time);
    if (!isValid) console.warn('Invalid lap filtered:', lap);
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

    // Auto-play video in TV mode
    if (mainPlayer && typeof mainPlayer.playVideo === 'function') {
      setTimeout(() => mainPlayer.playVideo(), 1000);
    }
  } else {
    // PC Mode: Full view
    if (comparisonSection) comparisonSection.style.display = 'block';
    if (footer) footer.style.display = 'block';
    if (detailedChart) detailedChart.style.display = 'block';

    // Hide QR panel by default (can be shown manually)
    if (qrPanel) qrPanel.style.display = 'none';

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

  statsGrid.innerHTML = `
  <div class="stat-card">
    <div class="stat-label">Fastest Lap</div>
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
    <div class="stat-label">Kart</div>
    <div class="stat-value">${data.kart}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Total Laps</div>
    <div class="stat-value">${validLaps.length}</div>
  </div>
  `;
}

// ===== VIDEO PLAYER MANAGEMENT =====

/**
* Load YouTube IFrame API
*/
function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return;

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.async = true;
  document.body.appendChild(tag);
}

/**
* YouTube API ready callback
*/
window.onYouTubeIframeAPIReady = function () {
  // Initialize main player
  if (pendingMainVideoConfig && document.getElementById('main-youtube-player')) {
    createMainPlayer(pendingMainVideoConfig);
  }

  // Initialize comparison player if needed
  if (pendingCompareVideoConfig && document.getElementById('compare-youtube-player')) {
    createComparePlayer(pendingCompareVideoConfig);
  }
};

/**
* Create main YouTube player
*/
function createMainPlayer(config) {
  const { videoId, startTimeSeconds } = config;

  mainPlayer = new YT.Player('main-youtube-player', {
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
      'onReady': onMainPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': (e) => onPlayerError(e, 'main')
    }
  });
}

/**
* Create comparison YouTube player
*/
function createComparePlayer(config) {
  const { videoId, startTimeSeconds } = config;

  comparePlayer = new YT.Player('compare-youtube-player', {
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
      'onReady': onComparePlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': (e) => onPlayerError(e, 'compare')
    }
  });
}

/**
* Main player ready handler
*/
function onMainPlayerReady(event) {
  console.log('Main player ready');

  // Set quality
  if (mainPlayer && typeof mainPlayer.getAvailableQualityLevels === 'function') {
    const qualities = mainPlayer.getAvailableQualityLevels();
    console.log('Available qualities:', qualities);

    if (qualities.includes('hd2160')) {
      mainPlayer.setPlaybackQuality('hd2160');
    } else if (qualities.includes('hd1080')) {
      mainPlayer.setPlaybackQuality('hd1080');
    }
  }

  seekToLap(1);

  // Show QR panel in TV mode
  if (currentMode === 'tv') {
    const qrPanel = document.getElementById('qr-panel');
    if (qrPanel) qrPanel.style.display = 'block';
  }
}

/**
* Comparison player ready handler
*/
function onComparePlayerReady(event) {
  console.log('Comparison player ready');

  // Set quality
  if (comparePlayer && typeof comparePlayer.getAvailableQualityLevels === 'function') {
    const qualities = comparePlayer.getAvailableQualityLevels();

    if (qualities.includes('hd2160')) {
      comparePlayer.setPlaybackQuality('hd2160');
    } else if (qualities.includes('hd1080')) {
      comparePlayer.setPlaybackQuality('hd1080');
    }
  }

  // Sync with main player
  if (mainPlayer && typeof mainPlayer.getCurrentTime === 'function') {
    const currentTime = mainPlayer.getCurrentTime();
    comparePlayer.seekTo(currentTime, true);
  }
}

/**
* Player state change handler (unified for both players)
*/
function onPlayerStateChange(event) {
  const isPlaying = event.data === YT.PlayerState.PLAYING;

  // Update UI
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const playIconTV = document.getElementById('play-icon-tv');

  if (isPlaying) {
    if (playIcon) playIcon.textContent = '⏸️';
    if (playText) playText.textContent = 'Pause';
    if (playIconTV) playIconTV.textContent = '⏸️';
    startStatsUpdateInterval();
  } else {
    if (playIcon) playIcon.textContent = '▶️';
    if (playText) playText.textContent = 'Play';
    if (playIconTV) playIconTV.textContent = '▶️';
    stopStatsUpdateInterval();
  }

  // Sync both players
  if (event.target === mainPlayer && comparePlayer) {
    if (isPlaying && comparePlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
      comparePlayer.playVideo();
    } else if (!isPlaying && comparePlayer.getPlayerState() === YT.PlayerState.PLAYING) {
      comparePlayer.pauseVideo();
    }
  } else if (event.target === comparePlayer && mainPlayer) {
    if (isPlaying && mainPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
      mainPlayer.playVideo();
    } else if (!isPlaying && mainPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
      mainPlayer.pauseVideo();
    }
  }
}

/**
* Player error handler
*/
function onPlayerError(event, playerType) {
  console.error(`${playerType} player error:`, event.data);

  const errorMsg = ERROR_MESSAGES[event.data] || 'Unknown error occurred';
  const containerId = playerType === 'main' ? 'main-video-container' : 'compare-video-container';
  const container = document.getElementById(containerId);

  if (container) {
    container.innerHTML = `
  <div class="error-message" style="padding:40px;text-align:center;">
    <h3>⚠️ Video Error</h3>
    <p>${errorMsg}</p>
    <p style="margin-top:10px;font-size:0.9em;color:var(--text-secondary);">
      Error code: ${event.data}
    </p>
  </div>
  `;
  }

  // Hide QR panel if main video fails
  if (playerType === 'main') {
    const qrPanel = document.getElementById('qr-panel');
    if (qrPanel) qrPanel.style.display = 'none';
  }
}

/**
* Render video player(s)
*/
function renderVideoPlayer(videoUrl, videoStartTime, isMainPlayer = true) {
  const videoSection = document.getElementById('video-section');
  const containerId = isMainPlayer ? 'main-video-container' : 'compare-video-container';
  const container = document.getElementById(containerId);

  if (!videoUrl || videoUrl.trim() === '') {
    if (container) container.style.display = 'none';
    if (isMainPlayer) videoSection.style.display = 'none';
    return;
  }

  // Handle "pending" status
  if (videoUrl.toLowerCase() === 'pending') {
    if (container) {
      container.innerHTML = `
  <div class="error-message" style="padding:40px;text-align:center;">
    <h3>🎥 Video Coming Soon</h3>
    <p>This session's video is being processed and will be available shortly.</p>
  </div>
  `;
      container.style.display = 'block';
    }
    if (isMainPlayer) videoSection.style.display = 'block';
    return;
  }

  const videoId = extractYouTubeId(videoUrl);

  if (!videoId) {
    console.error('Invalid video URL:', videoUrl);
    if (container) {
      container.innerHTML = `
  <div class="error-message" style="padding:40px;text-align:center;">
    <h3>⚠️ Invalid Video URL</h3>
    <p>The video URL provided is not valid.</p>
  </div>
  `;
      container.style.display = 'block';
    }
    return;
  }

  // Show video section and container
  if (container) container.style.display = 'block';
  if (isMainPlayer) videoSection.style.display = 'block';

  // Load YouTube API
  loadYouTubeAPI();

  const config = {
    videoId,
    startTimeSeconds: parseTime(videoStartTime)
  };

  if (isMainPlayer) {
    pendingMainVideoConfig = config;
    if (window.YT && window.YT.Player) {
      createMainPlayer(config);
    }
  } else {
    pendingCompareVideoConfig = config;
    if (window.YT && window.YT.Player) {
      createComparePlayer(config);
    }
  }
}

// ===== PLAYBACK CONTROLS =====

/**
* Toggle play/pause for both players
*/
function togglePlayPause() {
  if (!mainPlayer || typeof mainPlayer.getPlayerState !== 'function') return;

  const state = mainPlayer.getPlayerState();

  if (state === YT.PlayerState.PLAYING) {
    mainPlayer.pauseVideo();
    if (comparePlayer) comparePlayer.pauseVideo();
  } else {
    mainPlayer.playVideo();
    if (comparePlayer) comparePlayer.playVideo();
  }
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
function seekToLap(lapNumber) {
  if (!currentSessionData || !currentSessionData.laps) return;
  const maxLap = currentSessionData.laps.length;

  // Clamp lap number
  if (lapNumber < 1) lapNumber = 1;
  if (lapNumber > maxLap) lapNumber = maxLap;

  // Find lap start time
  const lapStartTimeObj = lapStartTimes.find(l => l.lapNumber === lapNumber);

  if (lapStartTimeObj) {
    // Seek both players
    if (mainPlayer && typeof mainPlayer.seekTo === 'function') {
      mainPlayer.seekTo(lapStartTimeObj.videoTime, true);
    }
    if (comparePlayer && typeof comparePlayer.seekTo === 'function') {
      comparePlayer.seekTo(lapStartTimeObj.videoTime, true);
    }
    // Update UI
    currentLapMarker.lapNumber = lapNumber;

    // New slider logic is time-based, so we don't set slider value here unless we want to sync it
    // But updateLiveStats will handle the slider position.
    // We just ensure the slider is "aware" if we stopped playback.

    const lapDisplay = document.getElementById('current-lap-display');
    if (lapDisplay) {
      // We need maxLapsCount here, which is usually derived from currentSessionData.laps
      // For now, we can get it from the slider if it exists, or calculate from currentSessionData
      const maxLap = currentSessionData && currentSessionData.laps ? currentSessionData.laps.length : 0;
      lapDisplay.textContent = `Lap: ${lapNumber} / ${maxLap}`;
    }

    // Redraw chart with current lap marker and time
    if (currentSessionData) {
      const currentLaps = validateLapData(currentSessionData.laps);
      // When seeking to a lap, we assume start of lap for visual indication
      // However, the video update is async, so we might just wait for the next stats update
      // But forcing a redraw here is good for responsiveness
      drawLineChart(currentLaps, comparisonDatasets, lapStartTimeObj.videoTime);
    }
  }
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
  if (!mainPlayer || typeof mainPlayer.getCurrentTime !== 'function') return;

  const videoTime = mainPlayer.getCurrentTime();
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
  // Draw current lap marker / Playhead
  if (currentVideoTime !== null && lapStartTimes.length > 0) {
    // Find percentage through total laps
    // We need to map time to X position.
    // This is tricky because the x-axis is "Lap Number", not time.
    // So we need to calculate: (CurrentLapIndex) + (ProgressWithinLap)

    const currentLapNum = getCurrentLapNumber(currentVideoTime);
    const currentLapIdx = currentLapNum - 1;

    const currentLapData = mainLaps[currentLapIdx];

    let progressWithinLap = 0;
    if (currentLapData) {
      const lapStartTime = lapStartTimes.find(l => l.lapNumber === currentLapNum)?.videoTime || 0;
      const timeInLap = currentVideoTime - lapStartTime;
      const lapDuration = parseTime(currentLapData.time);
      if (lapDuration > 0) {
        progressWithinLap = timeInLap / lapDuration;
        // Clamp to 0-1
        progressWithinLap = Math.max(0, Math.min(1, progressWithinLap));
      }
    }

    const effectiveIndex = currentLapIdx + progressWithinLap;
    const xPos = padding + (chartWidth / (maxLapsCount - 1 || 1)) * effectiveIndex;

    // Draw Playhead Line
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xPos, padding);
    ctx.lineTo(xPos, rect.height - padding);
    ctx.stroke();

    // Draw Playhead Handle
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(xPos, padding, 5, 0, Math.PI * 2);
    ctx.moveTo(xPos, rect.height - padding);
    ctx.arc(xPos, rect.height - padding, 4, 0, Math.PI * 2);
    ctx.fill();

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

  drawLapLine(mainLaps, '#f44336', '#ff5252', false, -1);

  // Draw main line on top
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

  // Click to seek
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dpr = window.devicePixelRatio || 1;

    // Calculate effective index from x
    const chartWidth = rect.width - padding * 2;
    const relativeX = x - padding;

    if (relativeX < 0 || relativeX > chartWidth) return;

    // Inverse of: xPos = padding + (chartWidth / (maxLapsCount - 1 || 1)) * effectiveIndex;
    // effectiveIndex = (xPos - padding) / (chartWidth / (maxLapsCount - 1 || 1))

    const step = chartWidth / (maxLapsCount - 1 || 1);
    const effectiveIndex = relativeX / step;

    // Convert effectiveIndex to time
    // effectiveIndex = lapIdx + progress

    const lapIdx = Math.floor(effectiveIndex);
    const progress = effectiveIndex - lapIdx;

    // Safety check
    if (lapIdx < 0 || lapIdx >= currentSessionData.laps.length) return;

    const lapData = currentSessionData.laps[lapIdx];
    const validLaps = validateLapData(currentSessionData.laps);

    if (lapData) {
      // Find lap start time
      // Note: lapStartTimes uses 1-based lapNumber
      const lapNum = lapIdx + 1;
      const lapStartTime = lapStartTimes.find(l => l.lapNumber === lapNum)?.videoTime || 0;
      const lapDuration = parseTime(lapData.time);

      const targetTime = lapStartTime + (lapDuration * progress);

      if (mainPlayer && typeof mainPlayer.seekTo === 'function') {
        mainPlayer.seekTo(targetTime, true);
        if (comparePlayer) comparePlayer.seekTo(targetTime, true);
      }
    }
  });
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
                Kart: ${session.kart}
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
  const compareIdsInput = document.getElementById('compare-id-input').value.trim();

  let sessionIds = compareIdsInput
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0 && id !== sessionId);

  // Remove duplicates
  sessionIds = Array.from(new Set(sessionIds));

  comparisonSessions = [];
  comparisonDatasets = [];

  if (!currentSessionData) return;

  const currentLaps = validateLapData(currentSessionData.laps);

  // If no comparison IDs, just show main session
  if (sessionIds.length === 0) {
    drawLineChart(currentLaps, []);
    renderComparisonResults([]);
    hideComparisonVideo();
    return;
  }

  // Show loading state
  const comparisonGrid = document.getElementById('comparison-grid');
  if (comparisonGrid) {
    comparisonGrid.innerHTML = '<div class="loading">Loading comparison data...</div>';
  }

  // Fetch all comparison sessions
  const fetchPromises = sessionIds.map(id =>
    fetch(`sessions/${id}.json`)
      .then(r => r.ok ? r.json() : Promise.reject(`Session ${id} not found`))
      .catch(err => ({ error: err }))
  );

  const results = await Promise.all(fetchPromises);
  const successfulSessions = results.filter(r => !r.error);
  const errorSessions = results.filter(r => r.error);

  // Process successful sessions
  successfulSessions.forEach(sessionData => {
    sessionData.id = sessionData.id || sessionIds[successfulSessions.indexOf(sessionData)];
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

  // Show comparison video if available
  if (comparisonSessions.length > 0 && currentMode === 'pc') {
    showComparisonVideo(comparisonSessions[0]);
  } else {
    hideComparisonVideo();
  }
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
      <p><strong>Kart:</strong> <span>${data.kart}</span></p>
    </div>
    `;
}

/**
* Show comparison video
*/
function showComparisonVideo(comparisonSession) {
  if (!comparisonSession.video_url || comparisonSession.video_url === 'pending') {
    hideComparisonVideo();
    return;
  }

  const videoGrid = document.getElementById('video-grid');
  const compareContainer = document.getElementById('compare-video-container');

  if (videoGrid && compareContainer) {
    // Enable grid mode
    videoGrid.classList.add('comparison-mode');
    compareContainer.style.display = 'block';

    // Update comparison driver name
    const compareDriverName = document.getElementById('compare-driver-name');
    if (compareDriverName) {
      compareDriverName.textContent = comparisonSession.driver;
    }

    // Render comparison video
    renderVideoPlayer(
      comparisonSession.video_url,
      comparisonSession.video_start_time || '0:00',
      false // isMainPlayer = false
    );
  }
}

/**
* Hide comparison video
*/
function hideComparisonVideo() {
  const videoGrid = document.getElementById('video-grid');
  const compareContainer = document.getElementById('compare-video-container');

  if (videoGrid) {
    videoGrid.classList.remove('comparison-mode');
  }

  if (compareContainer) {
    compareContainer.style.display = 'none';
  }

  // Destroy comparison player
  if (comparePlayer && typeof comparePlayer.destroy === 'function') {
    comparePlayer.destroy();
    comparePlayer = null;
  }
}

/**
* Clear comparison
*/
function clearComparison() {
  comparisonSessions = [];
  comparisonDatasets = [];

  const compareInput = document.getElementById('compare-id-input');
  if (compareInput) {
    compareInput.value = '';
  }

  hideComparisonVideo();

  if (currentSessionData) {
    const validLaps = validateLapData(currentSessionData.laps);
    drawLineChart(validLaps, []);
    renderComparisonResults([]);
  }
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
    console.error('Copy failed:', err);
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
    console.error('UUID copy failed:', err);
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
        session.id.toLowerCase().includes(lastQuery) ||
        session.driver.toLowerCase().includes(lastQuery) ||
        session.track.name.toLowerCase().includes(lastQuery)
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
function initializePeer() {
  if (peer) {
    peer.destroy();
  }

  peer = new Peer();

  peer.on('open', (id) => {
    console.log('PeerJS ID:', id);
    reconnectAttempts = 0;

    const remoteUrl = `${window.location.origin}${window.location.pathname.replace('session.html',
      'remote.html')}?host=${id}&mode=${currentMode}`;

    const remoteUrlEl = document.getElementById('remote-url');
    if (remoteUrlEl) {
      remoteUrlEl.textContent = remoteUrl;
    }

    const peerStatus = document.getElementById('peer-status');
    if (peerStatus) {
      peerStatus.textContent = 'Ready';
    }

    // Generate QR code
    const qrContainer = document.getElementById('qr-code');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      try {
        new QRCode(qrContainer, {
          text: remoteUrl,
          width: 220,
          height: 220,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (error) {
        console.error('QR generation failed:', error);
        qrContainer.innerHTML = '<p style="color:var(--error);">QR code generation failed</p>';
      }
    }
  });

  peer.on('connection', (conn) => {
    console.log('Remote connected:', conn.peer);
    connections.push(conn);

    conn.on('data', (data) => {
      console.log('Received command:', data);
      handleRemoteCommand(data);
    });

    conn.on('close', () => {
      connections = connections.filter(c => c.peer !== conn.peer);
      console.log('Remote disconnected:', conn.peer);
      updateConnectionUI();
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      connections = connections.filter(c => c.peer !== conn.peer);
      updateConnectionUI();
    });

    startStatsSync();
    updateConnectionUI();

    // Auto fullscreen in TV mode
    if (currentMode === 'tv' && !autoFullscreenTriggered) {
      autoFullscreenTriggered = true;
      setTimeout(() => {
        const videoSection = document.getElementById('video-section');
        if (videoSection && !document.fullscreenElement) {
          if (videoSection.requestFullscreen) {
            videoSection.requestFullscreen().catch(err =>
              console.log('Fullscreen failed:', err)
            );
          }
        }
      }, 2000);
    }
  });

  peer.on('disconnected', () => {
    console.log('Peer disconnected, attempting reconnect...');
    const peerStatus = document.getElementById('peer-status');
    if (peerStatus) {
      peerStatus.textContent = 'Reconnecting...';
    }

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++; setTimeout(() => {
        if (!peer.destroyed) {
          peer.reconnect();
        }
      }, 3000);
    } else {
      if (peerStatus) {
        peerStatus.textContent = 'Failed';
      }
      console.error('Max reconnection attempts reached');
    }
  });

  peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    const peerStatus = document.getElementById('peer-status');
    if (peerStatus) {
      peerStatus.textContent = 'Error';
    }

    if (err.type === 'network' || err.type === 'server-error') {
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => initializePeer(), 5000);
      }
    }
  });
}

/**
* Handle remote command
*/
function handleRemoteCommand(data) {
  switch (data.type) {
    case 'NEXT_LAP':
      nextLap();
      break;
    case 'PREV_LAP':
      previousLap();
      break;
    case 'PLAY_PAUSE':
      togglePlayPause();
      break;
    case 'SEEK':
      if (data.value !== undefined) {
        if (mainPlayer && typeof mainPlayer.seekTo === 'function') {
          mainPlayer.seekTo(parseFloat(data.value), true);
        }
        if (comparePlayer && typeof comparePlayer.seekTo === 'function') {
          comparePlayer.seekTo(parseFloat(data.value), true);
        }
      }
      break;
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
        console.error('Failed to send command:', error);
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
  const count = connections.length;
  const countEl = document.getElementById('connected-count');
  const panel = document.getElementById('qr-panel');
  const statusText = document.getElementById('connection-status');

  if (countEl) {
    countEl.textContent = count;
  }

  if (panel && statusText) {
    if (count > 0) {
      panel.classList.add('connected');
      statusText.textContent = `✅ ${count} Device${count > 1 ? 's' : ''} Connected`;
    } else {
      panel.classList.remove('connected');
      statusText.textContent = '📱 Phone Remote Control';
    }
  }
}

/**
* Start syncing stats to remotes
*/
function startStatsSync() {
  if (statsInterval) return;

  statsInterval = setInterval(() => {
    sendStatsToRemotes();
  }, 500);
}

/**
* Send stats to remote devices
*/
function sendStatsToRemotes() {
  if (connections.length === 0) return;

  const currentLap = currentLapMarker.lapNumber;
  const currentLapData = currentSessionData?.laps[currentLap - 1];
  const currentTime = mainPlayer && typeof mainPlayer.getCurrentTime === 'function' ?
    mainPlayer.getCurrentTime() : 0;
  const duration = mainPlayer && typeof mainPlayer.getDuration === 'function' ?
    mainPlayer.getDuration() : 0;
  const validLaps = validateLapData(currentSessionData?.laps || []);
  const totalLaps = validLaps.length;
  const fastestLap = currentSessionData?.fastest_lap || '--:--';
  const isPlaying = mainPlayer && mainPlayer.getPlayerState ?
    mainPlayer.getPlayerState() === YT.PlayerState.PLAYING : false;

  const stats = {
    type: 'STATS',
    lap: currentLap,
    totalLaps: totalLaps,
    fastestLap: fastestLap,
    time: currentLapData?.time || '--:--',
    currentTime: currentTime,
    duration: duration,
    isPlaying: isPlaying
  };

  connections.forEach(conn => {
    if (conn.open) {
      try {
        conn.send(stats);
      } catch (error) {
        console.error('Stats send failed:', error);
      }
    }
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

// ===== DATA LOADING =====

/**
* Load sessions list for autocomplete
*/
function loadSessionsList() {
  fetch('sessions/sessions-list.json')
    .then(r => r.json())
    .then(data => {
      allSessionsList = data.sessions || [];
      console.log(`Loaded ${allSessionsList.length} sessions for autocomplete`);
      setupAutocomplete();
    })
    .catch(err => {
      console.warn("Autocomplete load failed:", err);
    });
}

/**
* Load main session data
*/
function loadSessionData() {
  fetch(`sessions/${sessionId}.json`)
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
      console.error('Session load error:', err);
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
      <a href="index.html" class="btn btn-primary" style="
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
  } console.log('Lap start times:', lapStartTimes); // Draw initial
  drawLineChart(validLaps);

  // Update lap display
  const
    lapDisplay = document.getElementById('current-lap-display'); if (lapDisplay) {
      lapDisplay.textContent = `Lap: 1 / ${validLaps.length}`;
    }
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
  // Ignore if typing in input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      previousLap();
      break;
    case 'ArrowRight':
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
      // Toggle fullscreen
      if (!document.fullscreenElement) {
        const videoSection = document.getElementById('video-section');
        if (videoSection && videoSection.requestFullscreen) {
          videoSection.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
      break;
    case 'm':
      e.preventDefault();
      // Toggle mute
      if (mainPlayer && typeof mainPlayer.isMuted === 'function') {
        if (mainPlayer.isMuted()) {
          mainPlayer.unMute();
        } else {
          mainPlayer.mute();
        }
      }
      break;
  }
});

/**
* Visibility change handler
*/
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Resume
    if (currentMode === 'tv' && mainPlayer && typeof mainPlayer.playVideo === 'function') {
      setTimeout(() => {
        mainPlayer.playVideo();
      }, 500);
    }

    // Redraw chart
    if (currentSessionData) {
      const validLaps = validateLapData(currentSessionData.laps);
      drawLineChart(validLaps, comparisonDatasets);
    }
  } else {
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
    console.log('Page restored from BFCache');
    detectInitialMode();

    // Reconnect peer if needed
    if (peer && peer.disconnected) {
      setTimeout(() => initializePeer(), 1000);
    }
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

  // Close peer connections
  if (peer) {
    connections.forEach(conn => {
      try {
        conn.close();
      } catch (e) {
        console.error('Connection close error:', e);
      }
    });
    peer.destroy();
  }

  // Stop videos
  if (mainPlayer && typeof mainPlayer.stopVideo === 'function') {
    mainPlayer.stopVideo();
  }
  if (comparePlayer && typeof comparePlayer.stopVideo === 'function') {
    comparePlayer.stopVideo();
  }
});

/**
* Before unload handler
*/
window.addEventListener('beforeunload', () => {
  if (mainPlayer && typeof mainPlayer.pauseVideo === 'function') {
    mainPlayer.pauseVideo();
  }
  if (comparePlayer && typeof comparePlayer.pauseVideo === 'function') {
    comparePlayer.pauseVideo();
  }
});

/**
* Fullscreen change handler
*/
document.addEventListener('fullscreenchange', () => {
  console.log('Fullscreen:', !!document.fullscreenElement);
});

// ===== INITIALIZATION =====

/**
* Initialize application
*/
function initializeApp() {
  console.log('Initializing Karting Session Viewer...');
  console.log('Session ID:', sessionId);
  console.log('Compare ID:', compareId);

  // Detect and apply mode
  detectInitialMode();

  // Initialize PeerJS for remote control
  initializePeer();

  // Load sessions list for autocomplete
  loadSessionsList();

  // Load main session data
  loadSessionData();

  console.log('Initialization complete');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}