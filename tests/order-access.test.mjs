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
 *
 * An order can hold several live links now — db/schema.sql grew an
 * order_tokens table so that a status email can carry one without destroying
 * the link in the confirmation, and so that a lost email is no longer a dead
 * end. Every property above survives that unchanged, and the block at the
 * bottom of this file is what holds each of them to it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  newAccessToken,
  sha256,
  orderUrl,
  mintOrderLink,
  issueRecoveryToken,
  TOKEN_PURPOSES,
  RECOVERY_TTL_DAYS,
} from '../lib/order-access.js';

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
  // Every statement touching a hash column must be handed a digest. Both
  // columns are named, not just access_hash: order_tokens.token_hash is where
  // every new link is written, and a raw token reaching it would be the same
  // defect in a newer table.
  for (const m of SRC.matchAll(/sql`([\s\S]*?)`/g)) {
    const q = m[1];
    // No statement anywhere in this file may carry the token itself, whatever
    // column it is aimed at.
    assert.ok(!/\$\{\s*token\s*\}/.test(q),
      `a raw token is interpolated into a statement: ${q.trim().slice(0, 70)}`);
    if (!/access_hash|token_hash/.test(q)) continue;
    assert.match(q, /sha256\(/,
      `a value that is not a digest reaches a hash column: ${q.trim().slice(0, 70)}`);
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

test('the token table is searched by digest too, and only while a row is live', () => {
  // The second half of the same lookup. A link minted for a status email lives
  // in order_tokens rather than in the column, and it has to be found the same
  // way — by digest, never by reference.
  assert.match(SRC, /t\.token_hash = \$\{await sha256\(token\)\}/);
  assert.match(SRC, /t\.expires_at IS NULL OR t\.expires_at > now\(\)/,
    'an expired row would still open the order');
});

test('the lookup never starts from the reference', () => {
  /*
   * This is the timing half of the single failure branch, and it is easy to
   * lose by writing a query that reads more naturally.
   *
   *   WHERE o.ref = ${ref} AND (digest matches)
   *
   * answers in the same words either way and in different times: a reference
   * that exists costs a row fetch and one that does not costs an index miss.
   * Measuring that is how a page which refuses to confirm anything gets asked
   * whether an order exists. Both halves of the real query start at a digest,
   * and the reference is compared in JavaScript afterwards.
   */
  const fn = SRC.slice(SRC.indexOf('export async function orderFor'));
  const query = fn.slice(fn.indexOf('sql`'), fn.indexOf('`;', fn.indexOf('sql`')));
  assert.ok(!/\bref\b\s*=\s*\$\{ref\}/.test(query),
    'orderFor filters on the reference in SQL, which makes a real reference measurably slower');
  assert.equal((query.match(/sha256\(token\)/g) || []).length, 2,
    'both branches of the lookup must key on the digest');
});

test('minting a link never touches the links already handed out', () => {
  /*
   * The property the whole table exists for. The previous design had one
   * digest per order, so issuing a second link meant overwriting the first —
   * which is why no status email could carry one. If mintOrderLink ever grows
   * an UPDATE or a DELETE, the confirmation email in a customer inbox stops
   * working the first time their order moves, silently.
   */
  const fn = SRC.slice(SRC.indexOf('export async function mintOrderLink'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /INSERT INTO order_tokens/);
  assert.ok(!/\bUPDATE\b|\bDELETE\b/.test(body),
    'mintOrderLink modifies existing rows, so a new link kills an old one');
});

test('a purpose is a label and never a permission', () => {
  // Every live row opens the same one order. If a lookup ever started reading
  // `purpose`, the column would become an access rule that nothing tests and
  // that a mint could get wrong.
  assert.deepEqual(TOKEN_PURPOSES, ['checkout', 'status-mail', 'recovery']);
  const fn = SRC.slice(SRC.indexOf('export async function orderFor'));
  const query = fn.slice(fn.indexOf('sql`'), fn.indexOf('`;', fn.indexOf('sql`')));
  assert.ok(!/purpose/.test(query), 'the lookup branches on purpose');
});

test('mintOrderLink refuses anything that is not an unlocked order', async () => {
  // Every branch below returns before a query is built, so these run with no
  // database. A caller that got here with a junk id must not reach the table.
  for (const bad of [null, undefined, {}, { id: 0, ref: 'S7-1' }, { id: 1 }, { id: 'x', ref: 'S7-1' }]) {
    assert.equal(await mintOrderLink(bad), '', `minted for ${JSON.stringify(bad)}`);
  }
  assert.equal(await mintOrderLink({ id: 1, ref: 'S7-1' }, 'admin'), '',
    'minted a link for a purpose the schema does not allow');
});

test('the recovery lookup refuses a malformed reference before any query runs', async () => {
  for (const bad of ['', 'a b', 'S7/1234', 'x'.repeat(33), null, 12, {}]) {
    assert.equal(await issueRecoveryToken(bad, 'a@b.com'), null,
      `a query was built for ${String(bad)}`);
  }
  assert.equal(await issueRecoveryToken('S7-2708-1234', ''), null);
  assert.equal(await issueRecoveryToken('S7-2708-1234', `${'a'.repeat(200)}@b.com`), null);
});

test('the recovery lookup and the mint are one statement', () => {
  /*
   * A SELECT, then an INSERT if it matched, answers "if that matches an order
   * we have sent the link" in both cases and in two different times — one
   * round trip against two. That difference is the oracle the endpoint exists
   * to avoid, and it is invisible in the response body, which is what makes it
   * worth pinning here rather than trusting to review.
   */
  const fn = SRC.slice(SRC.indexOf('export async function issueRecoveryToken'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.equal((body.match(/sql`/g) || []).length, 1,
    'issueRecoveryToken makes more than one round trip, so a hit is slower than a miss');
  assert.match(body, /WITH hit AS/);
  assert.match(body, /INSERT INTO order_tokens/);
});

test('a recovery link expires and the durable ones do not', () => {
  // The one deliberate departure from the no-expiry rule, and the only token a
  // stranger can cause to be minted. If the TTL ever became null the pile of
  // credentials a stranger can create against one order would be unbounded.
  assert.ok(Number.isInteger(RECOVERY_TTL_DAYS) && RECOVERY_TTL_DAYS > 0);
  assert.ok(RECOVERY_TTL_DAYS <= 90, 'a recovery link should not outlive the memory of asking for it');

  const mint = SRC.slice(SRC.indexOf('export async function mintOrderLink'));
  assert.ok(!/expires_at/.test(mint.slice(0, mint.indexOf('\n}') + 2)),
    'a status-mail link expires, so the email a customer kept stops working');

  const recovery = SRC.slice(SRC.indexOf('export async function issueRecoveryToken'));
  assert.match(recovery, /expires_at/);
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

/* ------------------------------------------------------- /order/find */

/**
 * The page that mails a fresh link.
 *
 * It takes an email and a reference and it must not say whether they go
 * together. A reference is four random digits inside a day, so an endpoint
 * that confirmed the pair would hand back, from the front, exactly the
 * enumeration the order page closes.
 *
 * These are source assertions rather than calls, for the same reason
 * scripts/verify-order-status.mjs exists as a script: the route imports
 * next/server, which does not resolve outside a Next build, so it cannot be
 * invoked here. What CAN be pinned here is the shape that makes it uniform,
 * and each of these guards a way it could stop being.
 */
const FIND = readFileSync(join(ROOT, 'app/api/order/find/route.js'), 'utf8');

test('the find endpoint has exactly one success response', () => {
  // Two would drift. One of them would eventually gain a word that only the
  // matched branch could truthfully say, and the endpoint would answer the
  // question it exists to refuse.
  assert.equal((FIND.match(/\bok\(\{/g) || []).length, 1,
    'more than one success response — the two will diverge');
  assert.match(FIND, /const answer = \(\) =>/);
  // Two call sites, not three: the honeypot, and the single exit that a match
  // and a miss both fall through to. A third would mean one of them had been
  // given a return of its own, which is where they start to differ.
  assert.equal((FIND.match(/return answer\(\);/g) || []).length, 2,
    'a branch has been given a return of its own');
});

test('the find endpoint never returns early on a miss', () => {
  // The failure mode is subtle: `if (!issued) return fail(...)` reads like
  // sane error handling and is a yes/no oracle for any email and reference.
  assert.ok(!/if \(!issued\)/.test(FIND), 'a miss takes a different path out');
  assert.match(FIND, /if \(issued\) \{/);
});

test('the mail is sent after the response, not before it', () => {
  /*
   * Identical wording is only half of uniform. Awaiting Resend inline makes a
   * match hundreds of milliseconds slower than a miss, and the latency answers
   * what the body will not. app/api/subscribe/route.js has the same trap
   * written out at length.
   */
  assert.match(FIND, /after\(/);
  const send = FIND.indexOf('sendMail');
  const defer = FIND.indexOf('after(');
  assert.ok(defer !== -1 && defer < send, 'sendMail is reached outside after()');
});

test('the find endpoint is limited per IP and per email', () => {
  // Two different attacks. The IP limit is the enumeration limit; the email
  // limit stops the shop being used to mail somebody on demand.
  assert.match(FIND, /rateOk\('order-find', ip/);
  assert.match(FIND, /rateOk\('order-find-email', email/);
});

test('the language of the mail comes from the order, not from the request', () => {
  // `lang` in the body decides the wording of the page response. Letting it
  // decide the wording of a message that lands in somebody else inbox would
  // give a stranger a say in what that person reads.
  assert.match(FIND, /order\.lang === 'en'/);
  assert.ok(!/tplOrderLink\(order, lang/.test(FIND), 'the request language reaches the mail');
});

test('the find page exists in both trees and is not indexed', () => {
  for (const rel of ['app/order/find/page.js', 'app/en/order/find/page.js']) {
    const page = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(page, /export const dynamic = 'force-dynamic'/,
      `${rel} may be cached, and the answer it renders is per-visitor`);
    assert.match(page, /robots:\s*\{\s*index:\s*false/, `${rel} is indexable`);
  }
});

/* ----------------------------------------------------------- the schema */

const SCHEMA = readFileSync(join(ROOT, 'db/schema.sql'), 'utf8');

test('nothing in schema.sql drops order_tokens', () => {
  // db:setup re-runs the whole file on every deploy, and it already carries a
  // block of deliberate DROPs for the removed accounts tables. A DROP that
  // reached this table would log every customer out of their own order on a
  // deploy, with no way to put them back.
  assert.doesNotMatch(SCHEMA, /DROP TABLE[^;]*order_tokens/i);
  assert.doesNotMatch(SCHEMA, /orders DROP COLUMN[^;]*access_hash/i);
});

test('the access_hash migration is idempotent and cannot abort a deploy', () => {
  const stmt = SCHEMA.slice(SCHEMA.indexOf('INSERT INTO order_tokens'));
  const insert = stmt.slice(0, stmt.indexOf(';') + 1);
  assert.match(insert, /NOT EXISTS \(SELECT 1 FROM order_tokens/,
    'a re-run would insert every row a second time and fail on the unique index');
  assert.match(insert, /DISTINCT ON \(o\.access_hash\)/,
    'two rows sharing a digest would abort the whole schema run');
  assert.match(insert, /o\.access_hash <> ''/,
    'orders with no token would be given an empty digest, which any empty token then matches');
});

test('the purposes the code writes are the purposes the schema allows', () => {
  // A purpose the CHECK does not list is a constraint violation at runtime,
  // which for the status mail means a notice that silently loses its link.
  const [, list] = SCHEMA.match(/purpose\s+TEXT NOT NULL DEFAULT 'checkout'\s*\n?\s*CHECK \(purpose IN \(([^)]*)\)\)/) || [];
  assert.ok(list, 'could not find the purpose CHECK constraint');
  const allowed = list.split(',').map(s => s.trim().replace(/'/g, ''));
  for (const p of TOKEN_PURPOSES) {
    assert.ok(allowed.includes(p), `${p} is written by the code but not allowed by the schema`);
  }
});

test('the digest column is unique, so one digest cannot answer with two rows', () => {
  assert.match(SCHEMA, /CREATE UNIQUE INDEX IF NOT EXISTS idx_order_tokens_hash ON order_tokens \(token_hash\)/);
});
