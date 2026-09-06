'use client';

import { usePathname } from 'next/navigation';
import NotFoundView from './_views/not-found.js';

/**
 * The 404, in the language of the URL that missed.
 *
 * Next's default is an unbranded English-only black screen with no way back —
 * which is where every mistyped URL, every stale link and every notFound() call
 * on this site was landing, on a shop that is otherwise entirely Arabic.
 *
 * The language is read from the path on the client rather than from the
 * request on the server, and that is the whole trick. Reading it server-side
 * meant `await headers()`, and that dynamic API is what stopped this file —
 * and, from the root layout, every other page — from ever being prerendered.
 *
 * A nested app/en/not-found.js is the obvious alternative and it does not work:
 * Next resolves an unmatched URL against the ROOT not-found no matter what
 * sits under /en, with or without a layout boundary and with or without a
 * catch-all throwing notFound(). Both were tried.
 *
 * So the first paint is Arabic and hydration corrects it. That is a real
 * compromise and an acceptable one here: this page carries a 404 status, so it
 * is never indexed, and the only reader who reaches it is a person who is about
 * to click one of the links — which are the ones that matter and which are in
 * the right language by the time they are read.
 */
export default function NotFound() {
  const path = usePathname() || '';
  const en = path === '/en' || path.startsWith('/en/');
  return <NotFoundView lang={en ? 'en' : 'ar'} />;
}
