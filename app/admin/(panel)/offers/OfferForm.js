'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

const INITIAL = { errors: {}, fields: {}, attempt: 0 };

export default function OfferForm({ action, csrf }) {
  const [state, formAction, pending] = useActionState(action, INITIAL, '/admin/offers');
  const [type, setType] = useState(() => ['percent', 'fixed', 'none'].includes(state.fields?.discount_type) ? state.fields.discount_type : 'percent');
  const summary = useRef(null);
  const { errors = {}, fields = {} } = state;
  useEffect(() => {
    if (state.attempt) {
      setType(['percent', 'fixed', 'none'].includes(fields.discount_type) ? fields.discount_type : 'percent');
      summary.current?.focus();
    }
  }, [state.attempt, fields.discount_type]);
  const a11y = name => ({ 'aria-invalid': errors[name] ? true : undefined, 'aria-describedby': errors[name] ? `${name}-error` : undefined });
  const error = name => errors[name] && <p className="field-error" id={`${name}-error`}>{errors[name]}</p>;

  return (
    <form key={state.attempt} action={formAction} noValidate>
      <input type="hidden" name="_csrf" value={csrf} />
      {Object.keys(errors).length > 0 && (
        <div className="flash err offer-error-summary" role="alert" tabIndex={-1} ref={summary}>
          <p>Offer not created. Check these fields:</p>
          <ul>{Object.entries(errors).map(([name, message]) => <li key={name}>{name === 'form' ? message : <a href={`#${name}`}>{message}</a>}</li>)}</ul>
        </div>
      )}
      <div className="grid2">
        <div className="field">
          <label htmlFor="title_ar">Title (Arabic) *</label>
          <input id="title_ar" name="title_ar" required defaultValue={fields.title_ar || ''} placeholder="خصم 15% على الواكس" dir="rtl" {...a11y('title_ar')} />
          {error('title_ar')}
        </div>
        <div className="field">
          <label htmlFor="title_en">Title (English)</label>
          <input id="title_en" name="title_en" defaultValue={fields.title_en || ''} placeholder="15% off all wax" />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="body_ar">Body (Arabic) *</label>
          <textarea id="body_ar" name="body_ar" rows={3} required dir="rtl" defaultValue={fields.body_ar || ''} {...a11y('body_ar')} />
          {error('body_ar')}
        </div>
        <div className="field">
          <label htmlFor="body_en">Body (English)</label>
          <textarea id="body_en" name="body_en" rows={3} defaultValue={fields.body_en || ''} />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="code">Discount code{type !== 'none' ? ' *' : ''}</label>
          <input id="code" name="code" maxLength={64} required={type !== 'none'} defaultValue={fields.code || ''} placeholder="WAX15" style={{ textTransform: 'uppercase' }} {...a11y('code')} />
          {error('code')}
        </div>
        <div className="field">
          <label htmlFor="discount_type">Type</label>
          <select id="discount_type" name="discount_type" value={type} onChange={event => setType(event.target.value)} {...a11y('discount_type')}>
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed EGP off</option>
            <option value="none">Announcement only</option>
          </select>
          {error('discount_type')}
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="discount_value">Value</label>
          <input id="discount_value" type="number" name="discount_value" step="0.01" min={type === 'none' ? '0' : '0.01'} max={type === 'percent' ? '100' : '99999999.99'} disabled={type === 'none'} defaultValue={fields.discount_value ?? '10'} {...a11y('discount_value')} />
          {error('discount_value')}
        </div>
        <div className="field">
          <label htmlFor="min_total">Minimum order (EGP)</label>
          <input id="min_total" type="number" name="min_total" step="0.01" min="0" max="99999999.99" defaultValue={fields.min_total ?? '0'} {...a11y('min_total')} />
          {error('min_total')}
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="max_uses">Total redemptions</label>
          <input id="max_uses" type="number" name="max_uses" min="1" max="2147483647" step="1" defaultValue={fields.max_uses || ''} placeholder="unlimited" {...a11y('max_uses')} />
          {error('max_uses')}
        </div>
        <div className="field">
          <label htmlFor="per_customer">Uses per phone</label>
          <input id="per_customer" type="number" name="per_customer" min="1" max="2147483647" step="1" defaultValue={fields.per_customer || ''} placeholder="unlimited" {...a11y('per_customer')} />
          {error('per_customer')}
        </div>
      </div>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: '13px' }}>
        Blank caps mean unlimited. Total is the limit across all orders. Uses per phone applies to this code:
        {' '}<b>1 means one use of this code per phone number</b>. A cancelled order gives its redemption back.
      </p>
      <div className="grid2">
        <div className="field">
          <label htmlFor="starts_at">Starts (Cairo time)</label>
          <input id="starts_at" type="datetime-local" name="starts_at" defaultValue={fields.starts_at || ''} {...a11y('starts_at')} />
          {error('starts_at')}
        </div>
        <div className="field">
          <label htmlFor="ends_at">Ends (Cairo time)</label>
          <input id="ends_at" type="datetime-local" name="ends_at" defaultValue={fields.ends_at || ''} {...a11y('ends_at')} />
          {error('ends_at')}
        </div>
      </div>
      <button className="btn red" type="submit" disabled={pending}>{pending ? 'Creating offer…' : 'Create offer'}</button>
    </form>
  );
}
