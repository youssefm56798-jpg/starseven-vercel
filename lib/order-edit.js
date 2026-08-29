import { sql } from './db.js';
import { site } from './config.js';
import { cartTotals, discountFor } from './pricing.js';
import { normalizePhone } from './phone.js';

/**
 * Changing an order after it has been placed.
 *
 * On a cash-on-delivery shop the confirmation call IS the workflow. The shop
 * rings, and the customer says "make it two jars not one", "the address is
 * wrong", "add the gel as well", "I forgot the discount code". Until this
 * module existed the admin could do exactly two things — move the status and
 * write a note — so every one of those sentences was answered by cancelling
 * the order and asking the customer to place it again. That is a worse
 * experience, it loses the order about a third of the time, and it inflates
 * the one number a cash-on-delivery shop is judged on.
 *
 * ---------------------------------------------------------------------------
 * Everything app/api/order/route.js does, this has to do again
 *
 * An edit is a second checkout for the same order, so it inherits the whole of
 * that route's discipline and none of it is optional:
 *
 *   prices come from the database   nothing the browser sends about money is
 *                                   read. A line that survives the edit keeps
 *                                   the price recorded ON THE ORDER, and a
 *                                   line being added takes the price from
 *                                   products. Both are the database; neither
 *                                   is the form.
 *   totals are recomputed           lib/pricing.js, the same two functions
 *                                   checkout calls, over the whole basket.
 *   stock moves under a guard       a guarded UPDATE plus SELECT 1 / count(*),
 *                                   so a zero-row match divides by zero and
 *                                   Postgres rolls the batch back rather than
 *                                   overselling.
 *   the coupon is spent in the      and returned in the same one, when the code
 *   same transaction                changes. A redemption that outlives the
 *                                   order it paid for is money given away.
 *
 * ---------------------------------------------------------------------------
 * Why the decisions live inside the statements
 *
 * Neon over HTTP has no interactive transaction. There is no BEGIN, read, decide
 * in JavaScript, write — the batch is submitted in one go. lib/order-status.js
 * explains this at length and the shape here is the same one: every decision
 * that another request could invalidate is written into the WHERE clause of the
 * statement that depends on it, and the row count is divided into so that a
 * guard which matches nothing aborts the whole batch.
 *
 * There are four such decisions in an edit, and each has its own guard:
 *
 *   the order is still editable   tested on the LIVE row inside the UPDATE, not
 *                                 on the copy read a moment earlier. A cancel
 *                                 landing between the read and the write must
 *                                 make this edit disappear, or the edit would
 *                                 take stock for an order that has already
 *                                 given its stock back.
 *   nobody edited it first        edit_seq is a compare-and-swap. Two admins
 *                                 who both press Save with the same basket in
 *                                 front of them read the same sequence, and
 *                                 exactly one UPDATE can match it. The loser
 *                                 matches no rows, divides by zero, and its
 *                                 stock, its items and its coupon all roll back
 *                                 together. Without it both edits would apply
 *                                 one after the other and the second would
 *                                 compute its totals from a basket that no
 *                                 longer existed when it read it.
 *   there is enough stock         guarded per product, exactly as checkout does.
 *   the coupon is under its cap   guarded on max_uses, exactly as checkout does.
 *
 * ---------------------------------------------------------------------------
 * What this module deliberately does not do
 *
 * It never writes orders.status. That column has one writer — lib/order-status.js
 * — and an edit is not a move. It reads the column in a WHERE clause, which is
 * the opposite of owning it.
 *
 * It never writes expected_from / expected_to. Those are a promise the customer
 * has already been shown, and lib/order-status.js fills them once and never
 * moves them. An edit that slid the arrival date every time somebody corrected
 * a phone number would be the same bug from a new direction.
 *
 * It does not re-price the lines that survive. The price on an order line is
 * what the customer agreed to, and a catalogue that went up 10 EGP overnight
 * must not quietly raise the bill of an order placed yesterday because somebody
 * corrected the flat number in the address. Only a line being ADDED is priced
 * from the catalogue, because it has never been agreed at any other price.
 */

