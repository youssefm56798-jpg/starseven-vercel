/**
 * POST /api/quiz   { hair_type, concern?, lang? }
 *
 * Returns the ranked product match for a hair type and logs the answer, so the
 * client can see which hair types the audience actually has — that is the
 * signal that tells them which SKU to make next.
 */

import { sql, clientIp, rateOk } from '../../../lib/db.js';
import { ok, fail, readJson, langOf } from '../../../lib/http.js';
import { bySlug, rankProducts, productPublic } from '../../../lib/hairtypes.js';
import { limits } from '../../../lib/config.js';
import { str, tooMany, tooBig } from '../_lib/shared.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { body = {}, tooLarge } = await readJson(req);
  if (tooLarge) return tooBig();

  const lang = langOf(body.lang);
  const ip = clientIp(req);

  if (!(await rateOk('quiz', ip, ...limits.quiz))) return tooMany(lang);

  const type = bySlug(str(body.hair_type, 40));
  // Not customer copy: the tiles come from us, so an unknown slug is a bug or a bot.
  if (!type) return fail('Unknown hair type.', 422, { field: 'hair_type' });

  const concern = str(body.concern, 24);

  // Out-of-stock and unpriced products are hidden here rather than filtered
  // later, so the quiz never recommends something the customer cannot actually
  // buy. price > 0 is the same rule sellable() applies to the two finders: the
  // shop carries active rows at price 0 on purpose and renders them as "ask for
  // price", and an answer that quotes a jar at nothing is worse than no answer.
  const rows = await sql`
    SELECT * FROM products
     WHERE active = true AND stock > 0 AND price > 0
     ORDER BY sort ASC, id ASC`;

  const matches = rankProducts(rows, type.slug, 3);

  // Logging is analytics, not part of the answer — never fail the quiz over it.
  try {
    await sql`
      INSERT INTO quiz_results (hair_type, concern, sku, lang, ip)
      VALUES (${type.slug}, ${concern}, ${matches[0]?.sku ?? ''}, ${lang}, ${ip})`;
  } catch (e) {
    console.error('[s7] quiz log failed:', e?.message || e);
  }

  return ok({
    hair_type: {
      slug: type.slug,
      icon: type.icon,
      walker: type.walker,
      walkerEn: type.walkerEn || type.walker,
      color: type.color,
      copy: type[lang],
    },
    products: matches.map(productPublic),
  });
}
