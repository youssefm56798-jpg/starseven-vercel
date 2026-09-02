import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../../lib/auth.js';
import { sql } from '../../../../../lib/db.js';
import { requirePermission } from '../../../_lib/guard.js';
import { dt, Flash, money, waLink } from '../../../_lib/ui.js';
import { STATUSES, nextFrom, eventsFor, logEvent } from '../../../../../lib/order-status.js';
import { transitionAndNotify, editAndNotify } from '../../../../../lib/order-notify.js';
import { canEdit, MAX_QTY } from '../../../../../lib/order-edit.js';
import { formatWindow, zoneFor } from '../../../../../lib/delivery-eta.js';
import { formatRef } from '../../../../../lib/order-number.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order — Star Seven admin' };

const title = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Back to this same order, carrying only a validated flash code. */
function backTo(id, msg) {
  const p = new URLSearchParams();
  if (msg) p.set('m', msg);
  const s = p.toString();
  return `/admin/orders/${id}${s ? `?${s}` : ''}`;
}

async function saveStatus(formData) {
  'use server';
  const admin = await requirePermission('orders:write');

  const id = Number(formData.get('id'));
  const status = String(formData.get('status') || '');

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(id, 'csrf'));
  if (!Number.isInteger(id) || id <= 0 || !STATUSES.includes(status)) redirect(backTo(id, 'bad_input'));

  // transition() owns which moves are legal and does the restock/coupon return
  // in one transaction; the wrapper mails the customer after the response.
  const res = await transitionAndNotify({ orderId: id, to: status, actor: `admin:${admin.id}` });
  if (!res.ok) redirect(backTo(id, res.reason === 'not-found' ? 'bad_input' : 'bad_move'));
  redirect(backTo(id, res.changed && status === 'cancelled' ? 'order_cancelled' : 'order_saved'));
}

async function addNote(formData) {
  'use server';
  const admin = await requirePermission('orders:write');

  const id = Number(formData.get('id'));
  const note = String(formData.get('note') || '').trim().slice(0, 500);

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(id, 'csrf'));
  if (!Number.isInteger(id) || id <= 0 || !note) redirect(backTo(id, 'bad_input'));

  const [row] = await sql`SELECT id FROM orders WHERE id = ${id}`;
  if (!row) redirect(backTo(id, 'bad_input'));

  await logEvent({ orderId: id, kind: 'note', actor: `admin:${admin.id}`, note });
  redirect(backTo(id, 'note_added'));
}

/**
 * The courier and the waybill number, once the parcel is handed over.
 *
 * Deliberately not part of saveStatus. Marking an order shipped and knowing
 * which courier took it are two things that happen at different moments — the
 * status is pressed when the parcel is packed, the reference is copied off the
 * waybill afterwards — and folding them into one form would mean either
 * blanking the reference every time the status is saved, or refusing to save
 * the status until somebody has a reference to type.
 *
 * It writes two free-text columns and nothing else. In particular it does not
 * touch the status column or the delivery window: the first belongs to
 * lib/order-status.js and the second is a promise already made to the customer,
 * which a later edit here must not be able to move.
 */
/**
 * The statuses a waybill may still be written on.
 *
 * Terminal orders are excluded. Not because editing one is likely, but because
 * this action had no status test at all: any signed-in admin could POST an
 * arbitrary id and rewrite the courier and tracking number of a delivered or
 * cancelled order, and nothing recorded that it happened. Every other write on
 * this page either tests the live row (saveStatus, saveItems) or leaves an
 * order_events row behind; this one did neither.
 */
const DISPATCHABLE = ['new', 'confirmed', 'shipped'];

