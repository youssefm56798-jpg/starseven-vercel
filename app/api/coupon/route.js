/**
 * POST /api/coupon   { code, subtotal, lang? }
 *
 * Checks a discount code and returns what it is actually worth on this basket,
 * so the cart can show a real discount line instead of a hopeful "applied".
 *
 * Preview only — /api/order re-validates and re-computes the discount from the
 * database when the order is placed. Nothing here is trusted at checkout.
 */

import { sql, clientIp, rateOk } from '../../../lib/db.js';
import { ok, fail, readJson, langOf } from '../../../lib/http.js';
import { discountFor } from '../../../lib/pricing.js';
import { site, limits } from '../../../lib/config.js';
import { str, tooMany, tooBig } from '../_lib/shared.js';

export const dynamic = 'force-dynamic';

/** Whole pounds with thousands separators, the way the copy reads them. */
const whole = n => Math.round(Number(n) || 0).toLocaleString('en-US');

/** '15%' rather than '15.00%', but '12.5%' survives. */
const trimZeros = n => Number(n).toFixed(2).replace(/\.?0+$/, '');

export async function POST(req) {
  const { body = {}, tooLarge } = await readJson(req);
  if (tooLarge) return tooBig();

  const lang = langOf(body.lang);
  const ar = lang === 'ar';

  // Shares the cheap bucket with the quiz: this is a read-only lookup.
  if (!(await rateOk('quiz', clientIp(req), ...limits.quiz))) return tooMany(lang);

  const code = str(body.code, 64).toUpperCase();
  if (!code) {
    return fail(ar ? 'اكتب كود الخصم.' : 'Enter a discount code.', 422, { field: 'coupon' });
  }

  const subtotal = Number(body.subtotal) || 0;
  if (subtotal <= 0) {
    return fail(ar ? 'السلة فاضية.' : 'Your cart is empty.', 422, { field: 'items' });
  }

  const rows = await sql`
    SELECT discount_type, discount_value, min_total, max_uses, used_count
      FROM offers
     WHERE code = ${code}
       AND active = true
       AND (starts_at IS NULL OR starts_at <= now())
       AND (ends_at   IS NULL OR ends_at   >= now())
     LIMIT 1`;

  const offer = rows[0];
  if (!offer) {
    return fail(
      ar ? 'كود الخصم مش صحيح أو انتهى.' : 'That discount code is not valid.',
      422, { field: 'coupon' },
    );
  }

  // Tell the shopper the code is spent here rather than letting them find out at
  // checkout. The order route is what actually enforces the cap under
  // concurrency; this is only the honest preview.
  if (offer.max_uses != null && Number(offer.used_count) >= Number(offer.max_uses)) {
    return fail(
      ar ? 'كود الخصم ده خلص.' : 'That discount code has been fully used.',
      422, { field: 'coupon' },
    );
  }

  const min = Number(offer.min_total) || 0;
  if (subtotal < min) {
    return fail(
      ar ? `الكود ده شغال على أوردر من ${whole(min)} جنيه وفوق.`
         : `That code applies on orders of ${whole(min)} EGP and above.`,
      422, { field: 'coupon' },
    );
  }

  const discount = discountFor(subtotal, offer);
  if (discount <= 0) {
    return fail(
      ar ? 'الكود ده مش بيدي خصم على السلة دي.' : 'That code gives no discount on this basket.',
      422, { field: 'coupon' },
    );
  }

  return ok({
    code,
    discount,
    label: offer.discount_type === 'percent'
      ? `${trimZeros(offer.discount_value)}%`
      : `${whole(offer.discount_value)} ${site.currency}`,
  });
}
