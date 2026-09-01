import Link from 'next/link';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import { requirePermission } from '../../_lib/guard.js';
import { can } from '../../../../lib/admin-roles.js';
import { dt, Flash, money, waLink } from '../../_lib/ui.js';
import { STATUSES, nextFrom } from '../../../../lib/order-status.js';
import { transitionAndNotify } from '../../../../lib/order-notify.js';
import { formatRef, normaliseRef, isRef } from '../../../../lib/order-number.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders — Star Seven admin' };

const title = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Rebuilds the filter query string from validated parts, never from raw input. */
function backTo(status, q, msg) {
  const p = new URLSearchParams();
  if (STATUSES.includes(status)) p.set('status', status);
  if (q) p.set('q', q);
  if (msg) p.set('m', msg);
  const s = p.toString();
  return `/admin/orders${s ? `?${s}` : ''}`;
}

async function saveStatus(formData) {
  'use server';
  const admin = await requirePermission('orders:write');

  const status = String(formData.get('status') || '');
  const fStatus = String(formData.get('f_status') || '');
  const fQ = String(formData.get('q_back') || '').slice(0, 80);
  const id = Number(formData.get('id'));

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(fStatus, fQ, 'csrf'));
  if (!Number.isInteger(id) || id <= 0 || !STATUSES.includes(status)) redirect(backTo(fStatus, fQ, 'bad_input'));

  /*
   * This used to read the status, decide in JavaScript, then write — three
   * round-trips with no transaction around them. Two of the failures that
   * shape had were real: a crash between the status UPDATE and the restock
   * left an order cancelled with its stock never returned, and two admins
   * pressing Cancel at the same moment both read a live status and both
   * credited the stock. The coupon a cancelled order had spent was never given
   * back at all.
   *
   * transition() does the whole thing as one transaction and owns which moves
   * are legal. See lib/order-status.js. The notify wrapper mails the customer
   * once the response has gone out, so pressing Save is not held up by Resend.
   */
  const res = await transitionAndNotify({ orderId: id, to: status, actor: `admin:${admin.id}` });

  if (!res.ok) {
    redirect(backTo(fStatus, fQ, res.reason === 'not-found' ? 'bad_input' : 'bad_move'));
  }

  if (!res.changed) redirect(backTo(fStatus, fQ, 'order_saved'));
  if (status === 'cancelled') redirect(backTo(fStatus, fQ, 'order_cancelled'));
  redirect(backTo(fStatus, fQ, 'order_saved'));
}

/**
 * Give back the stock that unconfirmed orders are sitting on, right now.
 *
 * ---------------------------------------------------------------------------
 * Why a button exists when a sweep already runs
 *
 * The nightly sweep bounds the damage from a flood of fake orders; it does not
 * end it. Somebody who scripts two hundred orders at 3am takes the catalogue to
 * "out of stock" and it STAYS there until the hold expires — which is correct,
 * unattended behaviour, and completely useless to whoever opens the shop at 9am
 * and finds nothing sellable.
 *
 * This is the thing they reach for. One press, the stock is back, and the shop
 * is trading again in seconds rather than hours.
 *
 * ---------------------------------------------------------------------------
 * It is deliberately blunt, and deliberately owner-only
 *
 * It cancels every unconfirmed, unverified `new` order older than an hour. Some
 * of those may be real customers who simply have not been rung yet, and they
 * get the ordinary cancellation email inviting them to say if they still want
 * it. That is a real cost and it is the right trade in the situation this
 * exists for: a shop that cannot sell anything is losing every order, not some.
 *
 * The hour is what protects the checkout that is happening right now. Without
 * it, pressing this during normal trading would cancel an order placed thirty
 * seconds ago while its customer was still reading the confirmation.
 *
 * Owner-only, because it is bulk order cancellation — the most destructive
 * single action in this panel — and because `products:write` is already where
 * this codebase draws the line for stock. Staff answering the phone do not need
 * it and should not be one mis-click from it.
 *
 * Every cancellation goes through transitionAndNotify, so each one restocks,
 * returns its coupon and writes its own audit row naming who pressed this.
 */
const PANIC_MIN_AGE_MINUTES = 60;
const PANIC_BATCH = 200;

