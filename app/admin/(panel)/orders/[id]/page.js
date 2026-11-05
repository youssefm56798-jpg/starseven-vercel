import { localizedAdminMetadata } from "../../../_lib/locale-server.js";
import { AdminText, AdminElement, AdminFormat, AdminActor } from '../../../_lib/locale.js';
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
import {recordCollection} from '../../../../../lib/collection-ledger.mjs';
import { formatRef } from '../../../../../lib/order-number.js';

export const dynamic = 'force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({ title: 'Order — Star Seven admin' });}

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
  if (!res.ok) redirect(backTo(id, res.reason === 'not-found' ? 'bad_input' : res.reason === 'coupon-review' ? 'edit_coupon_review' : 'bad_move'));
  redirect(backTo(id, res.changed && status === 'cancelled' ? (res.couponReviewNeeded ? 'order_cancelled_review' : 'order_cancelled') : 'order_saved'));
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
  const me=await requirePermission('orders:write');
  const id=Number(formData.get('id'));
  if(!(await csrfOk(formData.get('_csrf'))))redirect(backTo(id,'csrf'));
  if(!Number.isSafeInteger(id)||id<1)redirect('/admin/orders?m=bad_input');
  let result;
  try{result=await recordCollection(sql,{order_id:id,expect_seq:formData.get('collection_seq'),amount:formData.get('collected'),reason:formData.get('collection_reason')},`admin:${me.id}`);}
  catch(error){console.error('[s7] Collection save failed:',/^[A-Z0-9]{5}$/.test(error?.code??'')?error.code:'DB_ERROR');redirect(backTo(id,'ops_unavailable'));}
  if(!result.ok)redirect(backTo(id,result.error==='input'?'cash_bad':result.error==='reason'?'cash_reason':result.error==='locked'?'cash_locked':result.error==='review'?'cash_review':'cash_conflict'));
  const short=result.amount===null?0:Math.round((result.total-Number(result.amount))*100)/100;
  redirect(backTo(id,!result.changed?'cash_unchanged':result.amount!==null&&short?'cash_short':'cash_saved'));
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
  'coupon-first-order': 'edit_coupon_first_order',
  'coupon-spent': 'edit_coupon_spent',
  'coupon-min': 'edit_coupon_min',
  'coupon-gone': 'edit_coupon_gone',
  'coupon-review': 'edit_coupon_review',
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
        <Link className="btn sm ghost" href="/admin/orders"><AdminText text="← All orders" /></Link>
      </div>

      <h1>{formatRef(order.ref)} <span className={`pill ${order.status}`}><AdminText text={title(order.status)} /></span></h1>
      <p className="sub"><AdminText text="Placed" />{' '}{<AdminFormat kind="dt" value={order.created_at} />} · {order.lang === 'en' ? <AdminText text="English" /> : <AdminText text="Arabic" />}{' '}<AdminText text="· cash on delivery" />{order.cancelled_at ? <AdminText text="· cancelled {0}" values={[dt(order.cancelled_at)]} /> : ''}
      </p>

      <Flash code={sp?.m} />

      {order.refund_requested_at ? (
        <div className="flash err"><AdminText text="Customer asked to cancel" />{' '}{<AdminFormat kind="dt" value={order.refund_requested_at} />}
          {order.refund_reason ? ` — “${order.refund_reason}”` : ''}
        </div>
      ) : null}

      <div className="grid2">
        <div className="panel">
          <h2><AdminText text="Customer" /></h2>
          <div style={{ padding: '16px 20px' }}>
            <div className="kv">
              <span><AdminText text="Name" /></span><b>{order.name}</b>
              <span><AdminText text="Phone" /></span>
              <b dir="ltr"><a href={waLink(order.phone)} target="_blank" rel="noopener noreferrer">{order.phone}</a></b>
              {order.email ? (<><span><AdminText text="Email" /></span><b dir="ltr">{order.email}</b></>) : null}
            </div>
          </div>
        </div>

        <div className="panel">
          <h2><AdminText text="Delivery" /></h2>
          {editable ? (
            <form action={saveContact} style={{ padding: '16px 20px' }}>
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="seq" value={seq} />
              <div className="kv">
                <span><AdminText text="Address" /></span>
                <b><input name="address" defaultValue={order.address || ''} maxLength={255}
                  style={{ width: '100%' }} /></b>
                <span><AdminText text="City" /></span>
                <b><input name="city" defaultValue={order.city || ''} maxLength={80}
                  style={{ width: '100%' }} /></b>
                <span><AdminText text="Phone" /></span>
                <b><input name="phone" defaultValue={order.phone || ''} maxLength={20} dir="ltr"
                  style={{ width: '100%' }} /></b>
                <span><AdminText text="Notes" /></span>
                <b><input name="notes" defaultValue={order.notes || ''} maxLength={500}
                  style={{ width: '100%' }} /></b>
              </div>
              <div className="bar-row" style={{ marginTop: '12px' }}>
                <button className="btn sm" type="submit"><AdminText text="Save delivery" /></button>
                <label className="muted" style={{ fontSize: '13px' }}>
                  <input type="checkbox" name="quiet" value="1" />{' '}<AdminText text="Do not email" /></label>
              </div>
            </form>
          ) : (
            <div style={{ padding: '16px 20px' }}>
              <div className="kv">
                <span><AdminText text="Address" /></span><b>{order.address || '—'}</b>
                <span><AdminText text="City" /></span><b>{order.city || '—'}</b>
                {order.notes ? (<><span><AdminText text="Notes" /></span><b><i>{order.notes}</i></b></>) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <ItemsPanel editable={editable} action={saveItems}>
        <input type="hidden" name="_csrf" value={token} />
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="seq" value={seq} />

        <h2><AdminText text="Items" /></h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th><AdminText text="Product" /></th><th><AdminText text="SKU" /></th><th><AdminText text="Price" /></th><th><AdminText text="Qty" /></th>
                <th style={{ textAlign: 'right' }}><AdminText text="Line" /></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="muted"><code>{it.sku || '—'}</code></td>
                  <td>{<AdminFormat kind="money" value={it.price} />}</td>
                  <td>
                    {editable ? (
                      <input type="number" name={`qty_${it.id}`} defaultValue={Number(it.qty)}
                        min={0} max={MAX_QTY} step={1} style={{ width: '72px' }} />
                    ) : `× ${Number(it.qty)}`}
                  </td>
                  <td style={{ textAlign: 'right' }}>{<AdminFormat kind="money" value={Number(it.price) * Number(it.qty)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1.5px solid var(--line)' }}>
          <div className="kv kv-money">
            <span><AdminText text="Subtotal" /></span><b>{<AdminFormat kind="money" value={order.subtotal} />}</b>
            {Number(order.discount) > 0 ? (
              <><span><AdminText text="Discount" />{order.coupon ? ` (${order.coupon})` : ''}</span><b>−{<AdminFormat kind="money" value={order.discount} />}</b></>
            ) : null}
            <span><AdminText text="Shipping" /></span><b>{<AdminFormat kind="money" value={order.shipping} />}</b>
            <span><AdminText text="Total" /></span><b style={{ fontSize: '18px' }}>{<AdminFormat kind="money" value={order.total} />}</b>
          </div>
        </div>

        {editable ? (
          <div style={{ padding: '14px 20px', borderTop: '1.5px solid var(--line)' }}>
            <div className="bar-row" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <select name="add_sku" defaultValue="" style={{ width: '260px' }}>
                <option value=""><AdminText text="Add a product…" /></option>
                {catalogue.map(p => (
                  <option key={p.sku} value={p.sku}>
                    {p.name_en} — {<AdminFormat kind="money" value={p.price} />} ({Number(p.stock)}{' '}<AdminText text="in stock)" /></option>
                ))}
              </select>
              <AdminElement as="input" type="number" name="add_qty" defaultValue={1} min={1} max={MAX_QTY} step={1}
                style={{ width: '72px' }} aria-label="Quantity to add" />
              <AdminElement as="input" name="coupon" defaultValue={order.coupon || ''} placeholder="Coupon code"
                maxLength={64} style={{ width: '160px', textTransform: 'uppercase' }} />
              <button className="btn sm" type="submit"><AdminText text="Save items" /></button>
              <label className="muted" style={{ fontSize: '13px' }}>
                <input type="checkbox" name="quiet" value="1" />{' '}<AdminText text="Do not email" /></label>
            </div>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: '13px' }}><AdminText text="Set a quantity to 0 to take the line off. Adding a product that is already on the order adds to that line. Totals, the discount and the stock are all recomputed when you save — the figures above are as they stand now. Clearing the coupon gives its redemption back; typing a different one moves the redemption across. The customer is emailed the revised order unless you tick Do not email." /></p>
          </div>
        ) : (
          <div className="muted" style={{ padding: '14px 20px', borderTop: '1.5px solid var(--line)' }}>
            <AdminText text={title(order.status)} />{' '}<AdminText text="orders cannot be edited. Once a parcel is with a courier its contents and the amount written on the waybill are fixed, and past that both remaining statuses are final." /></div>
        )}
      </ItemsPanel>

      <div className="panel">
        <h2><AdminText text="Move status" /><span className="right">
            <form action={saveStatus} className="bar-row">
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <select name="status" defaultValue={order.status} disabled={locked} style={{ width: '160px' }}>
                {[order.status, ...moves].map(s => <option key={s} value={s}><AdminText text={title(s)} /></option>)}
              </select>
              <button className="btn sm" type="submit" disabled={locked}><AdminText text="Save" /></button>
            </form>
          </span>
        </h2>
        <div className="muted" style={{ padding: '14px 20px' }}>
          {locked
            ? <AdminText text="{0} is final — there is nowhere to move this order." translateValues values={[title(order.status)]} />
            : <AdminText text="From {0} this order can move to {1}. The customer is emailed on the moves they hear about." translateValues values={[title(order.status),moves.map(title)]} />}
        </div>
      </div>

      <div className="panel">
        <h2><AdminText text="Dispatch" /><span className="right">
            <form action={saveDispatch} className="bar-row">
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <AdminElement as="input" name="courier" defaultValue={order.courier || ''} placeholder="Courier"
                maxLength={60} style={{ width: '140px' }} />
              <AdminElement as="input" name="tracking_ref" defaultValue={order.tracking_ref || ''} placeholder="Tracking ref"
                maxLength={60} style={{ width: '160px' }} />
              <button className="btn sm ghost" type="submit"><AdminText text="Save" /></button>
            </form>
          </span>
        </h2>
        <div className="muted" style={{ padding: '14px 20px' }}>
          {order.eta_from && order.eta_to ? (
            <><AdminText text="Customer was promised" />{' '}<b>{formatWindow(order.eta_from, order.eta_to, 'en')}</b><AdminText text=", on the" />{' '}
              <b>{zoneFor(order.city)}</b>{' '}<AdminText text="tier for “" />{order.city || '—'}<AdminText text="”. Written when the order was confirmed and never moved afterwards — the customer has already been shown it." /></>
          ) : (
            <><AdminText text="No delivery window yet. One is written from the governorate in the address the first time this order is confirmed or shipped, and the customer sees it on their order page." /></>
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
        <h2><AdminText text="Cash collected" />{settleable ? (
            <span className="right">
              <form action={saveSettlement} className="bar-row">
                <input type="hidden" name="_csrf" value={token} />
                <input type="hidden" name="id" value={order.id} />
                <input type="hidden" name="collection_seq" value={order.collection_seq}/>
                <AdminElement as="input" name="collected" type="number" step="0.01" min="0" max={MAX_COLLECTED}
                  defaultValue={order.collected_amount == null ? '' : Number(order.collected_amount)}
                  placeholder={Number(order.total).toFixed(2)} style={{ width: '120px' }}
                  aria-label="Amount the driver handed over" />
                <label><AdminText text="Reason for collection correction"/><input name="collection_reason" minLength={5} maxLength={300}/></label>
                <button className="btn sm ghost" type="submit"><AdminText text="Save" /></button>
              </form>
            </span>
          ) : null}
        </h2>
        <div className="muted" style={{ padding: '14px 20px' }}>
          {!settleable ? (
            <><AdminText text="Cash is recorded once the order is delivered. This one is" />{' '}<AdminText text={title(order.status)} />.</>
          ) : order.collected_amount == null ? (
            <><AdminText text="Nothing recorded yet. Type what the driver actually handed over — not what the waybill said. The order asked for" />{' '}<b>{<AdminFormat kind="money" value={order.total} />}</b><AdminText text=". Leave it blank until you have the real figure; every delivered order with no number here is listed on the Orders screen." /></>
          ) : (
            <>
              <b>{<AdminFormat kind="money" value={order.collected_amount} />}</b>{' '}<AdminText text="recorded against" />{' '}<b>{<AdminFormat kind="money" value={order.total} />}</b>
              {shortBy === 0 ? (
                <>{' '}<AdminText text="— matches." /></>
              ) : (
                <> — <b style={{ color: 'var(--red)' }}>{shortBy > 0 ? <AdminText text="short" /> : <AdminText text="over" />}{' '}<AdminText text="by" />{' '}{<AdminFormat kind="money" value={Math.abs(shortBy)} />}</b>.</>
              )}
              {order.settled_at ? <>{' '}<AdminText text="First collection record" />{' '}<AdminFormat kind="dt" value={order.settled_at}/>.</> : null}
              {' '}<AdminText text="Unchanged saves preserve history. Corrections need a reason and are recorded in their own period. Collection changes are locked after a refund or courier settlement." /></>
          )}
        </div>
      </div>

      <div className="panel">
        <h2><AdminText text="History" /><span className="right">
            <form action={addNote} className="bar-row">
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={order.id} />
              <AdminElement as="input" name="note" placeholder="Add an internal note" maxLength={500} style={{ width: '240px' }} />
              <button className="btn sm ghost" type="submit"><AdminText text="Add" /></button>
            </form>
          </span>
        </h2>
        {events.length === 0 ? (
          <div className="empty"><AdminText text="No history yet." /></div>
        ) : (
          <ul className="tl">
            {events.map(e => (
              <li key={e.id}>
                <span className="tl-when">{<AdminFormat kind="dt" value={e.created_at} />}</span>
                <span className="tl-body">
                  {e.kind === 'status' ? (
                    <><b><AdminText text={title(e.to_status)} /></b>{e.from_status ? <span className="muted">{' '}<AdminText text="from" />{' '}<AdminText text={title(e.from_status)} /></span> : null}</>
                  ) : (
                    <><b><AdminText text={EVENT_LABEL[e.kind] || e.kind} /></b>{e.note ? <span> — {e.note}</span> : null}</>
                  )}
                  <span className="muted"> · <AdminActor value={e.actor}/></span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
