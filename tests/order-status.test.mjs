import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STATUSES,
  LEGAL,
  nextFrom,
  canMove,
  transition,
  logEvent,
} from '../lib/order-status.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const schema = readFileSync(join(ROOT, 'db/schema.sql'), 'utf8');

/**
 * These run without a database on purpose.
 *
 * The transition table is the part of the order system that is expensive to be
 * wrong about — a bad edge credits stock that was never returned, or lets a
 * delivered order be cancelled — and it is also the part most likely to be
 * edited by someone adding a status later. Every assertion below is about the
 * shape of the graph rather than about any one move, so an edge added in the
 * wrong place fails here rather than in production.
 *
 * transition() itself reaches the database, so only its input validation is
 * exercised: those branches return before a query is built.
 */

/* ------------------------------------------------------------ the table */

test('every status in the table is a known status', () => {
  assert.deepEqual(Object.keys(LEGAL).sort(), [...STATUSES].sort());
});

test('every destination in the table is a known status', () => {
  for (const [from, targets] of Object.entries(LEGAL)) {
    for (const to of targets) {
      assert.ok(STATUSES.includes(to), `${from} -> ${to} is not a real status`);
    }
  }
});

test('no status lists itself as a move', () => {
  // A self-loop would make cancelled -> cancelled legal, and that credits the
  // stock a second time. Same-status saves are handled inside transition() by
  // widening the source list, never by an edge in this table.
  for (const [from, targets] of Object.entries(LEGAL)) {
    assert.ok(!targets.includes(from), `${from} loops back to itself`);
  }
});

test('no status is listed twice as a destination', () => {
  for (const [from, targets] of Object.entries(LEGAL)) {
    assert.equal(new Set(targets).size, targets.length, `${from} has a duplicate edge`);
  }
});

/* ----------------------------------------------------------- the shape */

/** Every status reachable from `start` in one or more moves. */
function reachable(start) {
  const out = new Set();
  const queue = [...(LEGAL[start] ?? [])];
  while (queue.length) {
    const s = queue.shift();
    if (out.has(s)) continue;
    out.add(s);
    queue.push(...(LEGAL[s] ?? []));
  }
  return out;
}

test('delivered is terminal, in one move and in any number of them', () => {
  // The one-hop assertion is the rule; the reachability assertion is the hole
  // it exists to close. delivered -> shipped looks harmless on its own, and
  // then shipped -> cancelled restocks a delivered order in two moves.
  assert.deepEqual(LEGAL.delivered, []);
  assert.equal(reachable('delivered').size, 0);
});

test('cancelled is terminal, in one move and in any number of them', () => {
  assert.deepEqual(LEGAL.cancelled, []);
  assert.equal(reachable('cancelled').size, 0);
});

test('cancelled cannot be re-entered from cancelled by any path', () => {
  // This is the double-restock invariant stated directly.
  assert.ok(!reachable('cancelled').has('cancelled'));
});

test('an order can always still be cancelled while it is in flight', () => {
  for (const s of ['new', 'confirmed', 'shipped']) {
    assert.ok(canMove(s, 'cancelled'), `${s} cannot be cancelled`);
  }
});

test('the three in-flight statuses move freely between each other', () => {
  const flight = ['new', 'confirmed', 'shipped'];
  for (const a of flight) {
    for (const b of flight) {
      if (a === b) continue;
      assert.ok(canMove(a, b), `${a} -> ${b} should be allowed`);
    }
  }
});

test('every non-terminal status can reach delivered', () => {
  for (const s of ['new', 'confirmed', 'shipped']) {
    assert.ok(reachable(s).has('delivered'), `${s} cannot reach delivered`);
  }
});

/* -------------------------------------------------------------- helpers */

test('nextFrom answers for a status it does not know', () => {
  assert.deepEqual(nextFrom('nonsense'), []);
  assert.deepEqual(nextFrom(''), []);
  assert.deepEqual(nextFrom(undefined), []);
});

test('canMove refuses anything not in the table', () => {
  assert.equal(canMove('new', 'nonsense'), false);
  assert.equal(canMove('nonsense', 'new'), false);
  assert.equal(canMove('delivered', 'cancelled'), false);
  assert.equal(canMove('cancelled', 'new'), false);
});

/* ---------------------------------------------- input validation, no db */

