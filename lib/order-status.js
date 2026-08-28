import { sql } from './db.js';

/**
 * The only thing in this codebase that writes orders.status.
 *
 * It used to be an UPDATE in the admin screen. That was fine while the admin
 * screen was the only caller; it stops being fine the moment the customer can
 * cancel their own order and a courier webhook can mark one delivered, because
 * then three callers each hold their own opinion about which moves are legal
 * and which side effects a move has. The first thing to go wrong in that world
 * is stock: cancelling returns it, and two callers that both "handle" a cancel
 * return it twice.
 *
 * So the rule is that nothing else touches the column. Everything goes through
 * transition(), which owns the legal-move table, the side effects, the audit
 * row, and the guarantee that all of them either happen together or not at all.
 *
 * ---------------------------------------------------------------------------
 * Why it is shaped like this
 *
 * Neon's HTTP driver has no interactive transaction. You cannot BEGIN, read a
 * row, decide in JavaScript, and then write — the whole batch is submitted at
 * once. That rules out the obvious check-then-act:
 *
 *     const [row] = await sql`SELECT status ...`;      // <- read
 *     if (row.status !== 'cancelled') { ... }          // <- decide
 *     await sql`UPDATE orders SET status = ...`;       // <- act
 *
 * which is what the admin screen did, and which has a real race in it: two
 * admins pressing Cancel at the same moment both read a non-cancelled status,
 * both proceed, and the stock is credited twice.
 *
 * The fix is to move the decision into the statement. The UPDATE only matches
 * while the order is in a status the move is legal from, and a guarded UPDATE
 * that matches nothing is not an error in Postgres — it is a quiet no-op. So
 * the count is divided into, exactly as the checkout stock guard does: zero
 * rows means division by zero, which aborts the batch and rolls back every
 * other statement in it. Illegal move and lost race both land there, and
 * neither can leave a half-applied cancel behind.
 */

export const STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];

/**
 * Where each status may go next.
 *
 * new / confirmed / shipped move freely between themselves. None of the three
 * touches stock, so an admin who marked something shipped by mistake can walk
 * it back, which is the correction they actually reach for.
 *
 * delivered and cancelled are terminal, and the asymmetry is the point:
 *
 *   cancelled  the stock has been credited back. Moving out of it would have
 *              to take it away again, and the only caller who would want that
 *              is one who cancelled by mistake — rare enough that a data fix
 *              is the honest answer, and far cheaper than a re-decrement path
 *              that can oversell.
 *
 *   delivered  on a cash-on-delivery shop this is where money changed hands
 *              and the goods left. Cancelling from here would credit stock the
 *              shop does not have back. It is also the hole that opens if the
 *              move out of delivered is allowed at all: delivered -> shipped
 *              looks harmless on its own, and then shipped -> cancelled
 *              restocks a delivered order in two hops. A return is a different
 *              transaction with different accounting, not a status flip.
 */
