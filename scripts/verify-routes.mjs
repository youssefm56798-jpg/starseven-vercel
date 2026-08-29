#!/usr/bin/env node
/**
 * NEW STAR SEVEN — the HTTP routes, against a real server and a real Postgres.
 *
 *   npm run test:routes
 *
 * Why this is a script and not a test: `npm test` runs with no database, on
 * purpose, so it is fast and works on a fresh clone. That constraint bought
 * 860 unit tests and cost every endpoint — until this file, not one route in
 * app/api had ever been called over HTTP by anything but a browser. The
 * pricing, the phone parser and the state machine were all proven in isolation
 * while the things that only exist at the edge of the request — the honeypot,
 * the content-type guard, the origin check, the 413, the rate limiter actually
 * filling, the order of the validation branches, what two simultaneous
 * checkouts do to one unit of stock — were proven by nothing.
 *
 * So this starts a real Next server on a spare port, points it at a database it
 * created seconds earlier, and talks to it with fetch.
 *
 * It is safe to run with the production connection string in the environment,
 * because it does not use it. It creates its own database from db/schema.sql,
 * runs everything there, and drops it in a finally block — the same discipline
 * scripts/verify-order-status.mjs uses, and for the same reason.
 *
 * It also does something that script does not have to. That script owns its own
 * connection, so asserting current_database() is enough. Here the writes are
 * made by a SEPARATE PROCESS that reads DATABASE_URL for itself and also loads
 * .env.local on its own — which is where the production URL lives. Asserting
 * anything about this process's connection would prove nothing about that one.
 * So before a single test runs, the server is asked to prove which database it
 * is on: it must serve a canary SKU that exists only in the throwaway, and a
 * write made through it must land in the throwaway. If either probe fails the
 * run aborts, because the failure it is guarding against is a suite of
 * checkout, subscribe and refund tests firing at the live shop.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';
import { makeReport, makeClient, makeIps } from './routes/harness.mjs';
import { seed, makeOrderFactory, SKU, CODE } from './routes/fixtures.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

/* CREATE DATABASE is refused through a connection pooler, so this wants the
   direct endpoint, exactly as verify-order-status.mjs does. Neon supplies both. */
const adminUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('\n  ERROR  DATABASE_URL is not set. See .env.example.\n');
  process.exit(1);
}

const RUN = randomBytes(4).toString('hex');
const DB = `s7_routes_${RUN}`;

const { neon } = await import('@neondatabase/serverless');
const { sha256, newAccessToken } = await import('../lib/order-access.js');

/** Only ever creates and drops the throwaway database. */
const admin = neon(adminUrl);

