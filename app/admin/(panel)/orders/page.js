import Link from 'next/link';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import { requireAdmin } from '../../_lib/guard.js';
import { dt, Flash, money, waLink } from '../../_lib/ui.js';
import { STATUSES, nextFrom } from '../../../../lib/order-status.js';
import { transitionAndNotify } from '../../../../lib/order-notify.js';

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
  const admin = await requireAdmin();

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

export default async function OrdersPage({ searchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const token = await csrfToken();

  const status = STATUSES.includes(String(sp?.status || '')) ? String(sp.status) : '';
  const q = String(sp?.q || '').trim().slice(0, 80);
  const like = `%${q}%`;

  // Four complete queries rather than one assembled string: the values stay
  // parameters and the SQL stays readable.
  let orders;
  if (status && q) {
    orders = await sql`
      SELECT * FROM orders
       WHERE status = ${status}
         AND (ref ILIKE ${like} OR name ILIKE ${like} OR phone ILIKE ${like})
       ORDER BY id DESC LIMIT 200`;
  } else if (status) {
    orders = await sql`SELECT * FROM orders WHERE status = ${status} ORDER BY id DESC LIMIT 200`;
  } else if (q) {
    orders = await sql`
      SELECT * FROM orders
       WHERE ref ILIKE ${like} OR name ILIKE ${like} OR phone ILIKE ${like}
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

  return (
    <>
      <h1>Orders</h1>
      <p className="sub">Cash on delivery. Call the customer, confirm, then move the status along.</p>

      <Flash code={sp?.m} />

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
          <div className="empty">Nothing matches that.</div>
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
                      <b><Link href={`/admin/orders/${o.id}`}>{o.ref}</Link></b>
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
