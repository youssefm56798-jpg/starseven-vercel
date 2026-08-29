import Link from 'next/link';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import { bySlug } from '../../../../lib/hairtypes.js';
import { can } from '../../../../lib/admin-roles.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import { requirePermission } from '../../_lib/guard.js';
import { day, Flash } from '../../_lib/ui.js';

/*
 * Read for everyone signed in, write and export for the owner.
 *
 * The list itself is not a new class of secret to somebody who can already read
 * every order, which carries the same names, phones, addresses and emails — and
 * a caller asking whether they are on the list is an order-desk question. The
 * bulk CSV is different in kind rather than in degree: it is the whole customer
 * database in one file, it is the single most valuable thing that can walk out
 * of this panel, and no order has ever needed it. Deleting a subscriber is
 * destructive and likewise has nothing to do with the order desk.
 */

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subscribers — Star Seven admin' };

const STATUSES = ['active', 'pending', 'unsubscribed', 'bounced'];
const title = s => s.charAt(0).toUpperCase() + s.slice(1);

function backTo(status, q, msg) {
  const p = new URLSearchParams();
  if (STATUSES.includes(status)) p.set('status', status);
  if (q) p.set('q', q);
  if (msg) p.set('m', msg);
  const s = p.toString();
  return `/admin/subscribers${s ? `?${s}` : ''}`;
}

async function subAction(formData) {
  'use server';
  await requirePermission('subscribers:write');

  const fStatus = String(formData.get('f_status') || '');
  const fQ = String(formData.get('q_back') || '').slice(0, 80);
  const id = Number(formData.get('id'));
  const act = String(formData.get('act') || '');

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo(fStatus, fQ, 'csrf'));
  if (!Number.isInteger(id) || id <= 0) redirect(backTo(fStatus, fQ, 'bad_input'));

  if (act === 'activate') {
    await sql`UPDATE subscribers SET status = 'active', confirmed_at = now() WHERE id = ${id}`;
    redirect(backTo(fStatus, fQ, 'sub_confirmed'));
  }
  if (act === 'unsub') {
    await sql`UPDATE subscribers SET status = 'unsubscribed' WHERE id = ${id}`;
    redirect(backTo(fStatus, fQ, 'sub_unsubbed'));
  }
  if (act === 'delete') {
    await sql`DELETE FROM subscribers WHERE id = ${id}`;
    redirect(backTo(fStatus, fQ, 'sub_deleted'));
  }
  redirect(backTo(fStatus, fQ, 'bad_input'));
}

export default async function SubscribersPage({ searchParams }) {
  const me = await requirePermission('subscribers:read');
  const mayWrite = can(me.role, 'subscribers:write');
  const mayExport = can(me.role, 'subscribers:export');
  const sp = await searchParams;
  const token = await csrfToken();

  const status = STATUSES.includes(String(sp?.status || '')) ? String(sp.status) : '';
  const q = String(sp?.q || '').trim().slice(0, 80);
  const like = `%${q}%`;

  let subs;
  if (status && q) {
    subs = await sql`
      SELECT * FROM subscribers
       WHERE status = ${status}
         AND (email ILIKE ${like} OR name ILIKE ${like} OR phone ILIKE ${like})
       ORDER BY id DESC LIMIT 500`;
  } else if (status) {
    subs = await sql`SELECT * FROM subscribers WHERE status = ${status} ORDER BY id DESC LIMIT 500`;
  } else if (q) {
    subs = await sql`
      SELECT * FROM subscribers
       WHERE email ILIKE ${like} OR name ILIKE ${like} OR phone ILIKE ${like}
       ORDER BY id DESC LIMIT 500`;
  } else {
    subs = await sql`SELECT * FROM subscribers ORDER BY id DESC LIMIT 500`;
  }

  const countRows = await sql`SELECT status, COUNT(*) AS c FROM subscribers GROUP BY status`;
  const counts = {};
  let total = 0;
  for (const r of countRows) {
    counts[r.status] = Number(r.c);
    total += Number(r.c);
  }

  return (
    <>
      <h1>Subscribers</h1>
      <p className="sub">The sale list. Double opt-in — only <b>active</b> rows receive broadcasts.</p>

      <Flash code={sp?.m} />

      <div className="cards">
        <div className="kpi"><b>{counts.active || 0}</b><span>Active</span></div>
        <div className="kpi"><b>{counts.pending || 0}</b><span>Pending</span></div>
        <div className="kpi"><b>{counts.unsubscribed || 0}</b><span>Unsubscribed</span></div>
        <div className="kpi"><b>{total}</b><span>Total</span></div>
      </div>

      <div className="panel">
        <h2>
          List
          <span className="right">
            <form method="get" className="bar-row">
              <input name="q" defaultValue={q} placeholder="Email, name or phone" style={{ width: '200px' }} />
              <select name="status" defaultValue={status} style={{ width: '150px' }}>
                <option value="">All</option>
                {STATUSES.map(s => <option key={s} value={s}>{title(s)}</option>)}
              </select>
              <button className="btn sm" type="submit">Apply</button>
            </form>
            {/* data-no-transition because this is a download, not a page.
                The route answers with Content-Disposition: attachment, so the
                browser hands the visitor a file and leaves the admin exactly
                where it is. PageWipe cannot see that from the markup - there
                is no `download` attribute for it to check, the href is
                same-origin and the pathname differs, so without this it treats
                the click as a navigation: it prevents the default (killing the
                browser's own download), covers the screen for 420ms, and then
                pushes a route that never commits a new pathname. The arrival
                effect never runs, so the panel sits opaque over the admin for
                the full 2500ms STUCK_MS failsafe and is then torn down with no
                animation. */}
            {mayExport ? (
              <a className="btn sm ghost" href="/admin/subscribers/export" data-no-transition="">Export CSV</a>
            ) : null}
            {mayExport ? <Link className="btn sm red" href="/admin/offers">Send an offer</Link> : null}
          </span>
        </h2>

        {subs.length === 0 ? (
          <div className="empty">No subscribers match that yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th><th>Name / phone</th><th>Hair type</th>
                  <th>Lang</th><th>Status</th><th>Joined</th><th></th>
                </tr>
              </thead>
              <tbody>
                {subs.map(s => {
                  const tile = s.hair_type ? bySlug(s.hair_type) : null;
                  return (
                    <tr key={s.id}>
                      <td dir="ltr">{s.email}<div className="muted">{s.source}</div></td>
                      <td>
                        {s.name || <span className="muted">—</span>}
                        {s.phone ? <div className="muted" dir="ltr">{s.phone}</div> : null}
                      </td>
                      <td className="muted">{s.hair_type ? (tile ? tile.en.name : s.hair_type) : '—'}</td>
                      <td className="muted">{String(s.lang || '').toUpperCase()}</td>
                      <td><span className={`pill ${s.status}`}>{s.status}</span></td>
                      <td className="muted">{day(s.created_at)}</td>
                      <td>
                        {mayWrite ? (
                        <form action={subAction} className="bar-row">
                          <input type="hidden" name="_csrf" value={token} />
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="f_status" value={status} />
                          <input type="hidden" name="q_back" value={q} />
                          {s.status !== 'active' && (
                            <button className="btn sm ghost" type="submit" name="act" value="activate">Confirm</button>
                          )}
                          {s.status !== 'unsubscribed' && (
                            <button className="btn sm ghost" type="submit" name="act" value="unsub">Unsubscribe</button>
                          )}
                          <ConfirmButton
                            name="act"
                            value="delete"
                            message="Delete this subscriber permanently?"
                          >
                            Delete
                          </ConfirmButton>
                        </form>
                        ) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
