import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../../lib/auth.js';
import { sql } from '../../../../../lib/db.js';
import { requireAdmin } from '../../../_lib/guard.js';
import { dt, Flash, money, waLink } from '../../../_lib/ui.js';
import { STATUSES, nextFrom, eventsFor, logEvent } from '../../../../../lib/order-status.js';
import { transitionAndNotify } from '../../../../../lib/order-notify.js';
import { formatWindow, zoneFor } from '../../../../../lib/delivery-eta.js';

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
  const admin = await requireAdmin();

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
  const admin = await requireAdmin();

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
async function saveDispatch(formData) {
  'use server';
  await requireAdmin();

  const id = Number(formData.get('id'));
  const courier = String(formData.get('courier') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const tracking = String(formData.get('tracking_ref') || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(id, 'csrf'));
  if (!Number.isInteger(id) || id <= 0) redirect(backTo(id, 'bad_input'));

  const rows = await sql`
    UPDATE orders
       SET courier = ${courier}, tracking_ref = ${tracking}
     WHERE id = ${id}
     RETURNING id`;
  if (!rows.length) redirect(backTo(id, 'bad_input'));

  redirect(backTo(id, 'dispatch_saved'));
}

/** The word the timeline shows for each non-status event kind. */
const EVENT_LABEL = {
  note: 'Note',
  'refund-request': 'Cancellation asked',
  mail: 'Email sent',
};

export default async function OrderDetail({ params, searchParams }) {
  await requireAdmin();

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

  return (
    <>
      <div className="bar-row" style={{ marginBottom: '14px' }}>
        <Link className="btn sm ghost" href="/admin/orders">← All orders</Link>
      </div>

      <h1>{order.ref} <span className={`pill ${order.status}`}>{title(order.status)}</span></h1>
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
          <div style={{ padding: '16px 20px' }}>
            <div className="kv">
              <span>Address</span><b>{order.address || '—'}</b>
              <span>City</span><b>{order.city || '—'}</b>
              {order.notes ? (<><span>Notes</span><b><i>{order.notes}</i></b></>) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
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
                  <td>× {Number(it.qty)}</td>
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
      </div>

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
