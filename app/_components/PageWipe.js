'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The page transition — a warm-paper panel carrying the star mark. Leaving a
 * page the panel rises from the bottom to cover; arriving, it carries on
 * upward and off the top, so one continuous movement spans the navigation.
 *
 * It is not an intro, and it never was one. Nothing plays on a cold load: the
 * reveal is gated on a `data-enter` attribute that only this component sets,
 * and the `first` ref below refuses to set it on the first paint. The hero
 * animations on the landing page (shine, s7spin, orb and slide, in
 * app/landing.css) are a separate thing that shares only the `s7` prefix. The
 * header comment this file used to carry claimed otherwise; it was wrong.
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
  // Still worth asking, because a capture-phase listener registered before
  // this one may already have prevented the click. What it can no longer catch
  // is a React onClick that prevents the default, since in the capture phase
  // those have not run yet. The six hair-type tiles on the home page are
  // exactly that shape - a real href that always calls preventDefault and
  // filters in place instead - so they carry data-no-transition, and the block
  // further down is where that is explained.
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (!a || !a.href) return false;
  if (a.target && a.target !== '_self') return false;
  if (a.hasAttribute('download')) return false;
  // The explicit opt-out, honoured wherever a link is really a filter.
  //
  // The shop-path pair rule further down only recognises links whose SOURCE is
  // already a shop page. That is what left the affordance the client actually
  // complained about paying the full 420ms cover and 620ms reveal: pressing
  // "hair spray" in the nav submenu, or a range link in the footer, from the
  // home page or an article. Those two controls are category pickers — they
  // list the same categories the shop chips list and land on the same screen —
  // so pressing one is filtering the catalogue no matter where it is pressed
  // from, and it should feel the way the chips feel.
  //
  // Which controls those are is recorded at the call sites, as
  // `data-no-transition` on the anchor, rather than as a table of paths in
  // here. Two rounds of this bug were both a path list that missed a case, and
  // a path list is structurally unable to tell apart the two things that
  // matter: a /shop/wax link that is a chip inside a picker, and a /shop/wax
  // link that is a worded-as-departure button below a grid. Only the markup
  // around it knows which it is, so the judgement belongs next to that markup.
  //
  // The check is presence, not truth. `data-no-transition=""` opts out — and so
  // would `data-no-transition={false}`, because React renders a data attribute
  // set to false as the string "false", which is still present. To opt out
  // conditionally, render `undefined` so the attribute is omitted entirely.
  if (a.dataset.noTransition !== undefined) return false;
  if (a.origin !== window.location.origin) return false;   // wa.me, mailto, tel

  // A link that changes neither the pathname nor the query string is a link the
  // reveal can never answer to, so covering for it strands the page.
  //
  // The arrival effect below is keyed on exactly those two values. If the cover
  // runs and router.push lands on the same pathname and the same search, the
  // effect does not re-run, nothing removes the covering class, and the visitor
  // sits behind an opaque panel until the STUCK_MS failsafe tears it down 2.5s
  // later - which it does with no animation, so it reads as a freeze and a
  // snap rather than a transition.
  //
  // This guard used to require `a.hash`, which caught only the half of the case
  // where the LINK carries the fragment - an in-page anchor. The half it missed
  // is the page carrying one: on /#shop, which is where the hero's "Shop now"
  // button leaves every visitor who presses it, the nav logo's href="/" differs
  // from location.href by the fragment alone. Measured before this line was
  // widened: cover completed, push dropped the hash, pathname and search never
  // moved, and the panel held the home page for 2.5 seconds.
  //
  // Comparing pathname and search directly also subsumes the exact-href check
  // that used to sit here, since equal hrefs cannot differ in either.
  if (a.pathname === window.location.pathname && a.search === window.location.search) {
    return false;
  }

  // Moving between shop categories is a filter, not a page change.
  // /shop -> /shop/wax -> /shop/gel reads as one screen with chips on it, and
  // a 420ms cover plus a 620ms reveal on every chip made the catalogue feel
  // broken. The routes are prerendered and prefetched, so skipping the wipe
  // here lands them in a frame or two.
  // The admin panel shares the root layout and therefore this component, but a
  // full-screen warm-paper panel carrying the storefront star mark has no
  // business in a back office. It was playing on the tab strip, on the Orders
  // filter Reset, and on the Export CSV link - where it was worse than
  // decorative, because a download leaves the page where it is, so nothing ever
  // arrives and the panel sat over the admin until the failsafe expired.
  if (isAdminPath(a.pathname) || isAdminPath(window.location.pathname)) return false;

  // Filtering the catalogue is not a page change. Both ends have to be in the
  // SAME language tree, though: /shop/wax to /en/shop is a language switch, and
  // matching it here silently dropped the transition from the language toggle
  // on every category page.
  const from = shopTree(window.location.pathname);
  const to = shopTree(a.pathname);
  if (from && to && from === to) return false;

  return true;
}

