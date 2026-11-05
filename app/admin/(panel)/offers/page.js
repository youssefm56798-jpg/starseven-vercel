import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText, AdminFormat } from '../../_lib/locale.js';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import { requirePermission } from '../../_lib/guard.js';
import { dt, Flash, money, trimNum } from '../../_lib/ui.js';
import { createValidatedOffer, effectiveOfferStatus, offerDateTime, validateOfferInput } from '../../../../lib/offer-admin.mjs';
import OfferForm from './OfferForm.js';
import BroadcastButton from './broadcast.js';
import {auditedQuery} from '../../../../lib/audit-query.mjs';

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
export async function generateMetadata(){return localizedAdminMetadata({ title: 'Offers — Star Seven admin' });}

async function createOffer(previous, formData) {
  'use server';
  const admin=await requirePermission('offers:write');
  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/offers?m=csrf');

  let result;
  try {
    result = await createValidatedOffer(sql, formData,`admin:${admin.id}`);
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
  const admin=await requirePermission('offers:write');

  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/offers?m=csrf');

  const id = Number(formData.get('id'));
  const act = String(formData.get('act') || '');
  if (!Number.isInteger(id) || id <= 0) redirect('/admin/offers?m=bad_input');


  if (act === 'eligibility') {
    const expected=String(formData.get('expected_first_order'));
    if(!['0','1'].includes(expected))redirect('/admin/offers?m=bad_input');
    let changed;
    try {
      changed=await auditedQuery(sql,`admin:${admin.id}`,'offer-eligibility',sql`UPDATE offers SET first_order_only=NOT first_order_only WHERE id=${id} AND first_order_only=${expected==='1'} AND code<>'' AND discount_type IN ('percent','fixed') RETURNING id`);
    }catch(error){console.error('[s7] Offer eligibility change failed:',/^[A-Z0-9]{5}$/.test(error?.code??'')?error.code:'DB_ERROR');redirect('/admin/offers?m=ops_unavailable');}
    redirect('/admin/offers?m='+(changed.length?'offer_updated':'ops_stale'));
  }
  if (act === 'toggle') {
    await auditedQuery(sql,`admin:${admin.id}`,'offer-toggle',sql`UPDATE offers SET active = NOT active WHERE id = ${id}`);
    redirect('/admin/offers?m=offer_updated');
  }
  if (act === 'delete') {
    await auditedQuery(sql,`admin:${admin.id}`,'offer-delete',sql`DELETE FROM offers WHERE id = ${id}`);
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
      <h1><AdminText text="Sale opportunities" /></h1>
      <p className="sub"><AdminText text="Create an offer, then broadcast it to" />{' '}<b>{activeSubs}</b>{' '}<AdminText text="confirmed subscriber" />{activeSubs === 1 ? '' : <AdminText text="s" />}<AdminText text=". The live offer also drives the discount code on the site and the banner in the newsletter block." /></p>

      <Flash code={sp?.m} />

      <div className="panel">
        <h2><AdminText text="New offer" /></h2>
        <div className="pad">
          <OfferForm action={createOffer} csrf={token} />
        </div>
      </div>

      <div className="panel">
        <h2><AdminText text="All offers" /></h2>
        {offers.length === 0 ? (
          <div className="empty"><AdminText text="No offers yet." /></div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th><AdminText text="Offer" /></th><th><AdminText text="Code" /></th><th><AdminText text="Discount" /></th><th><AdminText text="Window (Cairo time)" /></th><th><AdminText text="Sent" /></th><th></th></tr>
              </thead>
              <tbody>
                {offerRows.map(o => (
                  <tr key={o.id}>
                    <td>
                      <b dir="rtl">{o.title_ar}</b>
                      {o.title_en ? <div className="muted">{o.title_en}</div> : null}
                      {' '}
                      <span className={o.availability.key === 'active' ? 'pill active' : o.availability.key === 'scheduled' ? 'pill pending' : 'pill cancelled'}>{<AdminText text={o.availability.label} />}</span>
                      <div className="muted">{o.active ? <AdminText text="Enabled" /> : <AdminText text="Disabled" />}</div>
                      <div className="muted">{o.first_order_only ? <AdminText text="First order only" /> : <AdminText text="Any customer — no first-order restriction" />}</div>
                    </td>
                    <td>{o.code ? <b>{o.code}</b> : <span className="muted">—</span>}</td>
                    <td className="muted">
                      {o.discount_type === 'percent' && `${trimNum(o.discount_value)}%`}
                      {o.discount_type === 'fixed' && <AdminFormat kind="money" value={o.discount_value} />}
                      {o.discount_type === 'none' && '—'}
                      {Number(o.min_total) > 0 ? <div><AdminText text="min" />{' '}{<AdminFormat kind="money" value={o.min_total} />}</div> : null}
                      {/* The caps, and only when there are any — an unlimited
                          code is the common one and saying "unlimited" on every
                          row would bury the two that are capped. */}
                      {o.max_uses != null ? (
                        <div>{Number(o.used_count)}/{Number(o.max_uses)}{' '}<AdminText text="used ·" />{' '}{o.availability.remainingUses}{' '}<AdminText text="remaining" /></div>
                      ) : null}
                      {o.per_customer != null ? (
                        <div><AdminText text="max" />{' '}{Number(o.per_customer)} {Number(o.per_customer) === 1 ? <AdminText text="use" /> : <AdminText text="uses" />}{' '}<AdminText text="per phone" /></div>
                      ) : null}
                    </td>
                    <td className="muted"><div><AdminText text="Starts:" />{' '}{<AdminFormat kind="offerDateTime" value={o.starts_at} />}</div><div><AdminText text="Ends:" />{' '}{<AdminFormat kind="offerDateTime" value={o.ends_at} />}</div></td>
                    <td className="muted">
                      {Number(o.sent_count)}
                      {o.sent_at ? <div>{<AdminFormat kind="dt" value={o.sent_at} />}</div> : null}
                    </td>
                    <td>
                      <div className="bar-row">
                        <BroadcastButton offerId={Number(o.id)} csrf={token} recipients={activeSubs} />
                        {o.code&&o.discount_type!=='none'&&<form action={offerAction} className="bar-row">
                          <input type="hidden" name="_csrf" value={token}/><input type="hidden" name="id" value={o.id}/><input type="hidden" name="expected_first_order" value={o.first_order_only?'1':'0'}/>
                          <input type="hidden" name="act" value="eligibility"/><ConfirmButton message="This changes eligibility for future submissions. Existing orders are unchanged."><AdminText text={o.first_order_only?'Allow returning customers':'Require first order'}/></ConfirmButton>
                        </form>}
                        <form action={offerAction} className="bar-row">
                          <input type="hidden" name="_csrf" value={token} />
                          <input type="hidden" name="id" value={o.id} />
                          <input type="hidden" name="act" value="toggle"/><button className="btn sm ghost" type="submit">
                            {o.active ? <AdminText text="Turn off" /> : <AdminText text="Turn on" />}
                          </button>
                          </form><form action={offerAction} className="bar-row"><input type="hidden" name="_csrf" value={token}/><input type="hidden" name="id" value={o.id}/><input type="hidden" name="act" value="delete"/><ConfirmButton message="Delete this offer permanently?"><AdminText text="Delete" /></ConfirmButton>
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
