// Offer input and presentation rules. No connection, account or mail side effects.
const TYPES = new Set(['percent', 'fixed', 'none']);
const MONEY_MAX = 99999999.99; // offers NUMERIC(10,2)
const CAP_MAX = 2147483647; // offers INT caps
const FIELDS = ['title_ar', 'title_en', 'body_ar', 'body_en', 'code', 'discount_type', 'discount_value', 'min_total', 'max_uses', 'per_customer', 'starts_at', 'ends_at'];

function localTime(raw) {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw) || raw.startsWith('0000')) return NaN;
  const value = Date.parse(raw + 'Z');
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 16) !== raw.slice(0, 16)) return NaN;
  return value;
}

export function validateOfferInput(formData) {
  const fields = Object.fromEntries(FIELDS.map(name => [name, String(formData.get(name) ?? '').trim()]));
  fields.code = fields.code.toUpperCase();
  const errors = {};
  if (!fields.title_ar) errors.title_ar = 'Enter an Arabic title.';
  if (!fields.body_ar) errors.body_ar = 'Enter the Arabic offer text.';
  if (!TYPES.has(fields.discount_type)) errors.discount_type = 'Choose a listed offer type.';
  if (fields.discount_type !== 'none' && !fields.code) errors.code = 'Enter a code for this discount.';
  if (fields.code.length > 64) errors.code = 'Use a code of 64 characters or fewer.';

  const money = (name, positive = false) => {
    const raw = fields[name] || (name === 'min_total' ? '0' : '');
    const n = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 0 || (positive && n === 0) || n > MONEY_MAX || Number(n.toFixed(2)) !== n) {
      errors[name] = positive ? 'Enter an amount above zero, with at most two decimal places.' : 'Enter zero or a positive amount, with at most two decimal places.';
      return null;
    }
    return n;
  };
  const value = fields.discount_type === 'none' ? 0 : money('discount_value', true);
  if (fields.discount_type === 'percent' && value > 100) errors.discount_value = 'Enter a percentage above zero and no greater than 100.';
  const minTotal = money('min_total');
  const cap = name => {
    if (!fields[name]) return null;
    const n = Number(fields[name]);
    if (!/^\d+$/.test(fields[name]) || !Number.isSafeInteger(n) || n < 1 || n > CAP_MAX) {
      errors[name] = 'Enter a positive whole number, or leave blank for unlimited.';
      return null;
    }
    return n;
  };
  const maxUses = cap('max_uses'), perCustomer = cap('per_customer');
  const starts = localTime(fields.starts_at), ends = localTime(fields.ends_at);
  if (Number.isNaN(starts)) errors.starts_at = 'Enter a valid Cairo date and time.';
  if (Number.isNaN(ends)) errors.ends_at = 'Enter a valid Cairo date and time.';
  if (Number.isFinite(starts) && Number.isFinite(ends) && ends <= starts) errors.ends_at = 'End time must be after start time.';
  return {
    ok: Object.keys(errors).length === 0, fields, errors,
    values: { ...fields, discount_value: value, min_total: minTotal, max_uses: maxUses, per_customer: perCustomer, starts_at: fields.starts_at || null, ends_at: fields.ends_at || null },
  };
}

export async function createValidatedOffer(sql, formData) {
  const parsed = validateOfferInput(formData);
  if (!parsed.ok) return parsed;
  const v = parsed.values;
  try {
    if (v.code && (await sql`SELECT id FROM offers WHERE code = ${v.code} LIMIT 1`).length) {
      return { ...parsed, ok: false, errors: { code: 'This code already exists. Choose another code.' } };
    }
    // The database interprets wall-clock values in Cairo. Check the converted
    // bounds as well, including DST normalization, before any row is inserted.
    const rows = await sql`
      WITH validity AS (
        SELECT ${v.starts_at}::timestamp AT TIME ZONE 'Africa/Cairo' AS starts_at,
               ${v.ends_at}::timestamp AT TIME ZONE 'Africa/Cairo' AS ends_at
      )
      INSERT INTO offers (title_ar, title_en, body_ar, body_en, code, discount_type,
                          discount_value, min_total, starts_at, ends_at, active,
                          max_uses, per_customer)
      SELECT ${v.title_ar}, ${v.title_en}, ${v.body_ar}, ${v.body_en}, ${v.code},
             ${v.discount_type}, ${v.discount_value}, ${v.min_total}, starts_at, ends_at,
             true, ${v.max_uses}::int, ${v.per_customer}::int
        FROM validity
       WHERE starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
      RETURNING id`;
    if (!rows.length) return { ...parsed, ok: false, errors: { ends_at: 'End time must be after start time in Cairo.' } };
    return { ok: true, id: rows[0].id };
  } catch (error) {
    // The unique index remains authoritative when two owners submit at once.
    if (error?.code === '23505' && error?.constraint === 'idx_offers_code') {
      return { ...parsed, ok: false, errors: { code: 'This code already exists. Choose another code.' } };
    }
    throw error;
  }
}

function instant(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function effectiveOfferStatus(offer, now = Date.now()) {
  const starts = instant(offer.starts_at), ends = instant(offer.ends_at);
  const remainingUses = offer.max_uses == null ? null : Math.max(0, Number(offer.max_uses) - Number(offer.used_count || 0));
  // Match checkout's inclusive start/end checks and total-redemption guard.
  let key = 'active';
  if (!offer.active) key = 'disabled';
  else if (ends && ends.getTime() < Number(now)) key = 'expired';
  else if (remainingUses === 0) key = 'exhausted';
  else if (starts && starts.getTime() > Number(now)) key = 'scheduled';
  return { key, label: key[0].toUpperCase() + key.slice(1), remainingUses };
}

export function offerDateTime(value) {
  const date = instant(value);
  if (!date) return 'No limit';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  }).format(date);
}
