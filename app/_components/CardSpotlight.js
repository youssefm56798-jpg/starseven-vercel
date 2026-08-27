'use client';

import { useEffect } from 'react';

/**
 * The spotlight that follows the cursor across a product card.
 *
 * The CSS for this survived the port and the JavaScript did not:
 *
 *   .card::before { background: radial-gradient(260px circle at
 *                   var(--mx, 50%) var(--my, -20%), ...) }
 *
 * With nothing ever setting --mx and --my, every card fell back to the
 * defaults — a fixed blob at 50%/-20% — so hovering lit the same static shape
 * on every card instead of tracking the pointer. It looked like a plain glow,
 * which is exactly what it had become.
 *
 * One delegated listener on the document rather than a handler per card. The
 * grid renders 8 cards on the home page and 32 on the shop, they are server
 * components, and attaching to each would mean making them all client
 * components to hang an effect off. This needs nothing from React at all.
 *
 * Coalesced to one write per frame: pointermove fires far faster than the
 * browser paints, and setting a custom property invalidates the card's
 * background every time it is touched.
 */
export default function CardSpotlight() {
  useEffect(() => {
    // A coarse pointer has no hover to track, and someone who asked for less
    // motion should not get a light chasing their finger.
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let target = null;
    let x = 0;
    let y = 0;
    let last = null;

    const paint = () => {
      raf = 0;
      if (!target) return;
      target.style.setProperty('--mx', `${x}%`);
      target.style.setProperty('--my', `${y}%`);
    };

    const onMove = e => {
      const card = e.target.closest?.('.card');

      // Left the card the light was on: clear its position so the next hover
      // starts from the default rather than from wherever the pointer left.
      if (last && last !== card) {
        last.style.removeProperty('--mx');
        last.style.removeProperty('--my');
      }
      last = card;
      if (!card) { target = null; return; }

      const r = card.getBoundingClientRect();
      x = ((e.clientX - r.left) / r.width) * 100;
      y = ((e.clientY - r.top) / r.height) * 100;
      target = card;
      if (!raf) raf = requestAnimationFrame(paint);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
      if (last) {
        last.style.removeProperty('--mx');
        last.style.removeProperty('--my');
      }
    };
  }, []);

  return null;
}