const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${DB}`;
const db = neon(dbUrl.toString());

/* ------------------------------------------------------------------ port */

/**
 * A port the operating system just told us was free.
 *
 * Not 3000. The default port is routinely already taken by the developer's own
 * `npm run dev`, and a suite that quietly talked to THAT server would be
 * testing whatever database that server is pointed at — which is the one thing
 * this file exists not to do. Asking for port 0 and reading back what we were
 * given makes the choice the kernel's rather than a guess.
 */
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/* --------------------------------------------------------------- server */

let child = null;
const serverLog = [];

/**
 * Stops the dev server.
 *
 * `next dev` is a supervisor: it forks a worker that holds the port, so killing
 * the pid we spawned leaves the worker running and the port bound. On Windows
 * taskkill /T walks the tree; elsewhere the process group does the same job,
 * which is what `detached` is for.
 */
function stopServer() {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch { /* already gone */ }
}

async function startServer(port) {
  const bin = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(bin)) throw new Error('next is not installed. Run `npm install` first.');

  child = spawn(process.execPath, [bin, 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // The whole point. Everything the server writes goes here.
      DATABASE_URL: dbUrl.toString(),
      DATABASE_URL_UNPOOLED: dbUrl.toString(),
      // The refund route's origin check compares against this, so it has to be
      // the address the suite is actually calling — otherwise every request
      // looks cross-site and the only thing that route can be tested for is 403.
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
      // No key means lib/mail.js never constructs a Resend client and every
      // send fails fast and locally. Mail is best-effort in every route that
      // sends any, so this exercises the failure path the routes claim to
      // tolerate, and guarantees the suite cannot mail a real person.
      RESEND_API_KEY: '',
      ORDER_NOTIFY_TO: 'ops@example.invalid',
      SHIPPING_FEE: '30',
      FREE_DELIVERY_OVER: '300',
    },
  });

  const keep = buf => {
    serverLog.push(String(buf));
    if (serverLog.length > 200) serverLog.shift();
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  let exited = null;
  child.on('exit', code => { exited = code; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 180_000;

  // A dev server compiles a route the first time it is asked for one, so the
  // first response can be half a minute away on a cold .next directory. Any
  // response at all means it is listening; whether the answer is right is what
  // the probes below are for.
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`next dev exited with code ${exited}\n${serverLog.join('')}`);
    }
    try {
      await fetch(`${base}/api/products`, { signal: AbortSignal.timeout(20_000) });
      return base;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`next dev did not answer within 180s\n${serverLog.join('')}`);
}

/* ------------------------------------------------------------------ main */

console.log(`\n  New Star Seven — API routes over HTTP`);
console.log(`  throwaway database: ${DB}`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

const report = makeReport();
let aborted = null;

try {
  /* --------------------------------------------------------------- guards */

  const [{ d }] = await db`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);

  const [{ t }] = await db`SELECT to_regclass('orders')::text AS t`;
  if (t !== null) throw new Error(`"orders" already resolves to ${t}. Aborting.`);

  console.log(`  guard: current_database() = ${d}, and it is empty`);

  /* --------------------------------------------------------------- schema */

  // The real file, not a hand-written subset. A route that depends on a CHECK
  // constraint or a partial unique index — and /api/order depends on both — is
  // only tested if the constraints are the ones production has.
  const statements = splitStatements(readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8'));
  for (const stmt of statements) await db(stmt);
  console.log(`  applied db/schema.sql — ${statements.length} statement(s)`);

  const canary = await seed(db, RUN);
  const makeOrder = makeOrderFactory(db, sha256, newAccessToken);
  console.log(`  seeded the fixture catalogue`);

  /* --------------------------------------------------------------- server */

  const port = await freePort();
  const base = await startServer(port);
  console.log(`  next dev on ${base}`);

  try {
    const api = makeClient(base);
    const ip = makeIps();

    /* ------------------------------------------------------------- probes */

    // Read probe. The canary SKU was created a moment ago in a database that
    // did not exist a minute ago, so no other Postgres on earth has it.
    const probeRead = await api('/api/products', { ip: ip('probe') });
    if (probeRead.status !== 200 || !probeRead.text.includes(canary)) {
      throw new Error(
        `the server is not serving the throwaway database.\n` +
        `  GET /api/products answered ${probeRead.status} and did not contain ${canary}.\n` +
        `  Refusing to run: the next thing this suite does is write orders.`);
    }

    // Write probe. Reads and writes could in principle go to different places,
    // and it is the writes that would be unforgivable. /api/quiz is the
    // cheapest route that writes a row of its own.
    const stamp = `rt${RUN}`;
    await api('/api/quiz', {
      method: 'POST', ip: ip('probe'),
      json: { hair_type: 'straight', concern: stamp },
    });
    const landed = await db`SELECT count(*)::int AS n FROM quiz_results WHERE concern = ${stamp}`;
    if (Number(landed[0]?.n) !== 1) {
      throw new Error(
        `a write made through the server did not land in ${DB}.\n` +
        `  Refusing to run: the writes are going somewhere this script cannot see.`);
    }
    console.log(`  probe: the server reads and writes ${DB}\n`);

    /* ------------------------------------------------------------ warm-up */

    // Every route compiled once, on a bucket no case uses. Without this the
    // first request to a route carries several seconds of dev-server
    // compilation, which would swamp the subscribe timing comparison and make
    // it measure webpack rather than the endpoint.
    const warm = ip('warm-up');
    await Promise.all([
      api('/api/quiz', { method: 'POST', ip: warm, json: { hair_type: 'nope' } }),
      api('/api/coupon', { method: 'POST', ip: warm, json: {} }),
      api('/api/subscribe', { method: 'POST', ip: warm, json: { email: 'not-an-email' } }),
      api('/api/order', { method: 'POST', ip: warm, json: {} }),
      api('/api/order/refund', { method: 'POST', ip: warm, json: {}, headers: { origin: 'https://evil.example' } }),
      api('/api/confirm?t=nope', { ip: warm }),
      api('/api/unsubscribe?t=nope', { ip: warm }),
    ]);

    /* -------------------------------------------------------------- cases */

    const ctx = { db, api, ip, ...report, makeOrder, canary, base, SKU, CODE, sha256, newAccessToken };

    // Named on the command line, one or more case files run alone. Useful while
    // writing one of them: a full pass starts a dev server and talks to a
    // remote Postgres a few hundred times, which is not a loop anyone iterates
    // on. `npm run test:routes -- refund` is.
    const all = [
      'headers', 'products', 'quiz', 'coupon',
      'subscribe', 'confirm', 'unsubscribe', 'order', 'refund',
    ];
    const asked = process.argv.slice(2).filter(a => !a.startsWith('-'));
    const unknown = asked.filter(a => !all.includes(a));
    if (unknown.length) throw new Error(`no such case file: ${unknown.join(', ')}`);

    for (const name of (asked.length ? asked : all)) {
      const { default: run } = await import(`./routes/${name}.mjs`);
      await run(ctx);
    }
  } finally {
    stopServer();
  }
} catch (e) {
  aborted = e;
} finally {
  stopServer();
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

if (aborted) {
  console.error(`\n  ABORTED  ${aborted.message}\n`);
  process.exit(1);
}

const { checks, failures } = report.state;
console.log(failures
  ? `\n  ${failures} FAILURE(S) out of ${checks} checks\n`
  : `\n  all ${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
