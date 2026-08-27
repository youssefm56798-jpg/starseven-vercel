/**
 * clientIp must not trust a header the client can forge.
 *
 * Every rate limiter in the app keys its bucket on clientIp - the admin login
 * throttle, the order and refund limits, the newsletter and coupon limits - and
 * it is written into the orders and subscribers audit columns. If the client
 * chooses the value, none of those hold: a fresh header per request lands each
 * one in its own bucket and no fixed-window limit ever fills.
 *
 * The function used to read the leftmost entry of x-forwarded-for, which is the
 * part a proxy leaves under the client's control - the real address is appended
 * to the right. This pins the corrected behaviour: take only the headers the
 * platform sets and overwrites (x-vercel-forwarded-for, x-real-ip), and never
 * x-forwarded-for. A regression here is silent and total, so it gets a test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../lib/db.js';

// A stand-in for the Headers object clientIp reads via .get().
const headers = map => ({ get: k => map[k.toLowerCase()] ?? null });
const ipFrom = map => clientIp({ headers: headers(map) });

test('a spoofed x-forwarded-for is ignored', () => {
  // The attacker prepends whatever they like; the platform-set header is what
  // counts. The forged value must not become the bucket key.
  assert.equal(
    ipFrom({ 'x-forwarded-for': '1.2.3.4', 'x-vercel-forwarded-for': '9.9.9.9' }),
    '9.9.9.9',
  );
  assert.equal(
    ipFrom({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.9.9.9' }),
    '9.9.9.9',
  );
});

test('x-forwarded-for alone is never trusted', () => {
  // With only the forgeable header present, the function must fall back to the
  // shared bucket rather than honour it - one bucket is a nuisance, a
  // client-chosen bucket per request is an open door.
  assert.equal(ipFrom({ 'x-forwarded-for': '1.2.3.4' }), '0.0.0.0');
});

test('the Vercel header wins over x-real-ip', () => {
  assert.equal(
    ipFrom({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-real-ip': '5.5.5.5' }),
    '9.9.9.9',
  );
});

test('missing headers give a single shared bucket, not a throw', () => {
  assert.equal(ipFrom({}), '0.0.0.0');
  assert.equal(clientIp(undefined), '0.0.0.0');
  assert.equal(clientIp({}), '0.0.0.0');
});

test('a real value is trimmed', () => {
  assert.equal(ipFrom({ 'x-real-ip': '  8.8.8.8  ' }), '8.8.8.8');
});
