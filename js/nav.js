(function () {
  // Single source of truth for the site nav. Pages ship an empty
  // <nav class="header-nav"></nav> and this fills it, marking the current
  // page active by filename — so adding/renaming a page is a one-line change
  // here instead of an edit across every HTML file.
  var LINKS = [
    ['index.html', 'Hub'],
    ['sessions.html', 'Sessions'],
    ['map.html', 'Map'],
    ['fastest-lap-projection.html', 'Fastest Lap'],
    ['championship.html', 'Championship'],
    ['brake.html', 'Brake Detect'],
    ['progress.html', 'Progress'],
  ];

  var nav = document.querySelector('.header-nav');
  if (!nav) return;

  // Render only if the page hasn't supplied its own pills (idempotent).
  if (!nav.querySelector('.nav-pill')) {
    var current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (!nav.getAttribute('aria-label')) nav.setAttribute('aria-label', 'Site navigation');
    var html =
      '<a href="index.html" class="nav-brand">HCH</a>' +
      '<button class="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">' +
        '<svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">' +
        '<rect width="18" height="2" rx="1" fill="currentColor"/>' +
        '<rect y="6" width="18" height="2" rx="1" fill="currentColor"/>' +
        '<rect y="12" width="18" height="2" rx="1" fill="currentColor"/></svg>' +
      '</button>';
    LINKS.forEach(function (l) {
      var active = l[0].toLowerCase() === current ? ' active' : '';
      html += '<a href="' + l[0] + '" class="nav-pill' + active + '">' + l[1] + '</a>';
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