async function releaseHeldStock(formData) {
  'use server';
  const me = await requirePermission('products:write');

  /*
   * Both permissions, named, and that is not belt-and-braces.
   *
   * products:write is the one that decides WHO may press this - it is
   * owner-only, and stock is the money on a shop that takes cash at the door.
   * But the action also cancels orders in bulk, so it needs orders:write as
   * well, and naming it here is what stops the order check being shed by moving
   * the write into a helper. tests/action-permissions.test.mjs holds that line:
   * an action calling transitionAndNotify() must name orders:write or fail the
   * suite.
   *
   * In practice this second test can never refuse anybody who passed the first,
   * because every role holding products:write also holds orders:write. It is
   * here so the requirement is stated rather than inferred from a role table
   * that someone may change later.
   */
  if (!can(me.role, 'orders:write')) redirect(backTo('', '', 'forbidden'));

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo('', '', 'csrf'));

  const stale = await sql`
    SELECT id FROM orders
     WHERE status = 'new'
       AND phone_verified_at IS NULL
       AND created_at < now() - (${String(PANIC_MIN_AGE_MINUTES)} || ' minutes')::interval
     ORDER BY id ASC
     LIMIT ${PANIC_BATCH}`;

  let freed = 0;
  for (const row of stale) {
    // A refusal is not a failure: an admin may have confirmed one of these
    // between the read and the write, and transition() testing the live row is
    // what makes that safe. Only count the ones that actually moved.
    const res = await transitionAndNotify({
      orderId: row.id,
      to: 'cancelled',
      actor: `admin:${me.id}`,
      note: 'Bulk stock release from the Orders screen.',
    });
    if (res.ok && res.changed) freed++;
  }

  console.log(`[s7] bulk stock release by admin:${me.id} — ${freed} order(s) cancelled`);
  redirect(backTo('', '', freed ? 'stock_released' : 'stock_nothing'));
}

