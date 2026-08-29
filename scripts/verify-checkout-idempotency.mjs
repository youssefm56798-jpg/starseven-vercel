#!/usr/bin/env node
/**
 * NEW STAR SEVEN — checkout idempotency, against a real Postgres and a real
 * server.
 *
 *   npm run verify:checkout
 *
 * Why this is a script and not a test: everything under tests/ runs with no
 * database, on purpose. But the whole of the double-submit guard lives in one
 * statement — an INSERT ... ON CONFLICT DO NOTHING whose behaviour under a
 * CONCURRENT duplicate is the entire point — and no amount of mocking proves
 * what Postgres does when two transactions reach that row at the same instant.
 *
 * Nor does a sequential test. This repository has already been bitten once by
 * exactly that: the order state machine had a guard that passed every
 * back-to-back test while two overlapping cancels credited the stock twice.
 * So the interesting checks here fire their requests TOGETHER and never one
 * after the other, and one of them removes the key from the same burst to show
 * the burst really does overlap — without a key, the same three simultaneous
 * requests produce three orders.
 *
 * It is safe to run against the production connection string, because it does
 * not use it. It creates its own database, runs the real schema into it, starts
 * a real Next server pointed at it, and drops the database in a finally block.
 * Two guards run before the first write:
 *
 *   - current_database() must be the throwaway one and `orders` must resolve to
 *     nothing, the same guard scripts/verify-order-status.mjs uses.
 *   - the SERVER must agree. Next loads .env.local by itself, and an env file
 *     that quietly won over the injected DATABASE_URL would point the requests
 *     at production while every direct query in here looked correct. So the
 *     catalogue is read back THROUGH the server and has to contain exactly the
 *     two throwaway rows and nothing else. Production has thirty-odd products;
 *     if any of them appear, this aborts before a single POST goes out.
 */

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

/* CREATE DATABASE is refused through a connection pooler, so this wants the
   direct endpoint. Neon supplies both. */
const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!base) {
  console.error('\n  ERROR  DATABASE_URL is not set. See .env.example.\n');
  process.exit(1);
}

const TAG = randomBytes(4).toString('hex');
const DB = `s7_idem_${TAG}`;
const PORT = 3200 + (parseInt(TAG.slice(0, 3), 16) % 600);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const SKU = `IDEM-${TAG.toUpperCase()}`;
const SKU2 = `IDEM2-${TAG.toUpperCase()}`;
const CODE = `IDEM${TAG.toUpperCase()}`;
const STOCK = 500;

const { neon } = await import('@neondatabase/serverless');

/** Only ever creates and drops the throwaway database. */
const admin = neon(base);

/** Everything under test runs here. */
const url = new URL(base);
url.pathname = `/${DB}`;
const dbUrl = url.toString();
const db = neon(dbUrl);

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  console.log(`          want ${JSON.stringify(want)}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ state */

const orderCount = async () => Number((await db`SELECT count(*)::int AS n FROM orders`)[0].n);
const attemptCount = async () => Number((await db`SELECT count(*)::int AS n FROM order_attempts`)[0].n);
const stockOf = async sku =>
  Number((await db`SELECT stock FROM products WHERE sku = ${sku}`)[0]?.stock);
const usesOf = async code =>
  Number((await db`SELECT used_count FROM offers WHERE code = ${code}`)[0]?.used_count);

/** Back to a clean slate between phases, including the rate-limit window. */
async function reset() {
  await db`TRUNCATE order_items, order_events, orders, order_attempts, email_log RESTART IDENTITY CASCADE`;
  await db`DELETE FROM rate_limits`;
  await db`UPDATE products SET stock = ${STOCK} WHERE sku IN (${SKU}, ${SKU2})`;
  await db`UPDATE offers SET used_count = 0 WHERE code = ${CODE}`;
}

/* ----------------------------------------------------------------- client */

const newKey = () => `${TAG}-${randomBytes(12).toString('hex')}`;

function orderBody({ key, coupon = '', qty = 2, sku = SKU }) {
  const body = {
    name: 'Verify Customer',
    phone: '01012345678',
    address: '12 Verification Street, Cairo',
    city: 'Cairo',
    email: 'verify@example.com',
    notes: '',
    coupon,
    consent: 0,
    lang: 'en',
    items: [{ sku, qty }],
  };
  // An absent key is absent, not empty — that is the older-client case.
  if (key) body.idempotency_key = key;
  return body;
}

async function postOrder(body) {
  const res = await fetch(`${ORIGIN}/api/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON, which check() will show */ }
  return { status: res.status, data };
}

/**
 * n requests started in the same tick, so they are genuinely in flight
 * together. Nothing is awaited between the calls — that is the whole point.
 */
const burst = (n, makeBody) =>
  Promise.all(Array.from({ length: n }, (_, i) => postOrder(makeBody(i))));

/* ------------------------------------------------------------------ server */

