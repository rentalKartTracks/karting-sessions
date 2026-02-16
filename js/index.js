let allSessions = [];
let filteredSessions = [];
let currentSort = 'date';
let uniqueTracks = new Set();
let uniqueConfigs = new Set();
let trackConfigsMap = new Map();
let personalBests = {};
let trackBests = {};
let isLoading = true;

// Pagination and virtual scrolling
const SESSIONS_PER_PAGE = 50;
let currentPage = 1;
let totalPages = 1;

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function showSkeletonLoading() {
  const loader = document.getElementById('skeleton-loader');
  const skeletonHTML = Array(6).fill().map(() => `
    <div class="skeleton-card">
      <div class="skeleton-header">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-date"></div>
      </div>
      <div class="skeleton skeleton-stat"></div>
      <div class="skeleton skeleton-stat"></div>
      <div class="skeleton skeleton-stat"></div>
      <div class="skeleton skeleton-stat"></div>
      <div class="skeleton skeleton-stat"></div>
      <div class="skeleton skeleton-button"></div>
    </div>
  `).join('');
  loader.innerHTML = skeletonHTML;
}

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    search: params.get('search') || '',
    track: params.get('track') || '',
    config: params.get('config') || '',
    dateFilter: params.get('date') || 'all',
    dateFrom: params.get('from') || '',
    dateTo: params.get('to') || '',
    sort: params.get('sort') || 'date'
  };
}

function updateUrlParams() {
  const params = new URLSearchParams();
  const search = document.getElementById('search-input').value;
  const track = document.getElementById('track-filter').value;
  const config = document.getElementById('config-filter').value;
  const dateFilter = document.getElementById('date-filter').value;
  const dateFrom = document.getElementById('date-from').value;
  const dateTo = document.getElementById('date-to').value;

  if (search) params.set('search', search);
  if (track) params.set('track', track);
  if (config) params.set('config', config);
  if (dateFilter !== 'all') params.set('date', dateFilter);
  if (dateFilter === 'custom' && dateFrom) params.set('from', dateFrom);
  if (dateFilter === 'custom' && dateTo) params.set('to', dateTo);
  if (currentSort !== 'date') params.set('sort', currentSort);

  const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
  window.history.replaceState({}, '', newUrl);
}

function applyUrlParams() {
  const params = getUrlParams();
  document.getElementById('search-input').value = params.search;
  document.getElementById('track-filter').value = params.track;
  updateConfigFilter();
  document.getElementById('config-filter').value = params.config;
  document.getElementById('date-filter').value = params.dateFilter;
  document.getElementById('date-from').value = params.dateFrom;
  document.getElementById('date-to').value = params.dateTo;
  currentSort = params.sort;
  updateDateFilterVisibility();
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === currentSort);
  });
}

function resetFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('track-filter').value = '';
  updateConfigFilter();
  document.getElementById('config-filter').value = '';
  document.getElementById('date-filter').value = 'all';

  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const defaultFrom = monthAgo.toISOString().split('T')[0];

  document.getElementById('date-from').value = defaultFrom;
  document.getElementById('date-to').value = today;
  currentSort = 'date';

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === 'date');
  });

  updateDateFilterVisibility();
  filterSessions();
  updateUrlParams();
}

async function loadAllSessions() {
  const container = document.getElementById('sessions-container');
  showSkeletonLoading();

  try {
    const listResponse = await fetch('sessions/sessions-list.json');

    if (!listResponse.ok) {
      throw new Error(`Failed to load sessions: ${listResponse.statusText}`);
    }

    const sessionList = await listResponse.json();

    if (!sessionList || !Array.isArray(sessionList.sessions)) {
      throw new Error('Invalid session data format');
    }

    // Show processing message for large datasets
    if (sessionList.sessions.length > 200) {
      container.innerHTML = `<div class="loading">📊 Processing ${sessionList.sessions.length} sessions...</div>`;
    }

    allSessions = sessionList.sessions.map(session => ({
      id: session.id,
      driver: session.driver,
      track_name: session.track?.name || 'N/A',
      track_config: session.track?.configuration || 'N/A',
      session_date: session.session_date,
      fastest_lap: session.fastest_lap,
      kart: session.kart,
      laps_count: session.laps_count,
      average_lap: session.average_lap
    }));

    if (allSessions.length === 0) {
      container.innerHTML = '<div class="no-results">No sessions found. Start tracking your performance!</div>';
      isLoading = false;
      return;
    }

    // Use requestIdleCallback for non-blocking processing
    if (window.requestIdleCallback) {
      requestIdleCallback(() => {
        processSessionData();
      }, { timeout: 2000 });
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(() => processSessionData(), 0);
    }

  } catch (error) {
    container.innerHTML = `
      <div class="error">
        <strong>⚠️ Error Loading Sessions</strong><br>
        ${error.message}<br>
        <small>Please check that sessions/sessions-list.json is accessible and properly formatted.</small>
      </div>
    `;
    isLoading = false;
  }
}

