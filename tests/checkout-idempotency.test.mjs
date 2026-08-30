/**
 * The shape of the checkout idempotency guard, without a database.
 *
 * What Postgres actually does when two transactions reach the same key at once
 * cannot be proved here — that is scripts/verify-checkout-idempotency.mjs, which
 * needs a real server and a real database. What CAN be proved here is that the
 * code still has the shape those guarantees rest on, and every assertion below
 * is one that would have silently stopped being true under an innocent edit:
 *
 *   - the claim is the FIRST statement of the write batch. Move it after the
 *     stock decrements and it still works, but a losing duplicate then sits on
 *     product rows while it waits for a transaction it is going to lose to.
 *   - the claim conflicts and divides. Drop either half and a duplicate stops
 *     being refused.
 *   - the two sends live inside after(). Await one of them again and every
 *     checkout gets a Resend round trip back on its critical path.
 *   - the browser actually sends a key. Without it the server-side guard is
 *     dead code that nothing ever exercises.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = rel => readFileSync(`${ROOT}${rel}`, 'utf8');

const route = read('app/api/order/route.js');
const client = read('app/checkout/CheckoutClient.js');
const schema = read('db/schema.sql');

/* --------------------------------------------------------------- schema */

test('the schema declares order_attempts, and declares it idempotently', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS order_attempts \(/);
  assert.match(schema, /idem_key\s+TEXT PRIMARY KEY/);
  // JSON, not JSONB: JSONB would rewrite the text and reorder the keys, and a
  // reply that comes back reordered is no longer the reply that went out.
  assert.match(schema, /response\s+JSON NOT NULL/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_order_attempts_age/);
});

test('every statement added for order_attempts is safe to re-run', () => {
  // db/schema.sql is re-run by vercel-build on every deploy. A CREATE without
  // IF NOT EXISTS would fail the second build, which is the whole deploy.
  // Bounded to this table's own statements rather than running to end of file.
  // The first version sliced to EOF, which was true only while this block
  // happened to be last — and it stopped being last the moment two branches
  // both appended to this file, at which point an unrelated ALTER failed here.
  // A test that breaks when someone adds a paragraph after it is testing file
  // order, not re-runnability.
  const from = schema.indexOf('CREATE TABLE IF NOT EXISTS order_attempts');
  const purge = schema.indexOf('DELETE FROM order_attempts', from);
  const block = schema.slice(from, schema.indexOf(';', purge) + 1);
  for (const stmt of block.split(';').map(s => s.trim()).filter(Boolean)) {
    const head = stmt.split('\n').filter(l => !l.trim().startsWith('--')).join(' ').trim();
    if (!head) continue;
    assert.ok(
      /^CREATE TABLE IF NOT EXISTS/.test(head) ||
      /^CREATE INDEX IF NOT EXISTS/.test(head) ||
      /^DELETE FROM order_attempts WHERE created_at </.test(head),
      `not re-runnable: ${head.slice(0, 70)}`,
    );
  }
});

test('the deliberate DROP block was not extended', () => {
  // Those four drops exist to retire the customer-account tables. Anything new
  // arriving in that list is almost certainly an accident, and the accident is
  // expensive: schema.sql runs on every deploy, so a stray DROP is a table
  // emptied on every build.
  const drops = (schema.match(/^DROP TABLE IF EXISTS .*$/gm) || []).map(s => s.trim());
  assert.deepEqual(drops, [
    'DROP TABLE IF EXISTS cart_items;',
    'DROP TABLE IF EXISTS carts;',
    'DROP TABLE IF EXISTS sessions;',
    'DROP TABLE IF EXISTS users;',
  ]);
});

/* ---------------------------------------------------------------- route */

test('the order route claims the key before it writes anything else', () => {
  const claim = route.indexOf('INSERT INTO order_attempts');
  const order = route.indexOf('INSERT INTO orders');
  const items = route.indexOf('INSERT INTO order_items');
  const stock = route.indexOf('UPDATE products');

  assert.ok(claim > 0, 'the route does not claim an idempotency key at all');
  assert.ok(claim < order, 'the claim must come before the order INSERT');
  assert.ok(claim < items && claim < stock,
    'the claim must come before anything that takes a row lock');
});