async function saveDispatch(formData) {
  'use server';
  const me = await requirePermission('orders:write');

  const id = Number(formData.get('id'));
  const courier = String(formData.get('courier') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const tracking = String(formData.get('tracking_ref') || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(id, 'csrf'));
  if (!Number.isInteger(id) || id <= 0) redirect(backTo(id, 'bad_input'));

  // The status is tested on the live row inside the UPDATE, not read first and
  // trusted afterwards - the same shape the cancel race taught this codebase.
  const rows = await sql`
    UPDATE orders
       SET courier = ${courier}, tracking_ref = ${tracking}
     WHERE id = ${id}
       AND status = ANY(${DISPATCHABLE}::text[])
     RETURNING id`;
  if (!rows.length) redirect(backTo(id, 'bad_input'));

  // Who changed the waybill, and to what. A dispatch detail that changes with
  // no trace is exactly what somebody reading the timeline later needs to see.
  await logEvent({
    orderId: id,
    kind: 'note',
    actor: me.name || 'admin',
    note: `Dispatch updated - courier: ${courier || '(none)'}, tracking: ${tracking || '(none)'}`,
  });

  redirect(backTo(id, 'dispatch_saved'));
}

/**
 * The statuses on which cash may be recorded.
 *
 * Only `delivered`, and that is the whole rule: money changes hands at the door
 * on this shop, so an order that has not been delivered has no cash to account
 * for. Recording a figure earlier would mean the report below could not tell
 * "collected in advance" from "typed on the wrong order".
 *
 * Terminal in the transition table, so an order here cannot move again and the
 * figure cannot be stranded on an order that later becomes something else.
 */
const SETTLEABLE = ['delivered'];

/** More than any real order on this shop, and a guard against a fat finger. */
const MAX_COLLECTED = 1000000;

/**
 * What the driver actually came back with.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 *
 * Every other number on an order is what the shop ASKED for. The total is
 * computed from the products table at checkout and recomputed from it on every
 * edit, and nothing a browser sends about money is consulted at any point — so
 * the amount on the waybill is not something a customer can move. That half is
 * solid.
 *
 * The half that was missing is the other end. Nothing recorded what was handed
 * over, so `total` was silently doing double duty as both the asking price and
 * the assumed receipt. A driver or a member of staff who collects the right
 * amount and remits less of it leaves no trace anywhere in this database,
 * because there was no field that could disagree with the total.
 *
 * This is that field. It does not stop anybody doing it — nothing in software
 * can, at the point where cash crosses a doorstep — it makes it VISIBLE, which
 * is the only control that was available and the one that was absent.
 *
 * ---------------------------------------------------------------------------
 * Staff, not owner-only
 *
 * Prices, stock and offers are owner-only because they are money that can be
 * changed silently. This is money being REPORTED, by the person who made the
 * reconciliation call, and it writes an order_events row stamped with their
 * admin id — which is the line lib/admin-roles.js actually draws: staff may do
 * the things that leave a trail. Making it owner-only would not make the figure
 * more honest, it would just mean the owner typing what staff told them, with
 * the audit row naming the wrong person.
 *
 * ---------------------------------------------------------------------------
 * Blank clears it
 *
 * A figure typed onto the wrong order has to be removable, and a shop that can
 * only ever add numbers accumulates wrong ones. Clearing writes its own audit
 * row saying so, so the correction is as visible as the original.
 */
async function saveSettlement(formData) {
  'use server';
  const me = await requirePermission('orders:write');

  const id = Number(formData.get('id'));
  const raw = String(formData.get('collected') || '').trim();

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(id, 'csrf'));
  if (!Number.isInteger(id) || id <= 0) redirect(backTo(id, 'bad_input'));

  let amount = null;
  if (raw) {
    const n = Number(raw);
    // Zero is allowed and is a real answer — the driver came back with nothing,
    // which is exactly the case the report downstream is looking for. It is
    // NULL that means "nobody has said", and that is what blank writes.
    if (!Number.isFinite(n) || n < 0 || n > MAX_COLLECTED) redirect(backTo(id, 'cash_bad'));
    amount = Math.round(n * 100) / 100;
  }

  /*
   * The status is tested on the live row inside the UPDATE rather than read
   * first and trusted, the same shape saveDispatch uses and for the same
   * reason. `delivered` is terminal so the race is narrow, but a write that
   * checks its own precondition costs nothing and does not depend on the page
   * having been rendered a moment ago.
   *
   * settled_at is stamped from the amount rather than assigned unconditionally,
   * so clearing a figure clears the timestamp with it and an order never sits
   * in the "settled, but no amount" state that a report would have to special
   * case.
   */
  const rows = await sql`
    UPDATE orders
       SET collected_amount = ${amount}::numeric,
           settled_at = CASE WHEN ${amount}::numeric IS NULL THEN NULL ELSE now() END
     WHERE id = ${id}
       AND status = ANY(${SETTLEABLE}::text[])
     RETURNING ref, total, collected_amount`;

  if (!rows.length) redirect(backTo(id, 'cash_locked'));

  const row = rows[0];
  const short = amount === null ? null : Math.round((Number(row.total) - amount) * 100) / 100;

  await logEvent({
    orderId: id,
    kind: 'note',
    actor: me.name || `admin:${me.id}`,
    note: amount === null
      ? 'Cash record cleared'
      : `Cash collected ${amount.toFixed(2)} against ${Number(row.total).toFixed(2)}`
        + (short ? ` — ${short > 0 ? 'short' : 'over'} by ${Math.abs(short).toFixed(2)}` : ' — matches'),
  });

  redirect(backTo(id, amount !== null && short ? 'cash_short' : 'cash_saved'));
}

