/**
 * POST /api/order
 * Cash-on-delivery checkout. Prices, discounts and shipping are all recomputed
 * server-side from the database — whatever the browser sends about money is
 * treated as a suggestion, never as fact.
 *
 * Body: { name, phone, address, email, city?, notes?, coupon?, consent?,
 *         lang?, hp?, idempotency_key?, items: [ { sku, qty } ] }
 */

import { after } from 'next/server';
import { sql, clientIp, rateOk } from '../../../lib/db.js';
import { ok, fail, readJson, langOf, token40 } from '../../../lib/http.js';
import { formatRef, fakeOrderRef } from '../../../lib/order-number.js';
import { discountFor, cartTotals } from '../../../lib/pricing.js';
import { normalizePhone } from '../../../lib/phone.js';
import { sendMail, tplOrder, tplOrderAdmin } from '../../../lib/mail.js';
import { newAccessToken, sha256, orderUrl } from '../../../lib/order-access.js';
import { site, mail, limits, maxOrderLines } from '../../../lib/config.js';
import { str, trapped, isEmail, tooMany, tooBig } from '../_lib/shared.js';
import { isServed } from '../../../lib/delivery-eta.js';

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
  if (trapped(body.hp)) return ok({ ref: fakeOrderRef() });

  const ip = clientIp(req);
  if (!(await rateOk('order', ip, ...limits.order))) return tooMany(lang);

  /* --------------------------------------------------------- idempotency */

  /*
   * One key per checkout attempt, minted in the browser; every retry of that
   * same attempt carries the same one. See db/schema.sql for the shape of the
   * table it is claimed in, and the write below for the claim itself.
   *
   * Anything that is not a plausible key is treated as ABSENT rather than
   * refused. A tab that was opened before this deploy has no key to send, and a
   * checkout that answers 400 to those customers is a worse outage than the bug
   * this fixes: the shop would stop taking orders from everyone with a stale
   * page open until they happened to reload. Without a key the route behaves
   * exactly as it did before - one order per request, no replay protection -
   * which is a degradation, not a break.
   */
  const rawKey = str(body.idempotency_key, 100);
  const idemKey = /^[A-Za-z0-9_.:-]{16,100}$/.test(rawKey) ? rawKey : '';

  /**
   * The reply this key was already answered with, as a finished response, or
   * null if the key has not been claimed.
   *
   * Called in three places, and only the third is the guarantee:
   *
   *   here      the courteous check, the same shape as the coupon cap check
   *             below. It answers the common case - a replayed POST arriving
   *             well after the first one finished - without redoing any of the
   *             work. It is NOT what makes the guarantee: two requests landing
   *             together both look here and both find nothing, because neither
   *             has committed yet.
   *   refusals  on the way out of the two checks whose answer a concurrent
   *             winner can change under us. See each of them.
   *   the write the claim lost. That one is the guarantee.
   */
  const replayed = async () => {
    if (!idemKey) return null;
    const [prior] = await sql`
      SELECT response FROM order_attempts WHERE idem_key = ${idemKey} LIMIT 1`;
    return prior?.response ? ok(prior.response) : null;
  };

  const replay = await replayed();
  if (replay) return replay;

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

  /*
   * A second bucket, on the number rather than on the network.
   *
   * Placed here, after normalizePhone, so the key is the canonical form: 010…,
   * +2010… and 0020 10… are one customer and must land in one bucket rather
   * than three. See limits.orderPhone in lib/config.js for what this is and is
   * not worth — it stops the naive flood and the runaway retry, and it is not
   * the answer to a distributed one.
   *
   * After the IP limit rather than before it, so a single attacker still spends
   * their network allowance first and the cheaper check is the one that runs on
   * every request.
   */
  if (!(await rateOk('order-phone', phone, ...limits.orderPhone))) return tooMany(lang);

  const address = str(body.address, 255);
  if (address.length < 8) {
    return fail(
      ar ? 'اكتب العنوان بالتفصيل.' : 'Please enter a full address.',
      422, { field: 'address' },
    );
  }

  /*
   * The delivery area, refused here rather than only on the picker.
   *
   * Checkout offers three governorates in a <select>, and that is a courtesy:
   * this route is a plain POST endpoint that anything can call with any body,
   * so the select is not what stops an order for Aswan - this is. The shop has
   * no courier contract outside Cairo, Giza and Qalyubia, and an order it
   * cannot deliver is worse than one it never took: the customer has been told
   * yes, the stock has been decremented, and somebody has to ring them back.
   *
   * isServed() reads neighbourhoods too, so "المعادي" and "الشيخ زايد" pass
   * without the customer having to know which governorate they are in.
   */
  const city = str(body.city, 80);
  if (!isServed(city)) {
    return fail(
      ar ? 'دلوقتي بنوصّل للقاهرة والجيزة والقليوبية بس. لو إنت بره دول، كلّمنا واتساب.'
         : 'We currently deliver to Cairo, Giza and Qalyubia only. Outside those, message us on WhatsApp.',
      422, { field: 'city' },
    );
  }

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

  /*
   * A ceiling on how many DIFFERENT products one order may name.
   *
   * The quantity per line was always capped at twenty. The number of lines was
   * not capped at all, and the two are not the same protection: a request
   * naming every SKU in the catalogue at twenty each passed every check in this
   * file and emptied the shop in one transaction. It fitted inside the 128 KB
   * body limit with room to spare, and each accepted line added two more
   * statements to the write batch.
   *
   * Counted AFTER the merge, so a customer is not refused for a cart that
   * happens to list the same jar on several lines — that is one product, and
   * the map above has already made it one.
   *
   * Refused rather than truncated. Silently dropping lines would confirm an
   * order that is not the one the customer pressed Confirm on, and on a shop
   * that collects cash at the door the first they would hear of it is the
   * driver arriving with the wrong box.
   */
  if (want.size > maxOrderLines) {
    return fail(
      ar ? `أقصى عدد منتجات مختلفة في الأوردر ${maxOrderLines}. قسّمه على أوردرين أو كلّمنا واتساب.`
         : `An order can hold at most ${maxOrderLines} different products. Split it in two, or message us on WhatsApp.`,
      422, { field: 'items' },
    );
  }

  // One query for the whole basket. Prices come from here and nowhere else.
  const found = await sql`
    SELECT id, sku, name_ar, name_en, price, stock, image
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
      // Ask the key again before refusing. A duplicate of this same attempt can
      // arrive while the first one is still in flight — too early to have seen
      // its claim above — and then read the stock AFTER it committed. The units
      // that are missing are then the ones this customer's own first request
      // took, and telling them their order sold out is both wrong and alarming:
      // the order exists. Only the world changing between two identical
      // requests can land here, which is exactly what the key is for.
      return (await replayed()) ?? fail(
        ar ? `الكمية المطلوبة من "${p.name_ar}" مش متوفرة حالياً.`
           : `We do not have that many of "${p.name_en}" in stock.`,
        409, { field: 'items', sku: p.sku, stock },
      );
    }

    const price = Number(p.price);

    // Refuse a line whose price is not a real, positive amount. 31 products are
    // seeded at price 0 - the ones the manufacturer has no price for, shown as
    // "ask for price" with a WhatsApp button and never a buy button. They are
    // kept unorderable today only because their stock is also 0, so the check
    // above catches them first. That is a coupling, not a rule: the day an
    // admin sets stock on one before setting its price, it would sell for
    // nothing, and on a cash-on-delivery shop that is a driver at the door with
    // free product. Say the rule out loud instead of leaning on the side effect.
    if (!(price > 0)) {
      return fail(
        ar ? `"${p.name_ar}" لسه ملهوش سعر — كلمنا على واتساب.`
           : `"${p.name_en}" is not priced yet — message us on WhatsApp.`,
        409, { field: 'items', sku: p.sku },
      );
    }

    subtotal += price * qty;
    items.push({
      product_id: Number(p.id),
      sku: p.sku,
      name: ar ? p.name_ar : p.name_en,
      price,
      qty,
      // Carried for the confirmation email, which draws the jar next to the
      // line. order_items has no image column and does not want one - the
      // INSERT below names its columns, so this rides along to the templates
      // and is dropped at the database. A product photographed differently
      // next year should not change what a receipt from today looks like in
      // any way that matters, and the name and the price are the parts that
      // do; the picture is decoration and is allowed to follow the catalogue.
      image: p.image || '',
    });
  }

  if (!items.length) return emptyCart();

  /* ------------------------------------------------------------- discount */

  let discount = 0;
  let couponCode = '';
  /**
   * The per-customer cap this code carries, or null for none.
   *
   * Hoisted out of the block below because the write batch needs it and the
   * block is where it is read. Null is the historical behaviour and what every
   * code created before the column existed still has.
   */
  let couponPerCustomer = null;
  const coupon = str(body.coupon, 64).toUpperCase();

  if (coupon) {
    const offers = await sql`
      SELECT discount_type, discount_value, min_total, max_uses, used_count, per_customer
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

    // A code with a cap that is already spent is rejected up front. This is the
    // courteous check - the guard inside the write transaction is what actually
    // enforces it, because two orders can pass this line at once.
    if (off.max_uses != null && Number(off.used_count) >= Number(off.max_uses)) {
      // Same reason as the stock check above, and this is the one that fires in
      // practice: on a single-use code, a duplicate submit reads used_count
      // after the first request has already spent it, and would be told the
      // code is finished when it was their own order that finished it.
      return (await replayed()) ?? fail(
        ar ? 'كود الخصم ده خلص.' : 'That discount code has been fully used.',
        422, { field: 'coupon' },
      );
    }

    /*
     * The per-customer cap.
     *
     * A different question from max_uses above, and one that counter could
     * never answer: max_uses is the total across everybody, so a code with no
     * total cap could be put on every order one person ever placed, and a code
     * capped at a thousand could be spent a thousand times by the same person.
     * "15% off your first order" is not expressible without this.
     *
     * Counted on the phone number, not the email. An address is free and
     * unlimited, so a cap keyed on one caps nothing; the number is what the
     * shop rings to confirm a cash-on-delivery order, so a redemption from a
     * number that does not answer never becomes a delivery. db/schema.sql
     * carries the full argument.
     *
     * This is the courteous check — the guard inside the write transaction is
     * what enforces it, because two checkouts can pass this line at once. And
     * it asks the idempotency key first for the same reason the stock and
     * max_uses checks do: on a single-use code, a duplicate submit reads a
     * redemption that its OWN first request wrote, and telling that customer
     * they have already used the code would be true and useless.
     */
    couponPerCustomer = off.per_customer == null ? null : Number(off.per_customer);
    if (couponPerCustomer !== null) {
      const [seen] = await sql`
        SELECT count(*)::int AS n
          FROM offer_redemptions
         WHERE code = ${coupon} AND phone = ${phone}`;

      if (Number(seen?.n || 0) >= couponPerCustomer) {
        return (await replayed()) ?? fail(
          ar ? 'الكود ده اتستخدم على الرقم ده قبل كده.'
             : 'That code has already been used on this number.',
          422, { field: 'coupon' },
        );
      }
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

  /* ---------------------------------------------------------------- reply */

  /**
   * The answer the customer gets, built BEFORE the write rather than after it.
   *
   * It has to exist before, because the idempotency claim stores it: a retry of
   * this attempt is answered from the stored copy, and storing a copy means
   * having one to store. Everything in here is already decided by this point -
   * the totals came from the database, the reference is the one about to be
   * written - so nothing is being guessed ahead of the write.
   */
  const replyFor = ref => {
    // Prefilled WhatsApp text so the customer can jump straight into the chat.
    const waLines = [ar ? `أوردر رقم ${formatRef(ref)}` : `Order ${formatRef(ref)}`];
    for (const it of items) waLines.push(`• ${it.name} × ${it.qty}`);
    waLines.push(`${ar ? 'الإجمالي: ' : 'Total: '}${money(total)} ${site.currency}`);

    return {
      ref,
      subtotal,
      discount,
      shipping,
      total,
      wa: `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(waLines.join('\n'))}`,
      message: ar
        ? `استلمنا طلبك ★ هنكلمك على ${phone} نأكد التوصيل.`
        : `Order received ★ We will call you on ${phone} to confirm delivery.`,
    };
  };

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
  const writeFor = (ref, reply) => {
    const stmts = [];

    /*
     * Claim the idempotency key, and do it FIRST.
     *
     * This is the statement that makes a double-submit impossible, and it is
     * the only one in the batch whose guard is about a request rather than a
     * row. The shape is the house pattern - a guarded write, then
     * `SELECT 1 / count(*)::int` so a zero-row match divides by zero and rolls
     * the whole batch back - but what it is guarding on is unusual enough to
     * spell out:
     *
     *   ON CONFLICT DO NOTHING against a UNIQUE key does not just fail when the
     *   conflicting row is already committed. When the conflicting row was
     *   inserted by a transaction that has not finished yet, Postgres makes
     *   this INSERT WAIT on that transaction and only then decides. So a
     *   duplicate that arrives while the first request is still mid-flight -
     *   the case a check-then-insert cannot see, and the case that actually
     *   happens on a double-tap - blocks here and loses here.
     *
     *   The loser gets zero rows, divides by zero, and its entire batch is
     *   rolled back: no order row, no stock taken, no coupon spent. The winner
     *   commits the key and the order together, so there is no window in which
     *   one exists without the other.
     *
     * First in the batch, not last, and that ordering is load-bearing: a loser
     * that had already decremented stock would sit on those product rows while
     * it waited, and every unrelated order for the same product would queue
     * behind a request that is about to roll back anyway. Waiting before
     * touching anything costs nothing and holds nothing.
     *
     * With no key the statement is simply absent and the batch is what it
     * always was.
     */
    if (idemKey) {
      stmts.push(sql`
        WITH claimed AS (
          INSERT INTO order_attempts (idem_key, ref, response)
          VALUES (${idemKey}, ${ref}, ${JSON.stringify(reply)}::json)
          ON CONFLICT (idem_key) DO NOTHING
          RETURNING idem_key
        )
        SELECT 1 / count(*)::int AS guard FROM claimed`);
    }

    stmts.push(sql`
      INSERT INTO orders (ref, name, phone, address, city, notes, lang,
                          subtotal, shipping, discount, total, coupon, source, ip,
                          email, access_hash)
      VALUES (${ref}, ${name}, ${phone}, ${address}, ${city}, ${notes}, ${lang},
              ${subtotal}, ${shipping}, ${discount}, ${total}, ${couponCode}, 'web', ${ip},
              ${custEmail}, ${accessHash})
      RETURNING id`);

    /*
     * The same digest as a token row.
     *
     * order_tokens is where links live now — one row per link, so a status
     * email can mint its own without killing this one. See lib/order-access.js.
     *
     * The column above is written as well, and stays written for one more
     * release. The schema is applied at build time while the previous
     * deployment is still serving, so a rollback would otherwise leave every
     * order placed in between with its digest in a table the older code has
     * never heard of, and no way in at all.
     *
     * It finds its parent through `ref` for the same reason the item rows do:
     * the id cannot be read back mid-batch. The casts are explicit for the
     * reason documented on the item insert below — a bare parameter in an
     * INSERT ... SELECT target list has no column to take its type from.
     */
    stmts.push(sql`
      INSERT INTO order_tokens (order_id, token_hash, purpose)
      SELECT id, ${accessHash}::text, 'checkout'::text
        FROM orders WHERE ref = ${ref}`);

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

    // Spend the coupon inside the same transaction as the order. The UPDATE
    // only matches while the code is under its cap, and the divide-by-count
    // turns a no-match into a division by zero, so an order that would push a
    // capped code past its limit rolls back whole rather than being placed at a
    // discount the code was not entitled to give. A NULL cap always matches, so
    // an uncapped code just counts up.
    if (couponCode) {
      stmts.push(sql`
        WITH spent AS (
          UPDATE offers
             SET used_count = used_count + 1
           WHERE code = ${couponCode}
             AND active = true
             AND (max_uses IS NULL OR used_count < max_uses)
          RETURNING id
        )
        SELECT 1 / count(*)::int AS guard FROM spent`);

      /*
       * Record WHO redeemed it, and enforce the per-customer cap while doing it.
       *
       * offers.used_count above is a counter, and a counter cannot answer the
       * question the shop asks when a code looks abused: which customer. This
       * writes the row behind that number, inside the same transaction as the
       * order, so the two can never disagree — and it is deleted again by the
       * cancel path in lib/order-status.js, exactly as the counter is
       * decremented there.
       *
       * One statement covers both capped and uncapped codes, and the difference
       * is the slot:
       *
       *   uncapped   `slot` is NULL. A unique index treats two NULLs as
       *              distinct, so the index below does not constrain these rows
       *              at all — an uncapped code is recorded without being
       *              limited, which is the point.
       *   capped     `slot` is the next ordinal for this (code, phone), and
       *              idx_redemptions_slot is UNIQUE over the three. Two
       *              checkouts racing for the last slot both compute the same
       *              number; Postgres makes the second WAIT on the first and
       *              then refuses it. That refusal is what makes the cap exact
       *              rather than a check-then-insert — the same property the
       *              order_attempts claim at the top of this batch relies on.
       *
       * max(slot) + 1 rather than count(*), and the difference matters the
       * moment a cancellation gives a redemption back. With a cap of two: a
       * customer redeems slot 0, redeems slot 1, then cancels the first. count
       * is now 1, so a third order is allowed — correctly, they are holding one
       * — but a count-derived slot would be 1, which already exists, and the
       * order would fail on the unique index instead. Slots are monotonic per
       * (code, phone) and never reused; the CAP is the count, which is the
       * figure that is supposed to move when a redemption is returned.
       *
       * Casts are explicit throughout for the reason the item insert documents:
       * a bare parameter in an INSERT ... SELECT target list has no column to
       * take its type from, and a bare NULL has nothing at all.
       */
      stmts.push(sql`
        WITH claimed AS (
          INSERT INTO offer_redemptions (code, order_id, phone, email, slot)
          SELECT ${couponCode}::text, o.id, ${phone}::text, ${custEmail}::text,
                 CASE WHEN ${couponPerCustomer}::int IS NULL THEN NULL
                      ELSE (SELECT coalesce(max(r.slot), -1) + 1
                              FROM offer_redemptions r
                             WHERE r.code = ${couponCode} AND r.phone = ${phone})
                 END
            FROM orders o
           WHERE o.ref = ${ref}
             AND (${couponPerCustomer}::int IS NULL
                  OR (SELECT count(*) FROM offer_redemptions r
                       WHERE r.code = ${couponCode} AND r.phone = ${phone})
                     < ${couponPerCustomer}::int)
          RETURNING id
        )
        SELECT 1 / count(*)::int AS guard FROM claimed`);
    }

    return stmts;
  };

  /*
   * The order number, drawn once and kept.
   *
   * Here rather than at the top of the route, because everything above this
   * line can still refuse the order and a refused checkout should not consume a
   * number. It cannot be free of gaps regardless - nextval() does not roll
   * back, so a write that fails below burns one - but there is no reason to
   * spend numbers on orders that were never going to be written.
   */
  const [seq] = await sql`SELECT nextval('order_ref_seq')::text AS ref`;
  const ref = seq.ref;
  const reply = replyFor(ref);

  let written = false;
  let writeErr = null;

  /*
   * The loop exists for one case, and it is no longer the reference.
   *
   * 23505 used to mean two orders had drawn the same random reference. A
   * sequence cannot collide, so that meaning is gone. What it means today is
   * the per-customer redemption slot: two checkouts racing for the last use of
   * a capped code compute the same slot number and one loses on
   * idx_redemptions_slot.
   *
   * Retrying the loser is right, and it is right with the SAME reference - its
   * whole batch rolled back, so the reference, the idempotency claim and the
   * stock it touched all went with it. The second attempt re-reads the
   * redemption count, now sees the winner committed, fails the count test in
   * the same statement and is refused as 22012 below. So the loser is told the
   * code is spent rather than being handed a second redemption, which is
   * exactly the outcome the unique index exists to produce.
   */
  for (let attempt = 0; attempt < 5 && !written; attempt++) {
    try {
      await sql.transaction(writeFor(ref, reply));
      written = true;
    } catch (e) {
      writeErr = e;
      if (e?.code !== '23505') break;
    }
  }

  if (!written) {
    console.error('[s7] order failed:', writeErr?.code || '', writeErr?.message || writeErr);

    /*
     * 22012 is division_by_zero — one of our own guards, never a real fault.
     * Four of them can raise it now and they mean different things, so ask
     * which before choosing what to tell the customer.
     *
     * A row under our key can only have been written by somebody else: our own
     * batch rolled back, so whatever it claimed went with it. And the claim
     * blocked until that other transaction finished, so by the time we are
     * here the winner has already committed and its reply is readable. No
     * polling, no retry loop, no sleep — the wait already happened, inside the
     * statement.
     *
     * The customer sees the original order confirmation, which is the truth:
     * their order was placed, exactly once, by the request that got there
     * first.
     */
    if (writeErr?.code === '22012') {
      const lost = await replayed();
      if (lost) return lost;

      /*
       * No claim in the way, so it was the stock guard, the coupon cap guard or
       * the per-customer redemption guard. The stock is the one a customer can
       * act on, so that is the message.
       *
       * The two coupon cases are only reachable by losing a race — both have a
       * courteous check above that catches every sequential attempt and answers
       * precisely — so the wrong-but-harmless wording here is paid by a
       * vanishingly rare caller whose next move ("try again") is the same
       * either way. Distinguishing them would cost two more queries on an error
       * path to improve a sentence almost nobody reads.
       */
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

  // email rides along for the shop's copy, which lists it; the customer's copy never prints it.
  const order = { ref, name, phone, address, city, notes, email: custEmail, subtotal, shipping, discount, total };

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

  /*
   * Two mails to Resend, AFTER the response rather than before it.
   *
   * They were awaited inline, which put two round trips to a third party on the
   * critical path of a checkout — hundreds of milliseconds of a customer
   * staring at "Placing your order…" for work whose result they will not see on
   * this page anyway. The order is already committed by the time we get here,
   * so there is nothing left for the customer to wait on.
   *
   * The try/catch stays and stays wide. A mail failure must never turn a placed
   * order into an error, and now it structurally cannot: the response has
   * already gone out. The same discipline as app/api/subscribe/route.js, which
   * defers its confirmation send for a different reason.
   */
  after(async () => {
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
  });

  /* ----------------------------------------------------------------- reply */

  // The very same object the claim stored, so a retry of this attempt cannot
  // be answered with anything different from what was sent here.
  return ok(reply);
}
