/**
 * The delivery window: the SLA table, the free-text city, the working week and
 * the sentence both languages read.
 *
 * These run with no database, like everything else under tests/. That is not a
 * compromise here — lib/delivery-eta.js is deliberately all pure functions
 * precisely so the part of this feature that is easy to get quietly wrong can
 * be exercised without a server. What cannot be tested here is the write
 * itself, which lives in lib/order-status.js and is covered by
 * scripts/verify-order-status.mjs against a real Postgres.
 *
 * The clock is passed in everywhere it matters. A test that reads the real
 * calendar passes for eleven months and fails in the twelfth, and a window
 * that straddles a weekend or a month boundary is exactly the case worth
 * pinning — so every date below is a fixed one, chosen for the day of the week
 * it falls on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SLA,
  normalise,
  zoneFor,
  todayInCairo,
  addWorkingDays,
  deliveryWindow,
  formatWindow,
  formatDay,
  formatStamp,
  isYmd,
  SERVED,
  SERVED_LABELS,
  governorateFor,
  isServed,
} from '../lib/delivery-eta.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const schema = readFileSync(join(ROOT, 'db/schema.sql'), 'utf8');
const access = readFileSync(join(ROOT, 'lib/order-access.js'), 'utf8');

/* ---------------------------------------------------------------- the SLA */

test('every zone is a sane pair of whole working days', () => {
  for (const [zone, span] of Object.entries(SLA)) {
    assert.equal(span.length, 2, `${zone} is not a pair`);
    const [lo, hi] = span;
    assert.ok(Number.isInteger(lo) && lo >= 1, `${zone} starts at ${lo}`);
    assert.ok(Number.isInteger(hi) && hi >= lo, `${zone} ends before it starts`);
    assert.ok(hi <= 10, `${zone} promises ${hi} days, which is not a window any more`);
  }
});

test('the zones are ordered by distance', () => {
  // Not decoration: the whole point of the table is that Cairo is quoted
  // faster than the valley and the valley faster than the frontier. An edit
  // that puts them out of order is an edit that has misread the tiers.
  const order = ['metro', 'delta', 'upper', 'frontier'];
  for (let i = 1; i < order.length; i++) {
    const prev = SLA[order[i - 1]];
    const here = SLA[order[i]];
    assert.ok(here[0] >= prev[0], `${order[i]} starts sooner than ${order[i - 1]}`);
    assert.ok(here[1] >= prev[1], `${order[i]} ends sooner than ${order[i - 1]}`);
  }
});

test('the unknown window is wide enough to be true for most of the country', () => {
  // It is what a city nobody recognised gets, so it has to be a promise the
  // shop can keep for a Delta order and for an Upper Egypt one alike. A guess
  // narrower than that is a guess that will be wrong in one direction only.
  assert.ok(SLA.unknown[0] >= SLA.delta[0], 'the fallback opens before the Delta tier does');
  assert.ok(SLA.unknown[1] >= SLA.upper[1], 'the fallback closes before an Upper Egypt order lands');
  assert.ok(SLA.unknown[1] - SLA.unknown[0] >= 2, 'the fallback is too tight to be honest');
});

/* --------------------------------------------------------- reading a city */

test('Arabic spellings of the same place fold together', () => {
  // Every one of these is a real way a customer types Alexandria: with and
  // without the hamza, with the taa marbuta written as a haa, with a leading
  // definite article, with a diacritic a phone keyboard added.
  const forms = ['الإسكندرية', 'الاسكندرية', 'الاسكندريه', 'إسكندرية', 'اسكندريه', 'الأسكندرية'];
  const folded = new Set(forms.map(normalise));
  assert.equal(folded.size, 1, `expected one spelling, got ${[...folded].join(' | ')}`);
});

test('Arabic-Indic digits become digits', () => {
  assert.equal(normalise('٦ أكتوبر'), '6 اكتوبر');
});

test('the definite article comes off long tokens and stays on short ones', () => {
  assert.equal(normalise('القاهرة'), 'قاهره');
  // Four letters or fewer is left alone: taking "ال" off a short word is as
  // likely to be cutting into the word as removing an article.
  assert.equal(normalise('الحي'), 'الحي');
});

test('an empty or punctuation-only city normalises to nothing', () => {
  for (const junk of ['', '   ', '---', '???', null, undefined]) {
    assert.equal(normalise(junk), '');
  }
});