export const LEGAL = {
  new: ['confirmed', 'shipped', 'delivered', 'cancelled'],
  confirmed: ['new', 'shipped', 'delivered', 'cancelled'],
  shipped: ['new', 'confirmed', 'delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/** The moves that are legal from `status`. Drives the admin dropdown. */
export const nextFrom = status => LEGAL[status] ?? [];

/** Whether one specific move is allowed. */
export const canMove = (from, to) => nextFrom(from).includes(to);

/** The statuses `to` may legally be reached from. Empty means unreachable. */
const sourcesFor = to => STATUSES.filter(s => LEGAL[s].includes(to));

const trim = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Move one order to a new status.
 *
 * Returns a result rather than throwing on a refused move, because "you cannot
 * cancel a delivered order" is an answer the caller has to render, not a fault.
 * A genuine database failure still throws.
 *
 *   { ok: true,  from, to, changed }   changed is false when it was already there
 *   { ok: false, reason: 'bad-input' | 'not-found' | 'illegal-transition', from? }
 */
export async function transition({ orderId, to, actor = 'system', note = '' }) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'bad-input' };
  if (!STATUSES.includes(to)) return { ok: false, reason: 'bad-input' };

  /*
   * Saving a status that is already set has to be accepted, not refused. An
   * admin who presses Save without touching the dropdown is not making an
   * illegal move, and an idempotent retry — the same webhook delivered twice —
   * must not turn into an error the caller has to special-case.
   *
   * So `to` is added to its own source list, and the audit row below is
   * suppressed when nothing actually changed. Cancelling is the exception and
   * stays strict: it is the one move with side effects, and accepting it from
   * `cancelled` would credit the stock a second time. A second cancel is
   * refused, which is exactly what the caller wants to tell the customer.
   */
  const from = to === 'cancelled' ? sourcesFor(to) : [...sourcesFor(to), to];
  if (!from.length) return { ok: false, reason: 'illegal-transition' };

  const who = trim(actor, 64) || 'system';
  const why = trim(note, 500);

  /*
   * One statement doing four things, because they have to agree about what the
   * status was a moment ago:
   *
   *   before  reads the current status. A subquery in a CTE sees the snapshot
   *           the statement started with, so this is the value as it was
   *           BEFORE the UPDATE below. It feeds the audit row's from_status
   *           only; the guard does NOT test it (see moved).
   *   moved   applies the change, but only from a status the move is legal
   *           from. The legality test is o.status — the LIVE row, re-checked
   *           by Postgres under READ COMMITTED (EvalPlanQual) against the row
   *           as a concurrent transaction just left it, exactly as the
   *           checkout stock guard tests o.stock. Testing before.was here
   *           instead would compare a stale snapshot and let two concurrent
   *           cancels both apply. Matches nothing if the move is illegal, if
   *           the order does not exist, or if somebody already moved it.
   *   logged  writes the audit row from `moved`, so an event only exists for a
   *           move that actually happened. A data-modifying CTE always runs to
   *           completion whether or not the outer query reads it, so this is
   *           not dead code even though nothing selects from it.
   *   guard   1/0 when `moved` is empty. Aborts the batch.
   *
   * Every cast here is load-bearing, not decoration. A bare parameter in a
   * SELECT target list has no column to take its type from — the same trap the
   * checkout INSERT documents — so Postgres refuses the whole statement with
   * "could not determine data type of parameter". The same is true of a
   * parameter handed to ANY(). Inside `moved` the parameters sit in a SET
   * clause and a comparison against a typed column, so those infer and are
   * left alone.
   */
  const move = sql`
    WITH before AS (
      SELECT id, status AS was FROM orders WHERE id = ${id}
    ), moved AS (
      UPDATE orders o
         SET status = ${to},
             cancelled_at = CASE WHEN ${to} = 'cancelled' THEN now() ELSE o.cancelled_at END
        FROM before b
       WHERE o.id = b.id AND o.status = ANY(${from}::text[])
      RETURNING o.id, b.was
    ), logged AS (
      INSERT INTO order_events (order_id, kind, from_status, to_status, actor, note)
      SELECT id, 'status', was, ${to}::text, ${who}::text, ${why}::text
        FROM moved WHERE was <> ${to}::text
      RETURNING 1
    )
    SELECT 1 / count(*)::int AS guard, max(was) AS from_status FROM moved`;

  const stmts = [move];

  if (to === 'cancelled') {
    /*
     * Put the stock back.
     *
     * Unguarded on purpose. Every order alive in the table had its stock taken
     * at checkout, and the only status this can be reached from is one that
     * has not already been credited — `cancelled` is not in `from`, so a second
     * cancel never gets here. The guard is the one above, and it protects this
     * statement by aborting the batch before it commits.
     *
     * A line whose product row was since deleted has a product_id that joins to
     * nothing. It contributes no restock and no error, which is the right
     * answer: there is no shelf left to put it back on.
     */
    stmts.push(sql`
      UPDATE products p
         SET stock = p.stock + i.qty
        FROM order_items i
       WHERE i.product_id = p.id AND i.order_id = ${id}`);

    /*
     * Give the coupon use back.
     *
     * Checkout spends a redemption inside the order's own transaction, and a
     * capped code that is spent on an order that never happens is a discount
     * the shop has thrown away. GREATEST() rather than a bare subtraction
     * because used_count is not allowed to go negative, and a code that was
     * edited or re-created since the order was placed is the one case where
     * the two counters can legitimately disagree.
     */
    stmts.push(sql`
      UPDATE offers f
         SET used_count = GREATEST(0, f.used_count - 1)
        FROM orders o
       WHERE o.id = ${id} AND o.coupon <> '' AND f.code = o.coupon`);
  }

  let results;
  try {
    results = await sql.transaction(stmts);
  } catch (e) {
    // 22012 is division_by_zero — our own guard, not a fault. Anything else is.
    if (e?.code !== '22012') throw e;

    // Only now, and only to pick the right message. The batch above is the
    // authority on what happened; this read is after the fact and racy, so it
    // decides wording and nothing else.
    const [row] = await sql`SELECT status FROM orders WHERE id = ${id}`;
    if (!row) return { ok: false, reason: 'not-found' };
    return { ok: false, reason: 'illegal-transition', from: row.status };
  }

  // The driver hands back one result per statement, and whether a result is the
  // rows array itself or an object wrapping it depends on how the client was
  // configured. Read both shapes rather than betting on the default: getting
  // this wrong would not throw, it would silently report every move as a no-op.
  const first = results?.[0];
  const row = (Array.isArray(first) ? first[0] : first?.rows?.[0]) ?? {};
  const was = row.from_status ?? '';
  return { ok: true, from: was, to, changed: was !== to };
}

/**
 * An event that is not a status change — a refund request, a note, a mail that
 * went out. Same timeline, so the customer's page and the shop's audit trail
 * stay one list rather than two that have to be merged at read time.
 */
export async function logEvent({ orderId, kind, actor = 'system', note = '' }) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) return false;
  if (!['note', 'refund-request', 'mail'].includes(kind)) return false;

  try {
    await sql`
      INSERT INTO order_events (order_id, kind, actor, note)
      VALUES (${id}, ${kind}, ${trim(actor, 64) || 'system'}, ${trim(note, 500)})`;
    return true;
  } catch (e) {
    // The timeline is a record of what happened, never a reason for it to fail.
    console.error('[s7] order event failed:', e?.message || e);
    return false;
  }
}

/** One order's timeline, oldest first. */
export async function eventsFor(orderId) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) return [];
  return sql`
    SELECT id, kind, from_status, to_status, actor, note, created_at
      FROM order_events
     WHERE order_id = ${id}
     ORDER BY id`;
}
