import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createValidatedOffer, effectiveOfferStatus, offerDateTime, validateOfferInput } from '../lib/offer-admin.mjs';

function form(extra = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ title_ar: 'عرض تجريبي', body_ar: 'نص العرض', code: 'test15', discount_type: 'percent', discount_value: '15', min_total: '0', ...extra })) {
    if (value != null) data.set(key, String(value));
  }
  return data;
}

test('valid input normalizes codes and preserves optional unlimited caps', () => {
  const p = validateOfferInput(form({ code: '  test15  ', max_uses: ' ', per_customer: '' }));
  assert.equal(p.ok, true);
  assert.equal(p.values.code, 'TEST15');
  assert.equal(p.values.max_uses, null);
  assert.equal(p.values.per_customer, null);
  assert.equal(p.values.starts_at, null);
});

test('percent discounts reject invalid, zero and excessive values before database access', async () => {
  let queries = 0;
  for (const value of ['101', '-1', '0', 'NaN', 'Infinity', '', '1.001', '0.0000000001']) {
    const result = await createValidatedOffer(() => { queries++; }, form({ discount_value: value }));
    assert.equal(result.ok, false, value);
    assert.ok(result.errors.discount_value, value);
  }
  assert.equal(queries, 0);
  assert.equal(validateOfferInput(form({ discount_value: '100' })).ok, true);
});

test('fixed discounts and minimum spend respect finite NUMERIC(10,2) values', () => {
  assert.equal(validateOfferInput(form({ discount_type: 'fixed', discount_value: '250.25' })).ok, true);
  for (const value of ['Infinity', '100000000', '-1', '0.001']) {
    assert.ok(validateOfferInput(form({ discount_type: 'fixed', discount_value: value })).errors.discount_value, value);
  }
  for (const value of ['NaN', '-0.01', '100000000', '0.001']) assert.ok(validateOfferInput(form({ min_total: value })).errors.min_total, value);
  assert.equal(validateOfferInput(form({ min_total: '' })).values.min_total, 0);
});

test('announcement-only offers may omit a code; discounts and unknown types are refused', () => {
  const announcement = validateOfferInput(form({ discount_type: 'none', code: '', discount_value: '' }));
  assert.equal(announcement.ok, true);
  assert.equal(announcement.values.discount_value, 0);
  assert.ok(validateOfferInput(form({ code: ' ' })).errors.code);
  assert.ok(validateOfferInput(form({ code: 'x'.repeat(65) })).errors.code);
  assert.ok(validateOfferInput(form({ discount_type: 'unexpected' })).errors.discount_type);
  assert.ok(validateOfferInput(form({ title_ar: ' ' })).errors.title_ar);
  assert.ok(validateOfferInput(form({ body_ar: '' })).errors.body_ar);
});

test('present caps must be positive whole INT values instead of becoming unlimited', () => {
  for (const name of ['max_uses', 'per_customer']) {
    for (const value of ['0', '-1', '1.5', 'none', 'Infinity', '1e2', '2147483648']) assert.ok(validateOfferInput(form({ [name]: value })).errors[name], `${name}=${value}`);
    assert.equal(validateOfferInput(form({ [name]: '1' })).values[name], 1);
    assert.equal(validateOfferInput(form({ [name]: '2147483647' })).values[name], 2147483647);
  }
});

test('invalid and reversed date bounds are refused while blank boundaries stay optional', () => {
  for (const value of ['2026-02-30T12:00', '2026-11-01T24:00', '2026-11-01T12:00Z', 'not a date']) assert.ok(validateOfferInput(form({ starts_at: value })).errors.starts_at, value);
  for (const ends of ['2026-11-01T11:59', '2026-11-01T12:00', '2026-11-01T12:00:00']) assert.ok(validateOfferInput(form({ starts_at: '2026-11-01T12:00', ends_at: ends })).errors.ends_at, ends);
  assert.equal(validateOfferInput(form({ starts_at: '2026-11-01T12:00', ends_at: '2026-11-01T12:01' })).ok, true);
  assert.equal(validateOfferInput(form({ ends_at: '2026-11-01T12:00' })).ok, true);
});