/**
 * The statuses an order may be edited in.
 *
 * Kept apart from LEGAL in lib/order-status.js for the reason SELF_CANCELLABLE
 * is kept apart from it: those tables answer different questions. LEGAL says
 * which status moves are coherent. This says which orders the shop may still
 * change the contents of, and the two would give the wrong answer to each other
 * if they were merged.
 *
 *   new         nothing has happened yet beyond the customer pressing Confirm.
 *   confirmed   the call has happened, which is exactly where these changes
 *               come from. This is the status the whole feature is for.
 *
 *   shipped     no. The parcel is with a courier and its contents are fixed;
 *               so is the amount written on the waybill, which is what the
 *               driver will collect at the door. Editing here would change the
 *               order in the database and not the box in the van, and the
 *               difference is discovered by a stranger on a doorstep with the
 *               wrong money in his hand. The same line lib/order-status.js
 *               draws for a customer cancelling their own order, drawn for the
 *               same physical reason.
 *   delivered   terminal. The goods are gone and the cash is counted. Editing
 *               would change what the shop believes it sold after it sold it.
 *   cancelled   terminal. The stock has already been credited back from the
 *               lines as they were at the moment of the cancel, so changing
 *               those lines afterwards would make the credit wrong in
 *               retrospect, with nothing left to correct it against.
 */
export const EDITABLE = ['new', 'confirmed'];

/** Whether this order may be edited at all. Drives the admin screen. */
export const canEdit = status => EDITABLE.includes(status);

/** The ceiling checkout puts on one line. An edit may not go past it either. */
export const MAX_QTY = 20;

/**
 * The ceiling on how many distinct lines an order may carry.
 *
 * Not a business rule so much as a bound on the transaction: every line is up
 * to three statements in a batch that has to be submitted in one HTTP request,
 * and an unbounded basket is an unbounded batch.
 */
export const MAX_LINES = 24;

const round2 = n => Math.round(n * 100) / 100;
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const amount = n => Number(n || 0).toFixed(2);
const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * A quantity from a form, or null when it is not one.
 *
 * Strict rather than forgiving, and the empty string is the reason. `Number('')`
 * is 0, and 0 means "remove this line" — so a field that failed to submit, or a
 * name typo in the form, would silently delete a line off somebody's order. A
 * value out of range is refused rather than clamped for the same reason: an
 * admin who typed 100 should be told, not quietly given 20.
 */
function qtyOf(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) return null;
  return n;
}

/**
 * What changed, in one line, for the audit row.
 *
 * This is the sentence somebody reads six weeks later when a customer says they
 * were charged for something they never asked for, so it names the lines by the
 * name that was on the order, gives both sides of every number, and quotes the
 * old address rather than only the new one. The alternative — "order edited" —
 * is a row that proves an edit happened and settles nothing about what it was.
 */
export function describeEdit(before, after) {
  const parts = [];
  const lines = [];

  const was = new Map(before.items.map(i => [i.key, i]));
  const now = new Map(after.items.map(i => [i.key, i]));

  for (const [key, item] of now) {
    const old = was.get(key);
    if (!old) lines.push(`+ ${item.name} x${item.qty} at ${amount(item.price)}`);
    else if (Number(old.qty) !== Number(item.qty)) lines.push(`${item.name} x${old.qty} to x${item.qty}`);
  }
  for (const [key, item] of was) {
    if (!now.has(key)) lines.push(`- ${item.name} x${item.qty} removed`);
  }
  if (lines.length) parts.push(`items: ${lines.join('; ')}`);

  for (const [label, a, b] of [
    ['subtotal', before.subtotal, after.subtotal],
    ['discount', before.discount, after.discount],
    ['shipping', before.shipping, after.shipping],
    ['total', before.total, after.total],
  ]) {
    if (amount(a) !== amount(b)) parts.push(`${label} ${amount(a)} to ${amount(b)}`);
  }

  if (before.coupon !== after.coupon) {
    parts.push(`coupon ${before.coupon || 'none'} to ${after.coupon || 'none'}`);
  }

  for (const [label, a, b] of [
    ['phone', before.phone, after.phone],
    ['address', before.address, after.address],
    ['city', before.city, after.city],
    ['notes', before.notes, after.notes],
  ]) {
    if (String(a ?? '') !== String(b ?? '')) {
      parts.push(`${label}: "${a || ''}" to "${b || ''}"`);
    }
  }

  // Capped, because the note column is read by a human in a list. An edit big
  // enough to overflow this is one where the line detail matters most, and the
  // line detail is written first.
  return parts.join(' | ').slice(0, 2000);
}

