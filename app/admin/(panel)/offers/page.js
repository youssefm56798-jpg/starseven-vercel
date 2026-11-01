import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import { requirePermission } from '../../_lib/guard.js';
import { dt, Flash, money, trimNum } from '../../_lib/ui.js';
import { createValidatedOffer, effectiveOfferStatus, offerDateTime, validateOfferInput } from '../../../../lib/offer-admin.mjs';
import OfferForm from './OfferForm.js';
import BroadcastButton from './broadcast.js';

/*
 * Owner only, screen and actions alike.
 *
 * A discount code is money by another name and a broadcast is the one thing in
 * this panel that cannot be undone at all — it is thousands of emails already
 * delivered. Neither is anything the order desk needs, so neither is something
 * staff can reach. See lib/admin-roles.js for the whole split.
 */

export const dynamic = 'force-dynamic';
// A broadcast batch is 25 real SMTP calls; the default 15s ceiling is too tight.
export const maxDuration = 60;
export const metadata = { title: 'Offers — Star Seven admin' };

async function createOffer(previous, formData) {
  'use server';
  await requirePermission('offers:write');
  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/offers?m=csrf');

  let result;
  try {
    result = await createValidatedOffer(sql, formData);
  } catch (error) {
    const code = /^[A-Z0-9]{5}$/.test(error?.code || '') ? error.code : 'DB_ERROR';
    console.error('[s7] Offer creation failed:', code);
    result = { fields: validateOfferInput(formData).fields, errors: { form: 'Could not create the offer. Please try again.' } };
  }
  if (result.ok) redirect('/admin/offers?m=offer_created');
  const attempt = Number.isSafeInteger(previous?.attempt) && previous.attempt < Number.MAX_SAFE_INTEGER ? previous.attempt + 1 : 1;
  return { fields: result.fields, errors: result.errors, attempt };
}

async function offerAction(formData) {
  'use server';
  await requirePermission('offers:write');

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
  await requirePermission('offers:write');
  const sp = await searchParams;
  const token = await csrfToken();

  const offers = await sql`SELECT * FROM offers ORDER BY id DESC`;
  const [{ c }] = await sql`SELECT COUNT(*)::int AS c FROM subscribers WHERE status = 'active'`;
  const activeSubs = Number(c);
  const now = Date.now();
  const offerRows = offers.map(offer => ({ ...offer, availability: effectiveOfferStatus(offer, now) }));

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
          <OfferForm action={createOffer} csrf={token} />
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
                <tr><th>Offer</th><th>Code</th><th>Discount</th><th>Window (Cairo time)</th><th>Sent</th><th></th></tr>
              </thead>
              <tbody>
                {offerRows.map(o => (
                  <tr key={o.id}>
                    <td>
                      <b dir="rtl">{o.title_ar}</b>
                      {o.title_en ? <div className="muted">{o.title_en}</div> : null}
                      {' '}
                      <span className={o.availability.key === 'active' ? 'pill active' : o.availability.key === 'scheduled' ? 'pill pending' : 'pill cancelled'}>{o.availability.label}</span>
                      <div className="muted">{o.active ? 'Enabled' : 'Disabled'}</div>
                    </td>
                    <td>{o.code ? <b>{o.code}</b> : <span className="muted">—</span>}</td>
                    <td className="muted">
                      {o.discount_type === 'percent' && `${trimNum(o.discount_value)}%`}
                      {o.discount_type === 'fixed' && money(o.discount_value)}
                      {o.discount_type === 'none' && '—'}
                      {Number(o.min_total) > 0 ? <div>min {money(o.min_total)}</div> : null}
                      {/* The caps, and only when there are any — an unlimited
                          code is the common one and saying "unlimited" on every
                          row would bury the two that are capped. */}
                      {o.max_uses != null ? (
                        <div>{Number(o.used_count)}/{Number(o.max_uses)} used · {o.availability.remainingUses} remaining</div>
                      ) : null}
                      {o.per_customer != null ? (
                        <div>max {Number(o.per_customer)} {Number(o.per_customer) === 1 ? 'use' : 'uses'} per phone</div>
                      ) : null}
                    </td>
                    <td className="muted"><div>Starts: {offerDateTime(o.starts_at)}</div><div>Ends: {offerDateTime(o.ends_at)}</div></td>
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