test('transition refuses an id that is not a positive integer', async () => {
  for (const bad of [0, -1, 1.5, NaN, null, undefined, '', 'abc', {}]) {
    const res = await transition({ orderId: bad, to: 'confirmed' });
    assert.deepEqual(res, { ok: false, reason: 'bad-input' }, `accepted id ${String(bad)}`);
  }
});

test('transition refuses a status it does not know', async () => {
  for (const bad of ['', 'nonsense', 'NEW', null, undefined, 0]) {
    const res = await transition({ orderId: 1, to: bad });
    assert.deepEqual(res, { ok: false, reason: 'bad-input' }, `accepted status ${String(bad)}`);
  }
});

test('a numeric string id is accepted, because a form field is a string', async () => {
  // Not asserting success — that needs a database. Asserting only that it did
  // not stop at the input check, which is what a strict typeof test would do
  // and would break every caller that reads an id out of a form.
  await assert.rejects(
    () => transition({ orderId: '12', to: 'confirmed' }),
    err => !/bad-input/.test(String(err?.message)),
  );
});

test('logEvent refuses a kind that is not in the schema check', async () => {
  for (const bad of ['status', 'nonsense', '', null, undefined]) {
    assert.equal(await logEvent({ orderId: 1, kind: bad }), false, `accepted kind ${String(bad)}`);
  }
});

test('logEvent refuses a bad id before it reaches the database', async () => {
  for (const bad of [0, -1, 1.5, NaN, null, 'abc']) {
    assert.equal(await logEvent({ orderId: bad, kind: 'note' }), false);
  }
});

/* ------------------------------------------------------------- schema */

test('schema.sql creates order_events', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS order_events/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_order_events_order/);
});

test('schema.sql adds orders.cancelled_at idempotently', () => {
  assert.match(schema, /ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ/);
});

test('nothing in schema.sql drops order_events', () => {
  // db:setup re-runs this whole file on every deploy, so a DROP anywhere in it
  // is a deploy that wipes the audit log. The file already carries a block of
  // deliberate DROPs for the removed accounts tables; this makes sure the
  // timeline never joins them.
  assert.doesNotMatch(schema, /DROP TABLE[^;]*order_events/i);
  assert.doesNotMatch(schema, /orders DROP COLUMN[^;]*cancelled_at/i);
});

test('the order_events kind check covers every kind the code writes', () => {
  // logEvent and transition between them write these four. A kind the CHECK
  // does not list is a constraint violation at runtime, not at review time.
  const [, list] = schema.match(/kind\s+TEXT NOT NULL DEFAULT 'status'\s*\n?\s*CHECK \(kind IN \(([^)]*)\)\)/) || [];
  assert.ok(list, 'could not find the kind CHECK constraint');
  const allowed = list.split(',').map(s => s.trim().replace(/'/g, ''));
  for (const kind of ['status', 'note', 'refund-request', 'mail']) {
    assert.ok(allowed.includes(kind), `${kind} is written by the code but not allowed by the schema`);
  }
});

/* ------------------------------------------------- one writer, in fact */

test('nothing outside lib/order-status.js writes orders.status', async () => {
  // The whole point of the module. An UPDATE that sets the column anywhere else
  // has its own opinion about legal moves and its own side effects, which is
  // the shape the atomicity bug had in the first place.
  const { execFileSync } = await import('node:child_process');
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-n', '-E', 'UPDATE orders[^;]*SET[^;]*status', '--', 'app', 'lib'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    // git grep exits 1 when there are no matches, which is the passing case.
    return;
  }

  const offenders = hits
    .split('\n')
    .filter(Boolean)
    .filter(l => !l.startsWith('lib/order-status.js:'));

  assert.deepEqual(offenders, [], `orders.status is written outside the state machine:\n${offenders.join('\n')}`);
});

test('nothing under app/ imports transition directly', async () => {
  // transition() moves the order and says nothing. transitionAndNotify() moves
  // it and mails the customer. A route that reaches past the wrapper compiles,
  // passes every other test, and silently stops telling anyone their order
  // shipped — which is the failure this whole step exists to fix, so it has to
  // fail here rather than in somebody's inbox.
  const { execFileSync } = await import('node:child_process');
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-n', '-E', 'import[^;]*\\btransition\\b[^;]*order-status', '--', 'app'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return; // no matches
  }

  const offenders = hits.split('\n').filter(Boolean);
  assert.deepEqual(
    offenders, [],
    `app/ must import transitionAndNotify from lib/order-notify.js, not transition:\n${offenders.join('\n')}`,
  );
});
