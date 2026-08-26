/**
 * Credential rules and cart sanitising.
 *
 * These are the parts of the auth system that can be tested without a
 * database, and they are also the parts where a quiet mistake is worst: a
 * password policy that accepts anything, an email check that rejects real
 * addresses, or a cart sanitiser that lets a negative quantity through and
 * turns a basket into a refund.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseEmail, emailOk, emailProblem,
  passwordProblem, passwordOk, PASSWORD_MIN,
  cleanName, cleanCartLines, CART_MAX_QTY, CART_MAX_LINES,
  originAllowed,
} from '../lib/credentials.js';

/* ---------------------------------------------------------------- email --- */

test('email is lowercased and trimmed, so one address is one account', () => {
  assert.equal(normaliseEmail('  Youssef@Example.COM '), 'youssef@example.com');
  assert.equal(normaliseEmail(null), '');
  assert.equal(normaliseEmail(undefined), '');
});

test('real addresses are accepted', () => {
  for (const e of [
    'a@b.co', 'youssef.m@gmail.com', 'user+tag@sub.domain.eg',
    'first.last@company-name.com', 'x_y@a.b.c.de',
  ]) assert.ok(emailOk(e), `${e} should be accepted`);
});

test('malformed addresses are refused, with a reason', () => {
  const cases = {
    '': 'required',
    'nope': 'shape',
    '@nodomain.com': 'shape',
    'two@@at.com': 'shape',
    'a@b': 'domain',
    'a@.com': 'domain',
    'a@com.': 'domain',
    'a@b..com': 'domain',
    'has space@x.com': 'whitespace',
  };
  for (const [input, reason] of Object.entries(cases)) {
    assert.equal(emailProblem(input), reason, `${JSON.stringify(input)}`);
  }
  assert.equal(emailProblem('a'.repeat(250) + '@example.com'), 'too-long');
});

/* ------------------------------------------------------------- password --- */

test('the minimum is ten, not the usual eight', () => {
  assert.equal(PASSWORD_MIN, 10);
  assert.equal(passwordProblem('nine chr'), 'too-short');
  assert.equal(passwordProblem('a'.repeat(9)), 'too-short');
  assert.equal(passwordProblem(''), 'required');
  assert.equal(passwordProblem('x'.repeat(201)), 'too-long');
});

test('a long password is not sent to bcrypt unbounded', () => {
  // bcrypt truncates at 72 bytes anyway; the cap is about not handing a
  // megabyte of text to a deliberately slow function.
  assert.equal(passwordProblem('x'.repeat(100_000)), 'too-long');
});

test('the obvious passwords are refused', () => {
  for (const pw of ['password123', 'qwertyuiop', 'welcome123', '1234567890']) {
    assert.equal(passwordProblem(pw), 'common', pw);
  }
  assert.equal(passwordProblem('aaaaaaaaaaaa'), 'common', 'one repeated character');
});

test('a password may not contain the address it belongs to', () => {
  assert.equal(passwordProblem('youssef-hair-wax', 'youssef@gmail.com'), 'contains-email');
  assert.equal(passwordProblem('YOUSSEF12345', 'youssef@gmail.com'), 'contains-email');
  // A short local part would make this rule reject far too much.
  assert.equal(passwordProblem('abcorrecthorse', 'abc@gmail.com'), null);
});

test('a decent password passes', () => {
  for (const pw of ['correct-horse-battery', 'M3ga H0ld Wax!!', 'وقتك خلص يا صاحبي']) {
    assert.ok(passwordOk(pw, 'someone@example.com'), pw);
  }
});

/* ----------------------------------------------------------------- name --- */

test('names are collapsed and capped', () => {
  assert.equal(cleanName('  Youssef   Mohamed  '), 'Youssef Mohamed');
  assert.equal(cleanName('a'.repeat(200)).length, 80);
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('line\nbreak'), 'line break');
});

