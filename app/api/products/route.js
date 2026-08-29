/**
 * GET /api/products
 * Catalogue + hair-type tiles + shipping rules + whichever offer is live.
 *
 * The storefront falls back to its built-in copy if this call fails, so it is
 * safe for the front end to be optimistic here.
 */

import { sql } from '../../../lib/db.js';
import { fail } from '../../../lib/http.js';
import { HAIR_TYPES, productPublic } from '../../../lib/hairtypes.js';
import { site } from '../../../lib/config.js';

/*
 * The catalogue changes a few times a week at most, so a minute of staleness
 * buys every visitor a cached response instead of a database round trip.
 *
 * This used to be done with the Cache-Control header alone, and deliberately
 * not with `revalidate`, on the grounds that revalidate additionally prerenders
 * the route at build time and a build should not need a reachable database to
 * succeed. The first half of that was right and the second half turns out not
 * to be a cost at all, which is worth writing down because the reasoning is not
 * obvious from the outside.
 *
 * A header alone caches at the CDN. It does nothing about the invocation: a
 * request that misses - a cold region, the first hit after the window expires,
 * anything sent with no-cache - still starts a function, still opens a Neon
 * connection and still runs two queries. `revalidate` moves the whole thing
 * into the prerender: the payload is built once at deploy, served from the edge
 * with no function and no database behind it, and regenerated in the background
 * once a minute by whichever request happens to arrive after the window closes.
 *
 * And the build stays safe without a database, because of the try/catch below
 * rather than in spite of it. Next will not prerender a route handler that
 * answers with an error status, so on a build with no DATABASE_URL the 503 path
 * runs, the route falls back to being dynamic, and the build succeeds - which
 * is exactly the behaviour the old comment was protecting. Verified: with
 * .env.local removed the build prints the catalogue warning and marks this
 * route dynamic instead of static.
 *
 * The header stays alongside. On a prerendered route the two agree with each
 * other, and it is the only caching there is on the build where the route came
 * out dynamic.
 */
export const revalidate = 60;

/** The six tiles, without the long `ar`/`en` copy being reshaped. */
const tiles = HAIR_TYPES.map(t => ({
  slug: t.slug,
  icon: t.icon,
  walker: t.walker,
  walkerEn: t.walkerEn || t.walker,
  color: t.color,
  ar: t.ar,
  en: t.en,
}));

export async function GET() {
  let rows;
  let offers;

  try {
    [rows, offers] = await Promise.all([
      sql`SELECT * FROM products WHERE active = true ORDER BY sort ASC, id ASC`,
      // Newest first: the most recently created live offer is the one the
      // newsletter banner should be advertising.
      sql`SELECT title_ar, title_en, code, discount_type, discount_value, min_total, ends_at
            FROM offers
           WHERE active = true
             AND (starts_at IS NULL OR starts_at <= now())
             AND (ends_at   IS NULL OR ends_at   >= now())
           ORDER BY id DESC
           LIMIT 1`,
    ]);
  } catch (e) {
    console.error('[s7] products failed:', e?.message || e);
    return fail('Catalogue unavailable.', 503);
  }

  const o = offers[0];
  const offer = o
    ? {
        title_ar: o.title_ar,
        title_en: o.title_en,
        code: o.code,
        discount_type: o.discount_type,
        // NUMERIC comes back from Postgres as a string; the browser wants numbers.
        discount_value: Number(o.discount_value),
        min_total: Number(o.min_total),
        ends_at: o.ends_at,
      }
    : null;

  return Response.json(
    {
      ok: true,
      products: rows.map(productPublic),
      hair_types: tiles,
      shipping: { fee: site.shipping, free_over: site.freeOver, currency: site.currency },
      offer,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