test('an existing code returns a field error without inserting', async () => {
  let queries = 0;
  const result = await createValidatedOffer(async () => { queries++; return [{ id: 1 }]; }, form());
  assert.equal(queries, 1);
  assert.match(result.errors.code, /already exists/);
  assert.equal(result.fields.title_ar, 'عرض تجريبي');
});

test('a concurrent code conflict is a field error; unrelated database faults propagate', async () => {
  let calls = 0;
  const conflict = Object.assign(new Error('synthetic duplicate'), { code: '23505', constraint: 'idx_offers_code' });
  const result = await createValidatedOffer(async () => { if (++calls === 1) return []; throw conflict; }, form());
  assert.match(result.errors.code, /already exists/);
  for (const error of [Object.assign(new Error('synthetic primary-key fault'), { code: '23505', constraint: 'offers_pkey' }), new Error('synthetic unavailable')]) {
    calls = 0;
    await assert.rejects(createValidatedOffer(async () => { if (++calls === 1) return []; throw error; }, form()), e => e === error);
  }
});

test('database-normalized invalid windows return a field error with the input retained', async () => {
  const result = await createValidatedOffer(async () => [], form({ starts_at: '2026-04-24T00:30', ends_at: '2026-04-24T01:00' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.ends_at);
  assert.equal(result.fields.starts_at, '2026-04-24T00:30');
});

test('valid offer data stays parameterized and returns the created identity', async () => {
  const attack = "synthetic'); DROP TABLE offers; --";
  const statements = [];
  const result = await createValidatedOffer(async (strings, ...values) => {
    const text = strings.join('?');
    statements.push({ text, values });
    return text.includes('INSERT INTO') ? [{ id: 42 }] : [];
  }, form({ title_en: attack }));
  assert.equal(result.ok, true);
  assert.equal(result.id, 42);
  const insert = statements.find(x => x.text.includes('INSERT INTO'));
  assert.equal(insert.text.includes(attack), false);
  assert.ok(insert.values.includes(attack));
  assert.match(insert.text, /ends_at > starts_at/);
});

test('status follows enabled state, date bounds and total uses', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const base = { active: true, starts_at: null, ends_at: null, max_uses: null, used_count: 0 };
  assert.equal(effectiveOfferStatus(base, now).key, 'active');
  assert.equal(effectiveOfferStatus({ ...base, active: false }, now).key, 'disabled');
  assert.equal(effectiveOfferStatus({ ...base, starts_at: new Date(now + 1) }, now).key, 'scheduled');
  assert.equal(effectiveOfferStatus({ ...base, ends_at: new Date(now - 1) }, now).key, 'expired');
  assert.equal(effectiveOfferStatus({ ...base, max_uses: '2', used_count: '2' }, now).key, 'exhausted');
  assert.equal(effectiveOfferStatus({ ...base, max_uses: 2, used_count: 5 }, now).remainingUses, 0);
  assert.equal(effectiveOfferStatus({ ...base, max_uses: 5, used_count: 2 }, now).remainingUses, 3);
});

test('status retains checkout inclusive endpoint semantics', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const offer = { active: true, starts_at: new Date(now), ends_at: new Date(now), max_uses: null };
  assert.equal(effectiveOfferStatus(offer, now).key, 'active');
});

test('validity dates show year, time and the correct seasonal Cairo offset', () => {
  const winter = offerDateTime('2026-11-01 12:00:00+00');
  const summer = offerDateTime('2026-05-01T12:00:00Z');
  assert.match(winter, /2026/);
  assert.match(winter, /14:00/);
  assert.match(winter, /GMT\+2/);
  assert.match(summer, /15:00/);
  assert.match(summer, /GMT\+3/);
  assert.equal(offerDateTime(null), 'No limit');
});
