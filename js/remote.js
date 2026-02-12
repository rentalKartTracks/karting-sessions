const params = new URLSearchParams(window.location.search);
const hostId = params.get('host');
let peer = null;
let conn = null;
let isSeeking = false;
let currentDuration = 0;
let currentTime = 0;

function init() {
    if (!hostId) {
        showError('No Connection ID', 'Please scan the QR code again to connect.');
        return;
    }
    setupPeerConnection();
    preventDefaults();
}

function preventDefaults() {
    document.addEventListener('selectstart', e => e.preventDefault());
    document.addEventListener('contextmenu', e => e.preventDefault());
}

function showError(title, message) {
    document.getElementById('content-area').innerHTML = `
        <div class="error-state">
            <div class="error-icon">⚠️</div>
            <div class="error-title">${title}</div>
            <div class="error-message">${message}</div>
            <button class="retry-btn" onclick="location.reload()">Retry Connection</button>
        </div>
    `;
}

function haptic() {
    if (navigator.vibrate) navigator.vibrate(10);
}

function sendCommand(type, value = null) {
    haptic();
    if (conn?.open) {
        conn.send({ type, value });
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
}

function setupSeekControls() {
    const container = document.getElementById('seek-container');
    const thumb = document.getElementById('seek-thumb');
    const progress = document.getElementById('seek-progress');
    if (!container || !thumb || !progress) return;

    let isDragging = false;

    function updatePosition(clientX) {
        if (!container || currentDuration === 0) return;
        const rect = container.getBoundingClientRect();
        let x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const percentage = x / rect.width;

        thumb.style.left = `${percentage * 100}%`;
        progress.style.width = `${percentage * 100}%`;

        currentTime = percentage * currentDuration;
        document.getElementById('current-time').textContent = formatTime(currentTime);
    }

    function endSeek() {
        if (!isDragging) return;
        isDragging = false;
        isSeeking = false;
        sendCommand('SEEK', currentTime);
    }

    container.addEventListener('mousedown', e => {
        e.preventDefault();
        isDragging = true;
        isSeeking = true;
        updatePosition(e.clientX);
    });

    document.addEventListener('mousemove', e => {
        if (isDragging) updatePosition(e.clientX);
    });

    document.addEventListener('mouseup', endSeek);

    container.addEventListener('touchstart', e => {
        e.preventDefault();
        isDragging = true;
        isSeeking = true;
        updatePosition(e.touches[0].clientX);
    });

    document.addEventListener('touchmove', e => {
        if (isDragging) updatePosition(e.touches[0].clientX);
    });

    document.addEventListener('touchend', endSeek);
}

function setupPeerConnection() {
    peer = new Peer();

    peer.on('open', () => {
        conn = peer.connect(hostId, {
            reliable: true,
            serialization: 'json'
        });
        setupConnectionListeners();
    });

    peer.on('error', err => {
        showError('Connection Error', 'Unable to establish connection. Please try again.');
    });
}

function setupConnectionListeners() {
    conn.on('open', () => {
        showConnectedUI();
    });

    conn.on('data', data => {
        if (data.type === 'STATS') updateStats(data);
    });

    conn.on('close', () => {
        document.getElementById('body').classList.remove('connected');
        showError('Disconnected', 'Connection to session was lost.');
        setTimeout(() => {
            if (!conn?.open) location.reload();
        }, 5000);
    });

    conn.on('error', err => {
        // Connection error occurred
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
