'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The page transition — the same warm-paper panel with the star mark that the
 * landing page uses for its intro. Leaving a page the panel rises from the
 * bottom to cover; arriving, it carries on upward and off the top, so one
 * continuous movement spans the navigation.
 *
 * The original was a plain script that intercepted clicks and then set
 * `location.href`. That cannot work here: App Router navigations are
 * client-side, so there is no document unload to hide behind and no fresh
 * document to play the arrival on. This does the same two halves against the
 * router instead —
 *
 *   click  -> cover, then router.push once the cover has finished
 *   arrive -> pathname changes, play the reveal
 *
 * Everything the CSS needs is a class on <html> and a data attribute on the
 * panel, exactly as before, so `app/globals.css` did not have to change.
 *
 * The panel is `clip-path: inset(0 0 100% 0)` at rest — fully collapsed. If
 * this component never mounts or throws, the page is visible, never covered.
 */

const COVER_MS = 420;   // keep in step with @keyframes s7Cover
const REVEAL_MS = 620;  // keep in step with @keyframes s7Reveal
const STUCK_MS = 2500; // longest a navigation may leave the panel covering

/** Links that must never be hijacked. */
function isPlainInternalLink(a, e) {
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (!a || !a.href) return false;
  if (a.target && a.target !== '_self') return false;
  if (a.hasAttribute('download')) return false;
  if (a.dataset.noTransition !== undefined) return false;
  if (a.origin !== window.location.origin) return false;   // wa.me, mailto, tel

  // In-page anchors scroll; that is not a navigation.
  if (a.hash && a.pathname === window.location.pathname && a.search === window.location.search) {
    return false;
  }
  if (a.href === window.location.href) return false;

  // Moving between shop categories is a filter, not a page change.
  // /shop -> /shop/wax -> /shop/gel reads as one screen with chips on it, and
  // a 420ms cover plus a 620ms reveal on every chip made the catalogue feel
  // broken. The routes are prerendered and prefetched, so skipping the wipe
  // here lands them in a frame or two.
  if (isShopPath(a.pathname) && isShopPath(window.location.pathname)) return false;

  return true;
}

/** /shop, /shop/wax, /en/shop/cream-gel — the category screen in any locale. */
function isShopPath(pathname) {
  return /^\/(?:en\/)?shop(?:\/[^/]+)?\/?$/.test(pathname || '');
}

export default function PageWipe() {
  const panel = useRef(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Skip the reveal on the very first paint: nothing was covered, so playing
  // it would flash a panel over a page the visitor can already see.
  const first = useRef(true);

  // The same reasoning, for every other arrival nothing covered.
  //
  // The reveal used to fire on any pathname change, which meant the half of
  // the transition that is a panel sweeping up over the page still played on
  // navigations the cover had deliberately skipped - moving between shop
  // categories above all, where a chip is a filter and 620ms of panel is the
  // whole complaint. Back and forward had it too.
  //
  // So the cover records that it ran, and the reveal only answers to that.
  const covered = useRef(false);

  // Depend on the query STRING, not the object. useSearchParams() hands back a
  // fresh instance on every render, so using it directly as a dependency
  // re-fires the arrival effect on unrelated re-renders — which yanked the
  // covering panel away mid-navigation and played the reveal over a page that
  // had not changed. Measured: the cover died at ~300ms of its 420ms.
  const qs = searchParams ? searchParams.toString() : '';

  const reduced = useCallback(
    () => typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  );

  /* ---------------------------------------------------------- leaving */
  useEffect(() => {
    if (reduced()) return;
    let leaving = false;
    let timer, failsafe;

    const onClick = e => {
      const a = e.target.closest?.('a');
      if (!a || leaving || !isPlainInternalLink(a, e)) return;

      e.preventDefault();
      leaving = true;
      covered.current = true;
      document.documentElement.classList.add('s7-leaving');

      // The timeout is the source of truth: if the animation is throttled or
      // interrupted, the navigation still happens.
      const href = a.getAttribute('href') || a.href;
      timer = window.setTimeout(() => {
        router.push(href);
        // If that route never commits — blocked, errored, or resolves to the
        // page we are already on — uncover rather than stranding the visitor
        // behind the panel.
        failsafe = window.setTimeout(() => {
          leaving = false;
          document.documentElement.classList.remove('s7-leaving');
        }, STUCK_MS);
      }, COVER_MS);
    };

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      window.clearTimeout(timer);
      window.clearTimeout(failsafe);
    };
  }, [router, reduced]);

  /* --------------------------------------------------------- arriving */
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduced()) return;
    if (!covered.current) return;   // nothing to reveal
    covered.current = false;

    // Arm the reveal and drop the covering class in the SAME frame. Doing it
    // through React state instead would let the panel fall back to its
    // revealed base style for a frame before the reveal started, which reads
    // as a flicker rather than one continuous upward movement.
    const el = panel.current;
    if (el) el.setAttribute('data-enter', '');
    document.documentElement.classList.remove('s7-leaving');

    const done = window.setTimeout(() => el?.removeAttribute('data-enter'), REVEAL_MS);
    return () => window.clearTimeout(done);
    // Search params matter: /shop and /shop?kind=wax are different pages here.
  }, [pathname, qs, reduced]);

  /* Fail-safe for the two cases the arrival effect cannot see: a restore from
     the back/forward cache, and a history pop. A page must never be left
     sitting behind an opaque panel.

     This used to also run a blind 4s interval that stripped the covering class
     whenever it was present. That is not a safety net, it is a race: it fired
     mid-animation and killed the cover about 150ms in. The timed clear now
     lives with the click that started the cover, where it knows what it is
     waiting for. */
  useEffect(() => {
    const clear = () => {
      covered.current = false;
      document.documentElement.classList.remove('s7-leaving');
      panel.current?.removeAttribute('data-enter');
    };
    window.addEventListener('pageshow', clear);
    window.addEventListener('popstate', clear);
    return () => {
      window.removeEventListener('pageshow', clear);
      window.removeEventListener('popstate', clear);
    };
  }, []);

  return (
    <div className="s7-wipe" ref={panel} aria-hidden="true">
      <img src="/assets/star-mark.png" alt="" width="88" height="88" />
    </div>
  );
}
