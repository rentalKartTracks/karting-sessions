(function () {
  var nav = document.querySelector('.header-nav');
  if (!nav) return;

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