test('both languages of every governorate reach the same zone', () => {
  const pairs = [
    ['القاهرة', 'Cairo', 'metro'],
    ['الجيزة', 'Giza', 'metro'],
    ['الإسكندرية', 'Alexandria', 'delta'],
    ['الدقهلية', 'Dakahlia', 'delta'],
    ['كفر الشيخ', 'Kafr El Sheikh', 'delta'],
    ['أسوان', 'Aswan', 'upper'],
    ['بني سويف', 'Beni Suef', 'upper'],
    ['الأقصر', 'Luxor', 'upper'],
    ['شمال سيناء', 'North Sinai', 'frontier'],
    ['الوادي الجديد', 'New Valley', 'frontier'],
  ];
  for (const [ar, en, zone] of pairs) {
    assert.equal(zoneFor(ar), zone, `${ar} is not ${zone}`);
    assert.equal(zoneFor(en), zone, `${en} is not ${zone}`);
  }
});

test('the extra words people put around a governorate do not matter', () => {
  for (const typed of ['محافظة القاهرة', 'القاهرة - المعادي', 'مصر / القاهرة', 'cairo, egypt', 'Giza governorate']) {
    assert.equal(zoneFor(typed), 'metro', `${typed} was not read as Cairo or Giza`);
  }
});

test('a neighbourhood is read as its governorate', () => {
  // These are what actually arrives in the box. Falling through to the unknown
  // window would quote two to five days for a next-day delivery.
  for (const typed of ['المعادي', 'مدينة نصر', 'Nasr City', '٦ أكتوبر', 'الشيخ زايد', 'New Cairo', 'الهرم']) {
    assert.equal(zoneFor(typed), 'metro', `${typed} was not read as Cairo or Giza`);
  }
  assert.equal(zoneFor('طنطا'), 'delta');
  assert.equal(zoneFor('Hurghada'), 'frontier');
});

test('an alias only matches a whole token', () => {
  // "قنا" is a governorate and "القناطر" is a town in Qalyubia that contains
  // its letters. A substring search reads the second as the first and quotes a
  // Delta order the Upper Egypt window.
  assert.equal(zoneFor('قنا'), 'upper');
  assert.notEqual(zoneFor('القناطر الخيرية'), 'upper');
});

test('the longest alias wins, so a shared word does not decide the zone', () => {
  // Both contain "الشيخ". Sharm El Sheikh is South Sinai and a week away;
  // Sheikh Zayed is Giza and next day. Whichever of the two a shorter alias
  // would have matched first, one of them would be badly wrong.
  assert.equal(zoneFor('شرم الشيخ'), 'frontier');
  assert.equal(zoneFor('الشيخ زايد'), 'metro');
  assert.equal(zoneFor('كفر الشيخ'), 'delta');
});

test('a city nobody recognises falls back rather than failing', () => {
  for (const typed of ['', '   ', 'عزبة النخل الجديدة القديمة', 'somewhere else', '12345', null]) {
    assert.equal(zoneFor(typed), 'unknown', `${typed} should have fallen back`);
  }
});

/* ------------------------------------------------------ the working week */

test('Friday is skipped and Saturday is not', () => {
  // 2026-08-27 is a Thursday. One working day later is Saturday, because the
  // couriers run Saturday to Thursday and Friday is the day off.
  assert.equal(addWorkingDays('2026-08-27', 1), '2026-08-29');
  assert.equal(addWorkingDays('2026-08-27', 2), '2026-08-30');
});

test('counting starts from the day after the anchor', () => {
  // Zero is the anchor itself; one is tomorrow. An order confirmed this
  // afternoon is not also delivered this afternoon.
  assert.equal(addWorkingDays('2026-09-01', 0), '2026-09-01');
  assert.equal(addWorkingDays('2026-09-01', 1), '2026-09-02');
});

test('a window never lands on a Friday, from any starting day', () => {
  // Walked over a full week of anchors and the whole range of the table, which
  // is the only way to catch an off-by-one that only bites when the count
  // steps onto the day it is meant to skip.
  for (let d = 1; d <= 14; d++) {
    const anchor = `2026-09-${String(d).padStart(2, '0')}`;
    for (let n = 1; n <= 7; n++) {
      const landed = addWorkingDays(anchor, n);
      const dow = new Date(`${landed}T00:00:00Z`).getUTCDay();
      assert.notEqual(dow, 5, `${anchor} + ${n} landed on Friday ${landed}`);
    }
  }
});

