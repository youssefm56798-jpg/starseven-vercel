/**
 * Structural guarantees about the customer auth surface.
 *
 * These read the route files as text rather than executing them, because the
 * mistakes they are aimed at are omissions, and an omission has no behaviour
 * to assert against. A new endpoint that simply forgets the origin check does
 * not fail any functional test — it just quietly has no CSRF protection.
 *
 * Every rule here corresponds to a line in docs/auth-spec.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function routesUnder(dir) {
  const base = join(ROOT, dir);
  if (!existsSync(base)) return [];
  const out = [];
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'route.js') out.push(full);
    }
  })(base);
  return out;
}

const AUTH_ROUTES = routesUnder('app/api/auth');
const CART_ROUTES = routesUnder('app/api/cart');
const ALL = [...AUTH_ROUTES, ...CART_ROUTES];
const read = f => readFileSync(f, 'utf8');
// join() gives backslashes on Windows; normalise both sides before stripping.
const norm = p => p.replace(/\\/g, '/');
const rel = f => norm(f).replace(norm(ROOT), '');

test('the auth surface is the one the spec describes', () => {
  const paths = ALL.map(rel).sort();
  assert.deepEqual(paths, [
    'app/api/auth/login/route.js',
    'app/api/auth/logout-all/route.js',
    'app/api/auth/logout/route.js',
    'app/api/auth/me/route.js',
    'app/api/auth/refresh/route.js',
    'app/api/auth/register/route.js',
    'app/api/cart/route.js',
  ]);
});

test('every state-changing handler runs an origin check first', () => {
  for (const file of ALL) {
    const src = read(file);
    if (!/export async function (POST|PUT|PATCH|DELETE)/.test(src)) continue;
    assert.match(src, /\bguard(Origin)?\(req\)/,
      `${rel(file)} changes state without an origin check`);
  }
});

test('every handler that reads a body insists on JSON', () => {
  for (const file of ALL) {
    const src = read(file);
    if (!src.includes('readJson')) continue;
    // guard() is guardOrigin + guardJson; either spelling is fine.
    assert.ok(/\bguard\(req\)/.test(src) || /guardJson\(req\)/.test(src),
      `${rel(file)} parses a body without insisting on a JSON content type`);
  }
});

test('bcrypt never runs on the edge runtime', () => {
  for (const file of ALL) {
    const src = read(file);
    if (!/verifyPassword|hashPassword|startSession|refreshSession/.test(src)) continue;
    assert.match(src, /runtime\s*=\s*'nodejs'/,
      `${rel(file)} touches password or session code but does not pin the Node runtime`);
  }
});

test('no route takes a user id from the request', () => {
  // The whole "each user sees only their own cart" guarantee rests on this:
  // identity comes from the verified token and from nowhere else.
  const forbidden = [
    /body\.user_?[Ii]d/, /body\.userId/, /body\.customer/,
    /searchParams\.get\(['"]user/, /params\.user/,
    /headers\.get\(['"]x-user/i,
  ];
  for (const file of ALL) {
    const src = read(file);
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(src),
        `${rel(file)} reads an identity from the request (${pattern})`);
    }
  }
});

test('the cart module offers no way to fetch a cart that is not the callers', () => {
  const src = read(join(ROOT, 'lib/server-cart.js'));
  // Every exported function must take userId as its first parameter.
  const exported = [...src.matchAll(/export async function (\w+)\s*\(([^)]*)\)/g)];
  assert.ok(exported.length >= 3, 'expected the cart helpers to be exported');
  for (const [, name, params] of exported) {
    assert.match(params.trim(), /^userId\b/,
      `server-cart.${name}() does not start from a userId`);
  }
  // And no exported helper may be keyed by cart id.
  assert.ok(!/export .*function \w+\s*\(\s*cartId/.test(src),
    'a cart helper is keyed by cart id, which would let one user name another cart');
});

test('every cart statement filters on the user', () => {
  const src = read(join(ROOT, 'lib/server-cart.js'));
  // Pull each tagged-template SQL body and check the ones touching cart tables.
  for (const m of src.matchAll(/sql`([\s\S]*?)`/g)) {
    const q = m[1];
    if (!/cart_items|carts/.test(q)) continue;
    // Scoped either by the user directly, or by a cart id that was itself
    // resolved from the user - cartIdFor() is the only source of one.
    const scoped = /\$\{userId\}/.test(q) || /\$\{cartId\}/.test(q);
    assert.ok(scoped, `an unscoped cart statement: ${q.trim().slice(0, 80)}`);
  }
});

test('session tokens are stored hashed, never raw', () => {
  const src = read(join(ROOT, 'lib/customer-auth.js'));
  for (const m of src.matchAll(/sql`([\s\S]*?)`/g)) {
    const q = m[1];
    if (!/refresh_hash/.test(q)) continue;
    // Any value written to or compared against refresh_hash must be a digest.
    assert.ok(/sha256\(/.test(q) || /\$\{digest\}/.test(q),
      `a raw token reaches refresh_hash: ${q.trim().slice(0, 80)}`);
  }
  assert.ok(!/INSERT INTO sessions[\s\S]*?\$\{refresh\}[^_]/.test(src),
    'a raw refresh token is being inserted');
});

test('cookies are httpOnly, secure and same-site', () => {
  const src = read(join(ROOT, 'lib/customer-auth.js'));
  assert.match(src, /httpOnly:\s*true/);
  assert.match(src, /secure:\s*true/);
  assert.match(src, /sameSite:\s*'lax'/);
  // The access cookie is host-locked; the refresh cookie is path-scoped so it
  // is not sent on ordinary page requests.
  assert.match(src, /__Host-s7_at/);
  assert.match(src, /__Secure-s7_rt/);
  assert.match(src, /REFRESH_PATH\s*=\s*'\/api\/auth'/);
});

test('the access token is short-lived, because it is not checked against the database', () => {
  const src = read(join(ROOT, 'lib/customer-auth.js'));
  const m = src.match(/ACCESS_TTL\s*=\s*([^;]+);/);
  assert.ok(m, 'ACCESS_TTL not found');
  const ttl = Function(`"use strict";return (${m[1]})`)();
  assert.ok(ttl <= 900, `access tokens live ${ttl}s — that is the revocation window`);
});

test('a spent refresh token revokes its whole family', () => {
  const src = read(join(ROOT, 'lib/customer-auth.js'));
  assert.match(src, /rotated_at/, 'rotation is not recorded, so reuse cannot be detected');
  assert.match(src, /UPDATE sessions SET revoked_at = now\(\)\s*\n?\s*WHERE family_id/,
    'reuse does not revoke the family');
});

test('login cannot be used to discover which addresses have accounts', () => {
  const src = read(join(ROOT, 'app/api/auth/login/route.js'));
  assert.match(src, /DUMMY_HASH/,
    'an unknown address must still pay for a bcrypt compare');
  // One message for both failures.
  const failures = [...src.matchAll(/fail\('([a-z-]+)'/g)].map(m => m[1]);
  assert.ok(!failures.includes('unknown-email'), 'the failure reason names the cause');
  assert.ok(failures.includes('bad-credentials'));
});

test('login is rate limited by address as well as by IP', () => {
  const src = read(join(ROOT, 'app/api/auth/login/route.js'));
  assert.match(src, /c-login-ip/);
  assert.match(src, /c-login-acct/);
  // The account bucket must be keyed by a digest, not by the raw address —
  // otherwise rate_limits becomes a list of customer emails.
  assert.match(src, /rateOk\('c-login-acct',\s*await sha256\(email\)/);
});

test('the admin session and the customer session share nothing', () => {
  const admin = read(join(ROOT, 'lib/auth.js'));
  const customer = read(join(ROOT, 'lib/customer-auth.js'));
  const cookieOf = src => [...src.matchAll(/'(__[A-Za-z]+-)?s7_[a-z]+'/g)].map(m => m[0]);
  const shared = cookieOf(admin).filter(c => cookieOf(customer).includes(c));
  assert.deepEqual(shared, [], 'admin and customer sessions share a cookie name');
  assert.ok(!customer.includes('FROM admins'), 'customer auth reads the admins table');
  assert.ok(!admin.includes('FROM users'), 'admin auth reads the customers table');
});

test('the dummy hash is a real cost-12 bcrypt hash, not a placeholder', async () => {
  // The timing defence in login only works if comparing against this costs the
  // same as comparing against a real hash. A malformed string would make
  // bcrypt.compare return immediately, and an unknown address would then be
  // measurably faster than a wrong password — which is the exact leak the
  // dummy exists to close.
  // Read as text, not imported: customer-auth.js pulls in next/headers,
  // which does not resolve outside a Next runtime.
  const src = read(join(ROOT, 'lib/customer-auth.js'));
  const DUMMY_HASH = src.match(/DUMMY_HASH = '([^']+)'/)?.[1] ?? '';
  assert.match(DUMMY_HASH, /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/,
    'DUMMY_HASH is not a well-formed cost-12 bcrypt hash');

  const bcrypt = (await import('bcryptjs')).default;
  const started = Date.now();
  assert.equal(await bcrypt.compare('anything at all', DUMMY_HASH), false);
  const elapsed = Date.now() - started;
  assert.ok(elapsed > 50,
    `comparing against the dummy took ${elapsed}ms — too fast to be doing the work`);
});
