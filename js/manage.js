document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('session-form');
    const sessionIdDisplay = document.getElementById('session-id-display');
    const lapsContainer = document.getElementById('laps-container');
    const bulkImportBtn = document.getElementById('bulk-import-btn');
    const bulkContainer = document.getElementById('bulk-import-container');
    const bulkTextarea = document.getElementById('bulk-laps');
    const processBulkBtn = document.getElementById('process-bulk-btn');
    const cancelBulkBtn = document.getElementById('cancel-bulk-btn');
    const addLapBtn = document.getElementById('add-lap-btn');
    const resetBtn = document.getElementById('reset-btn');

    let laps = [];
    let sessionId = crypto.randomUUID();

    // Initialize
    init();

    function init() {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('id');

        if (id) {
            loadSession(id);
        } else {
            // New session defaults
            document.getElementById('session_date').valueAsDate = new Date();
            sessionIdDisplay.textContent = sessionId;
        }
    }

    async function loadSession(id) {
        try {
            const response = await fetch(`sessions/${id}.json`);
            if (!response.ok) throw new Error('Session not found');

            const data = await response.json();
            populateForm(data);
        } catch (error) {
            console.error(error);
            alert('Error loading session: ' + error.message);
        }
    }

    function populateForm(data) {
        sessionId = data.session_id;
        sessionIdDisplay.textContent = sessionId;

        document.getElementById('driver').value = data.driver;
        document.getElementById('session_date').value = data.session_date;
        document.getElementById('kart').value = data.kart || '';
        document.getElementById('track_name').value = data.track.name;
        document.getElementById('track_config').value = data.track.configuration;
        document.getElementById('maps_link').value = data.track.maps_link || '';
        document.getElementById('video_url').value = data.video_url || '';
        document.getElementById('video_start_time').value = data.video_start_time || '';

        laps = data.laps.map(l => ({ ...l }));
        renderLaps();
    }

    // --- Bulk Import Logic ---
    bulkImportBtn.addEventListener('click', () => {
        bulkContainer.classList.remove('hidden');
        bulkTextarea.focus();
    });

    cancelBulkBtn.addEventListener('click', () => {
        bulkContainer.classList.add('hidden');
        bulkTextarea.value = '';
    });

    processBulkBtn.addEventListener('click', () => {
        const text = bulkTextarea.value;
        if (!text.trim()) return;

        const lines = text.split(/\n/);
        const newLaps = [];

        lines.forEach((line, index) => {
            const cleanLine = line.trim();
            if (!cleanLine) return;

            // Try to extract time. Matches: "1:23.456", "1:23", "45.678" or just "45"
            const timeMatch = cleanLine.match(/(\d{1,2}:\d{2}(\.\d*)?|\d{1,2}(\.\d*)?)/);

            if (timeMatch) {
                let time = timeMatch[0];

                // If it's a raw number without colon (e.g. "45.123" or "45"), treat as seconds
                if (!time.includes(':')) {
                    // Check if it's potentially minutes (e.g. "70.5") -> "01:10.500" logic is complex, 
                    // assumes seconds < 60 usually, but lets just format as 00:SS.mmm
                    // Ensure it has decimal part for consistency
                    if (!time.includes('.')) time += '.000';
                    else if (time.split('.')[1].length < 3) time = time.padEnd(time.indexOf('.') + 4, '0');

                    if (parseFloat(time) < 60) {
                        time = `00:${time.padStart(6, '0')}`;
                    } else {
                        // Convert >60s to M:SS
                        const totalSec = parseFloat(time);
                        const mins = Math.floor(totalSec / 60);
                        const secs = (totalSec % 60).toFixed(3);
                        time = `${mins}:${secs.padStart(6, '0')}`;
                    }
                } else {
                    // It has a colon. Ensure 3 decimal places.
                    const parts = time.split(':');
                    const mins = parts[0].padStart(2, '0');
                    let secs = parts[1];
                    if (!secs.includes('.')) secs += '.000';
                    else if (secs.split('.')[1].length < 3) secs = secs.padEnd(secs.indexOf('.') + 4, '0');
                    time = `${mins}:${secs}`;
                }

                newLaps.push({
                    lap: laps.length + newLaps.length + 1,
                    time: time
                });
            }
        });

        if (newLaps.length > 0) {
            laps = [...laps, ...newLaps];
            renderLaps();
            bulkContainer.classList.add('hidden');
            bulkTextarea.value = '';
        } else {
            alert('No valid lap times found. Please check format.');
        }
    });

    // --- Lap Management ---
    addLapBtn.addEventListener('click', () => {
        laps.push({
            lap: laps.length + 1,
            time: ''
        });
        renderLaps();
    });

    window.removeLap = (index) => {
        laps.splice(index, 1);
        // Re-index laps
        laps.forEach((lap, i) => lap.lap = i + 1);
        renderLaps();
    };

    window.updateLapTime = (index, value) => {
        laps[index].time = value;
    };

    function renderLaps() {
        lapsContainer.innerHTML = '';
        laps.forEach((lap, index) => {
            const lapDiv = document.createElement('div');
            lapDiv.className = 'lap-item';
            lapDiv.innerHTML = `
                <span class="lap-number">#${lap.lap}</span>
                <input type="text" 
                    class="lap-time-input" 
                    value="${lap.time}" 
                    placeholder="00:00.000"
                    onchange="updateLapTime(${index}, this.value)"
                >
                <button type="button" class="lap-remove-btn" onclick="removeLap(${index})" title="Remove Lap">✕</button>
            `;
            lapsContainer.appendChild(lapDiv);
        });
    }

    // --- Form Submission ---
    resetBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the form?')) {
            form.reset();
            laps = [];
            renderLaps();
            sessionId = crypto.randomUUID();
            sessionIdDisplay.textContent = sessionId;
            document.getElementById('session_date').valueAsDate = new Date();
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveSession();
    });

    function saveSession() {
        // Validation
        if (laps.length === 0) {
            alert('Please add at least one lap.');
            return;
        }

        // Calculate Fastest Lap
        let fastestTime = Infinity;
        let fastestLapStr = '';

        laps.forEach(l => {
            const time = parseTime(l.time);
            if (time < fastestTime) {
                fastestTime = time;
                fastestLapStr = l.time;
            }
        });

        const sessionData = {
            session_id: sessionId,
            driver: document.getElementById('driver').value,
            fastest_lap: fastestLapStr,
            track: {
                name: document.getElementById('track_name').value,
                configuration: document.getElementById('track_config').value,
                maps_link: document.getElementById('maps_link').value
            },
            kart: document.getElementById('kart').value,
            video_start_time: document.getElementById('video_start_time').value,
            video_url: document.getElementById('video_url').value,
            session_date: document.getElementById('session_date').value,
            laps: laps
        };

        const jsonString = JSON.stringify(sessionData, null, 2);
        const fileName = `${sessionId}.json`;

        // Trigger Download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert(`Session JSON generated! \nPlease save this file to your 'sessions/' folder as: ${fileName}`);
    }

    // Helper: Parse MM:SS.mmm to seconds
    function parseTime(timeStr) {
        if (!timeStr) return Infinity;
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            return (parseInt(parts[0]) * 60) + parseFloat(parts[1]);
        }
        return parseFloat(timeStr) || Infinity;
    }
});