/**
 * Edit one order.
 *
 * Returns a result rather than throwing on a refusal, exactly as transition()
 * does and for the same reason: "there are not three of those left" is an
 * answer the admin screen has to render, not a fault. A genuine database
 * failure still throws.
 *
 *   { ok: true, changed: false }                          nothing to do
 *   { ok: true, changed: true, orderId, ref, notify, summary, before, after }
 *   { ok: false, reason, ... }
 *
 * Reasons: bad-input, not-found, not-editable (with from), stale, empty,
 * too-many, unknown-sku (with sku), unpriced (with sku), no-stock (with sku),
 * bad-phone, bad-address, coupon-invalid, coupon-spent, coupon-min (with min),
 * coupon-gone, conflict.
 *
 * @param {object}  p
 * @param {number}  p.orderId
 * @param {string}  p.actor      who to record. 'admin:<id>' from the panel.
 * @param {number=} p.expectSeq  the edit_seq the form was rendered against.
 * @param {Array=}  p.lines      [{ id, qty }] for lines already on the order.
 * @param {Array=}  p.add        [{ sku, qty }] for lines being added.
 * @param {string=} p.coupon     the new code, '' to remove it, undefined to
 *                               leave it alone.
 * @param {object=} p.contact    { phone?, address?, city?, notes? }
 */
