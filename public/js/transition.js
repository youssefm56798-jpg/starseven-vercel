/**
 * NEW STAR SEVEN — page transition.
 *
 * Matches the landing page's intro: a warm-paper panel with the star mark that
 * wipes upward. Leaving a page the panel rises from the bottom to cover; the
 * next page's panel continues upward and off the top — one continuous motion
 * across the navigation.
 *
 * The reveal is pure CSS, so a page is never left covered if this script fails
 * to run. JavaScript only handles the outgoing half.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var panel = document.querySelector('.s7-wipe');
  if (!panel) return;

  // Honour the OS setting: no transitions, no covering panel at all.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { panel.remove(); return; }

  var COVER_MS = 420;   // keep in step with the CSS timing
  var leaving = false;

  /** Links we must never hijack. */
  function isPlainInternalLink(a, e) {
    if (e.defaultPrevented) return false;
    if (e.button !== 0) return false;                       // left-click only
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;  // new tab/window
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    if (a.dataset.noTransition !== undefined) return false;
    if (a.origin !== window.location.origin) return false;  // external, wa.me, mailto, tel

    // In-page anchors scroll; they are not a navigation.
    if (a.hash && a.pathname === window.location.pathname && a.search === window.location.search) return false;
    // Same URL entirely — nothing to transition to.
    if (a.href === window.location.href) return false;
    return true;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a || leaving || !isPlainInternalLink(a, e)) return;

    e.preventDefault();
    leaving = true;
    var href = a.href;

    root.classList.add('s7-leaving');

    // Navigate when the cover finishes. The timeout is the source of truth —
    // if the animation is interrupted the navigation still happens.
    window.setTimeout(function () { window.location.href = href; }, COVER_MS);
  }, false);

  /* Fail-safe: the panel only covers while the reveal animation is mid-flight.
     If that animation is throttled (a background tab) or interrupted, drop the
     attribute so the panel falls back to its revealed base state — a page must
     never be left sitting behind an opaque panel. */
  function clearEnter() { panel.removeAttribute('data-enter'); }
  panel.addEventListener('animationend', function (e) {
    if (e.animationName === 's7Reveal') clearEnter();
  });
  window.setTimeout(clearEnter, 1500);

  // Coming back via the back button can restore the page mid-cover (bfcache).
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted) {
      leaving = false;
      root.classList.remove('s7-leaving');
    }
  });
})();
