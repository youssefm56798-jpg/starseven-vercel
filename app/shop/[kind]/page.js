import { notFound } from 'next/navigation';
import ShopView from '../view.js';
import { shopMeta, KINDS } from '../lib.js';

/**
 * One page per category, and only those. Anything else under /shop/ is a 404
 * rather than another empty grid — the old `?kind=anything` returned a 200
 * with the whole catalogue on it, which is how a crawl trap starts.
 */
export function generateStaticParams() {
  return KINDS.map(kind => ({ kind }));
}
export const dynamicParams = false;

/**
 * Both shop routes render on demand, and `searchParams` is what decides it.
 *
 * English lives at /en/shop/... and middleware.js rewrites that onto this route
 * as ?lang=en, so `searchParams` is the only channel carrying the language down
 * here. It is also a dynamic API: in a legacy (non-PPR) prerender, awaiting it
 * interrupts static generation and zeroes the revalidate window on the way out.
 * So nothing here is prerendered to HTML, `revalidate = 60` never gets to
 * apply, and every chip click is a live server render with its queries.
 *
 * `generateStaticParams` still earns its keep — paired with
 * `dynamicParams = false` it is the allow-list that stops /shop/anything
 * minting a page — but it produces no HTML to serve.
 *
 * Undoing this means giving the locale a segment of its own, so English is a
 * real path rather than a rewrite and the language arrives in `params`. That is
 * a routing change spanning middleware.js and the layout, not something this
 * file can do on its own. Until then, what makes these pages feel fast is the
 * two things app/shop/view.js does: as few queries per render as the page can
 * manage, and a full prefetch on the chips so the click is served from the
 * client router cache rather than from here.
 *
 * `revalidate` stays regardless. It is the correct declaration for a catalogue
 * whose prices move, and it starts working the day the locale moves into the
 * path.
 */
export const revalidate = 60;

export async function generateMetadata({ params, searchParams }) {
  const { kind } = await params;
  const sp = await searchParams;
  if (!KINDS.includes(kind)) return { title: 'Not found', robots: { index: false } };
  return shopMeta(kind, sp?.lang === 'en' ? 'en' : 'ar');
}

export default async function ShopKindPage({ params, searchParams }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) notFound();

  // A category holding nothing live 404s as well, so the shop never offers a
  // page for something it cannot sell. That check used to be a SELECT of its
  // own here, awaited to completion before the view was allowed to begin; the
  // view's own product list gives the same answer for free, so it makes the
  // call itself now. See app/shop/view.js.
  const sp = await searchParams;
  return <ShopView kind={kind} lang={sp?.lang === 'en' ? 'en' : 'ar'} />;
}