let server = null;
let serverLog = '';

function startServer() {
  const bin = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  server = spawn(process.execPath, [bin, 'dev', '-p', String(PORT)], {
    cwd: ROOT,
    // DATABASE_URL is injected here and @next/env leaves an inherited value
    // alone, so .env.local cannot take it back. The catalogue guard below is
    // what proves that actually happened rather than assuming it.
    // ORDER_NOTIFY_TO is set so BOTH sends happen — the admin copy is skipped
    // when it is empty, and half the deferred work would go unproven.
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      DATABASE_URL_UNPOOLED: dbUrl,
      ORDER_NOTIFY_TO: 'verify-admin@example.invalid',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = d => { serverLog = (serverLog + d.toString()).slice(-4000); };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  // next dev runs a render worker of its own, so kill the tree, not the parent.
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
  }
}

async function waitForServer(ms = 180000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`next dev exited (${server.exitCode})\n${serverLog}`);
    try {
      const res = await fetch(`${ORIGIN}/api/products`);
      if (res.ok) return res.json();
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  throw new Error(`server did not answer on ${ORIGIN} in ${ms}ms\n${serverLog}`);
}

/* -------------------------------------------------------------------- run */

console.log(`\n  New Star Seven — checkout idempotency`);
console.log(`  throwaway database: ${DB}`);
console.log(`  server: ${ORIGIN}`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  /* --------------------------------------------------------------- guards */

  const [{ d }] = await db`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);

  const [{ t }] = await db`SELECT to_regclass('orders')::text AS t`;
  if (t !== null) throw new Error(`"orders" already resolves to ${t}. Aborting.`);

  console.log(`  guard: current_database() = ${d}, and it is empty`);

  /* ------------------------------------------------- the real schema, verbatim */

  const schema = splitStatements(readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8'));
  for (const stmt of schema) await db(stmt);
  console.log(`  db/schema.sql applied — ${schema.length} statement(s)`);

  await db`
    INSERT INTO products (sku, slug, name_ar, name_en, price, image, stock, active)
    VALUES (${SKU},  ${`idem-${TAG}`},  'منتج اختبار', 'Verify Product', 100, 'x.webp', ${STOCK}, true),
           (${SKU2}, ${`idem2-${TAG}`}, 'منتج اختبار', 'Verify Product 2', 100, 'x.webp', ${STOCK}, true)`;

  // max_uses = 1, so a coupon spent twice is visible as loudly as stock taken
  // twice: the second spend can only happen if the second order happened.
  await db`
    INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, max_uses, used_count)
    VALUES ('اختبار', 'اختبار', ${CODE}, 'percent', 10, 1, 0)`;

  startServer();
  const catalogue = await waitForServer();

  /* The second guard, and the important one: does the SERVER see this database? */
  const skus = (catalogue.products || []).map(p => p.sku).sort();
  if (!same(skus, [SKU, SKU2].sort())) {
    throw new Error(
      `the server is NOT on the throwaway database — /api/products returned ` +
      `${skus.length} product(s): ${skus.slice(0, 5).join(', ')}. Aborting before any write.`,
    );
  }
  console.log(`  guard: the server reads ${skus.length} product(s), both of them ours\n`);

  // Compile the route before anything is timed or raced, so the first burst is
  // not measuring webpack.
  await postOrder({});
  await reset();

  /* ------------------------------------------------------------------ 1 */

  console.log('  one order, with a key');
  {
    const key = newKey();
    const { status, data } = await postOrder(orderBody({ key, coupon: CODE }));
    check('200 ok', [status, data?.ok], [200, true]);
    check('has a reference', /^S7-\d{4}-\d{4}$/.test(data?.ref || ''), true);
    check('one order', await orderCount(), 1);
    check('one claimed key', await attemptCount(), 1);
    check('stock taken once', await stockOf(SKU), STOCK - 2);
    check('coupon spent once', await usesOf(CODE), 1);

    /* ---------------------------------------------------------------- 2 */

    console.log('\n  the same key again, sequentially (a replayed POST)');
    const again = await postOrder(orderBody({ key, coupon: CODE }));
    check('200 ok', [again.status, again.data?.ok], [200, true]);
    check('the SAME reference comes back', again.data?.ref, data?.ref);
    check('the whole reply is identical', again.data, data);
    check('still one order', await orderCount(), 1);
    check('stock not taken again', await stockOf(SKU), STOCK - 2);
    check('coupon not spent again', await usesOf(CODE), 1);
  }

  /* ------------------------------------------------------------------ 3 */

  console.log('\n  two requests landing at once with the same key (the double-tap)');
  for (let round = 1; round <= 5; round++) {
    await reset();
    const key = newKey();
    const results = await burst(2, () => orderBody({ key, coupon: CODE }));
    const refs = [...new Set(results.map(r => r.data?.ref))];

    check(`round ${round}: both answered 200`, results.map(r => r.status), [200, 200]);
    check(`round ${round}: both got the same reference`, refs.length, 1);
    check(`round ${round}: EXACTLY ONE order exists`, await orderCount(), 1);
    check(`round ${round}: stock taken exactly once`, await stockOf(SKU), STOCK - 2);
    check(`round ${round}: coupon spent exactly once`, await usesOf(CODE), 1);
    check(`round ${round}: one claimed key`, await attemptCount(), 1);
  }

  /* ------------------------------------------------------------------ 4 */

  console.log('\n  five requests landing at once with the same key');
  {
    // Five is not just more of the same. With a single-use code, the ones that
    // arrive slightly later read the offer AFTER the winner has spent it, and
    // are refused by the courteous coupon check long before they reach the
    // claim. That refusal has to be replayed as the original confirmation, not
    // returned as "that code has been fully used" - the code was finished by
    // their own order. This burst is the only thing that exercises it, and it
    // caught the route doing exactly the wrong thing.
    await reset();
    const key = newKey();
    const results = await burst(5, () => orderBody({ key, coupon: CODE }));
    check('all five answered 200', results.map(r => r.status), [200, 200, 200, 200, 200]);
    check('all five got the same reference', new Set(results.map(r => r.data?.ref)).size, 1);
    check('all five got the same reply, byte for byte',
      new Set(results.map(r => JSON.stringify(r.data))).size, 1);
    check('EXACTLY ONE order exists', await orderCount(), 1);
    check('stock taken exactly once', await stockOf(SKU), STOCK - 2);
    check('coupon spent exactly once', await usesOf(CODE), 1);
    check('one claimed key', await attemptCount(), 1);
  }

  /* ------------------------------------------------------------------ 5 */

  console.log('\n  the control: the same burst with NO key');
  {
    // This is what makes the checks above mean something. Same harness, same
    // three simultaneous requests, key removed - and three orders land. So the
    // burst really does overlap, and it really is the key that collapses it.
    // No coupon here: a capped code would refuse two of the three for its own
    // reasons and hide the result.
    await reset();
    const results = await burst(3, () => orderBody({ key: '' }));
    check('all three answered 200', results.map(r => r.status), [200, 200, 200]);
    check('three DIFFERENT references', new Set(results.map(r => r.data?.ref)).size, 3);
    check('three orders — the old behaviour, unchanged for older clients', await orderCount(), 3);
    check('stock taken three times', await stockOf(SKU), STOCK - 6);
    check('nothing claimed', await attemptCount(), 0);
  }

  /* ------------------------------------------------------------------ 6 */

  console.log('\n  two requests at once with DIFFERENT keys are two real orders');
  {
    await reset();
    const results = await burst(2, () => orderBody({ key: newKey() }));
    check('two orders', await orderCount(), 2);
    check('two different references', new Set(results.map(r => r.data?.ref)).size, 2);
    check('stock taken twice', await stockOf(SKU), STOCK - 4);
  }

  /* ------------------------------------------------------------------ 7 */

  console.log('\n  a key that is not a plausible key degrades, it does not refuse');
  {
    await reset();
    const { status, data } = await postOrder({ ...orderBody({ key: '' }), idempotency_key: 'x' });
    check('200 ok', [status, data?.ok], [200, true]);
    check('the order was placed', await orderCount(), 1);
    check('and nothing was claimed', await attemptCount(), 0);
  }

  /* ------------------------------------------------------------------ 8 */

  console.log('\n  the confirmation mail is sent after the response, not before it');
  {
    await reset();
    const started = Date.now();
    const { status } = await postOrder(orderBody({ key: newKey() }));
    const responded = Date.now() - started;

    // RESEND_API_KEY is not set here, so both sends fail fast and land in
    // email_log as failures. That they land AT ALL is the proof that after()
    // ran; that the response did not wait for them is what the change is for.
    const mailCount = async () => Number((await db`SELECT count(*)::int AS n FROM email_log`)[0].n);
    const atReply = await mailCount();

    let logged = atReply;
    for (let i = 0; i < 40 && logged < 2; i++) {
      await sleep(250);
      logged = await mailCount();
    }
    check('the order was placed', status, 200);
    check('both mails were attempted, and only after the reply', logged, 2);
    // Not an assertion: the first read is itself a round trip to Neon, so it
    // can lose a race it is not meant to be in. Printed because it is the
    // number that shows the sends are off the response path.
    console.log(`          (reply in ${responded}ms, ${atReply} of ${logged} mails logged by then)`);
  }

} catch (e) {
  failures++;
  console.log(`\n    FAIL  ${e?.message || e}`);
} finally {
  stopServer();
  // FORCE terminates anything still attached. The HTTP driver holds no
  // persistent connection, so this is belt and braces.
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  all checks passed\n');
process.exit(failures ? 1 : 0);
