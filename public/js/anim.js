/**
 * NEW STAR SEVEN — animation budget.
 *
 * The page has several decorative loops (ticker, orbits, gradient borders).
 * Left alone they repaint continuously for as long as the page is open, which
 * burns CPU and spins laptop fans for no visual benefit. This keeps them
 * running only when they can actually be seen:
 *
 *   - tab hidden      -> pause everything
 *   - section off-screen -> pause that section
 */
(function () {
  'use strict';

  var root = document.documentElement;

  /* --- 1. background tab: pause the lot ------------------------------- */
  function syncVisibility() {
    root.classList.toggle('s7-bg', document.hidden);
  }
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();

  /* --- 2. off-screen sections: pause per-section ----------------------- */
  if (typeof IntersectionObserver === 'undefined') return;

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.removeAttribute('data-anim');
        en.target.classList.add('in-view');
      } else {
        en.target.setAttribute('data-anim', 'off');
        en.target.classList.remove('in-view');
      }
    });
  }, { rootMargin: '120px 0px' });   // wake slightly before it scrolls in

  function observeAll() {
    document.querySelectorAll('section, header.hero, .ticker, footer').forEach(function (el) {
      if (!el.dataset.animObserved) {
        el.dataset.animObserved = '1';
        io.observe(el);
      }
    });
  }

  // The landing page renders via React, so watch for sections appearing.
  observeAll();
  if (typeof MutationObserver !== 'undefined') {
    var mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });
    // Stop re-scanning once the app has settled.
    setTimeout(function () { mo.disconnect(); observeAll(); }, 6000);
  }
})();
