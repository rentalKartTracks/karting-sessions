// YouTube Creator Calendar — content.js

function getContentType() {
  const url = window.location.href;
  return url.includes('/videos/short') ? 'short' : 'video';
}

function extractVideoId(url) {
  if (!url) return null;
  const match = url.match(/\/video\/([^\/\?]+)/) || url.match(/\/shorts\/([^\/\?]+)/) || url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

const MONTH_MAP = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  ene:1,"fév":2,avr:4,mai:5,juin:6,juil:7,"août":8,"déc":12,"mär":3,okt:10,dez:12
};

function parseDate(raw) {
  if (!raw || typeof raw !== 'string' || raw.trim() === 'N/A') return null;
  
  // Clean newlines
  let s = raw.replace(/\n/g, ' ').trim();
  
  // Attempt to extract purely a date-like substring looking like "25 Apr 2026" or "Apr 25, 2026" or "2026-04-25"
  const datePattern = /(?:(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\s+(\d{4}))|(?:([A-Za-zÀ-ÿ]{3,})\s+(\d{1,2}),?\s+(\d{4}))|(?:(\d{4})-(\d{2})-(\d{2}))/i;
  const extracted = s.match(datePattern);
  
  if (extracted) {
     s = extracted[0];
  } else {
    // Clean prefixes and times
    s = s.replace(/^(scheduled\s*(for)?|published\s*(on)?|premieres?\s*(on)?|private|unlisted|public|draft).*/i, (m, p1) => m.replace(p1, '')).trim();
    s = s.replace(/\s+(at\s+)?\d{1,2}:\d{2}(\s*(AM|PM))?/i, '').trim();
    // Strip trailing status
    s = s.replace(/\s+(scheduled|published|premieres?|private|unlisted|public|draft)$/i, '').trim();
  }
  
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  // Custom parser for specific locales dd Mon yyyy
  const match = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s*(\d{4})?/);
  if (match) {
    const mon = MONTH_MAP[match[2].toLowerCase().slice(0,3)];
    if (mon) {
      const year = match[3] ? +match[3] : new Date().getFullYear();
      return new Date(year, mon - 1, +match[1]).toISOString();
    }
  }
  
  // Custom parser Mon dd yyyy
  const mdy = s.match(/^([A-Za-zÀ-ÿ]+)\s+(\d{1,2}),?\s*(\d{4})?/);
  if (mdy) {
    const mon = MONTH_MAP[mdy[1].toLowerCase().slice(0,3)];
    if (mon) {
      const year = mdy[3] ? +mdy[3] : new Date().getFullYear();
      return new Date(year, mon - 1, +mdy[2]).toISOString();
    }
  }

  return null;
}

function extractVideoData() {
  const type = getContentType();
  
  // Resilient selectors based on modern YouTube Studio DOM
  // We avoid mixing broad selectors in a single querySelectorAll to prevent nested matching
  let rows = Array.from(document.querySelectorAll('ytcp-video-row'));
  if (rows.length === 0) rows = Array.from(document.querySelectorAll('.ytcp-video-row'));
  if (rows.length === 0) rows = Array.from(document.querySelectorAll('#row-container'));
  
  if (rows.length === 0) {
    console.warn("[YT-Cal] No video rows found.");
    return;
  }

  const videos = rows.map(row => {
    // Try multiple precise selectors for title link, date, and visibility
    const titleLink = row.querySelector('a#video-title') || row.querySelector('a.ytcp-video-title');
    const dateElem = row.querySelector('.tablecell-date') || row.querySelector('.date-column, [id^="date"]');
    const statusElem = row.querySelector('.tablecell-visibility') || row.querySelector('.visibility-column, [id^="visibility"]');

    const rawDate = dateElem ? dateElem.textContent.replace(/\n/g, ' ').trim() : 'N/A';
    const title = titleLink ? titleLink.textContent.replace(/\n/g, ' ').trim() : 'Untitled';
    const status = statusElem ? statusElem.textContent.replace(/\n/g, ' ').trim() : 'Unknown';
    
    let url = titleLink ? titleLink.href : '';
    if (!url) {
      const thumbLink = row.querySelector('a#thumbnail-anchor, a#thumbnail');
      if (thumbLink) url = thumbLink.href;
    }

    return {
      videoId: extractVideoId(url),
      title: title,
      status: status,
      date: rawDate,
      parsedDate: parseDate(rawDate),
      contentType: type
    };
  }).filter(v => v.videoId);

  chrome.runtime.sendMessage({ action: "storeVideos", videos, contentType: type }, () => {
    const btn = document.getElementById('yt-cal-sync-btn');
    if (btn) {
      btn.textContent = `✅ Synced ${videos.length} items!`;
      setTimeout(() => { btn.textContent = '📅 Sync to Calendar'; }, 2000);
    }
  });
}

function injectButton() {
  if (document.getElementById('yt-cal-sync-btn')) return;
  
  // Check for various possible anchors, prioritizing the target primary action bar
  const anchorCandidates = [
    document.querySelector('.ytcp-primary-action-bar.primary'),
    document.querySelector('ytcp-filter-bar'),
    document.querySelector('#filter-bar'),
    document.querySelector('ytcp-table-header'),
    document.body
  ];

  const anchor = anchorCandidates.find(a => a !== null);

  if (anchor) {
    const container = document.createElement('div');
    container.id = 'yt-cal-btn-container';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.marginLeft = 'auto'; // push to right inside flex container
    
    const syncBtn = document.createElement('button');
    syncBtn.id = 'yt-cal-sync-btn';
    syncBtn.textContent = '📅 Sync to Calendar';
    Object.assign(syncBtn.style, {
      padding: '8px 16px', margin: '10px', background: 'rgb(204, 0, 0)', color: 'rgb(255, 255, 255)',
      border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', zIndex: 9999
    });
    syncBtn.onclick = extractVideoData;

    const openBtn = document.createElement('button');
    openBtn.id = 'yt-cal-open-btn';
    openBtn.textContent = '↗️ Open Calendar';
    Object.assign(openBtn.style, {
      padding: '8px 16px', margin: '10px 10px 10px 0', background: '#1a73e8', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', zIndex: 9999
    });
    openBtn.onclick = () => window.open(chrome.runtime.getURL("popup.html"), "_blank", "width=880,height=650");

    container.appendChild(syncBtn);
    container.appendChild(openBtn);
    
    // Inject logic
    if (anchor.classList && anchor.classList.contains('ytcp-primary-action-bar')) {
      anchor.appendChild(container);
    } else if (anchor === document.body) {
      Object.assign(container.style, {
        position: 'fixed', bottom: '20px', right: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
      });
      document.body.appendChild(container);
    } else {
      anchor.parentNode.insertBefore(container, anchor);
    }
  }
}

// Polling for the button injection to handle YouTube's dynamic page loading
setInterval(injectButton, 2000);