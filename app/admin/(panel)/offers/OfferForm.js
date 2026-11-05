'use client';
import { AdminText, AdminElement } from '../../_lib/locale.js';


import { useActionState, useEffect, useRef, useState } from 'react';

const INITIAL = { errors: {}, fields: {}, attempt: 0 };

export default function OfferForm({ action, csrf }) {
  const [state, formAction, pending] = useActionState(action, INITIAL, '/admin/offers');
  const [type, setType] = useState(() => ['percent', 'fixed', 'none'].includes(state.fields?.discount_type) ? state.fields.discount_type : 'percent');
  const summary = useRef(null);
  const errors = state.errors ?? {};
  const fields = state.fields ?? {};
  useEffect(() => {
    if (state.attempt) {
      setType(['percent', 'fixed', 'none'].includes(fields.discount_type) ? fields.discount_type : 'percent');
      summary.current?.focus();
    }
  }, [state.attempt, fields.discount_type]);
  const a11y = name => ({ 'aria-invalid': errors[name] ? true : undefined, 'aria-describedby': errors[name] ? `${name}-error` : undefined });
  const error = name => errors[name] && <p className="field-error" id={`${name}-error`}>{<AdminText text={errors[name]} />}</p>;

  return (
    <form key={state.attempt} action={formAction} noValidate>
      <input type="hidden" name="_csrf" value={csrf} />
      {Object.keys(errors).length > 0 && (
        <div className="flash err offer-error-summary" role="alert" tabIndex={-1} ref={summary}>
          <p><AdminText text="Offer not created. Check these fields:" /></p>
          <ul>{Object.entries(errors).map(([name, message]) => <li key={name}>{name === 'form' ? <AdminText text={message}/> : <a href={`#${name}`}>{<AdminText text={message} />}</a>}</li>)}</ul>
        </div>
      )}
      <div className="grid2">
        <div className="field">
          <label htmlFor="title_ar"><AdminText text="Title (Arabic) *" /></label>
          <input id="title_ar" name="title_ar" required defaultValue={fields.title_ar || ''} placeholder="خصم 15% على الواكس" dir="rtl" {...a11y('title_ar')} />
          {error('title_ar')}
        </div>
        <div className="field">
          <label htmlFor="title_en"><AdminText text="Title (English)" /></label>
          <AdminElement as="input" id="title_en" name="title_en" defaultValue={fields.title_en || ''} placeholder="15% off all wax" />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="body_ar"><AdminText text="Body (Arabic) *" /></label>
          <textarea id="body_ar" name="body_ar" rows={3} required dir="rtl" defaultValue={fields.body_ar || ''} {...a11y('body_ar')} />
          {error('body_ar')}
        </div>
        <div className="field">
          <label htmlFor="body_en"><AdminText text="Body (English)" /></label>
          <textarea id="body_en" name="body_en" rows={3} defaultValue={fields.body_en || ''} />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="code"><AdminText text="Discount code" />{type !== 'none' ? ' *' : ''}</label>
          <AdminElement as="input" id="code" name="code" maxLength={64} required={type !== 'none'} defaultValue={fields.code || ''} placeholder="WAX15" style={{ textTransform: 'uppercase' }} {...a11y('code')} />
          {error('code')}
        </div>
        <div className="field">
          <label htmlFor="discount_type"><AdminText text="Type" /></label>
          <select id="discount_type" name="discount_type" value={type} onChange={event => setType(event.target.value)} {...a11y('discount_type')}>
            <option value="percent"><AdminText text="Percent off" /></option>
            <option value="fixed"><AdminText text="Fixed EGP off" /></option>
            <option value="none"><AdminText text="Announcement only" /></option>
          </select>
          {error('discount_type')}
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="discount_value"><AdminText text="Value" /></label>
          <input id="discount_value" type="number" name="discount_value" step="0.01" min={type === 'none' ? '0' : '0.01'} max={type === 'percent' ? '100' : '99999999.99'} disabled={type === 'none'} defaultValue={fields.discount_value ?? '10'} {...a11y('discount_value')} />
          {error('discount_value')}
        </div>
        <div className="field">
          <label htmlFor="min_total"><AdminText text="Minimum order (EGP)" /></label>
          <input id="min_total" type="number" name="min_total" step="0.01" min="0" max="99999999.99" defaultValue={fields.min_total ?? '0'} {...a11y('min_total')} />
          {error('min_total')}
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="max_uses"><AdminText text="Total redemptions" /></label>
          <AdminElement as="input" id="max_uses" type="number" name="max_uses" min="1" max="2147483647" step="1" defaultValue={fields.max_uses || ''} placeholder="unlimited" {...a11y('max_uses')} />
          {error('max_uses')}
        </div>
        <div className="field">
          <label htmlFor="per_customer"><AdminText text="Uses per phone" /></label>
          <AdminElement as="input" id="per_customer" type="number" name="per_customer" min="1" max="2147483647" step="1" defaultValue={fields.per_customer || ''} placeholder="unlimited" {...a11y('per_customer')} />
          {error('per_customer')}
        </div>
      </div>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: '13px' }}><AdminText text="Blank caps mean unlimited. Total is the limit across all orders. Uses per phone applies to this code:" />{' '}<b><AdminText text="1 means one use of this code per phone number" /></b><AdminText text=". A cancelled order gives its redemption back." /></p>
      <div className="field">
        <label><input type="checkbox" name="first_order_only" value="1" defaultChecked={fields.first_order_only === '1'} />{' '}<AdminText text="First order only" /></label>
        <p className="muted"><AdminText text="Rejects any previous placed order with the same phone or email, including cancelled orders. Changing email alone cannot bypass the phone check. Guest contact details do not prove a unique person." /></p>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="starts_at"><AdminText text="Starts (Cairo time)" /></label>
          <input id="starts_at" type="datetime-local" name="starts_at" defaultValue={fields.starts_at || ''} {...a11y('starts_at')} />
          {error('starts_at')}
        </div>
        <div className="field">
          <label htmlFor="ends_at"><AdminText text="Ends (Cairo time)" /></label>
          <input id="ends_at" type="datetime-local" name="ends_at" defaultValue={fields.ends_at || ''} {...a11y('ends_at')} />
          {error('ends_at')}
        </div>
      </div>
      <button className="btn red" type="submit" disabled={pending}>{pending ? <AdminText text="Creating offer…" /> : <AdminText text="Create offer" />}</button>
    </form>
  );
}