export default async function OrdersPage({ searchParams }) {
  await requirePermission('orders:read');
  const sp = await searchParams;
  const token = await csrfToken();

  const status = STATUSES.includes(String(sp?.status || '')) ? String(sp.status) : '';
  const q = String(sp?.q || '').trim().slice(0, 80);

  /*
   * An exact order number opens the order, rather than a list of one.
   *
   * This is the most common thing anybody does on this screen: a customer is on
   * the phone reading their number out, and every click between typing it and
   * seeing the order happens while somebody waits. A filtered list holding
   * exactly one row is a page that exists only to be clicked through.
   *
   * Only on an EXACT match, and only when what was typed is shaped like a
   * reference. A partial number, a name or a phone still lists - jumping on a
   * partial would take somebody who typed "100" to whichever order sorted first
   * and hide the other nine from them.
   *
   * normaliseRef because the number is printed with a hash and that is what
   * gets read out and pasted; isRef first, so a name never costs a lookup.
   */
  if (q) {
    const probe = normaliseRef(q);
    if (isRef(probe)) {
      const [hit] = await sql`SELECT id FROM orders WHERE ref = ${probe} LIMIT 1`;
      if (hit) redirect(`/admin/orders/${hit.id}`);
    }
  }

  // The hash is decoration, so it must not reach the LIKE: searching "#10001"
  // has to find the order stored as "10001". Everything else is left exactly as
  // typed, because this box also takes names and phone numbers, and normalising
  // those would strip the space out of "Youssef Tester".
  const like = `%${q.replace(/^#+/, '')}%`;

  /*
   * Four complete queries rather than one assembled string: the values stay
   * parameters and the SQL stays readable.
   *
   * The search reads the three columns concatenated rather than as three ORs,
   * and that is not a stylistic choice. A leading % gives a btree no prefix to
   * seek on, so this was a sequential scan of the whole orders table however it
   * was written; the fix is the pg_trgm GIN index in db/schema.sql, and a GIN
   * index can only be used by a predicate whose left-hand side is exactly the
   * expression it was built on. Three ORs would need three indexes and a
   * BitmapOr across them, which is three writes per order to answer one
   * question and a slower read than the single scan this gets.
   *
   * The space between the columns matters twice over. It stops a reference
   * running into a name and matching a substring that spans the join by
   * accident, and it is what lets somebody type a name and a phone number into
   * one box and have it match - which is what a person doing that meant.
   */
  let orders;
  if (status && q) {
    orders = await sql`
      SELECT * FROM orders
       WHERE status = ${status}
         AND (ref || ' ' || name || ' ' || phone) ILIKE ${like}
       ORDER BY id DESC LIMIT 200`;
  } else if (status) {
    orders = await sql`SELECT * FROM orders WHERE status = ${status} ORDER BY id DESC LIMIT 200`;
  } else if (q) {
    orders = await sql`
      SELECT * FROM orders
       WHERE (ref || ' ' || name || ' ' || phone) ILIKE ${like}
       ORDER BY id DESC LIMIT 200`;
  } else {
    orders = await sql`SELECT * FROM orders ORDER BY id DESC LIMIT 200`;
  }

  const itemsBy = new Map();
  if (orders.length) {
    const ids = orders.map(o => Number(o.id));
    const items = await sql`SELECT * FROM order_items WHERE order_id = ANY(${ids}::int[]) ORDER BY id ASC`;
    for (const it of items) {
      const key = Number(it.order_id);
      if (!itemsBy.has(key)) itemsBy.set(key, []);
      itemsBy.get(key).push(it);
    }
  }

  /*
   * The cash that has not been accounted for.
   *
   * This is the report half of the reconciliation the order screen records —
   * see saveSettlement in app/admin/(panel)/orders/[id]/page.js for why the
   * column exists at all. The short version: on a shop that takes cash at the
   * door, `total` is what was ASKED for, and until there was a second column
   * nothing in this database could ever disagree with it. A driver or a member
   * of staff remitting less than they collected left no trace.
   *
   * Two different problems in one query, and deliberately so, because they are
   * the same problem to whoever is doing the reconciliation: a delivered order
   * with nothing recorded, and one where the figure does not match. The first
   * is much more common and is usually just work not done yet; the second is
   * the one worth a conversation. Listing them together is what stops the
   * second hiding among the first.
   *
   * It is not filtered by the screen's own status/search filter. This is a
   * standing question about the whole shop — "what is outstanding" — and
   * answering it only about the rows that happen to match a search box would
   * make it silently wrong exactly when somebody is looking at something else.
   *
   * Deliberately unpaged and capped. If there are more than fifty of these the
   * shop has a bookkeeping backlog, not a pagination problem, and the line
   * below says so rather than offering to page through it.
   */
  const outstanding = await sql`
    SELECT id, ref, name, total, collected_amount
      FROM orders
     WHERE status = 'delivered'
       AND (collected_amount IS NULL OR collected_amount <> total)
     ORDER BY id DESC
     LIMIT 51`;

  /*
   * How much stock is currently held by orders nobody has confirmed.
   *
   * The number that matters during a flood. `products.stock` says the shelf is
   * empty; this says how much of that emptiness is orders that may never become
   * deliveries, which is the difference between "we sold out" and "we are being
   * attacked".
   *
   * Only counts orders old enough for the release button to act on, so the
   * figure shown and the figure the button would free are the same number.
   */
  const [held] = await sql`
    SELECT count(DISTINCT o.id)::int AS orders,
           coalesce(sum(i.qty), 0)::int AS units
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
     WHERE o.status = 'new'
       AND o.phone_verified_at IS NULL
       AND o.created_at < now() - interval '60 minutes'`;

  const shown = outstanding.slice(0, 50);
  const mismatched = shown.filter(o => o.collected_amount != null);

  return (
    <>
      <h1>Orders</h1>
      <p className="sub">Cash on delivery. Call the customer, confirm, then move the status along.</p>

      <Flash code={sp?.m} />

      {Number(held?.orders) > 0 ? (
        <div className="panel">
          <h2>
            Stock held by unconfirmed orders
            <span className="right">
              <form action={releaseHeldStock} className="bar-row">
                <input type="hidden" name="_csrf" value={token} />
                <ConfirmButton
                  className="btn sm"
                  message={`Cancel ${held.orders} unconfirmed order(s) and put ${held.units} unit(s) back on the shelf? Each customer is emailed. This cannot be undone.`}
                >
                  Release {Number(held.units)} unit{Number(held.units) === 1 ? '' : 's'}
                </ConfirmButton>
              </form>
            </span>
          </h2>
          <div className="muted" style={{ padding: '14px 20px' }}>
            <b>{Number(held.orders)}</b> order{Number(held.orders) === 1 ? '' : 's'} placed over an
            hour ago that nobody has confirmed and whose phone number has not answered, holding{' '}
            <b>{Number(held.units)}</b> unit{Number(held.units) === 1 ? '' : 's'} of stock.
            {' '}Normal on a busy morning — these are orders waiting for their call. Worth acting on
            when the number is far larger than a day of real orders, which is what a flood of fake
            orders looks like: the shop reads as sold out while none of it will ever be delivered.
            Releasing cancels them, returns the stock and emails each customer that they can reorder.
          </div>
        </div>
      ) : null}

      {shown.length ? (
        <div className="panel">
          <h2>
            Cash outstanding
            <span className="right muted" style={{ fontSize: '13px' }}>
              {shown.length}{outstanding.length > 50 ? '+' : ''} delivered
              {mismatched.length ? ` · ${mismatched.length} not matching` : ''}
            </span>
          </h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th>
                  <th style={{ textAlign: 'right' }}>Asked</th>
                  <th style={{ textAlign: 'right' }}>Collected</th>
                  <th style={{ textAlign: 'right' }}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(o => {
                  const has = o.collected_amount != null;
                  const diff = has
                    ? Math.round((Number(o.total) - Number(o.collected_amount)) * 100) / 100
                    : null;
                  return (
                    <tr key={o.id}>
                      <td><Link href={`/admin/orders/${o.id}`}><b>{formatRef(o.ref)}</b></Link></td>
                      <td className="muted">{o.name}</td>
                      <td style={{ textAlign: 'right' }}>{money(o.total)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {has ? money(o.collected_amount) : <span className="muted">not recorded</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {diff === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <b style={{ color: 'var(--red)' }}>
                            {diff > 0 ? '−' : '+'}{money(Math.abs(diff))}
                          </b>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ padding: '14px 20px', borderTop: '1.5px solid var(--line)' }}>
            Every delivered order whose cash has not been recorded, or whose recorded amount does
            not match what was asked. Open one to enter what the driver actually handed over.
            {outstanding.length > 50 ? ' Only the fifty most recent are listed.' : ''}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <h2>
          Filter
          <span className="right">
            <form method="get" className="bar-row">
              <input name="q" defaultValue={q} placeholder="Ref, name or phone" style={{ width: '210px' }} />
              <select name="status" defaultValue={status} style={{ width: '150px' }}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{title(s)}</option>)}
              </select>
              <button className="btn sm" type="submit">Apply</button>
              <Link className="btn sm ghost" href="/admin/orders">Reset</Link>
            </form>
          </span>
        </h2>

        {orders.length === 0 ? (
          /*
           * Two different situations wearing one sentence.
           *
           * "Nothing matches that" is true when a filter is set and false when
           * the shop simply has not had an order yet — and on a shop that has
           * not launched, which is exactly when somebody first opens this
           * screen, it sends them hunting for a filter they never set. The
           * distinction is free: we already know whether either control is in
           * use.
           */
          <div className="empty">
            {(status || q)
              ? <>No order matches that. <Link href="/admin/orders">Clear the filter</Link> to see them all.</>
              : 'No orders yet. When somebody checks out, they land here — newest first.'}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Ref</th><th>Customer</th><th>Address</th><th>Items</th><th>Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <td>
                      <b><Link href={`/admin/orders/${o.id}`}>{formatRef(o.ref)}</Link></b>
                      <div className="muted">{dt(o.created_at)}</div>
                      {o.coupon ? <div className="muted">code: {o.coupon}</div> : null}
                      {/* The customer asked to cancel through the link in
                          their confirmation email. It arrives by mail too, but
                          mail gets missed — this is the copy that cannot. */}
                      {o.refund_requested_at ? (
                        <div className="pill cancelled" style={{ marginTop: '6px' }}
                             title={o.refund_reason || 'No reason given'}>
                          cancellation asked {dt(o.refund_requested_at)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {o.name}
                      <div className="muted" dir="ltr">
                        <a href={waLink(o.phone)} target="_blank" rel="noopener noreferrer">{o.phone}</a>
                      </div>
                    </td>
                    <td className="muted" style={{ maxWidth: '230px' }}>
                      {o.address}{o.city ? ` — ${o.city}` : ''}
                      {o.notes ? <div><i>{o.notes}</i></div> : null}
                    </td>
                    <td className="muted">
                      {(itemsBy.get(Number(o.id)) || []).map(it => (
                        <div key={it.id}>{it.name} × {Number(it.qty)}</div>
                      ))}
                    </td>
                    <td>
                      <b>{money(o.total)}</b>
                      {Number(o.discount) > 0 ? <div className="muted">−{money(o.discount)}</div> : null}
                      <div className="muted">+{money(o.shipping)} ship</div>
                    </td>
                    <td>
                      <form action={saveStatus} className="bar-row">
                        <input type="hidden" name="_csrf" value={token} />
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="f_status" value={status} />
                        <input type="hidden" name="q_back" value={q} />
                        {/* Only the moves this order can actually make, plus
                            where it already is. Offering the rest would have
                            the panel present a control that the transition
                            table then refuses — and on a delivered or
                            cancelled order every other option is refused, so
                            the dropdown collapses to a single locked value,
                            which is the honest rendering of a terminal state. */}
                        <select
                          name="status"
                          defaultValue={o.status}
                          disabled={!nextFrom(o.status).length}
                          style={{ width: '130px' }}
                        >
                          {[o.status, ...nextFrom(o.status)].map(s => (
                            <option key={s} value={s}>{title(s)}</option>
                          ))}
                        </select>
                        <button className="btn sm" type="submit" disabled={!nextFrom(o.status).length}>
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
