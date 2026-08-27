/**
 * POST /api/order
 * Cash-on-delivery checkout. Prices, discounts and shipping are all recomputed
 * server-side from the database — whatever the browser sends about money is
 * treated as a suggestion, never as fact.
 *
 * Body: { name, phone, address, email, city?, notes?, coupon?, consent?,
 *         lang?, hp?, items: [ { sku, qty } ] }
 */

import { sql, clientIp, rateOk } from '../../../lib/db.js';
import { ok, fail, readJson, langOf, orderRef, token40 } from '../../../lib/http.js';
import { discountFor, cartTotals } from '../../../lib/pricing.js';
import { normalizePhone } from '../../../lib/phone.js';
import { sendMail, tplOrder, tplOrderAdmin } from '../../../lib/mail.js';
import { newAccessToken, sha256, orderUrl } from '../../../lib/order-access.js';
import { site, mail, limits } from '../../../lib/config.js';
import { str, trapped, isEmail, tooMany, tooBig } from '../_lib/shared.js';

export const dynamic = 'force-dynamic';

const money = n =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const whole = n => Math.round(Number(n) || 0).toLocaleString('en-US');

export async function POST(req) {
  const { body = {}, tooLarge } = await readJson(req);
  if (tooLarge) return tooBig();

  const lang = langOf(body.lang);
  const ar = lang === 'ar';

  // Honeypot: a field no human ever sees. Answer exactly like a success —
  // a plausible reference and no trace in the database — so the bot moves on.
  if (trapped(body.hp)) return ok({ ref: orderRef() });

  const ip = clientIp(req);
  if (!(await rateOk('order', ip, ...limits.order))) return tooMany(lang);

  /* ------------------------------------------------------------- customer */

  const name = str(body.name, 120);
  if (name.length < 3) {
    return fail(ar ? 'اكتب اسمك.' : 'Please enter your name.', 422, { field: 'name' });
  }

  const phone = normalizePhone(body.phone);
  if (!phone) {
    return fail(
      ar ? 'رقم موبايل مصري غير صحيح.' : 'Enter a valid Egyptian mobile number.',
      422, { field: 'phone' },
    );
  }

  const address = str(body.address, 255);
  if (address.length < 8) {
    return fail(
      ar ? 'اكتب العنوان بالتفصيل.' : 'Please enter a full address.',
      422, { field: 'address' },
    );
  }

  const city = str(body.city, 80);
  const notes = str(body.notes, 500);

  /* ---------------------------------------------------------------- items */

  const emptyCart = () =>
    fail(ar ? 'السلة فاضية.' : 'Your cart is empty.', 422, { field: 'items' });

  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return emptyCart();

  // Merge duplicate lines so "2 × the same SKU twice" is one row of four, not
  // two rows that each pass the stock check on their own.
  const want = new Map();
  for (const line of raw) {
    if (!line || typeof line !== 'object') continue;
    const sku = str(line.sku, 64);
    if (!sku) continue;
    const qty = Math.max(1, Math.min(20, Math.trunc(Number(line.qty)) || 1));
    want.set(sku, Math.min(20, (want.get(sku) || 0) + qty));
  }
  if (!want.size) return emptyCart();

  // One query for the whole basket. Prices come from here and nowhere else.
  const found = await sql`
    SELECT id, sku, name_ar, name_en, price, stock
      FROM products
     WHERE sku = ANY(${[...want.keys()]}::text[])
       AND active = true`;

  if (!found.length) {
    return fail(ar ? 'المنتجات دي مش متاحة.' : 'Those products are unavailable.', 422, { field: 'items' });
  }

  const items = [];
  let subtotal = 0;

  for (const p of found) {
    const qty = want.get(p.sku);
    // The query cannot return a SKU we did not ask for, but an unmatched row
    // here would silently turn the subtotal into NaN. Never risk it on money.
    if (!qty) continue;

    const stock = Number(p.stock);

    if (stock < qty) {
      return fail(
        ar ? `الكمية المطلوبة من "${p.name_ar}" مش متوفرة حالياً.`
           : `We do not have that many of "${p.name_en}" in stock.`,
        409, { field: 'items', sku: p.sku, stock },
      );
    }

    const price = Number(p.price);
    subtotal += price * qty;
    items.push({
      product_id: Number(p.id),
      sku: p.sku,
      name: ar ? p.name_ar : p.name_en,
      price,
      qty,
    });
  }

  if (!items.length) return emptyCart();

  /* ------------------------------------------------------------- discount */

  let discount = 0;
  let couponCode = '';
  const coupon = str(body.coupon, 64).toUpperCase();

  if (coupon) {
    const offers = await sql`
      SELECT discount_type, discount_value, min_total
        FROM offers
       WHERE code = ${coupon}
         AND active = true
         AND (starts_at IS NULL OR starts_at <= now())
         AND (ends_at   IS NULL OR ends_at   >= now())
       LIMIT 1`;

    const off = offers[0];
    if (!off) {
      return fail(
        ar ? 'كود الخصم مش صحيح أو انتهى.' : 'That discount code is not valid.',
        422, { field: 'coupon' },
      );
    }

    const min = Number(off.min_total) || 0;
    if (subtotal < min) {
      return fail(
        ar ? `الكود ده شغال على أوردر من ${whole(min)} جنيه وفوق.`
           : `That code applies on orders of ${whole(min)} EGP and above.`,
        422, { field: 'coupon' },
      );
    }

    discount = discountFor(subtotal, off);
    couponCode = coupon;
  }

  /* ----------------------------------------------------------------- email */

  // Mandatory now. It is the only way a customer gets back to this order —
  // there are no accounts — so an order without one is an order nobody can
  // track, cancel or ask about. Checked here, before the write, so a bad
  // address fails cleanly rather than producing an unreachable order.
  const custEmail = str(body.email, 190).toLowerCase();
  if (!isEmail(custEmail)) {
    return fail(
      ar ? 'اكتب إيميل صح — هنبعتلك عليه لينك تتابع بيه الأوردر.'
         : 'Enter a valid email — we send you a link to follow your order.',
      422, { field: 'email' },
    );
  }

  // The token goes in that email and nowhere else; the database keeps only its
  // digest. See lib/order-access.js.
  const accessToken = newAccessToken();
  const accessHash = await sha256(accessToken);

  /* ------------------------------------------------------ shipping + total */

  const t = cartTotals(subtotal, discount, site.shipping, site.freeOver);
  ({ subtotal, discount } = t);
  const { shipping, total } = t;

  /* ---------------------------------------------------------------- write */

  /**
   * Neon's HTTP driver has no interactive transaction, so the whole write goes
   * out as one non-interactive batch. Two consequences shape this:
   *
   *  - The order id cannot be read back mid-batch, so the item rows find their
   *    parent through the unique `ref` — visible to later statements because
   *    they run inside the same transaction.
   *  - A guarded UPDATE that matches nothing is not an error, so the stock
   *    decrements divide by their own row count. If someone took the last unit
   *    between our check above and this write, that is a division by zero and
   *    Postgres rolls the entire order back rather than overselling.
   */
  const writeFor = ref => {
    const stmts = [sql`
      INSERT INTO orders (ref, name, phone, address, city, notes, lang,
                          subtotal, shipping, discount, total, coupon, source, ip,
                          email, access_hash)
      VALUES (${ref}, ${name}, ${phone}, ${address}, ${city}, ${notes}, ${lang},
              ${subtotal}, ${shipping}, ${discount}, ${total}, ${couponCode}, 'web', ${ip},
              ${custEmail}, ${accessHash})
      RETURNING id`];

    for (const it of items) {
      // Casts are explicit because a bare parameter in an INSERT ... SELECT
      // target list has no column to take its type from, unlike VALUES.
      stmts.push(sql`
        INSERT INTO order_items (order_id, product_id, sku, name, price, qty)
        SELECT id, ${it.product_id}::int, ${it.sku}::text, ${it.name}::text,
               ${it.price}::numeric, ${it.qty}::smallint
          FROM orders WHERE ref = ${ref}`);

      stmts.push(sql`
        WITH taken AS (
          UPDATE products
             SET stock = stock - ${it.qty}
           WHERE id = ${it.product_id} AND stock >= ${it.qty}
          RETURNING id
        )
        SELECT 1 / count(*)::int AS guard FROM taken`);
    }

    return stmts;
  };

  let ref = '';
  let written = false;
  let writeErr = null;

  // order_ref() is four random digits within a day, so a collision is unlikely
  // but not impossible. A duplicate is worth retrying; anything else is not.
  for (let attempt = 0; attempt < 5 && !written; attempt++) {
    ref = orderRef();
    try {
      await sql.transaction(writeFor(ref));
      written = true;
    } catch (e) {
      writeErr = e;
      if (e?.code !== '23505') break;
    }
  }

  if (!written) {
    console.error('[s7] order failed:', writeErr?.code || '', writeErr?.message || writeErr);

    // 22012 is division_by_zero — our stock guard firing, not a real fault.
    if (writeErr?.code === '22012') {
      return fail(
        ar ? 'واحد من المنتجات خلص من المخزن دلوقتي. راجع السلة وجرّب تاني.'
           : 'One of those items just sold out. Check your cart and try again.',
        409, { field: 'items' },
      );
    }

    return fail(
      ar ? 'حصلت مشكلة وإحنا بنسجل الأوردر. جرّب تاني أو ابعتلنا واتساب.'
         : 'Something went wrong saving your order. Try again or message us on WhatsApp.',
      500,
    );
  }

  /* --------------------------------------------------------------- consent */

  const order = { ref, name, phone, address, city, notes, subtotal, shipping, discount, total };

  // Marketing consent given at checkout (unticked by default). Because the
  // customer opted in directly on their own order, the row is stored active —
  // no email double-opt-in step. Email confirmation stays separate.
  if (body.consent === 1 || body.consent === true || body.consent === '1') {
    try {
      // Email is mandatory at checkout now, so there is always a real key —
      // the old synthetic wa+phone@sms.local fallback is gone with it.
      const key = custEmail;
      await sql`
        INSERT INTO subscribers (email, name, phone, lang, source, status, token, ip, confirmed_at)
        VALUES (${key}, ${name}, ${phone}, ${lang}, 'checkout', 'active', ${token40()}, ${ip}, now())
        ON CONFLICT (email) DO UPDATE
          SET phone  = EXCLUDED.phone,
              name   = EXCLUDED.name,
              -- Someone who opted out stays opted out; a checkout tick is not
              -- consent to undo that.
              status = CASE WHEN subscribers.status = 'unsubscribed'
                            THEN subscribers.status ELSE 'active' END,
              confirmed_at = COALESCE(subscribers.confirmed_at, now())`;
    } catch (e) {
      console.error('[s7] consent capture failed:', e?.message || e);
    }
  }

  /* ---------------------------------------------------------------- notify */

  // The order is already saved. Mail is best-effort from here on — a bounced
  // notification must never turn a placed order into an error.
  try {
    const [aSub, aHtml] = tplOrderAdmin(order, items);
    if (mail.notifyTo) await sendMail({ to: mail.notifyTo, subject: aSub, html: aHtml, kind: 'order-admin' });

    // The link is the whole point of the confirmation now — it is the only
    // copy of the token that will ever exist.
    const [cSub, cHtml] = tplOrder(order, items, lang, orderUrl(ref, accessToken, lang));
    await sendMail({ to: custEmail, subject: cSub, html: cHtml, kind: 'order' });
  } catch (e) {
    console.error('[s7] order mail failed:', e?.message || e);
  }

  /* ----------------------------------------------------------------- reply */

  // Prefilled WhatsApp text so the customer can jump straight into the chat.
  const waLines = [ar ? `أوردر رقم ${ref}` : `Order ${ref}`];
  for (const it of items) waLines.push(`• ${it.name} × ${it.qty}`);
  waLines.push(`${ar ? 'الإجمالي: ' : 'Total: '}${money(total)} ${site.currency}`);

  return ok({
    ref,
    subtotal,
    discount,
    shipping,
    total,
    wa: `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(waLines.join('\n'))}`,
    message: ar
      ? `استلمنا طلبك ★ هنكلمك على ${phone} نأكد التوصيل.`
      : `Order received ★ We will call you on ${phone} to confirm delivery.`,
  });
}
