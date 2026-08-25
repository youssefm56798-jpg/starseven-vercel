import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import { requireAdmin } from '../../_lib/guard.js';
import { dayShort, dt, Flash, money, trimNum } from '../../_lib/ui.js';
import BroadcastButton from './broadcast.js';

export const dynamic = 'force-dynamic';
// A broadcast batch is 25 real SMTP calls; the default 15s ceiling is too tight.
export const maxDuration = 60;
export const metadata = { title: 'Offers — Star Seven admin' };

const TYPES = ['percent', 'fixed', 'none'];

async function createOffer(formData) {
  'use server';
  await requireAdmin();

  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/offers?m=csrf');

  const titleAr = String(formData.get('title_ar') || '').trim();
  const bodyAr = String(formData.get('body_ar') || '').trim();
  if (!titleAr || !bodyAr) redirect('/admin/offers?m=offer_needs_text');

  const type = TYPES.includes(String(formData.get('discount_type'))) ? String(formData.get('discount_type')) : 'percent';
  const value = Math.max(0, Number(formData.get('discount_value')) || 0);
  const minTotal = Math.max(0, Number(formData.get('min_total')) || 0);
  const code = String(formData.get('code') || '').trim().toUpperCase();
  const starts = String(formData.get('starts_at') || '') || null;
  const ends = String(formData.get('ends_at') || '') || null;

  // The datetime-local input gives a wall clock with no zone; it is the shop's
  // wall clock, so it is read as Cairo time before being stored as UTC.
  await sql`
    INSERT INTO offers (title_ar, title_en, body_ar, body_en, code, discount_type,
                        discount_value, min_total, starts_at, ends_at, active)
    VALUES (${titleAr},
            ${String(formData.get('title_en') || '').trim()},
            ${bodyAr},
            ${String(formData.get('body_en') || '').trim()},
            ${code}, ${type}, ${value}, ${minTotal},
            ${starts}::timestamp AT TIME ZONE 'Africa/Cairo',
            ${ends}::timestamp AT TIME ZONE 'Africa/Cairo',
            true)`;

  redirect('/admin/offers?m=offer_created');
}

async function offerAction(formData) {
  'use server';
  await requireAdmin();

  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/offers?m=csrf');

  const id = Number(formData.get('id'));
  const act = String(formData.get('act') || '');
  if (!Number.isInteger(id) || id <= 0) redirect('/admin/offers?m=bad_input');

  if (act === 'toggle') {
    await sql`UPDATE offers SET active = NOT active WHERE id = ${id}`;
    redirect('/admin/offers?m=offer_updated');
  }
  if (act === 'delete') {
    await sql`DELETE FROM offers WHERE id = ${id}`;
    redirect('/admin/offers?m=offer_deleted');
  }
  redirect('/admin/offers?m=bad_input');
}

export default async function OffersPage({ searchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const token = await csrfToken();

  const offers = await sql`SELECT * FROM offers ORDER BY id DESC`;
  const [{ c }] = await sql`SELECT COUNT(*)::int AS c FROM subscribers WHERE status = 'active'`;
  const activeSubs = Number(c);

  return (
    <>
      <h1>Sale opportunities</h1>
      <p className="sub">
        Create an offer, then broadcast it to <b>{activeSubs}</b> confirmed
        subscriber{activeSubs === 1 ? '' : 's'}. The live offer also drives the discount code on the
        site and the banner in the newsletter block.
      </p>

      <Flash code={sp?.m} />

      <div className="panel">
        <h2>New offer</h2>
        <div className="pad">
          <form action={createOffer}>
            <input type="hidden" name="_csrf" value={token} />
            <div className="grid2">
              <div className="field">
                <label htmlFor="title_ar">Title (Arabic) *</label>
                <input id="title_ar" name="title_ar" required placeholder="خصم 15% على الواكس" dir="rtl" />
              </div>
              <div className="field">
                <label htmlFor="title_en">Title (English)</label>
                <input id="title_en" name="title_en" placeholder="15% off all wax" />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="body_ar">Body (Arabic) *</label>
                <textarea id="body_ar" name="body_ar" rows={3} required dir="rtl" />
              </div>
              <div className="field">
                <label htmlFor="body_en">Body (English)</label>
                <textarea id="body_en" name="body_en" rows={3} />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="code">Discount code</label>
                <input id="code" name="code" placeholder="WAX15" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="field">
                <label htmlFor="discount_type">Type</label>
                <select id="discount_type" name="discount_type" defaultValue="percent">
                  <option value="percent">Percent off</option>
                  <option value="fixed">Fixed EGP off</option>
                  <option value="none">No code — announcement only</option>
                </select>
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="discount_value">Value</label>
                <input id="discount_value" type="number" name="discount_value" step="0.01" min="0" defaultValue="10" />
              </div>
              <div className="field">
                <label htmlFor="min_total">Minimum order (EGP)</label>
                <input id="min_total" type="number" name="min_total" step="0.01" min="0" defaultValue="0" />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="starts_at">Starts</label>
                <input id="starts_at" type="datetime-local" name="starts_at" />
              </div>
              <div className="field">
                <label htmlFor="ends_at">Ends</label>
                <input id="ends_at" type="datetime-local" name="ends_at" />
              </div>
            </div>
            <button className="btn red" type="submit">Create offer</button>
          </form>
        </div>
      </div>

      <div className="panel">
        <h2>All offers</h2>
        {offers.length === 0 ? (
          <div className="empty">No offers yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Offer</th><th>Code</th><th>Discount</th><th>Window</th><th>Sent</th><th></th></tr>
              </thead>
              <tbody>
                {offers.map(o => (
                  <tr key={o.id}>
                    <td>
                      <b dir="rtl">{o.title_ar}</b>
                      {o.title_en ? <div className="muted">{o.title_en}</div> : null}
                      {' '}
                      <span className={o.active ? 'pill active' : 'pill cancelled'}>{o.active ? 'live' : 'off'}</span>
                    </td>
                    <td>{o.code ? <b>{o.code}</b> : <span className="muted">—</span>}</td>
                    <td className="muted">
                      {o.discount_type === 'percent' && `${trimNum(o.discount_value)}%`}
                      {o.discount_type === 'fixed' && money(o.discount_value)}
                      {o.discount_type === 'none' && '—'}
                      {Number(o.min_total) > 0 ? <div>min {money(o.min_total)}</div> : null}
                    </td>
                    <td className="muted">{dayShort(o.starts_at)} → {dayShort(o.ends_at)}</td>
                    <td className="muted">
                      {Number(o.sent_count)}
                      {o.sent_at ? <div>{dt(o.sent_at)}</div> : null}
                    </td>
                    <td>
                      <div className="bar-row">
                        <BroadcastButton offerId={Number(o.id)} csrf={token} recipients={activeSubs} />
                        <form action={offerAction} className="bar-row">
                          <input type="hidden" name="_csrf" value={token} />
                          <input type="hidden" name="id" value={o.id} />
                          <button className="btn sm ghost" type="submit" name="act" value="toggle">
                            {o.active ? 'Turn off' : 'Turn on'}
                          </button>
                          <ConfirmButton name="act" value="delete" message="Delete this offer permanently?">
                            Delete
                          </ConfirmButton>
                        </form>
                      </div>
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
