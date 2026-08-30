/**
 * Two fixes that a green test run would otherwise let somebody undo.
 *
 * Both were live defects, and both were invisible from the outside: the code
 * looked defensive in each case, and the flaw was in the ORDER things happened
 * in. So these read the source rather than the behaviour - the modules pull in
 * next/headers, next/navigation and the database, none of which survives being
 * loaded under node:test - and they assert the ordering that makes each fix a
 * fix. See tests/admin-actions.test.mjs for the same idea applied to actions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(ROOT + p, 'utf8');

const auth = read('lib/auth.js');
const mw = read('middleware.js');
const login = read('app/admin/(auth)/login/page.js');
const db = read('lib/db.js');

/* ------------------------------------------------------------------ CSRF */

test('the CSRF token is a MAC, not a bare hash of the signing secret', () => {
  const fn = auth.slice(auth.indexOf('async function csrfKey('), auth.indexOf('export async function csrfOk('));

  assert.match(fn, /crypto\.subtle\.sign\('HMAC'/, 'the token has to be an HMAC');
  assert.match(fn, /s7-csrf-v1:/, 'the HMAC key must be domain-separated from the session key');
  assert.doesNotMatch(
    fn,
    /digest\('SHA-256',\s*new TextEncoder\(\)\.encode\(\s*(seed|token)\s*\+/,
    'hashing the seed together with the raw secret is what published a hash of the secret',
  );
});

test('an anonymous visitor gets a seed of their own, not the constant', () => {
  const fn = auth.slice(auth.indexOf('export async function csrfToken('), auth.indexOf('export async function csrfOk('));
  // The seed expression itself, not the prose around it - the comment above it
  // names 'anon' while explaining why it is last, and that must not count.
  const expr = fn.slice(fn.indexOf('const seed ='), fn.indexOf(';', fn.indexOf('const seed =')));

  assert.match(expr, /CSRF_COOKIE/, 'the anonymous cookie has to be one of the seeds');
  const anon = expr.indexOf("'anon'");
  const cookie = expr.indexOf('CSRF_COOKIE');
  assert.ok(anon !== -1, "'anon' should still be the last resort");
  assert.ok(cookie !== -1 && cookie < anon, "CSRF_COOKIE must be tried BEFORE falling back to 'anon'");
});

test('SESSION_SECRET is read in exactly one place', () => {
  // csrfToken() used to read process.env directly, which skipped the length
  // check that secret() applies. One reader means one rule.
  const reads = auth.match(/process\.env\.SESSION_SECRET/g) || [];
  assert.equal(reads.length, 1, 'only secretRaw() may read SESSION_SECRET');
  const guard = auth.slice(auth.indexOf('function secretRaw('), auth.indexOf('function secret()'));
  assert.match(guard, /throw new Error/, 'the one reader has to enforce the length floor');
});

test('both jwtVerify calls pin the algorithm', () => {
  // Slice forward from each call site rather than regexing the parens: the
  // argument list contains secret(), so a lazy [^)]* stops at the wrong one.
  const sites = [...auth.matchAll(/jwtVerify\(/g)].map(m => auth.slice(m.index, m.index + 140));
  assert.ok(sites.length >= 2, 'expected the session and the pending-session verifies');
  for (const c of sites) {
    assert.match(c, /algorithms: \['HS256'\]/, `unpinned jwtVerify: ${c.slice(0, 60)}`);
  }
});

test('the middleware mints the seed, and spells the cookie the same way', () => {
  const name = auth.match(/export const CSRF_COOKIE = '([^']+)'/)?.[1];
  assert.ok(name, 'lib/auth.js must export CSRF_COOKIE');
  assert.match(mw, new RegExp(`const CSRF_COOKIE = '${name}'`), 'middleware.js disagrees with lib/auth.js');

  const fn = mw.slice(mw.indexOf('function withCsrfSeed('), mw.indexOf('export function middleware('));
  assert.match(fn, /crypto\.getRandomValues/, 'the seed has to be random per visitor');
  assert.match(fn, /httpOnly: true/, 'the seed cookie must not be readable by client JS');
  assert.match(fn, /NextResponse\.next\(\{ request: \{ headers \} \}\)/,
    'the seed must reach THIS render, or the first page load still derives from the constant');
});

/* --------------------------------------------------------------- lockout */

test('a wrong password spends the account allowance; a right one does not', () => {
  const compare = login.indexOf('bcrypt.compare');
  const acct = login.indexOf("rateOk('login-acct'");
  const clear = login.indexOf("rateClear('login-acct'");

  assert.ok(compare !== -1 && acct !== -1 && clear !== -1, 'expected all three calls');
  assert.ok(
    acct > compare,
    'the account limit must be charged AFTER the password is known to be wrong - ' +
      'charging it first lets anyone who knows the admin address lock the owner out',
  );
  assert.ok(clear > compare, 'a proven-correct password must clear whatever somebody else spent');
});

test('the per-IP login limit still runs before any bcrypt work', () => {
  const ipLimit = login.indexOf("rateOk('login'");
  const compare = login.indexOf('bcrypt.compare');
  assert.ok(ipLimit !== -1 && ipLimit < compare, 'the IP limit is what bounds bcrypt cost; it stays first');
});

test('rateClear exists and deletes only the one bucket', () => {
  const fn = db.slice(db.indexOf('export async function rateClear('), db.indexOf('export async function rateOk('));
  assert.match(fn, /DELETE FROM rate_limits/);
  assert.match(fn, /bucket = \$\{bucket\}/, 'must be scoped to the bucket');
  assert.match(fn, /ip = \$\{ipBucket\(ip\)\}/, 'must key the same way rateOk does');
});