/**
 * The refusals lib/order-edit.js can answer with, as flash codes.
 *
 * Every one of them is a sentence an admin can act on, which is why they are
 * not collapsed into one. The mapping lives here rather than in the module
 * because the module is not allowed to know what a query string is, and a flash
 * code is a query string — see lib/order-edit.js for the reasons themselves.
 */
const EDIT_FLASH = {
  'not-found': 'bad_input',
  'bad-input': 'bad_input',
  'not-editable': 'edit_locked',
  stale: 'edit_stale',
  conflict: 'edit_stale',
  empty: 'edit_empty',
  'too-many': 'edit_toomany',
  'unknown-sku': 'edit_unknown',
  unpriced: 'edit_unpriced',
  'no-stock': 'edit_stock',
  'bad-phone': 'edit_phone',
  'bad-address': 'edit_address',
  'coupon-invalid': 'edit_coupon_bad',
  'coupon-spent': 'edit_coupon_spent',
  'coupon-min': 'edit_coupon_min',
  'coupon-gone': 'edit_coupon_gone',
};

const editFlash = res =>
  res.ok ? (res.changed ? 'order_edited' : 'edit_nothing') : (EDIT_FLASH[res.reason] || 'bad_input');

/**
 * Change what is on the order: the lines, and the coupon.
 *
 * The two are one form because they are one sum. A coupon has a minimum and a
 * percentage, so removing a jar can invalidate the code and adding one can
 * qualify for it — saving them separately would mean saving an order through a
 * state where the discount does not match the basket, and on a shop that takes
 * cash at the door that state is a number a driver collects.
 *
 * Nothing about money is read from this form. The quantities are quantities and
 * the coupon is a code; every price, every total and the discount itself are
 * recomputed in lib/order-edit.js from the database, inside the transaction
 * that also moves the stock. See app/api/order/route.js, which this mirrors.
 */