/* ----------------------------------------------------------------- cart --- */

test('a cart line survives only if the server can trust every field', () => {
  const out = cleanCartLines([
    { sku: 'S7-WAX-RED', qty: 2 },
    { sku: 'S7-GEL-BLU', qty: '3' },
  ]);
  assert.deepEqual(out, [{ sku: 'S7-WAX-RED', qty: 2 }, { sku: 'S7-GEL-BLU', qty: 3 }]);
});

test('prices sent by the client are dropped, not honoured', () => {
  const out = cleanCartLines([{ sku: 'S7-WAX-RED', qty: 1, price: 0.01, name: 'free' }]);
  assert.deepEqual(out, [{ sku: 'S7-WAX-RED', qty: 1 }]);
  assert.equal('price' in out[0], false);
});

test('quantities that would cost the shop money are refused', () => {
  assert.deepEqual(cleanCartLines([{ sku: 'A', qty: -5 }]), []);
  assert.deepEqual(cleanCartLines([{ sku: 'A', qty: 0 }]), []);
  assert.deepEqual(cleanCartLines([{ sku: 'A', qty: NaN }]), []);
  assert.deepEqual(cleanCartLines([{ sku: 'A', qty: Infinity }]), []);
  assert.deepEqual(cleanCartLines([{ sku: 'A', qty: 1e9 }]), [{ sku: 'A', qty: CART_MAX_QTY }]);
  assert.deepEqual(cleanCartLines([{ sku: 'A', qty: 2.9 }]), [{ sku: 'A', qty: 2 }]);
});

test('a SKU that is not a SKU cannot reach a query', () => {
  for (const sku of ["'; DROP TABLE carts;--", '../../etc/passwd', '', 'a'.repeat(60), 42, null]) {
    assert.deepEqual(cleanCartLines([{ sku, qty: 1 }]), [], String(sku).slice(0, 20));
  }
});

test('duplicate lines are summed, then capped', () => {
  assert.deepEqual(
    cleanCartLines([{ sku: 'A', qty: 8 }, { sku: 'A', qty: 9 }]),
    [{ sku: 'A', qty: 17 }]);
  assert.deepEqual(
    cleanCartLines([{ sku: 'A', qty: 15 }, { sku: 'A', qty: 15 }]),
    [{ sku: 'A', qty: CART_MAX_QTY }]);
});

test('a huge basket cannot be used to make the server do work', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ sku: `S7-${i}`, qty: 1 }));
  assert.ok(cleanCartLines(many).length <= CART_MAX_LINES);
});

test('anything that is not an array is an empty cart', () => {
  for (const v of [null, undefined, 'cart', 42, {}]) assert.deepEqual(cleanCartLines(v), []);
});

/* --------------------------------------------------------------- origin --- */

const req = h => ({ headers: { get: k => h[k.toLowerCase()] ?? null } });
const SITE = 'https://shop.example.com';

test('same-origin requests are allowed', () => {
  assert.equal(originAllowed(req({ origin: SITE, 'sec-fetch-site': 'same-origin' }), SITE), true);
  assert.equal(originAllowed(req({ 'sec-fetch-site': 'same-origin' }), SITE), true);
});

test('cross-site requests are refused however they are dressed', () => {
  assert.equal(originAllowed(req({ origin: 'https://evil.com', 'sec-fetch-site': 'cross-site' }), SITE), false);
  assert.equal(originAllowed(req({ origin: 'https://evil.com' }), SITE), false);
  assert.equal(originAllowed(req({ 'sec-fetch-site': 'cross-site' }), SITE), false);
  // A lookalike host, and the same host over plain http.
  assert.equal(originAllowed(req({ origin: 'https://shop.example.com.evil.com' }), SITE), false);
  assert.equal(originAllowed(req({ origin: 'http://shop.example.com' }), SITE), false);
  assert.equal(originAllowed(req({ origin: 'not a url' }), SITE), false);
});