export async function editOrder({
  orderId,
  actor = 'system',
  expectSeq = null,
  lines = [],
  add = [],
  coupon = undefined,
  contact = undefined,
}) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) return refuse('bad-input');
  if (!Array.isArray(lines) || !Array.isArray(add)) return refuse('bad-input');

  const who = clean(actor, 64) || 'system';

  /* ----------------------------------------------------------------- read */

  const [order] = await sql`
    SELECT id, ref, lang, status, coupon, phone, address, city, notes,
           subtotal, discount, shipping, total, edit_seq
      FROM orders WHERE id = ${id}`;

  if (!order) return refuse('not-found');
  if (!canEdit(order.status)) return refuse('not-editable', { from: order.status });

  /*
   * The sequence the form was rendered against, if the caller kept one.
   *
   * This is the courteous half of the concurrency story and it is not the
   * guarantee — the compare-and-swap in the write is. What it catches is the
   * other shape of the same problem: a form opened an hour ago, edited in
   * another tab since, and then submitted. The quantities in that form describe
   * a basket that no longer exists, and applying them would silently undo the
   * other edit. The write cannot catch that on its own, because by then this
   * request has already re-read the order and would happily swap against the
   * new sequence.
   */
  const seq = Number(order.edit_seq) || 0;
  if (expectSeq !== null && expectSeq !== undefined && Number(expectSeq) !== seq) {
    return refuse('stale');
  }

  const existing = await sql`
    SELECT id, product_id, sku, name, price, qty
      FROM order_items WHERE order_id = ${id} ORDER BY id`;

  /* ---------------------------------------------------------------- lines */

  /**
   * The basket, as rows keyed by the order_items id they came from.
   *
   * Keyed on the row id rather than on the SKU because a SKU is not a key here:
   * order_items.sku defaults to the empty string and rows written before it was
   * populated still carry one. The row id is the only thing every line has.
   */
  const basket = new Map();
  for (const it of existing) {
    basket.set(String(it.id), {
      key: `row:${it.id}`,
      itemId: Number(it.id),
      productId: it.product_id === null ? null : Number(it.product_id),
      sku: it.sku || '',
      name: it.name,
      price: Number(it.price),
      qty: Number(it.qty),
      wasQty: Number(it.qty),
    });
  }

  for (const line of lines) {
    if (!line || typeof line !== 'object') return refuse('bad-input');
    const row = basket.get(String(line.id));
    // An id that is not on this order is refused rather than ignored. Ignoring
    // it would let a form aimed at the wrong order half-apply.
    if (!row) return refuse('bad-input');
    const qty = qtyOf(line.qty);
    if (qty === null) return refuse('bad-input');
    row.qty = qty;
  }

  /* ------------------------------------------------------------ additions */

  const wanted = new Map();
  for (const line of add) {
    if (!line || typeof line !== 'object') return refuse('bad-input');
    const sku = clean(line.sku, 64);
    if (!sku) continue;
    const qty = qtyOf(line.qty);
    if (qty === null) return refuse('bad-input');
    if (qty === 0) continue;
    wanted.set(sku, Math.min(MAX_QTY, (wanted.get(sku) || 0) + qty));
  }

  if (wanted.size) {
    // One query for everything being added, and the prices come from here and
    // nowhere else — the same sentence app/api/order/route.js writes over the
    // same query.
    const found = await sql`
      SELECT id, sku, name_ar, name_en, price
        FROM products
       WHERE sku = ANY(${[...wanted.keys()]}::text[])
         AND active = true`;

    const bySku = new Map(found.map(p => [p.sku, p]));

    for (const [sku, qty] of wanted) {
      const p = bySku.get(sku);
      if (!p) return refuse('unknown-sku', { sku });

      const price = Number(p.price);
      // The rule checkout states out loud rather than leaning on stock being 0:
      // an unpriced product is one the manufacturer has given no price for, and
      // selling it at zero on a cash-on-delivery shop is a driver at the door
      // with free product.
      if (!(price > 0)) return refuse('unpriced', { sku });

      const productId = Number(p.id);

      /*
       * Adding a product the order already has is a quantity change, not a
       * second line.
       *
       * Two rows for one SKU would be legal in the table and wrong everywhere
       * else: the customer order page keys its list on the SKU, so one of the
       * two would not render, and the stock arithmetic below would have to
       * reconcile two rows that disagree about the same shelf. It is also
       * never what the admin meant.
       *
       * The extra units go on at the price already on that line, not at
       * today catalogue price, which is the same rule the surviving lines
       * follow: one order line is one agreed price, and "make it two" on the
       * phone means two of what was agreed. The shop can only lose money on
       * this, never the customer, and the alternative is one line whose total
       * cannot be arrived at from its own price and quantity.
       */
      const already = [...basket.values()].find(r => r.qty > 0 && r.productId === productId);
      if (already) {
        const merged = already.qty + qty;
        if (merged > MAX_QTY) return refuse('bad-input');
        already.qty = merged;
        continue;
      }

      basket.set(`add:${sku}`, {
        key: `sku:${sku}`,
        itemId: null,
        productId,
        sku,
        name: order.lang === 'en' ? p.name_en : p.name_ar,
        price,
        qty,
      });
    }
  }

  const kept = [...basket.values()].filter(r => r.qty > 0);

  // An order with no lines is not an order. The way to end one is to cancel it,
  // which returns the stock, returns the coupon and tells the customer — none
  // of which emptying the basket here would do.
  if (!kept.length) return refuse('empty');

  /*
   * The ceiling stops an order GROWING past what one batch should carry, and
   * says nothing about one that is already there. Checkout puts no limit on how
   * many distinct products go in a basket, so an order with more lines than
   * this can exist — and refusing to correct the address on it, forever,
   * because of a bound that is about transaction size would be the ceiling
   * doing harm instead of work.
   */
  if (kept.length > MAX_LINES && kept.length > existing.length) return refuse('too-many');

  const subtotal = round2(kept.reduce((sum, r) => sum + r.price * r.qty, 0));

  /* --------------------------------------------------------------- coupon */

  const asked = coupon === undefined ? order.coupon : clean(coupon, 64).toUpperCase();
  const couponChanged = asked !== order.coupon;

  /**
   * Whether this edit can change what the order costs at all.
   *
   * Every figure is recomputed from the database whenever it CAN have moved —
   * any change to the lines, and any change to the code. What this flag stops
   * is a recompute when nothing about the basket was touched, and that is not
   * an optimisation, it is a correctness rule:
   *
   *   The discount is derived from the offers row, and that row can be edited.
   *   An offer that was 10 percent when the order was placed and is 5 percent
   *   today would, on a blind recompute, quietly RAISE the amount a customer
   *   owes at the door because somebody corrected a house number. The order
   *   already carries the figures it was agreed at; leaving them alone is what
   *   keeps a correction to the address a correction to the address.
   *
   *   It also stops an unrelated refusal blocking the most urgent edit there
   *   is. A code deleted from the Offers screen months ago cannot be priced,
   *   and refusing to save a WRONG ADDRESS over it would be absurd.
   *
   * When the basket or the code does move, the whole sum is redone from the
   * database and the admin sees the new total before the customer does.
   */
  const touchesMoney = lines.length > 0 || add.length > 0 || coupon !== undefined;

  let discount = 0;

  if (asked && touchesMoney) {
    /*
     * A code that is being kept is looked up by code alone; a code that is
     * being applied now has to pass everything checkout would ask of it.
     *
     * The asymmetry is the point. active, starts_at and ends_at say whether a
     * code may be CLAIMED, and this order claimed it when it was placed — an
     * offer that ended yesterday is not a reason to quietly take a discount off
     * an order somebody already agreed to, in a screen they opened to correct
     * a house number.
     */
    const [off] = couponChanged
      ? await sql`
          SELECT code, discount_type, discount_value, min_total, max_uses, used_count
            FROM offers
           WHERE code = ${asked}
             AND active = true
             AND (starts_at IS NULL OR starts_at <= now())
             AND (ends_at   IS NULL OR ends_at   >= now())
           LIMIT 1`
      : await sql`
          SELECT code, discount_type, discount_value, min_total, max_uses, used_count
            FROM offers WHERE code = ${asked} LIMIT 1`;

    if (!off) return refuse(couponChanged ? 'coupon-invalid' : 'coupon-gone');

    // The courteous check. The guard inside the write is what enforces it,
    // because two edits can pass this line at once.
    if (couponChanged && off.max_uses != null && Number(off.used_count) >= Number(off.max_uses)) {
      return refuse('coupon-spent');
    }

    const min = Number(off.min_total) || 0;
    if (subtotal < min) return refuse('coupon-min', { min });

    discount = discountFor(subtotal, off);
  }

  /*
   * The whole sum, through the same two functions checkout uses.
   *
   * The delivery fee and the free-delivery threshold are read from the
   * environment, so a recompute prices the order at TODAY rates. That is right
   * when the basket has changed — it is a new basket and the admin is quoting
   * it on the phone — and wrong when nothing has, which is why the figures the
   * order already carries are written straight back rather than re-derived.
   * A shop that raised its delivery fee last week must not raise it on an
   * order placed before that because somebody corrected a house number.
   */
  const t = touchesMoney
    ? cartTotals(subtotal, discount, site.shipping, site.freeOver)
    : {
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      shipping: Number(order.shipping),
      total: Number(order.total),
    };

  /* -------------------------------------------------------------- contact */

  const patch = contact && typeof contact === 'object' ? contact : {};

  let phone = order.phone;
  if (patch.phone !== undefined) {
    phone = normalizePhone(patch.phone);
    if (!phone) return refuse('bad-phone');
  }

  let address = order.address;
  if (patch.address !== undefined) {
    address = clean(patch.address, 255);
    // The same floor checkout puts on it. An edit must not be able to leave an
    // order in a state checkout would have refused to create.
    if (address.length < 8) return refuse('bad-address');
  }

  const city = patch.city === undefined ? order.city : clean(patch.city, 80);
  const notes = patch.notes === undefined ? order.notes : clean(patch.notes, 500);

  /* ----------------------------------------------------------- what moved */

  const before = {
    items: existing.map(i => ({
      key: `row:${i.id}`, name: i.name, qty: Number(i.qty), price: Number(i.price),
    })),
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    shipping: Number(order.shipping),
    total: Number(order.total),
    coupon: order.coupon,
    phone: order.phone,
    address: order.address,
    city: order.city,
    notes: order.notes,
  };

  const after = {
    items: kept.map(r => ({ key: r.key, name: r.name, qty: r.qty, price: r.price })),
    subtotal: t.subtotal,
    discount: t.discount,
    shipping: t.shipping,
    total: t.total,
    coupon: asked,
    phone,
    address,
    city,
    notes,
  };

  const summary = describeEdit(before, after);

  // Nothing to do. Said before the write rather than after it, so an admin who
  // presses Save without touching anything does not bump the sequence, does not
  // write an audit row that says nothing, and above all does not email the
  // customer to tell them their order is exactly as it was.
  if (!summary) return { ok: true, changed: false, orderId: id, ref: order.ref };

  /*
   * Whether the customer hears about it.
   *
   * Everything on this order except one field is something they would recognise
   * on their own page or at their own door: the lines, the money, the address
   * the parcel is going to and the number the courier will ring. `notes` is the
   * delivery note, and an admin tidying it is not news. See lib/order-notify.js
   * for what is actually sent and why it is sent at all.
   */
  const sameLines =
    before.items.length === after.items.length &&
    before.items.every((i, n) => i.key === after.items[n].key && i.qty === after.items[n].qty);

  const notify = !sameLines ||
    amount(before.total) !== amount(after.total) ||
    before.coupon !== after.coupon ||
    before.phone !== after.phone ||
    before.address !== after.address ||
    before.city !== after.city;

  /* ------------------------------------------------------- stock movement */

  /**
   * Net units per product, over the whole edit.
   *
   * Netted rather than applied per line, because two lines can point at one
   * product — a merge that has just happened above, or historical data — and
   * two separate UPDATEs against the same shelf would each pass their own guard
   * while the pair oversells.
   *
   * A line whose product row is gone contributes nothing in either direction:
   * there is no shelf to take from or put back on, which is the same answer
   * lib/order-status.js gives when it credits a cancelled order.
   */
  const delta = new Map();
  const bump = (pid, n) => { if (pid !== null) delta.set(pid, (delta.get(pid) || 0) + n); };
  for (const r of basket.values()) {
    if (r.itemId !== null) bump(r.productId, -r.wasQty);
  }
  for (const r of kept) bump(r.productId, r.qty);

  /* ---------------------------------------------------------------- write */

  const stmts = [];

  /*
   * The order row, and it goes FIRST.
   *
   * Three things at once, because they have to agree with each other:
   *
   *   the money        recomputed above from the database and from
   *                    lib/pricing.js, never from the form.
   *   the guard        the WHERE clause is the entire concurrency story. It
   *                    tests the LIVE row — Postgres re-evaluates it under READ
   *                    COMMITTED against the row as a concurrent transaction
   *                    just left it — so a cancel that lands between the read
   *                    above and this write makes the status test fail, and a
   *                    second edit that got here first makes the sequence test
   *                    fail. Either way this batch matches no rows, divides by
   *                    zero and rolls back whole: no stock taken, no items
   *                    changed, no coupon spent.
   *   the audit row    written from the CTE, so an event can only exist for an
   *                    edit that actually happened. A data-modifying CTE runs to
   *                    completion whether or not the outer query reads it.
   *
   * First in the batch for the reason the idempotency claim in
   * app/api/order/route.js is first: a loser that had already decremented stock
   * would sit on those product rows while it waited to find out it had lost,
   * and every unrelated order for the same product would queue behind a
   * transaction that is about to roll back anyway.
   *
   * The status column is READ here and never written. Its one writer is
   * lib/order-status.js and an edit is not a move.
   *
   * The casts in the audit INSERT are load-bearing: a bare parameter in an
   * INSERT ... SELECT target list has no column to take its type from, which
   * is the trap this repository has now hit three times.
   */
  stmts.push(sql`
    WITH edited AS (
      UPDATE orders o
         SET subtotal = ${t.subtotal},
             discount = ${t.discount},
             shipping = ${t.shipping},
             total    = ${t.total},
             coupon   = ${asked},
             phone    = ${phone},
             address  = ${address},
             city     = ${city},
             notes    = ${notes},
             edit_seq = o.edit_seq + 1
       WHERE o.id = ${id}
         AND o.edit_seq = ${seq}
         AND o.status = ANY(${EDITABLE}::text[])
      RETURNING o.id
    ), logged AS (
      INSERT INTO order_events (order_id, kind, actor, note)
      SELECT id, 'edit', ${who}::text, ${summary}::text FROM edited
      RETURNING 1
    )
    SELECT 1 / count(*)::int AS guard FROM edited`);

  /*
   * The shelves.
   *
   * Sorted by product id, and that is not cosmetic: two edits touching the same
   * two products in opposite orders would take one row each and then wait on
   * each other forever. A fixed order makes that impossible between two edits.
   * It does not make it impossible between an edit and a checkout, which walks
   * its basket in whatever order the products query returned — that one is
   * still a real if rare deadlock, Postgres detects it and aborts one side, and
   * the catch below turns the abort into an answer the admin can act on rather
   * than a stack trace.
   *
   * Taking more is guarded and can fail the whole edit. Giving back is not,
   * for the same reason the restock in lib/order-status.js is not: every unit
   * being returned was taken from that row by this same shop, and a product
   * row that has since been deleted simply matches nothing.
   */
  for (const [productId, n] of [...delta.entries()].sort((a, b) => a[0] - b[0])) {
    if (n === 0) continue;
    if (n > 0) {
      stmts.push(sql`
        WITH taken AS (
          UPDATE products
             SET stock = stock - ${n}
           WHERE id = ${productId} AND stock >= ${n}
          RETURNING id
        )
        SELECT 1 / count(*)::int AS guard FROM taken`);
    } else {
      stmts.push(sql`
        UPDATE products SET stock = stock + ${-n} WHERE id = ${productId}`);
    }
  }

  /*
   * The lines.
   *
   * Unguarded, and they can be: nothing in this codebase writes order_items
   * except the checkout that creates them and this module, and this module
   * bumps edit_seq in the same transaction every time it does. So a basket read
   * under one sequence cannot have been rewritten by anybody by the time the
   * swap on that sequence succeeds.
   *
   * Every statement is scoped by order_id as well as by row id. The ids arrive
   * from a form, and an id belonging to another order must not be reachable
   * even by an admin holding a valid session and a hand-written request.
   */
  for (const r of basket.values()) {
    if (r.itemId === null) continue;
    if (r.qty === 0) {
      stmts.push(sql`DELETE FROM order_items WHERE id = ${r.itemId} AND order_id = ${id}`);
    } else if (r.qty !== r.wasQty) {
      stmts.push(sql`
        UPDATE order_items SET qty = ${r.qty}
         WHERE id = ${r.itemId} AND order_id = ${id}`);
    }
  }

  for (const r of kept) {
    if (r.itemId !== null) continue;
    // VALUES, so each parameter takes its type from the column above it and no
    // cast is needed — unlike the INSERT ... SELECT in the audit row above.
    stmts.push(sql`
      INSERT INTO order_items (order_id, product_id, sku, name, price, qty)
      VALUES (${id}, ${r.productId}, ${r.sku}, ${r.name}, ${r.price}, ${r.qty})`);
  }

  /*
   * The coupon, when it changed.
   *
   * The old redemption goes back and the new one is spent, in this same
   * transaction, so there is no window in which the shop has taken two
   * redemptions for one order or none for the discount it is about to give.
   *
   * GREATEST(0, ...) on the way back for the reason the cancel path has it:
   * used_count may not go negative, and a code that was re-created since the
   * order was placed is the one case where the two counters can honestly
   * disagree. The spend is guarded on the cap, so an edit that would push a
   * capped code past its limit rolls back whole rather than handing out a
   * discount the code was not entitled to give.
   */
  if (couponChanged) {
    if (order.coupon) {
      stmts.push(sql`
        UPDATE offers SET used_count = GREATEST(0, used_count - 1)
         WHERE code = ${order.coupon}`);
    }
    if (asked) {
      stmts.push(sql`
        WITH spent AS (
          UPDATE offers
             SET used_count = used_count + 1
           WHERE code = ${asked}
             AND active = true
             AND (max_uses IS NULL OR used_count < max_uses)
          RETURNING id
        )
        SELECT 1 / count(*)::int AS guard FROM spent`);
    }
  }

  try {
    await sql.transaction(stmts);
  } catch (e) {
    /*
     * 40P01 is deadlock_detected. Postgres has already rolled this batch back
     * whole, so nothing is half-applied; what is left is to say something
     * useful. It is the same answer a lost compare-and-swap gets, because it is
     * the same situation from the admin point of view: somebody else was
     * writing at the same moment, nothing was saved, try again. Letting it
     * escape as an exception would show a stack trace for a condition the
     * screen knows how to render.
     */
    if (e?.code === '40P01') return refuse('conflict');

    // 22012 is division_by_zero — one of our own guards, never a real fault.
    if (e?.code !== '22012') throw e;

    /*
     * Which guard fired, asked after the fact.
     *
     * The batch is the authority on what happened and it has already rolled
     * back; these reads decide nothing but the wording. They are racy by
     * construction, which is why the fallback is a refusal that tells the admin
     * to reload rather than a claim about a specific cause.
     */
    return await explain(id, seq, delta, asked, couponChanged);
  }

  return { ok: true, changed: true, orderId: id, ref: order.ref, notify, summary, before, after };
}

