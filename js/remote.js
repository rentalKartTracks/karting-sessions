const params = new URLSearchParams(window.location.search);
const hostId = params.get('host');
let peer = null;
let conn = null;
let isSeeking = false;
let currentDuration = 0;
let currentTime = 0;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let reconnectTimer = null;
let connectionTimer = null;
let heartbeatTimer = null;
let lastStatsAt = 0;
let seekControlsCleanup = null;
let connectionState = 'disabled';
let remoteAllowed = false;

function init() {
    showRemotePermission();
}

function showRemotePermission() {
    setConnectionState('disabled');
    document.getElementById('stop-remote').hidden = true;
    document.getElementById('content-area').innerHTML = `
        <div class="error-state">
            <h1>Kart Remote</h1>
            <p>Connect to control the session shown on the paired screen. The connection starts only when you select Connect.</p>
            <button class="retry-btn" type="button" onclick="connectRemote()">Connect</button>
        </div>
    `;
}

function connectRemote() {
    if (!hostId) {
        showError('No Connection ID', 'Please scan the QR code again to connect.');
        return;
    }
    if (remoteAllowed) return;
    remoteAllowed = true;
    document.getElementById('stop-remote').hidden = false;
    reconnectAttempts = 0;
    document.getElementById('content-area').innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p class="loading-text">Connecting to session…</p>
        </div>
    `;
    setupPeerConnection();
    preventDefaults();
}

function disconnectRemote() {
    remoteAllowed = false;
    cleanupRemoteConnection();
    if (seekControlsCleanup) seekControlsCleanup();
    reconnectAttempts = 0;
    showRemotePermission();
}

function preventDefaults() {
    document.addEventListener('selectstart', e => e.preventDefault());
    document.addEventListener('contextmenu', e => e.preventDefault());
}

function setConnectionState(state, message = '') {
    connectionState = state;
    const connected = state === 'connected';
    document.getElementById('body').classList.toggle('connected', connected);
    document.getElementById('connection-banner').classList.toggle('connected', connected);
    const titles = {connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline', disabled: 'Not connected'};
    const descriptions = {connected: 'Controlling session playback', connecting: 'Finding the TV session', reconnecting: 'Playback controls will return when connected', offline: 'Scan the current QR code on the TV to pair again', disabled: 'Select Connect to pair with the screen'};
    const text = document.getElementById('connection-text');
    text.innerHTML = `<strong>${titles[state]}</strong><small>${message || descriptions[state]}</small>`;
    document.querySelectorAll('#content-area .control-btn, #content-area .quick-btn').forEach(button => {
        button.disabled = !connected;
    });
    const timeline = document.getElementById('seek-container');
    if (timeline) {
        timeline.style.pointerEvents = connected ? '' : 'none';
        timeline.setAttribute('aria-disabled', String(!connected));
    }
    const pill = document.querySelector('.status-pill span');
    if (pill) pill.textContent = connected ? 'Live' : titles[state];
}

function showError(title, message) {
    setConnectionState('offline');
    if (seekControlsCleanup) seekControlsCleanup();
    document.getElementById('content-area').innerHTML = `
        <div class="error-state">
            <div class="error-icon">⚠️</div>
            <div class="error-title">${title}</div>
            <div class="error-message">${message}</div>
            <button class="retry-btn" onclick="retryConnection()">Retry Connection</button>
        </div>
    `;
}

function haptic() {
    if (navigator.vibrate) navigator.vibrate(10);
}

function sendCommand(type, value = null) {
    if (connectionState !== 'connected' || !conn?.open) return false;
    try {
        conn.send({type, value});
        haptic();
        return true;
    } catch (_) {
        scheduleRemoteReconnect();
        return false;
    }
}

function handleQuickSeek(seconds) {
    const newTime = Math.max(0, Math.min(currentTime + seconds, currentDuration));
    currentTime = newTime;

    updateSeekUI();
    sendCommand('SEEK', currentTime);

    isSeeking = true;
    setTimeout(() => isSeeking = false, 500);
}

function updateSeekUI() {
    const percentage = currentDuration > 0 ? (currentTime / currentDuration) * 100 : 0;
    const thumb = document.getElementById('seek-thumb');
    const progress = document.getElementById('seek-progress');

    if (thumb) thumb.style.left = `${percentage}%`;
    if (progress) progress.style.width = `${percentage}%`;

    const currentEl = document.getElementById('current-time');
    if (currentEl) currentEl.textContent = formatTime(currentTime);
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showConnectedUI() {
    if (seekControlsCleanup) seekControlsCleanup();
    document.getElementById('body').classList.add('connected');
    document.getElementById('connection-banner').classList.add('connected');
    document.getElementById('connection-text').innerHTML = `
        <strong>Connected</strong>
        <small>Controlling session playback</small>
    `;

    document.getElementById('content-area').innerHTML = `
        <div class="header">
            <h1>Kart Remote</h1>
            <div class="status-pill">
                <div class="status-pill-dot"></div>
                <span>Live</span>
            </div>
        </div>

        <div class="stats-section">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Current Lap</div>
                    <div id="cur-lap" class="stat-value">—</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Laps</div>
                    <div id="total-laps" class="stat-value">—</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Last Lap</div>
                    <div id="last-lap-time" class="stat-value">—:—</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Fastest</div>
                    <div id="fastest-lap-time" class="stat-value">—:—</div>
                </div>
            </div>
        </div>

        <div class="control-section">
            <div class="section-header">Playback</div>
            <div class="playback-grid">
                <button class="control-btn" onclick="sendCommand('PREV_LAP')">
                    <span class="btn-icon">⏮️</span>
                    <span class="btn-label">Previous</span>
                </button>
                <button id="play-pause-btn" class="control-btn primary" onclick="sendCommand('PLAY_PAUSE')">
                    <span class="btn-icon" id="play-icon">⏸️</span>
                    <span class="btn-label" id="play-label">Pause</span>
                </button>
                <button class="control-btn" onclick="sendCommand('NEXT_LAP')">
                    <span class="btn-icon">⏭️</span>
                    <span class="btn-label">Next</span>
                </button>
            </div>
            <div class="quick-actions">
                <button class="quick-btn" onclick="handleQuickSeek(-10)">⏪ 10s</button>
                <button class="quick-btn" onclick="handleQuickSeek(10)">10s ⏩</button>
            </div>
        </div>

        <div class="control-section">
            <div class="section-header">Timeline</div>
            <div class="seek-wrapper">
                <div class="time-display">
                    <div id="current-time" class="time-current">0:00</div>
                    <div id="total-time" class="time-total">0:00</div>
                </div>
                <div class="seek-container" id="seek-container">
                    <div class="seek-track">
                        <div class="seek-progress" id="seek-progress"></div>
                    </div>
                    <div class="seek-thumb" id="seek-thumb"></div>
                </div>
            </div>
        </div>
    `;

    setupSeekControls();
    setConnectionState('connected');
}

function setupSeekControls() {
    const container = document.getElementById('seek-container');
    if (!container) return;
    let pointerId = null;
    const updatePosition = clientX => {
        if (!currentDuration) return;
        const rect = container.getBoundingClientRect();
        if (!rect.width) return;
        currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * currentDuration;
        updateSeekUI();
    };
    const start = event => {
        if (connectionState !== 'connected' || !currentDuration || pointerId !== null) return;
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        pointerId = event.pointerId;
        isSeeking = true;
        container.setPointerCapture?.(pointerId);
        updatePosition(event.clientX);
    };
    const move = event => {
        if (event.pointerId === pointerId) updatePosition(event.clientX);
    };
    const finish = event => {
        if (event.pointerId !== pointerId) return;
        const canceled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
        const releasedId = pointerId;
        pointerId = null;
        isSeeking = false;
        if (container.hasPointerCapture?.(releasedId)) container.releasePointerCapture(releasedId);
        if (!canceled) sendCommand('SEEK', currentTime);
    };
    container.style.touchAction = 'pan-y';
    container.addEventListener('pointerdown', start);
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', finish);
    container.addEventListener('lostpointercapture', finish);
    seekControlsCleanup = () => {
        pointerId = null;
        isSeeking = false;
        container.removeEventListener('pointerdown', start);
        container.removeEventListener('pointermove', move);
        container.removeEventListener('pointerup', finish);
        container.removeEventListener('pointercancel', finish);
        container.removeEventListener('lostpointercapture', finish);
        seekControlsCleanup = null;
    };
}

function cleanupRemoteConnection() {
    clearTimeout(reconnectTimer);
    clearTimeout(connectionTimer);
    clearInterval(heartbeatTimer);
    reconnectTimer = connectionTimer = heartbeatTimer = null;
    const oldConnection = conn;
    const oldPeer = peer;
    conn = peer = null;
    isSeeking = false;
    if (oldConnection) {
        oldConnection.removeAllListeners?.();
        try { oldConnection.close(); } catch (_) { /* Already closed. */ }
    }
    if (oldPeer) {
        oldPeer.removeAllListeners?.();
        try { oldPeer.destroy(); } catch (_) { /* Already destroyed. */ }
    }
}

function scheduleRemoteReconnect(message = 'The TV connection was interrupted.') {
    if (!remoteAllowed || reconnectTimer) return;
    cleanupRemoteConnection();
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showError('TV unavailable', `${message} Scan the current QR code on the TV, or retry when it is ready.`);
        return;
    }
    reconnectAttempts++;
    setConnectionState('reconnecting');
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        setupPeerConnection();
    }, Math.min(1000 * 2 ** (reconnectAttempts - 1), 5000));
}

function retryConnection() {
    if (!remoteAllowed) { showRemotePermission(); return; }
    if (!hostId) {
        showError('No Connection ID', 'Scan the QR code on the TV to connect.');
        return;
    }
    reconnectAttempts = 0;
    setupPeerConnection();
}

function setupPeerConnection() {
    if (!remoteAllowed) return;
    cleanupRemoteConnection();
    setConnectionState(reconnectAttempts ? 'reconnecting' : 'connecting');
    if (typeof Peer !== 'function') {
        showError('Connection unavailable', 'Reload this page to load the connection service, then scan the QR code again.');
        return;
    }
    const instance = new Peer();
    peer = instance;
    connectionTimer = setTimeout(() => {
        if (peer === instance && !conn?.open) scheduleRemoteReconnect('The TV did not answer.');
    }, 10000);
    instance.on('open', () => {
        if (peer !== instance) return;
        try {
            conn = instance.connect(hostId, {reliable: true, serialization: 'json'});
            setupConnectionListeners(conn, instance);
        } catch (_) {
            scheduleRemoteReconnect();
        }
    });
    instance.on('error', err => {
        if (peer !== instance) return;
        scheduleRemoteReconnect(err.type === 'peer-unavailable' ? 'The pairing code is no longer available.' : 'The connection service could not be reached.');
    });
    instance.on('disconnected', () => {
        if (peer === instance) scheduleRemoteReconnect();
    });
    instance.on('close', () => {
        if (peer === instance) scheduleRemoteReconnect();
    });
}

function setupConnectionListeners(channel, instance) {
    channel.on('open', () => {
        if (conn !== channel || peer !== instance) return;
        clearTimeout(connectionTimer);
        connectionTimer = null;
        reconnectAttempts = 0;
        lastStatsAt = Date.now();
        showConnectedUI();
        heartbeatTimer = setInterval(() => {
            if (document.visibilityState !== 'hidden' && conn === channel && Date.now() - lastStatsAt > 10000) {
                scheduleRemoteReconnect();
            }
        }, 1000);
    });
    channel.on('data', data => {
        if (conn !== channel || !channel.open || !data || data.type !== 'STATS') return;
        lastStatsAt = Date.now();
        updateStats(data);
    });
    channel.on('close', () => {
        if (conn === channel) scheduleRemoteReconnect();
    });
    channel.on('error', () => {
        if (conn === channel) scheduleRemoteReconnect();
    });
}

function updateStats(data) {
    const elements = {
        'cur-lap': data.lap || '—',
        'total-laps': data.totalLaps || '—',
        'last-lap-time': data.time || '—:—',
        'fastest-lap-time': data.fastestLap || '—:—'
    };

    for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    const playIcon = document.getElementById('play-icon');
    const playLabel = document.getElementById('play-label');
    if (playIcon) playIcon.textContent = data.isPlaying ? '⏸️' : '▶️';
    if (playLabel) playLabel.textContent = data.isPlaying ? 'Pause' : 'Play';

    if (!isSeeking && data.duration > 0) {
        currentDuration = data.duration;
        currentTime = data.currentTime || 0;

        const totalEl = document.getElementById('total-time');
        if (totalEl) totalEl.textContent = formatTime(currentDuration);

        updateSeekUI();
    }
}

window.addEventListener('DOMContentLoaded', init);
document.addEventListener('visibilitychange', () => {
    // A suspended phone may resume before queued stats arrive. Give an open
    // channel a fresh grace period rather than replacing a healthy connection.
    if (document.visibilityState === 'visible' && conn?.open) lastStatsAt = Date.now();
});
window.addEventListener('pagehide', cleanupRemoteConnection);
window.addEventListener('pageshow', event => {
    if (event.persisted && hostId && remoteAllowed) retryConnection();
});