test('more days is never an earlier date', () => {
  let last = '2026-09-01';
  for (let n = 1; n <= 12; n++) {
    const next = addWorkingDays('2026-09-01', n);
    assert.ok(next > last, `${n} working days went backwards`);
    last = next;
  }
});

test('the anchor is the Cairo date, not the UTC one', () => {
  // Late evening UTC is already tomorrow in Cairo, which is +02:00 in winter
  // and +03:00 in summer. Reading the date off a UTC getter would stamp every
  // order confirmed after ten at night with yesterday.
  assert.equal(todayInCairo(new Date('2026-08-29T22:30:00Z')), '2026-08-30');
  assert.equal(todayInCairo(new Date('2026-08-29T20:30:00Z')), '2026-08-29');
  // And in January, where the offset is an hour smaller.
  assert.equal(todayInCairo(new Date('2026-01-15T22:30:00Z')), '2026-01-16');
  assert.equal(todayInCairo(new Date('2026-01-15T21:30:00Z')), '2026-01-15');
});

/* ------------------------------------------------------------ the window */

test('a window is ordered, and matches the tier its city belongs to', () => {
  const at = new Date('2026-09-01T09:00:00Z'); // a Tuesday
  for (const [city, zone] of [['القاهرة', 'metro'], ['طنطا', 'delta'], ['أسوان', 'upper'], ['دهب', 'frontier'], ['nowhere', 'unknown']]) {
    const w = deliveryWindow(city, at);
    assert.equal(w.zone, zone, `${city} took the ${w.zone} tier`);
    assert.ok(isYmd(w.from) && isYmd(w.to), `${city} produced ${w.from} / ${w.to}`);
    assert.ok(w.from <= w.to, `${city} ends before it starts`);
    assert.equal(w.from, addWorkingDays(todayInCairo(at), SLA[zone][0]));
    assert.equal(w.to, addWorkingDays(todayInCairo(at), SLA[zone][1]));
  }
});

test('Cairo is quoted sooner than Upper Egypt and the far coast', () => {
  const at = new Date('2026-09-01T09:00:00Z');
  const cairo = deliveryWindow('القاهرة', at);
  const valley = deliveryWindow('سوهاج', at);
  const coast = deliveryWindow('مرسى مطروح', at);
  assert.ok(cairo.to < valley.to, 'Cairo is not quoted before the valley');
  assert.ok(valley.to < coast.to, 'the valley is not quoted before the coast');
});

/* ------------------------------------------------------------- the words */

test('a window inside one month writes the month once', () => {
  assert.equal(formatWindow('2026-09-02', '2026-09-04', 'en'), 'Wed 2 – Fri 4 Sept');
});

test('a window across a month boundary writes it twice', () => {
  // Dropping the first month here would leave "Mon 31 – Wed 2 Sept", which
  // reads as a range inside September and is a date the customer never gets.
  assert.equal(formatWindow('2026-08-31', '2026-09-02', 'en'), 'Mon 31 Aug – Wed 2 Sept');
});

test('a one-day window is one date, not a range of a date with itself', () => {
  assert.equal(formatWindow('2026-09-02', '2026-09-02', 'en'), 'Wed 2 Sept');
});

test('the Arabic window is Arabic, in Arabic-Indic numerals', () => {
  const out = formatWindow('2026-09-02', '2026-09-04', 'ar');
  assert.match(out, /[؀-ۿ]/, 'no Arabic in the Arabic window');
  assert.match(out, /[٠-٩]/, 'the day numbers are not Arabic-Indic');
  assert.ok(out.includes('سبتمبر'), `the month is missing: ${out}`);
  // The separator has to survive into both languages or the range reads as one
  // date with some noise after it.
  assert.ok(out.includes('–'), `no range dash: ${out}`);
  // Latin letters here would mean the locale fell back to English, which is
  // what happens on a runtime built without full ICU and is worth catching.
  assert.doesNotMatch(out, /[A-Za-z]/, `Latin text leaked into the Arabic window: ${out}`);
});

test('the two languages disagree about the words and agree about the shape', () => {
  const en = formatWindow('2026-09-02', '2026-09-04', 'en');
  const ar = formatWindow('2026-09-02', '2026-09-04', 'ar');
  assert.notEqual(en, ar);
  assert.equal(en.split('–').length, 2);
  assert.equal(ar.split('–').length, 2);
});

