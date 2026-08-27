/**
 * Getting back to your own order, without an account.
 *
 * The shop had passwords and sessions for about an hour before it became clear
 * that a cash-on-delivery shop does not need them: the only thing a customer
 * comes back for is the state of one order. So the link in the confirmation
 * email carries a token, and the token is the credential.
 *
 * Which makes that token the whole security boundary, and these are the
 * properties it has to hold:
 *
 *   - long and random, so it cannot be guessed
 *   - never stored, so a database dump yields nothing replayable
 *   - bound to one order, so holding one tells you nothing about any other
 *   - a wrong token and a wrong reference fail identically, so this cannot be
 *     used to find out whether an order exists
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newAccessToken, sha256, orderUrl } from '../lib/order-access.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = readFileSync(join(ROOT, 'lib/order-access.js'), 'utf8');

test('the token is long, random and URL-safe', () => {
  const a = newAccessToken();
  assert.ok(a.length >= 40, `token is only ${a.length} chars`);
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'token must survive a query string unescaped');

  // 200 draws, no repeats. A generator seeded from the clock fails this.
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(newAccessToken());
  assert.equal(seen.size, 200, 'tokens repeat');
});

test('the digest is stable and does not leak the token', async () => {
  const t = newAccessToken();
  assert.equal(await sha256(t), await sha256(t));
  assert.notEqual(await sha256(t), await sha256(newAccessToken()));
  const d = await sha256(t);
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.ok(!d.includes(t.slice(0, 8)), 'the digest contains the token');
});

test('the raw token is never written to the database', () => {
  // Every statement touching access_hash must be handed a digest.
  for (const m of SRC.matchAll(/sql`([\s\S]*?)`/g)) {
    const q = m[1];
    if (!/access_hash/.test(q)) continue;
    assert.match(q, /sha256\(/,
      `a value that is not a digest reaches access_hash: ${q.trim().slice(0, 70)}`);
  }
  // And nothing here may write the token to a column of its own.
  assert.ok(!/access_token|token\s*=\s*\$\{token\}/.test(SRC),
    'the raw token is being stored somewhere');
});

test('an order is looked up by digest and confirmed against its reference', () => {
  // Both halves matter. The digest finds the row; the reference proves the URL
  // is talking about that row. Without the second check, one valid token would
  // open whatever reference was typed next to it.
  assert.match(SRC, /WHERE access_hash = \$\{await sha256\(token\)\}/);
  assert.match(SRC, /order\.ref !== ref/);
});

test('a malformed token or reference is refused before any query runs', async () => {
  // Cheap, but the point is that a null or a 2-character token never becomes a
  // database round trip, and never becomes a digest lookup that could be timed.
  const guard = SRC.slice(SRC.indexOf('export async function orderFor'));
  const beforeQuery = guard.slice(0, guard.indexOf('sql`'));
  assert.match(beforeQuery, /token\.length < 20/);
  assert.match(beforeQuery, /\/\^\[A-Za-z0-9-\]\{1,32\}\$\//);
});

test('the refund request cannot be pointed at another order', () => {
  // requestRefund takes the id the token already unlocked. If it took a
  // reference or accepted one from a body, one valid token would let its holder
  // write to any order.
  const m = SRC.match(/export async function requestRefund\(([^)]*)\)/);
  assert.ok(m, 'requestRefund is gone');
  assert.match(m[1].trim(), /^orderId\b/, 'requestRefund does not start from an unlocked order id');

  const route = readFileSync(join(ROOT, 'app/api/order/refund/route.js'), 'utf8');
  assert.match(route, /orderFor\(body\?\.ref, body\?\.t\)/,
    'the refund route does not re-verify the token');
  assert.match(route, /requestRefund\(order\.id/,
    'the refund route writes to an id that did not come from the verified order');
  assert.ok(!/body\?\.(id|orderId)/.test(route), 'the route reads an id from the body');
});

test('the refund route refuses cross-site and non-JSON requests', () => {
  const route = readFileSync(join(ROOT, 'app/api/order/refund/route.js'), 'utf8');
  assert.match(route, /originAllowed\(req, site\.url\)/);
  assert.match(route, /application\/json/);
  assert.match(route, /rateOk\(/);
});

test('the link is built for the language the order was placed in', () => {
  const t = 'abcdefghijklmnopqrstuvwxyz0123456789';
  assert.match(orderUrl('S7-2708-1234', t, 'en'), /\/en\/order\/S7-2708-1234\?t=/);
  assert.match(orderUrl('S7-2708-1234', t, 'ar'), /\/order\/S7-2708-1234\?t=/);
  assert.ok(!orderUrl('S7-2708-1234', t, 'ar').includes('/en/'));
});

test('a reference with URL-significant characters is escaped', () => {
  const url = orderUrl('S7 2708/1234?x=1', 'tok', 'ar');
  assert.ok(!url.includes('?x=1'), 'a crafted reference can inject query params');
  assert.ok(url.includes('%2F') || url.includes('%20'), 'the reference is not encoded');
});

test('the order page never caches, because it renders one customer’s order', () => {
  const page = readFileSync(join(ROOT, 'app/order/[ref]/page.js'), 'utf8');
  assert.match(page, /export const dynamic = 'force-dynamic'/);
  assert.match(page, /robots:\s*\{\s*index:\s*false/);
});

test('a bad link and a missing order say the same thing', () => {
  // Otherwise the page answers "does this order reference exist" for anyone
  // who asks, which is the enumeration hole the single failure branch closes.
  const page = readFileSync(join(ROOT, 'app/order/[ref]/page.js'), 'utf8');
  const branches = page.match(/if \(!order\)/g) || [];
  assert.equal(branches.length, 1, 'more than one failure branch — they will drift apart');
});