test('the claim is a guarded write, not a check followed by a write', () => {
  const claim = route.slice(route.indexOf('INSERT INTO order_attempts'));
  assert.match(claim.slice(0, 400), /ON CONFLICT \(idem_key\) DO NOTHING/);
  // The house pattern: zero rows divides by zero and rolls the batch back.
  assert.match(claim.slice(0, 500), /SELECT 1 \/ count\(\*\)::int AS guard FROM claimed/);
});

test('a missing key degrades instead of refusing the order', () => {
  // An older tab has no key to send. Refusing those would stop the shop taking
  // orders from everyone who has not reloaded since the deploy.
  assert.match(route, /const idemKey = .*test\(rawKey\) \? rawKey : ''/);
  // Every use of the key is conditional on there being one.
  assert.match(route, /if \(idemKey\) \{/);
  assert.ok(!/idempotency_key.*\n.*return fail/.test(route),
    'the route refuses a request over its idempotency key');
});

test('a lost claim answers with the original reply, not with an error', () => {
  assert.match(route, /SELECT response FROM order_attempts WHERE idem_key/);
  const tail = route.slice(route.indexOf('if (!written)'));
  assert.match(tail, /writeErr\?\.code === '22012'/);
  assert.match(tail, /const lost = await replayed\(\);\n\s*if \(lost\) return lost;/);
  // And it has to be asked BEFORE the sold-out message, or a duplicate is told
  // its own order sold the last unit out from under it.
  assert.ok(tail.indexOf('if (lost) return lost;') < tail.indexOf('just sold out'));
});

test('the two order mails are sent after the response, not before it', () => {
  assert.match(route, /import \{ after \} from 'next\/server'/);
  const at = route.indexOf('after(async () =>');
  assert.ok(at > 0, 'the route does not defer anything with after()');
  for (const m of route.matchAll(/sendMail\(/g)) {
    assert.ok(m.index > at, 'a sendMail call is still on the response path');
  }
});

test('the reply is built once and both answers come from it', () => {
  // The stored copy and the live reply have to be the same object, or a retry
  // can be answered with something the first request never said.
  assert.match(route, /\$\{JSON\.stringify\(reply\)\}::json\)/);
  assert.match(route, /return ok\(reply\);/);
});

test('a refusal that a concurrent duplicate can cause asks the key first', () => {
  // The two checks a winning duplicate can flip under a loser: it takes the
  // stock, and it spends the last use of a capped code. Refusing on either
  // without asking the key tells a customer their order failed when their own
  // earlier request is what placed it.
  const guarded = [...route.matchAll(/return \(await replayed\(\)\) \?\? fail\(/g)];
  assert.equal(guarded.length, 2, 'the raceable refusals are not replay-checked');
  const stock = route.indexOf('in stock.');
  const spent = route.indexOf('has been fully used.');
  for (const at of [stock, spent]) {
    const before = route.lastIndexOf('return (await replayed()) ?? fail(', at);
    assert.ok(before > 0 && at - before < 400, 'this refusal is not replay-checked');
  }
});

/* --------------------------------------------------------------- client */

test('the checkout sends an idempotency key', () => {
  assert.match(client, /idempotency_key: attemptKey\(\)/);
});

test('the key survives a reload, and is dropped once the server has answered', () => {
  // localStorage, because the retry that matters is the one where the page did
  // not survive to hold a ref.
  assert.match(client, /localStorage\.setItem\(KEY_STORE/);
  assert.match(client, /localStorage\.removeItem\(KEY_STORE\)/);
  /*
   * Cleared on success, and on a refusal — but never on a network failure,
   * which is the one case where the order may exist and the reply be lost.
   *
   * Checked by ORDER rather than by adjacency. This used to assert the literal
   * `endAttempt();\n setDone(res)`, which pinned the right property to the
   * wrong evidence: the two being neighbours is not what makes this correct,
   * and the assertion broke the moment a third statement was added between them
   * on the same path. What has to hold is that the attempt is finished before
   * the success is committed, and that both happen after the server answered.
   */
  const answered = client.indexOf("await api('/api/order'");
  const ended = client.indexOf('endAttempt();', answered);
  const shown = client.indexOf('setDone(res)', answered);

  assert.ok(answered > 0, 'the order request has moved — this test needs updating');
  assert.ok(ended > answered, 'endAttempt() no longer runs on the success path');
  assert.ok(shown > ended,
    'setDone(res) now runs before endAttempt(), so a success can be shown with the attempt key still held');

  assert.match(client, /if \(e\.message !== NET\) endAttempt\(\)/);
});