test('anything that is not a pair of dates renders as nothing at all', () => {
  // The caller draws no window in that case, which is the right answer for an
  // order nobody has confirmed and for a row written before the columns
  // existed. Throwing here would take the whole order page down with it.
  for (const bad of [null, undefined, '', 'soon', '2026-9-2', '2026-09-02T00:00:00Z', 0]) {
    assert.equal(formatWindow(bad, '2026-09-04', 'en'), '', `accepted ${String(bad)} as a date`);
    assert.equal(formatWindow('2026-09-02', bad, 'ar'), '', `accepted ${String(bad)} as a date`);
  }
  assert.equal(formatDay('nope', 'en'), '');
});

test('a stored timestamp renders as the day it was in Cairo', () => {
  // Half past midnight Cairo time on the 3rd is still the 2nd in UTC. The
  // customer is told the day it happened where they are.
  assert.equal(formatStamp('2026-09-02T22:30:00Z', 'en'), 'Thu 3 Sept');
  assert.equal(formatStamp(new Date('2026-09-02T20:30:00Z'), 'en'), 'Wed 2 Sept');
});

test('an absent or unparseable timestamp renders as nothing', () => {
  for (const bad of [null, undefined, '', 'never', new Date('nonsense')]) {
    assert.equal(formatStamp(bad, 'en'), '', `accepted ${String(bad)}`);
  }
});

/* ------------------------------------------------------------- the schema */