/** /shop, /shop/wax, /en/shop/cream-gel — the category screen in any locale. */
function shopTree(pathname) {
  const m = /^\/(en\/)?shop(?:\/[^/]+)?\/?$/.exec(pathname || '');
  return m ? (m[1] ? 'en' : 'ar') : null;
}

/** /admin and everything under it. */
function isAdminPath(pathname) {
  return /^\/admin(?:\/|$)/.test(pathname || '');
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

  // `leaving` and the two timers are refs rather than closure variables so the
  // ARRIVAL effect can release them. As closures they were reachable only from
  // the click handler, and the latch was lowered in exactly one place: the
  // failsafe, 2500ms after the 420ms cover. So for ~2.9 seconds after any
  // transitioned click, every further click hit `if (leaving) return` and got
  // no transition at all - which is most of the times a person clicks twice.
  //
  // Lowering it in the arrival effect alone is not enough and must not be done
  // on its own: `failsafe` was overwritten by each new click and never
  // cancelled, so a stale one from the previous navigation would fire mid-way
  // through the next and clear state that no longer belonged to it. The arrival
  // cancels it as well as lowering the latch.
  const leaving = useRef(false);
  const timer = useRef(null);
  const failsafe = useRef(null);

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

    const onClick = e => {
      const a = e.target.closest?.('a');
      if (!a || leaving.current || !isPlainInternalLink(a, e)) return;

      e.preventDefault();
      leaving.current = true;
      covered.current = true;
      document.documentElement.classList.add('s7-leaving');

      // The timeout is the source of truth: if the animation is throttled or
      // interrupted, the navigation still happens.
      const href = a.getAttribute('href') || a.href;
      timer.current = window.setTimeout(() => {
        router.push(href);
        // If that route never commits — blocked, errored, or a download that
        // leaves the page where it is — uncover rather than stranding the
        // visitor behind the panel.
        failsafe.current = window.setTimeout(() => {
          leaving.current = false;
          // Lower the latch as well as the class. Clearing only the class
          // leaves `covered` up with nothing covering, and the next arrival -
          // a shop chip, a nav submenu row, any of the exempt filters - then
          // passes the reveal's guard and sweeps a full-screen panel up over a
          // page nothing ever covered. That is the first of the two bugs this
          // component was rewritten to fix, and it came back through here.
          covered.current = false;
          document.documentElement.classList.remove('s7-leaving');
        }, STUCK_MS);
      }, COVER_MS);
    };

    // Capture phase, and this is not a detail: in the bubble phase the whole
    // component is inert.
    //
    // Next's <Link> handles clicks with a React onClick, and React 19 under
    // the App Router hydrates the document, so its delegated listeners live on
    // `document` too. A bubble listener added here therefore sits on the same
    // node as React's and is registered later, which means it runs second - by
    // which point Link has already called preventDefault and started its own
    // navigation, and the first line of isPlainInternalLink bails out on
    // e.defaultPrevented. Measured on a trusted click in this app: every link
    // on the site reached a document-level bubble listener with
    // defaultPrevented already true, and the cover never ran once.
    //
    // Capture runs on the way down, before the target and so before Link's
    // onClick. Preventing the default there is also what keeps Link from
    // navigating underneath the cover: node_modules/next/dist/client/app-dir/
    // link.js returns early on `if (e.defaultPrevented)`, so the router.push
    // scheduled below stays the only navigation that happens.
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.clearTimeout(timer.current);
      window.clearTimeout(failsafe.current);
    };
  }, [router, reduced]);

  /* --------------------------------------------------------- arriving */
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduced()) return;
    if (!covered.current) return;   // nothing to reveal
    covered.current = false;

    // The navigation committed, so release the latch and cancel the guard that
    // exists only for navigations that never do. Without this the component
    // ignores every click for the next 2.9 seconds; without the cancel, a stale
    // guard fires into the following navigation.
    leaving.current = false;
    window.clearTimeout(failsafe.current);
    failsafe.current = null;

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
      leaving.current = false;
      window.clearTimeout(failsafe.current);
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