async function saveItems(formData) {
  'use server';
  const admin = await requirePermission('orders:write');

  const id = Number(formData.get('id'));

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(id, 'csrf'));
  if (!Number.isInteger(id) || id <= 0) redirect(backTo(id, 'bad_input'));

  // One field per existing line, named for the row it belongs to. Reading them
  // back off the form rather than trusting a positional list means a line
  // deleted by somebody else between render and Save is refused by name.
  const lines = [];
  for (const [key, value] of formData.entries()) {
    const m = /^qty_(\d+)$/.exec(key);
    if (m) lines.push({ id: Number(m[1]), qty: value });
  }

  const addSku = String(formData.get('add_sku') || '');
  const addQty = String(formData.get('add_qty') || '1');
  const add = addSku ? [{ sku: addSku, qty: addQty }] : [];

  const res = await editAndNotify({
    orderId: id,
    actor: `admin:${admin.id}`,
    expectSeq: Number(formData.get('seq')),
    lines,
    add,
    coupon: String(formData.get('coupon') || ''),
    notify: formData.get('quiet') !== '1',
  });

  redirect(backTo(id, editFlash(res)));
}

/**
 * Change where it is going: the address, the city, the phone, the note.
 *
 * A separate form from the basket, and separate for the reason saveDispatch is
 * separate from saveStatus: they are corrected at different moments in the same
 * call, and folding them together would mean an address fix that cannot be
 * saved until the basket is also valid.
 *
 * It goes through the same editOrder() as the basket, so it takes the same
 * compare-and-swap and lands on the same timeline. A wrong address is the most
 * expensive fact on a cash-on-delivery order, and it deserves an audit row as
 * much as a quantity does.
 */
async function saveContact(formData) {
  'use server';
  const admin = await requirePermission('orders:write');

  const id = Number(formData.get('id'));

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(id, 'csrf'));
  if (!Number.isInteger(id) || id <= 0) redirect(backTo(id, 'bad_input'));

  const res = await editAndNotify({
    orderId: id,
    actor: `admin:${admin.id}`,
    expectSeq: Number(formData.get('seq')),
    contact: {
      phone: String(formData.get('phone') || ''),
      address: String(formData.get('address') || ''),
      city: String(formData.get('city') || ''),
      notes: String(formData.get('notes') || ''),
    },
    notify: formData.get('quiet') !== '1',
  });

  redirect(backTo(id, editFlash(res)));
}

/**
 * The Items panel: a form while the order can still be edited, and the same
 * table as plain markup once it cannot.
 *
 * A form is only rendered when there is something to submit. A panel that was
 * always a form would be a form with no controls in it on a shipped order —
 * submittable by accident and refused by the server, which is a worse way to
 * say no than not offering it.
 */
function ItemsPanel({ editable, action, children }) {
  if (!editable) return <div className="panel">{children}</div>;
  return <form action={action} className="panel">{children}</form>;
}

/** The word the timeline shows for each non-status event kind. */
const EVENT_LABEL = {
  note: 'Note',
  'refund-request': 'Cancellation asked',
  mail: 'Email sent',
  edit: 'Order edited',
  call: 'Call',
};