test('schema.sql adds the four columns idempotently', () => {
  // db:setup re-runs this file on every deploy, so a bare ADD COLUMN is a
  // deploy that fails the second time it runs.
  for (const col of ['expected_from', 'expected_to', 'courier', 'tracking_ref']) {
    assert.match(
      schema,
      new RegExp(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ${col}\\s`),
      `${col} is not added, or is not added idempotently`,
    );
  }
});

test('the window columns are DATE, not TIMESTAMPTZ', () => {
  // A timestamp would carry an hour nobody promised, and would render as the
  // previous evening for any reader west of Cairo.
  assert.match(schema, /ADD COLUMN IF NOT EXISTS expected_from DATE/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS expected_to\s+DATE/);
});

test('nothing in schema.sql drops the new columns', () => {
  // The file carries a deliberate block of DROPs for the removed account
  // tables. A column joining that block by accident is a deploy that throws
  // away every delivery promise the shop has made.
  for (const col of ['expected_from', 'expected_to', 'courier', 'tracking_ref']) {
    assert.doesNotMatch(schema, new RegExp(`orders DROP COLUMN[^;]*${col}`, 'i'), `${col} is dropped`);
  }
});

test('the block that adds them carries no apostrophe in its comments', () => {
  /*
   * scripts/sql-split.mjs keeps a comment attached to the statement that
   * follows it, and tests/sql-split counts single quotes per statement to
   * prove the split did not cut a literal open. An odd number fails there,
   * a long way from the line that caused it, so a lone apostrophe in prose
   * ("doesn't") is a real hazard in this file and the fix is to write it out.
   *
   * Scoped to the block these columns arrived in rather than to the whole
   * file: schema.sql already carries older comments that quote a value, in
   * balanced pairs, and those are fine. It is the odd one that hurts.
   */
  const start = schema.indexOf('--  When it is coming');
  assert.notEqual(start, -1, 'the delivery-window block has lost its header');
  const block = schema.slice(start, schema.indexOf('ALTER TABLE orders', start));
  const quotes = (block.match(/'/g) ?? []).length;
  assert.equal(quotes, 0, `the delivery-window comments carry ${quotes} apostrophe(s)`);
});

/* ------------------------------------------- what the customer may not see */

/**
 * The body of timelineFor, as text.
 *
 * Read rather than called, because calling it needs a database and the thing
 * worth pinning is not what it returns for one order — it is which columns it
 * is capable of returning at all. Same reasoning as the git-grep tests in
 * tests/order-status.test.mjs: some invariants are about the shape of the
 * source, and asserting them on the source is honest rather than lazy.
 */
function timelineQuery() {
  const at = access.indexOf('export async function timelineFor');
  assert.notEqual(at, -1, 'timelineFor is gone from lib/order-access.js');
  const fn = access.slice(at);
  return fn.slice(0, fn.indexOf('\n}'));
}

test('the customer timeline query never selects the actor', () => {
  // The projection is the security boundary, not the component. actor holds
  // 'admin:4' and friends, and a query that does not select it cannot leak it
  // however the markup is edited later.
  const query = timelineQuery();
  assert.ok(query.includes('FROM order_events'), 'timelineFor no longer reads order_events');
  assert.ok(!/\bactor\b/.test(query), 'timelineFor selects the actor column');
  assert.ok(!/\bfrom_status\b/.test(query), 'timelineFor selects from_status');
});

test('the customer timeline returns only status changes and the refund request', () => {
  const query = timelineQuery();
  // Internal notes and the mail log are the two kinds that must never reach a
  // customer, and an allow-list is the only filter that stays correct when a
  // fifth kind is added later.
  assert.match(query, /kind IN \('status', 'refund-request'\)/);
  assert.match(query, /CASE WHEN kind = 'refund-request' THEN note ELSE '' END/,
    'the note on a status or mail row is not blanked out');
});

/* ------------------------------------------------- where we deliver ---- */

test('the served list is the three governorates and nothing else', () => {
  assert.deepEqual(SERVED, ['cairo', 'giza', 'qalyubia']);
  for (const g of SERVED) {
    assert.ok(SERVED_LABELS[g]?.ar, `${g} has no Arabic label for the picker`);
    assert.ok(SERVED_LABELS[g]?.en, `${g} has no English label for the picker`);
  }
});

test('a served governorate is recognised however it is written', () => {
  for (const [input, want] of [
    ['القاهرة', 'cairo'], ['Cairo', 'cairo'], ['محافظة القاهرة', 'cairo'],
    ['الجيزة', 'giza'], ['الجيزه', 'giza'], ['Giza', 'giza'],
    ['القليوبية', 'qalyubia'], ['Qalyubia', 'qalyubia'],
  ]) {
    assert.equal(governorateFor(input), want, `${input} should be ${want}`);
  }
});

test('a neighbourhood counts as its governorate', () => {
  /*
   * The tail that decides whether this feature loses orders. Nobody writes
   * "محافظة الجيزة" in a delivery box - they write "الشيخ زايد". Refusing that
   * is worse than mis-quoting a delivery window, because the order never
   * happens at all.
   */
  for (const [input, want] of [
    ['المعادي', 'cairo'], ['مدينة نصر', 'cairo'], ['التجمع الخامس', 'cairo'],
    ['الشيخ زايد', 'giza'], ['6 أكتوبر', 'giza'], ['الهرم', 'giza'],
    ['المهندسين', 'giza'], ['بنها', 'qalyubia'], ['العبور', 'qalyubia'],
  ]) {
    assert.equal(governorateFor(input), want, `${input} should be ${want}`);
  }
});

test('Shubra is Cairo and Shubra El Kheima is Qalyubia', () => {
  // Longest alias first, or the شبرا in شبرا الخيمة decides it.
  assert.equal(governorateFor('شبرا'), 'cairo');
  assert.equal(governorateFor('شبرا الخيمة'), 'qalyubia');
});

test('everywhere else is refused', () => {
  /*
   * Including بلبيس, which is where the shop physically is - it is in Sharqia,
   * and the courier contract is what decides this list, not the address on the
   * jar.
   */
  for (const input of [
    'الإسكندرية', 'Alexandria', 'أسوان', 'طنطا', 'المنصورة', 'شرم الشيخ',
    'البحر الأحمر', 'الشرقية', 'بلبيس', 'الزقازيق', '', '   ', 'asdf', null, undefined,
  ]) {
    assert.equal(governorateFor(input), null, `${input} must not be served`);
    assert.equal(isServed(input), false);
  }
});

test('the order route refuses an unserved governorate server-side', () => {
  /*
   * The picker on checkout is markup. This route is a POST endpoint anything
   * can call with any body, so the refusal has to live here or it does not
   * exist - the same reason every other field is re-validated after the form
   * has already checked it.
   */
  const route = readFileSync(join(ROOT, 'app/api/order/route.js'), 'utf8');
  assert.match(route, /isServed/, 'the order route no longer checks the delivery area');

  const checked = route.indexOf('isServed(city)');
  const written = route.search(/INSERT INTO orders/);
  assert.ok(checked > 0, 'isServed(city) is not called');
  assert.ok(written > checked, 'the order is written before the delivery area is checked');
});
