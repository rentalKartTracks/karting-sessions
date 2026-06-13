(function () {
  // Single source of truth for the site nav. Pages ship an empty
  // <nav class="header-nav"></nav> and this fills it, marking the current
  // page active by filename — so adding/renaming a page is a one-line change
  // here instead of an edit across every HTML file.
  var LINKS = [
    { href: 'index.html', label: 'Hub', icon: '🏁' },
    { href: 'sessions.html', label: 'Sessions', icon: '📊' },
    { href: 'map.html', label: 'Map', icon: '🗺️' },
    { href: 'fastest-lap-projection.html', label: 'Fastest Lap', icon: '⚡' },
    { href: 'championship.html', label: 'Championship', icon: '🏆' },
    { href: 'brake.html', label: 'Brake Detect', icon: '🛑' },
    { href: 'progress.html', label: 'Progress', icon: '📈' },
  ];

  // ── Usage tracking (per-browser, localStorage) ──────────────────────────
  var VISITS_KEY = 'hch:pageVisits';
  function getVisits() {
    try { return JSON.parse(localStorage.getItem(VISITS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function recordVisit(page) {
    try {
      var v = getVisits();
      v[page] = (v[page] || 0) + 1;
      localStorage.setItem(VISITS_KEY, JSON.stringify(v));
    } catch (e) {}
  }

  var current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (LINKS.some(function (l) { return l.href.toLowerCase() === current; })) recordVisit(current);

  // Expose for the Hub's "Most Visited" row (single source of page metadata).
  window.HCHNav = { links: LINKS, getVisits: getVisits };

  var nav = document.querySelector('.header-nav');
  if (!nav) return;

  // Render only if the page hasn't supplied its own pills (idempotent).
  if (!nav.querySelector('.nav-pill')) {
    if (!nav.getAttribute('aria-label')) nav.setAttribute('aria-label', 'Site navigation');

    // Order: Hub always pinned first; the rest sorted by visit count (desc),
    // with the original order as a stable tiebreak so the bar only re-ranks
    // gradually rather than reshuffling on every click.
    var visits = getVisits();
    var rest = LINKS.slice(1).map(function (l, i) { return { l: l, i: i }; });
    rest.sort(function (a, b) {
      var d = (visits[b.l.href] || 0) - (visits[a.l.href] || 0);
      return d !== 0 ? d : a.i - b.i;
    });
    var ordered = [LINKS[0]].concat(rest.map(function (x) { return x.l; }));

    var html =
      '<a href="index.html" class="nav-brand">HCH</a>' +
      '<button class="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">' +
        '<svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">' +
        '<rect width="18" height="2" rx="1" fill="currentColor"/>' +
        '<rect y="6" width="18" height="2" rx="1" fill="currentColor"/>' +
        '<rect y="12" width="18" height="2" rx="1" fill="currentColor"/></svg>' +
      '</button>';
    ordered.forEach(function (l) {
      var active = l.href.toLowerCase() === current ? ' active' : '';
      html += '<a href="' + l.href + '" class="nav-pill' + active + '">' + l.label + '</a>';
    });
    nav.innerHTML = html;
  }

  // Publish the live nav height so pages can offset content beneath the
  // fixed bar regardless of how many rows the pills wrap onto.
  function syncHeight() {
    document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
  }
  syncHeight();
  window.addEventListener('resize', syncHeight);
  if (window.ResizeObserver) new ResizeObserver(syncHeight).observe(nav);

  var btn = nav.querySelector('.nav-hamburger');
  if (!btn) return;

  function close() {
    nav.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = nav.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
  });

  nav.addEventListener('click', function (e) {
    if (e.target.matches && e.target.matches('.nav-pill')) close();
  });

  document.addEventListener('click', function (e) {
    if (!nav.contains(e.target)) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
