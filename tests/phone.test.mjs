/**
 * Egyptian mobile normalisation — ported 1:1 from tests/run.php.
 *
 * A phone number is the only way the courier reaches the customer, so a number
 * that normalises wrongly is a lost order, not a cosmetic bug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../lib/phone.js';

const accepts = [
  ['plain 010', '01028282216', '01028282216'],
  ['spaced', '010 2828 2216', '01028282216'],
  ['dashes', '010-2828-2216', '01028282216'],
  ['+20 prefix', '+201028282216', '01028282216'],
  ['0020 prefix', '00201028282216', '01028282216'],
  ['20 prefix, no zero', '201028282216', '01028282216'],
  ['bare 10 digits', '1028282216', '01028282216'],
  ['vodafone 010', '01012345678', '01012345678'],
  ['etisalat 011', '01112345678', '01112345678'],
  ['orange 012', '01212345678', '01212345678'],
  ['we 015', '01512345678', '01512345678'],
];

for (const [name, input, want] of accepts) {
  test(`phone accepts ${name}`, () => {
    assert.equal(normalizePhone(input), want);
  });
}

const rejects = [
  ['013 (not an Egyptian mobile prefix)', '01312345678'],
  ['landline', '0223456789'],
  ['too short', '0102828221'],
  ['too long', '010282822160'],
  ['letters', 'abcdefghijk'],
  ['empty', ''],
];

for (const [name, input] of rejects) {
  test(`phone rejects ${name}`, () => {
    assert.equal(normalizePhone(input), null);
  });
}

// Not in the PHP suite: JS gets undefined/null where PHP got '' from $_POST.
test('phone rejects null and undefined without throwing', () => {
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), null);
});