/** Why a guarded batch matched nothing. Wording only — see the caller. */
async function explain(id, seq, delta, coupon, couponChanged) {
  const [row] = await sql`SELECT status, edit_seq FROM orders WHERE id = ${id}`;
  if (!row) return refuse('not-found');
  if (!canEdit(row.status)) return refuse('not-editable', { from: row.status });
  if (Number(row.edit_seq) !== seq) return refuse('stale');

  const takes = new Map([...delta.entries()].filter(([, n]) => n > 0));
  if (takes.size) {
    const rows = await sql`
      SELECT id, sku, stock FROM products WHERE id = ANY(${[...takes.keys()]}::int[])`;
    // A product that has been deleted outright is also a reason the take
    // matched nothing, and it reads to an admin exactly as an empty shelf does.
    const byId = new Map(rows.map(r => [Number(r.id), r]));
    for (const [pid, want] of takes) {
      const p = byId.get(pid);
      if (!p) return refuse('no-stock', { sku: '', stock: 0 });
      if (Number(p.stock) < want) {
        return refuse('no-stock', { sku: p.sku, stock: Number(p.stock) });
      }
    }
  }

  if (couponChanged && coupon) {
    const [off] = await sql`
      SELECT max_uses, used_count, active FROM offers WHERE code = ${coupon} LIMIT 1`;
    if (!off || !off.active) return refuse('coupon-invalid');
    if (off.max_uses != null && Number(off.used_count) >= Number(off.max_uses)) {
      return refuse('coupon-spent');
    }
  }

  return refuse('conflict');
}
