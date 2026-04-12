document.addEventListener('DOMContentLoaded', function () {
  let currentMonth = new Date().getMonth();
  let currentYear  = new Date().getFullYear();

  renderCalendar(currentMonth, currentYear);

  // ── Month nav ────────────────────────────────────────────────────────────
  document.getElementById('prev-month').addEventListener('click', () => {
    if (--currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar(currentMonth, currentYear);
  });
  document.getElementById('next-month').addEventListener('click', () => {
    if (++currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar(currentMonth, currentYear);
  });

  // ── Filters ──────────────────────────────────────────────────────────────
  ['filter-type-video','filter-type-short',
   'filter-scheduled','filter-private','filter-public','filter-unlisted']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => renderCalendar(currentMonth, currentYear));
      }
    });

  // ── Nav buttons ───────────────────────────────────────────────────────────
  document.getElementById('btn-open-videos').addEventListener('click', () => {
    setStatus('Opening Videos page…');
    chrome.runtime.sendMessage({ action: 'getChannelId' }, ({ channelId }) =>
      chrome.runtime.sendMessage({ action: 'openVideosPage', channelId }));
  });
  document.getElementById('btn-open-shorts').addEventListener('click', () => {
    setStatus('Opening Shorts page…');
    chrome.runtime.sendMessage({ action: 'getChannelId' }, ({ channelId }) =>
      chrome.runtime.sendMessage({ action: 'openShortsPage', channelId }));
  });

  // ── Refresh ───────────────────────────────────────────────────────────────
  document.getElementById('btn-refresh').addEventListener('click', () => {
    setStatus('🧹 Clearing calendar data…');
    chrome.storage.local.remove(['scheduledVideos', 'scheduledShorts'], () => {
      setStatus('✅ Calendar cleared. Sync again from YouTube Studio.');
      renderCalendar(currentMonth, currentYear);
    });
  });

  // ── Calendar renderer ─────────────────────────────────────────────────────
  function renderCalendar(month, year) {
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    document.getElementById('current-month').textContent = `${MONTHS[month]} ${year}`;

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    DAYS.forEach(d => {
      const h = document.createElement('div');
      h.className = 'day-header';
      h.textContent = d;
      grid.appendChild(h);
    });

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    let offset = firstDay.getDay() - 1;
    if (offset < 0) offset = 6;

    for (let i = 0; i < offset; i++) {
      const e = document.createElement('div');
      e.className = 'day-cell';
      grid.appendChild(e);
    }

    chrome.storage.local.get(['scheduledVideos', 'scheduledShorts'], (data) => {
      const videos = (data.scheduledVideos || []).map(v => ({...v, contentType: v.contentType || 'video'}));
      const shorts = (data.scheduledShorts  || []).map(v => ({...v, contentType: v.contentType || 'short'}));
      const all = [...videos, ...shorts];

      const showVideos = document.getElementById('filter-type-video').checked;
      const showShorts = document.getElementById('filter-type-short').checked;
      const fSched     = document.getElementById('filter-scheduled').checked;
      const fPriv      = document.getElementById('filter-private').checked;
      const fPub       = document.getElementById('filter-public').checked;
      const fUnl       = document.getElementById('filter-unlisted').checked;

      const today = new Date();

      const allParsed = all.map(item => {
        let d = null;
        if (item.parsedDate) {
          d = new Date(item.parsedDate);
          if (isNaN(d.getTime())) d = null;
        }
        if (!d && item.date && item.date !== 'N/A') {
          d = tryParseDate(item.date);
        }
        return { ...item, _date: d };
      });

      const noDates = allParsed.filter(v => !v._date).length;
      let totalShown = 0;

      for (let day = 1; day <= lastDay.getDate(); day++) {
        const cell = document.createElement('div');
        cell.className = 'day-cell';

        if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear())
          cell.classList.add('current-day');

        const num = document.createElement('div');
        num.className = 'day-number';
        num.textContent = day;
        cell.appendChild(num);

        const list = document.createElement('div');
        list.className = 'video-list';
        cell.appendChild(list);

        const dayItems = allParsed.filter(item => {
          const d = item._date;
          if (!d) return false;
          if (d.getDate() !== day || d.getMonth() !== month || d.getFullYear() !== year) return false;

          if (item.contentType === 'short' && !showShorts) return false;
          if (item.contentType !== 'short' && !showVideos) return false;

          const s = (item.status || '').toLowerCase();
          if (s.includes('scheduled') && !fSched) return false;
          if (s.includes('private')   && !fPriv)  return false;
          if (s.includes('public')    && !fPub)   return false;
          if (s.includes('unlisted')  && !fUnl)   return false;

          return true;
        });

        if (dayItems.length > 0) {
          cell.classList.add('has-videos');
          dayItems.forEach(item => {
            totalShown++;
            const row = document.createElement('div');
            const s = (item.status || 'unknown').toLowerCase();
            const statusClass = s.includes('scheduled') ? 'status-scheduled'
                              : s.includes('private')   ? 'status-private'
                              : s.includes('public')    ? 'status-public'
                              : s.includes('unlisted')  ? 'status-unlisted'
                              : 'status-unknown';
            row.className = `video-item ${statusClass}`;

            const badge = document.createElement('span');
            badge.className = `type-badge ${item.contentType === 'short' ? 'badge-short' : 'badge-video'}`;
            badge.textContent = item.contentType === 'short' ? 'SHT' : 'VID';

            const link = document.createElement('a');
            link.className = 'video-title';
            link.textContent = item.title;
            link.href   = item.videoId
              ? `https://studio.youtube.com/video/${item.videoId}/edit`
              : 'https://studio.youtube.com/';
            link.target = '_blank';

            row.appendChild(badge);
            row.appendChild(link);
            list.appendChild(row);
          });
        }
        grid.appendChild(cell);
      }

      const vTotal = videos.length, sTotal = shorts.length;
      const vDated = videos.filter(v => v._date || (v.parsedDate && !isNaN(new Date(v.parsedDate).getTime()))).length;
      const sDated = shorts.filter(v => v._date || (v.parsedDate && !isNaN(new Date(v.parsedDate).getTime()))).length;

      let statusMsg = `${vTotal} videos (${vDated} dated) · ${sTotal} shorts (${sDated} dated) · ${totalShown} shown this month`;
      if (noDates > 0) statusMsg += ` · ⚠️ ${noDates} items missing dates`;
      setStatus(statusMsg);
    });
  }

  const MONTH_MAP = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,ene:1,"fév":2,avr:4,mai:5,juin:6,juil:7,"aoû":8,"août":8,"déc":12,"mär":3,okt:10,dez:12};

  function tryParseDate(raw) {
    if (!raw || typeof raw !== 'string' || raw.trim() === 'N/A') return null;
    
    // Some regions output e.g "25 Apr 2026 Scheduled" inside the same cell. We extract just the date part.
    // Clean newlines
    let s = raw.replace(/\n/g, ' ').trim();
    
    // Attempt to extract purely a date-like substring looking like "25 Apr 2026" or "Apr 25, 2026" or "2026-04-25"
    const datePattern = /(?:(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\s+(\d{4}))|(?:([A-Za-zÀ-ÿ]{3,})\s+(\d{1,2}),?\s+(\d{4}))|(?:(\d{4})-(\d{2})-(\d{2}))/i;
    const extracted = s.match(datePattern);
    
    if (extracted) {
       s = extracted[0];
    } else {
       // Fallback to original scrubbing if regex wasn't clean
       s = s.replace(/^(scheduled\s*(for)?|published\s*(on)?|premieres?\s*(on)?|private|unlisted|public|draft)\s*/i, '').trim();
       s = s.replace(/\s+(at\s+)?\d{1,2}:\d{2}(\s*(AM|PM))?/i, '').trim();
       // Also strip trailing status
       s = s.replace(/\s+(scheduled|published|premieres?|private|unlisted|public|draft)$/i, '').trim();
    }

    if (!s) return null;
    const now = new Date();

    let d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;

    const dmy = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s*(\d{4})?/);
    if (dmy) {
      const mon = MONTH_MAP[dmy[2].toLowerCase().slice(0,3)];
      if (mon) { d = new Date(dmy[3] ? +dmy[3] : now.getFullYear(), mon-1, +dmy[1]); if (!isNaN(d.getTime())) return d; }
    }
    const mdy = s.match(/^([A-Za-zÀ-ÿ]+)\s+(\d{1,2}),?\s*(\d{4})?/);
    if (mdy) {
      const mon = MONTH_MAP[mdy[1].toLowerCase().slice(0,3)];
      if (mon) { d = new Date(mdy[3] ? +mdy[3] : now.getFullYear(), mon-1, +mdy[2]); if (!isNaN(d.getTime())) return d; }
    }
    return null;
  }

  function setStatus(msg) {
    const el = document.getElementById('status-bar');
    if (el) el.textContent = msg;
  }
});