function processSessionData() {
  // Extract unique values
  allSessions.forEach(session => {
    uniqueTracks.add(session.track_name);
    uniqueConfigs.add(session.track_config);

    if (!trackConfigsMap.has(session.track_name)) {
      trackConfigsMap.set(session.track_name, new Set());
    }
    trackConfigsMap.get(session.track_name).add(session.track_config);
  });

  calculatePersonalBests();
  calculateTrends();
  populateFilters();
  filteredSessions = [...allSessions];
  applyUrlParams();
  filterSessions();
  isLoading = false;
}

function parseTime(timeStr) {
  if (timeStr === null || timeStr === undefined || timeStr === "") return Infinity;
  if (typeof timeStr === 'number') return timeStr;
  const parts = timeStr.toString().split(':');
  if (parts.length === 2) {
    return (parseInt(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(timeStr) || Infinity;
}

function formatTime(seconds) {
  if (seconds === Infinity || isNaN(seconds)) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return mins > 0 ? `${mins}:${secs.padStart(6, '0')}` : `${secs}s`;
}

function calculatePersonalBests() {
  personalBests = {};
  trackBests = {};

  allSessions.forEach(session => {
    const key = `${session.track_name}_${session.track_config}`;
    const lapTime = parseTime(session.fastest_lap);
    const driverKey = `${session.driver}_${key}`;

    // Personal best per driver per track
    if (!personalBests[driverKey] || lapTime < personalBests[driverKey].time) {
      personalBests[driverKey] = {
        time: lapTime,
        sessionId: session.id
      };
    }

    // Track best (fastest across all drivers)
    if (!trackBests[key] || lapTime < trackBests[key].time) {
      trackBests[key] = {
        time: lapTime,
        sessionId: session.id
      };
    }
  });
}

function calculateTrends() {
  // Create index for faster lookups
  const sessionsByDriver = new Map();

  allSessions.forEach(session => {
    const key = `${session.driver}_${session.track_name}_${session.track_config}`;
    if (!sessionsByDriver.has(key)) {
      sessionsByDriver.set(key, []);
    }
    sessionsByDriver.get(key).push(session);
  });

  // Sort each group by date
  sessionsByDriver.forEach(sessions => {
    sessions.sort((a, b) => new Date(a.session_date) - new Date(b.session_date));
  });

  // Calculate trends for each session
  sessionsByDriver.forEach(sessions => {
    sessions.forEach((session, index) => {
      if (index < 2) return; // Need at least 2 previous sessions

      const recentSessions = sessions.slice(Math.max(0, index - 3), index);
      if (recentSessions.length >= 2) {
        const currentTime = parseTime(session.fastest_lap);
        const avgPrevious = recentSessions.reduce((sum, s) =>
          sum + parseTime(s.fastest_lap), 0) / recentSessions.length;

        const improvement = ((avgPrevious - currentTime) / avgPrevious) * 100;

        if (improvement > 1) {
          session.trend = 'improving';
          session.trendValue = improvement.toFixed(1);
        } else if (improvement < -1) {
          session.trend = 'declining';
          session.trendValue = Math.abs(improvement).toFixed(1);
        } else {
          session.trend = 'stable';
        }
      }
    });
  });
}

function updateConfigFilter() {
  const trackFilter = document.getElementById('track-filter');
  const configFilter = document.getElementById('config-filter');
  const selectedTrack = trackFilter.value;
  const currentConfig = configFilter.value;

  configFilter.innerHTML = '<option value="">All Configurations</option>';

  let configsToShow = uniqueConfigs;
  if (selectedTrack && trackConfigsMap.has(selectedTrack)) {
    configsToShow = trackConfigsMap.get(selectedTrack);
  }

  Array.from(configsToShow).sort().forEach(config => {
    const option = document.createElement('option');
    option.value = config;
    option.textContent = config;
    configFilter.appendChild(option);
  });

  if (currentConfig && configsToShow.has(currentConfig)) {
    configFilter.value = currentConfig;
  } else {
    configFilter.value = '';
  }
}

function populateFilters() {
  const trackFilter = document.getElementById('track-filter');

  Array.from(uniqueTracks).sort().forEach(track => {
    const option = document.createElement('option');
    option.value = track;
    option.textContent = track;
    trackFilter.appendChild(option);
  });

  updateConfigFilter();
}

function updateFilteredSummaryStats() {
  const sessionsToUse = filteredSessions;
  const totalSessions = sessionsToUse.length;
  const totalLaps = sessionsToUse.reduce((sum, s) => sum + (s.laps_count || 0), 0);

  const allFastestLaps = sessionsToUse
    .map(s => parseTime(s.fastest_lap))
    .filter(t => t !== Infinity);

  const bestLapEver = allFastestLaps.length > 0 ? Math.min(...allFastestLaps) : null;
  const uniqueTrackNames = new Set(sessionsToUse.map(s => s.track_name).filter(n => n && n !== 'N/A'));

  document.getElementById('filtered-sessions-count').textContent = totalSessions;
  document.getElementById('filtered-total-laps').textContent = totalLaps;
  document.getElementById('filtered-tracks-count').textContent = uniqueTrackNames.size;
  document.getElementById('filtered-best-lap').textContent = bestLapEver !== null ? formatTime(bestLapEver) : '-';
}

function renderSessions() {
  const container = document.getElementById('sessions-container');

  if (filteredSessions.length === 0) {
    container.innerHTML = '<div class="no-results">No sessions match your filters. Try adjusting your search criteria.</div>';
    return;
  }

  // Calculate pagination
  totalPages = Math.ceil(filteredSessions.length / SESSIONS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * SESSIONS_PER_PAGE;
  const endIdx = Math.min(startIdx + SESSIONS_PER_PAGE, filteredSessions.length);
  const sessionsToRender = filteredSessions.slice(startIdx, endIdx);

  const html = sessionsToRender.map(session => {
    const fastestTime = session.fastest_lap || '-';
    const averageTime = session.average_lap || '-';
    const lapsCount = session.laps_count || 0;

    const key = `${session.track_name}_${session.track_config}`;
    const driverKey = `${session.driver}_${key}`;
    const isPB = personalBests[driverKey]?.sessionId === session.id;
    const isTrackPB = trackBests[key]?.sessionId === session.id;

    let badgesHTML = '';
    if (isPB || isTrackPB) {
      badgesHTML = '<div class="badge-container">';
      if (isPB) {
        badgesHTML += '<span class="badge pb-badge" title="Your personal best on this track">⭐ PB</span>';
      }
      if (isTrackPB) {
        badgesHTML += '<span class="badge track-pb-badge" title="Fastest lap ever on this track">🎯 Track PB</span>';
      }
      badgesHTML += '</div>';
    }

    let trendHTML = '';
    if (session.trend) {
      const trendClass = `trend-${session.trend}`;
      const trendIcon = session.trend === 'improving' ? '📈' :
        session.trend === 'declining' ? '📉' : '➡️';
      const trendText = session.trend === 'improving' ? `${session.trendValue}% faster` :
        session.trend === 'declining' ? `${session.trendValue}% slower` : 'Stable';
      trendHTML = `<div class="trend-indicator ${trendClass}">${trendIcon} ${trendText}</div>`;
    }

    return `
      <div class="session-card" onclick="viewSession('${session.id}')">
        ${badgesHTML}
        <div class="session-header">
          <div>
            <div class="driver-name">${session.driver}</div>
            ${trendHTML}
          </div>
          <div class="session-date">${new Date(session.session_date).toLocaleDateString()}</div>
        </div>
        
        <div class="session-stats">
          <div class="session-stat">
            <span class="stat-name">Track</span>
            <span class="stat-val">${session.track_name} (${session.track_config})</span>
          </div>
          <div class="session-stat">
            <span class="stat-name">Kart</span>
            <span class="stat-val">${session.kart || '-'}</span>
          </div>
          <div class="session-stat">
            <span class="stat-name">Fastest Lap</span>
            <span class="stat-val">🏆 ${fastestTime}</span>
          </div>
          <div class="session-stat">
            <span class="stat-name">Average</span>
            <span class="stat-val">${averageTime}</span>
          </div>
          <div class="session-stat">
            <span class="stat-name">Laps</span>
            <span class="stat-val">${lapsCount}</span>
          </div>
        </div>
        
        <button class="view-btn">View Full Telemetry →</button>
      </div>
    `;
  }).join('');

  // Pagination controls
  let paginationHTML = '';
  if (totalPages > 1) {
    paginationHTML = `
      <div class="pagination">
        <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(1)">⏮️ First</button>
        <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">⬅️ Prev</button>
        <span class="pagination-info">Page ${currentPage} of ${totalPages} (${filteredSessions.length} sessions)</span>
        <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">Next ➡️</button>
        <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${totalPages})">Last ⏭️</button>
      </div>
    `;
  }

  container.innerHTML = `<div class="sessions-grid">${html}</div>${paginationHTML}`;

  // Scroll to top when page changes
  if (currentPage > 1) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  updateFilteredSummaryStats();
}

function goToPage(page) {
  currentPage = page;
  renderSessions();
}

function viewSession(sessionId) {
  window.location.href = `session.html?id=${sessionId}&mode=pc`;
}

function sortSessions(criteria) {
  currentSort = criteria;
  filteredSessions.sort((a, b) => {
    let diff = 0;
    if (criteria === 'date') {
      diff = new Date(b.session_date) - new Date(a.session_date);
    } else {
      const timeA = parseTime(a.fastest_lap);
      const timeB = parseTime(b.fastest_lap);
      diff = timeA - timeB;
    }
    return diff || (new Date(b.session_date) - new Date(a.session_date));
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === currentSort);
  });

  renderSessions();
}

function filterSessions() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const selectedTrack = document.getElementById('track-filter').value;
  const selectedConfig = document.getElementById('config-filter').value;
  const dateFilter = document.getElementById('date-filter').value;

  filteredSessions = allSessions.filter(session => {
    const kart = (session.kart || '').toLowerCase();
    if (searchTerm &&
      !session.driver.toLowerCase().includes(searchTerm) &&
      !session.track_name.toLowerCase().includes(searchTerm) &&
      !kart.includes(searchTerm)) {
      return false;
    }

    if (selectedTrack && session.track_name !== selectedTrack) {
      return false;
    }

    if (selectedConfig && session.track_config !== selectedConfig) {
      return false;
    }

    const sessionDate = new Date(session.session_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dateFilter === 'today') {
      const sessionDay = new Date(sessionDate);
      sessionDay.setHours(0, 0, 0, 0);
      if (sessionDay.getTime() !== today.getTime()) return false;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      if (sessionDate < weekAgo) return false;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      if (sessionDate < monthAgo) return false;
    } else if (dateFilter === 'custom') {
      const dateFrom = document.getElementById('date-from').value;
      const dateTo = document.getElementById('date-to').value;

      if (dateFrom && new Date(session.session_date) < new Date(dateFrom)) return false;
      if (dateTo) {
        const dateToMax = new Date(dateTo);
        dateToMax.setDate(dateToMax.getDate() + 1);
        if (new Date(session.session_date) >= dateToMax) return false;
      }
    }

    return true;
  });

  // Reset to page 1 when filters change
  currentPage = 1;
  sortSessions(currentSort);
}

function updateDateFilterVisibility() {
  const dateFilter = document.getElementById('date-filter').value;
  const customRange = document.getElementById('custom-date-range');

  if (dateFilter === 'custom') {
    customRange.style.display = 'flex';
  } else {
    customRange.style.display = 'none';
  }
}

const debouncedFilter = debounce(() => {
  filterSessions();
  updateUrlParams();
}, 300);

document.getElementById('search-input').addEventListener('input', debouncedFilter);

document.getElementById('track-filter').addEventListener('change', () => {
  updateConfigFilter();
  filterSessions();
  updateUrlParams();
});

document.getElementById('config-filter').addEventListener('change', () => {
  filterSessions();
  updateUrlParams();
});

document.getElementById('date-filter').addEventListener('change', function () {
  updateDateFilterVisibility();
  filterSessions();
  updateUrlParams();
});

document.getElementById('date-from').addEventListener('change', () => {
  filterSessions();
  updateUrlParams();
});

document.getElementById('date-to').addEventListener('change', () => {
  filterSessions();
  updateUrlParams();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    sortSessions(e.target.dataset.sort);
    updateUrlParams();
  });
});

document.getElementById('reset-filters').addEventListener('click', resetFilters);

// Legend overlay handlers
document.getElementById('info-button').addEventListener('click', () => {
  document.getElementById('legend-overlay').classList.add('active');
});

document.getElementById('close-legend').addEventListener('click', () => {
  document.getElementById('legend-overlay').classList.remove('active');
});

document.getElementById('legend-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'legend-overlay') {
    document.getElementById('legend-overlay').classList.remove('active');
  }
});

// Close legend with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('legend-overlay').classList.remove('active');
  }
});

const today = new Date().toISOString().split('T')[0];
const monthAgo = new Date();
monthAgo.setDate(monthAgo.getDate() - 30);
const defaultFrom = monthAgo.toISOString().split('T')[0];

document.getElementById('date-from').value = defaultFrom;
document.getElementById('date-to').value = today;
document.getElementById('date-from').max = today;
document.getElementById('date-to').max = today;
document.getElementById('date-to').min = '2020-01-01';
document.getElementById('date-from').min = '2020-01-01';

loadAllSessions();
