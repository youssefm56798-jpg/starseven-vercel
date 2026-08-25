/**
 * Normalisation of the long-form product copy typed into the admin panel.
 *
 * Everything here is what the admin form hands to the UPDATE, so these rules
 * decide the exact bytes that land in `long_*`, `howto_*` and `highlights_*`.
 * The list fields are one item per line and the page draws the numbers and the
 * ticks, so a stray blank line is a stray empty <li> on a live product page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseLines, normaliseLongText, LIST_MAX, LONG_MAX } from '../lib/product-copy.js';

/* ------------------------------------------------------------- the caps */

test('the caps are the ones the admin form advertises', () => {
  assert.equal(LONG_MAX, 4000);
  assert.equal(LIST_MAX, 1200);
});

/* ------------------------------------------------- long-form body copy */

test('long text trims the ends and every line', () => {
  assert.equal(normaliseLongText('  hello  '), 'hello');
  assert.equal(normaliseLongText('  one  \n  two  '), 'one\ntwo');
  assert.equal(normaliseLongText('\n\n  body  \n\n'), 'body');
});

test('long text collapses Windows and old-Mac line endings to LF', () => {
  assert.equal(normaliseLongText('one\r\ntwo'), 'one\ntwo');
  assert.equal(normaliseLongText('one\rtwo'), 'one\ntwo');
  assert.equal(normaliseLongText('one\r\n\r\ntwo'), 'one\n\ntwo');
});

test('long text keeps the single blank line markdown reads as a paragraph break', () => {
  assert.equal(normaliseLongText('para one\n\npara two'), 'para one\n\npara two');
  // A pasted document arrives with big gaps; they all mean the same thing.
  assert.equal(normaliseLongText('para one\n\n\n\n\npara two'), 'para one\n\npara two');
  assert.equal(normaliseLongText('one\r\n\r\n\r\ntwo'), 'one\n\ntwo');
});

test('long text survives Arabic unchanged', () => {
  const ar = 'واكس قوي للشعر.\n\nيثبت طول اليوم.';
  assert.equal(normaliseLongText(ar), ar);
});

test('long text is capped at 4000 characters', () => {
  const out = normaliseLongText('x'.repeat(6000));
  assert.equal(out.length, LONG_MAX);
});

test('long text under the cap is returned whole', () => {
  const body = 'y'.repeat(LONG_MAX);
  assert.equal(normaliseLongText(body), body);
  assert.equal(normaliseLongText(body).length, LONG_MAX);
});

test('a cap that lands on whitespace does not leave a trailing space', () => {
  // 3999 characters, then a space, then more — the slice ends on the space.
  const out = normaliseLongText(`${'z'.repeat(3999)} tail`);
  assert.equal(out, 'z'.repeat(3999));
});

test('long text handles the empty and missing cases', () => {
  assert.equal(normaliseLongText(''), '');
  assert.equal(normaliseLongText(null), '');
  assert.equal(normaliseLongText(undefined), '');
  assert.equal(normaliseLongText('   \n  \n '), '');
});

test('long text accepts a caller-supplied cap', () => {
  assert.equal(normaliseLongText('abcdefghij', 4), 'abcd');
});

/* ------------------------------------------------- one item per line ---- */

test('lines are trimmed and blank ones dropped', () => {
  assert.equal(normaliseLines('  step one  \n\n  step two  \n'), 'step one\nstep two');
  assert.equal(normaliseLines('\n\n\nonly one\n\n\n'), 'only one');
});

test('lines collapse Windows line endings before splitting', () => {
  assert.equal(normaliseLines('one\r\ntwo\r\nthree'), 'one\ntwo\nthree');
  // The lone \r that a copy-paste from an old export leaves behind.
  assert.equal(normaliseLines('one\rtwo'), 'one\ntwo');
  // A CRLF file's stray \r must not survive as a character inside a line.
  assert.ok(!normaliseLines('one\r\ntwo').includes('\r'));
});

test('lines never keep an empty item — the page would draw an empty bullet', () => {
  const out = normaliseLines('a\n\n\n\nb\n   \nc');
  assert.equal(out, 'a\nb\nc');
  assert.deepEqual(out.split('\n').filter(l => l === ''), []);
});

test('lines survive Arabic and keep the typed order', () => {
  assert.equal(
    normaliseLines('  خذ كمية صغيرة \r\n\r\n وزعها على الشعر '),
    'خذ كمية صغيرة\nوزعها على الشعر',
  );
});

test('lines are capped at 1200 characters', () => {
  const out = normaliseLines(Array.from({ length: 200 }, (_, i) => `step ${i}`).join('\n'));
  assert.ok(out.length <= LIST_MAX, `got ${out.length}`);
});

test('the cap cuts at a whole line, never mid-step', () => {
  // Ten-character lines: "aaaaaaaaaa" plus the joining newline is 11 each, so
  // a cap of 32 fits three lines (10 + 11 + 11 = 32) and not the fourth.
  const input = Array.from({ length: 8 }, () => 'aaaaaaaaaa').join('\n');
  const out = normaliseLines(input, 32);
  assert.equal(out.split('\n').length, 3);
  assert.equal(out.length, 32);
  assert.ok(out.split('\n').every(l => l === 'aaaaaaaaaa'), 'a step was cut in half');
});

test('a first line longer than the cap is sliced rather than dropped', () => {
  // Losing the field entirely would look like the save failed.
  const out = normaliseLines(`${'b'.repeat(50)}\nsecond`, 20);
  assert.equal(out, 'b'.repeat(20));
});

test('a list exactly on the cap is kept whole', () => {
  const input = `${'c'.repeat(9)}\n${'d'.repeat(10)}`; // 9 + 1 + 10 = 20
  assert.equal(normaliseLines(input, 20), input);
});

test('lines handle the empty and missing cases', () => {
  assert.equal(normaliseLines(''), '');
  assert.equal(normaliseLines(null), '');
  assert.equal(normaliseLines(undefined), '');
  assert.equal(normaliseLines('\r\n  \r\n'), '');
});

test('both helpers always return a string, never null', () => {
  // The columns are NOT NULL DEFAULT '' — a null here would fail the insert.
  for (const input of [null, undefined, '', 0, false, '   ']) {
    assert.equal(typeof normaliseLongText(input), 'string');
    assert.equal(typeof normaliseLines(input), 'string');
  }
});

test('normalising twice changes nothing the second time', () => {
  const long = 'Para one.\r\n\r\n\r\nPara two.  \r\n';
  const list = '  first \r\n\r\n second  ';
  assert.equal(normaliseLongText(normaliseLongText(long)), normaliseLongText(long));
  assert.equal(normaliseLines(normaliseLines(list)), normaliseLines(list));
});