export default async function OrderDetail({ params, searchParams }) {
  await requirePermission('orders:read');

  const { id: raw } = await params;
  const sp = await searchParams;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const token = await csrfToken();

  // The two window columns are pulled out again under their own names rather
  // than left to `*`. They are DATE, and the driver turns a DATE into a JS Date
  // at LOCAL midnight, which then renders as the previous day through any
  // formatter pinned to Cairo. Reading them as text keeps them the calendar
  // days they were written as. Aliased rather than re-selected under the same
  // name, because a result set with two columns called expected_from is
  // resolved by whichever one the driver happens to keep.
  const [order] = await sql`
    SELECT o.*, o.expected_from::text AS eta_from, o.expected_to::text AS eta_to
      FROM orders o WHERE o.id = ${id}`;
  if (!order) notFound();

  const items = await sql`SELECT * FROM order_items WHERE order_id = ${id} ORDER BY id ASC`;
  const events = await eventsFor(id);
  const moves = nextFrom(order.status);
  const locked = !moves.length;

  /*
   * Whether this order can still be changed, and what it could be changed to.
   *
   * The policy is lib/order-edit.js and this screen only asks it — a panel that
   * rendered its own opinion of which statuses are editable would eventually
   * offer a form the server refuses, which is the same mistake the Cancel
   * button on the customer order page exists not to make.
   *
   * The catalogue is only read when it is going to be shown. Unpriced products
   * are left out for the reason the edit refuses them: they have no price to
   * sell at. Products already on the order are kept in, because adding one
   * again is how an admin says two instead of one, and the edit merges it into
   * the line that is already there.
   */
  const editable = canEdit(order.status);
  const catalogue = editable
    ? await sql`
        SELECT sku, name_en, price, stock
          FROM products
         WHERE active = true AND price > 0
         ORDER BY name_en ASC`
    : [];

  const seq = Number(order.edit_seq) || 0;

  // Cash is only recordable on a delivered order — see saveSettlement. The
  // variance is computed once here rather than twice in the markup below, and
  // is only meaningful when there is a figure to compare against.
  const settleable = SETTLEABLE.includes(order.status);
  const shortBy = order.collected_amount == null
    ? 0
    : Math.round((Number(order.total) - Number(order.collected_amount)) * 100) / 100;

  return (
    <>
      <div className="bar-row" style={{ marginBottom: '14px' }}>
        <Link className="btn sm ghost" href="/admin/orders">← All orders</Link>
      </div>

      <h1>{formatRef(order.ref)} <span className={`pill ${order.status}`}>{title(order.status)}</span></h1>
      <p className="sub">
        Placed {dt(order.created_at)} · {order.lang === 'en' ? 'English' : 'Arabic'} · cash on delivery
        {order.cancelled_at ? ` · cancelled ${dt(order.cancelled_at)}` : ''}
      </p>

      <Flash code={sp?.m} />

      {order.refund_requested_at ? (
        <div className="flash err">
          Customer asked to cancel {dt(order.refund_requested_at)}
          {order.refund_reason ? ` — “${order.refund_reason}”` : ''}
        </div>
      ) : null}

      <div className="grid2">
        <div className="panel">
          <h2>Customer</h2>
          <div style={{ padding: '16px 20px' }}>
            <div className="kv">
              <span>Name</span><b>{order.name}</b>
              <span>Phone</span>
              <b dir="ltr"><a href={waLink(order.phone)} target="_blank" rel="noopener noreferrer">{order.phone}</a></b>
              {order.email ? (<><span>Email</span><b dir="ltr">{order.email}</b></>) : null}
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Delivery</h2>
          {editable ? (
            <form action={saveContact} style={{ padding: '16px 20px' }}>
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="seq" value={seq} />
              <div className="kv">
                <span>Address</span>
                <b><input name="address" defaultValue={order.address || ''} maxLength={255}
                  style={{ width: '100%' }} /></b>
                <span>City</span>
                <b><input name="city" defaultValue={order.city || ''} maxLength={80}
                  style={{ width: '100%' }} /></b>
                <span>Phone</span>
                <b><input name="phone" defaultValue={order.phone || ''} maxLength={20} dir="ltr"
                  style={{ width: '100%' }} /></b>
                <span>Notes</span>
                <b><input name="notes" defaultValue={order.notes || ''} maxLength={500}
                  style={{ width: '100%' }} /></b>
              </div>
              <div className="bar-row" style={{ marginTop: '12px' }}>
                <button className="btn sm" type="submit">Save delivery</button>
                <label className="muted" style={{ fontSize: '13px' }}>
                  <input type="checkbox" name="quiet" value="1" /> Do not email
                </label>
              </div>
            </form>
          ) : (
            <div style={{ padding: '16px 20px' }}>
              <div className="kv">
                <span>Address</span><b>{order.address || '—'}</b>
                <span>City</span><b>{order.city || '—'}</b>
                {order.notes ? (<><span>Notes</span><b><i>{order.notes}</i></b></>) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <ItemsPanel editable={editable} action={saveItems}>
        <input type="hidden" name="_csrf" value={token} />
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="seq" value={seq} />

        <h2>Items</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>SKU</th><th>Price</th><th>Qty</th>
                <th style={{ textAlign: 'right' }}>Line</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="muted"><code>{it.sku || '—'}</code></td>
                  <td>{money(it.price)}</td>
                  <td>
                    {editable ? (
                      <input type="number" name={`qty_${it.id}`} defaultValue={Number(it.qty)}
                        min={0} max={MAX_QTY} step={1} style={{ width: '72px' }} />
                    ) : `× ${Number(it.qty)}`}
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(Number(it.price) * Number(it.qty))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1.5px solid var(--line)' }}>
          <div className="kv kv-money">
            <span>Subtotal</span><b>{money(order.subtotal)}</b>
            {Number(order.discount) > 0 ? (
              <><span>Discount{order.coupon ? ` (${order.coupon})` : ''}</span><b>−{money(order.discount)}</b></>
            ) : null}
            <span>Shipping</span><b>{money(order.shipping)}</b>
            <span>Total</span><b style={{ fontSize: '18px' }}>{money(order.total)}</b>
          </div>
        </div>

        {editable ? (
          <div style={{ padding: '14px 20px', borderTop: '1.5px solid var(--line)' }}>
            <div className="bar-row" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <select name="add_sku" defaultValue="" style={{ width: '260px' }}>
                <option value="">Add a product…</option>
                {catalogue.map(p => (
                  <option key={p.sku} value={p.sku}>
                    {p.name_en} — {money(p.price)} ({Number(p.stock)} in stock)
                  </option>
                ))}
              </select>
              <input type="number" name="add_qty" defaultValue={1} min={1} max={MAX_QTY} step={1}
                style={{ width: '72px' }} aria-label="Quantity to add" />
              <input name="coupon" defaultValue={order.coupon || ''} placeholder="Coupon code"
                maxLength={64} style={{ width: '160px', textTransform: 'uppercase' }} />
              <button className="btn sm" type="submit">Save items</button>
              <label className="muted" style={{ fontSize: '13px' }}>
                <input type="checkbox" name="quiet" value="1" /> Do not email
              </label>
            </div>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: '13px' }}>
              Set a quantity to 0 to take the line off. Adding a product that is already on the
              order adds to that line. Totals, the discount and the stock are all recomputed when
              you save — the figures above are as they stand now. Clearing the coupon gives its
              redemption back; typing a different one moves the redemption across.
              The customer is emailed the revised order unless you tick Do not email.
            </p>
          </div>
        ) : (
          <div className="muted" style={{ padding: '14px 20px', borderTop: '1.5px solid var(--line)' }}>
            {title(order.status)} orders cannot be edited. Once a parcel is with a courier its
            contents and the amount written on the waybill are fixed, and past that both remaining
            statuses are final.
          </div>
        )}
      </ItemsPanel>

      <div className="panel">
        <h2>
          Move status
          <span className="right">
            <form action={saveStatus} className="bar-row">
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <select name="status" defaultValue={order.status} disabled={locked} style={{ width: '160px' }}>
                {[order.status, ...moves].map(s => <option key={s} value={s}>{title(s)}</option>)}
              </select>
              <button className="btn sm" type="submit" disabled={locked}>Save</button>
            </form>
          </span>
        </h2>
        <div className="muted" style={{ padding: '14px 20px' }}>
          {locked
            ? `${title(order.status)} is final — there is nowhere to move this order.`
            : `From ${title(order.status)} this order can move to ${moves.map(title).join(', ')}. The customer is emailed on the moves they hear about.`}
        </div>
      </div>

      <div className="panel">
        <h2>
          Dispatch
          <span className="right">
            <form action={saveDispatch} className="bar-row">
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <input name="courier" defaultValue={order.courier || ''} placeholder="Courier"
                maxLength={60} style={{ width: '140px' }} />
              <input name="tracking_ref" defaultValue={order.tracking_ref || ''} placeholder="Tracking ref"
                maxLength={60} style={{ width: '160px' }} />
              <button className="btn sm ghost" type="submit">Save</button>
            </form>
          </span>
        </h2>
        <div className="muted" style={{ padding: '14px 20px' }}>
          {order.eta_from && order.eta_to ? (
            <>
              Customer was promised <b>{formatWindow(order.eta_from, order.eta_to, 'en')}</b>, on the{' '}
              <b>{zoneFor(order.city)}</b> tier for “{order.city || '—'}”. Written when the order was
              confirmed and never moved afterwards — the customer has already been shown it.
            </>
          ) : (
            <>
              No delivery window yet. One is written from the governorate in the address the first
              time this order is confirmed or shipped, and the customer sees it on their order page.
            </>
          )}
        </div>
      </div>

      {/*
        * Cash, and only once the order is delivered.
        *
        * Rendered as a form when there is something to record and as a flat
        * statement when there is not, the same shape ItemsPanel uses: a form
        * that the server would refuse is a worse way to say no than not
        * offering one.
        */}
      <div className="panel">
        <h2>
          Cash collected
          {settleable ? (
            <span className="right">
              <form action={saveSettlement} className="bar-row">
                <input type="hidden" name="_csrf" value={token} />
                <input type="hidden" name="id" value={order.id} />
                <input name="collected" type="number" step="0.01" min="0" max={MAX_COLLECTED}
                  defaultValue={order.collected_amount == null ? '' : Number(order.collected_amount)}
                  placeholder={Number(order.total).toFixed(2)} style={{ width: '120px' }}
                  aria-label="Amount the driver handed over" />
                <button className="btn sm ghost" type="submit">Save</button>
              </form>
            </span>
          ) : null}
        </h2>
        <div className="muted" style={{ padding: '14px 20px' }}>
          {!settleable ? (
            <>Cash is recorded once the order is delivered. This one is {title(order.status)}.</>
          ) : order.collected_amount == null ? (
            <>
              Nothing recorded yet. Type what the driver actually handed over — not what the
              waybill said. The order asked for <b>{money(order.total)}</b>. Leave it blank until
              you have the real figure; every delivered order with no number here is listed on the
              Orders screen.
            </>
          ) : (
            <>
              <b>{money(order.collected_amount)}</b> recorded against <b>{money(order.total)}</b>
              {shortBy === 0 ? (
                <> — matches.</>
              ) : (
                <> — <b style={{ color: 'var(--red)' }}>{shortBy > 0 ? 'short' : 'over'} by {money(Math.abs(shortBy))}</b>.</>
              )}
              {order.settled_at ? <> Recorded {dt(order.settled_at)}.</> : null}
              {' '}Clear the box and save to remove a figure entered by mistake; both go on the
              history below.
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>
          History
          <span className="right">
            <form action={addNote} className="bar-row">
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <input name="note" placeholder="Add an internal note" maxLength={500} style={{ width: '240px' }} />
              <button className="btn sm ghost" type="submit">Add</button>
            </form>
          </span>
        </h2>
        {events.length === 0 ? (
          <div className="empty">No history yet.</div>
        ) : (
          <ul className="tl">
            {events.map(e => (
              <li key={e.id}>
                <span className="tl-when">{dt(e.created_at)}</span>
                <span className="tl-body">
                  {e.kind === 'status' ? (
                    <><b>{title(e.to_status)}</b>{e.from_status ? <span className="muted"> from {title(e.from_status)}</span> : null}</>
                  ) : (
                    <><b>{EVENT_LABEL[e.kind] || e.kind}</b>{e.note ? <span> — {e.note}</span> : null}</>
                  )}
                  <span className="muted"> · {e.actor}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
