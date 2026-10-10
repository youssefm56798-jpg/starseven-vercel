import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmail } from '../lib/customer-email.js';

test('customer email accepts ordinary, plus-tagged and punycode addresses', () => {
  for (const email of ['customer@example.com', 'CUSTOMER@example.com',
    'customer+shop@example.co.uk', 'customer@xn--mgbh0fb.com']) {
    assert.equal(isEmail(email), true, email);
  }
});

test('reject recipients that caused the September 26 mail-provider failure', () => {
  for (const email of ['عميل@example.com', 'customer@مثال.com',
    'customer\u200b@example.com', 'customer\u200e@example.com',
    'customer\u00a0@example.com', 'customer@exámple.com']) {
    assert.equal(isEmail(email), false, email);
  }
});

test('reject malformed and oversized customer addresses', () => {
  for (const email of ['', null, 'customer', 'customer@@example.com',
    'customer@example', 'customer@example.c', 'customer @example.com',
    'customer\n@example.com', 'customer\x00@example.com', `${'a'.repeat(180)}@example.com`]) {
    assert.equal(isEmail(email), false, String(email));
  }
});
