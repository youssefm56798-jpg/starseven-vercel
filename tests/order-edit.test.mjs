import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EDITABLE,
  MAX_QTY,
  MAX_LINES,
  canEdit,
  describeEdit,
  editOrder,
} from '../lib/order-edit.js';
import { STATUSES, LEGAL, SELF_CANCELLABLE, canMove } from '../lib/order-status.js';
import { tplOrderEdited } from '../lib/order-mail.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const schema = read('db/schema.sql');
const module_ = read('lib/order-edit.js');
/** The same file with its comments taken out, for asserting about the code. */
const code = module_.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const notify = read('lib/order-notify.js');
const panel = read('app/admin/(panel)/orders/[id]/page.js');

/**
 * These run without a database, like everything else under tests/.
 *
 * lib/order-edit.js is mostly SQL and the statements are proved against a real
 * Postgres by scripts/verify-order-edit.mjs — including the concurrent cases,
 * which are the ones that have caught real bugs in this repository three times.
 * What is provable here is the half that is not SQL: the policy table, the
 * arithmetic that decides what the statements will say, and a set of source
 * assertions for the rules a running database cannot check — that the edit
 * never writes the status column, that every admin mutation is guarded, and
 * that an edit event never reaches the customer.
 */

/* -------------------------------------------------------- the policy table */

test('every editable status is a real status', () => {
  for (const s of EDITABLE) assert.ok(STATUSES.includes(s), `${s} is not a real status`);
});

test('an order can only be edited while it is still in the shop', () => {
  // The physical rule. Past `shipped` a real person is carrying a real parcel
  // whose contents and collection amount are already fixed on a waybill.
  for (const s of ['shipped', 'delivered', 'cancelled']) {
    assert.equal(canEdit(s), false, `${s} is editable`);
  }
  for (const s of ['new', 'confirmed']) assert.equal(canEdit(s), true, `${s} is not editable`);
});

test('canEdit refuses anything it does not recognise', () => {
  for (const bad of ['', 'nonsense', 'NEW', null, undefined, 0]) {
    assert.equal(canEdit(bad), false, `accepted ${String(bad)}`);
  }
});

test('editable is narrower than the transition table, and stays that way', () => {
  /*
   * The same relationship SELF_CANCELLABLE has to LEGAL, and the same reason
   * for asserting it: these are different questions, and the day they become
   * the same set is the day somebody has collapsed them. Every status the
   * machine can move OUT of is not a status whose contents may be rewritten —
   * shipped can still be moved, and must never be edited.
   */
  const movable = STATUSES.filter(s => (LEGAL[s] ?? []).length > 0);
  assert.ok(EDITABLE.length < movable.length,
    'every movable status is now editable — the shipped guard is gone');
  assert.ok(!EDITABLE.includes('shipped'), 'a shipped parcel can be edited');
});

test('a terminal status is never editable', () => {
  for (const s of STATUSES) {
    if ((LEGAL[s] ?? []).length === 0) assert.equal(canEdit(s), false, `${s} is terminal but editable`);
  }
});

test('anything a customer may cancel alone, the shop may still edit', () => {
  // Not a coincidence worth leaving to chance: both lists are about an order
  // that has not left the building. If a customer can still call the whole
  // thing off, the shop can still change one line of it.
  for (const s of SELF_CANCELLABLE) {
    assert.equal(canEdit(s), true, `${s} can be cancelled by the customer but not edited by the shop`);
    assert.ok(canMove(s, 'cancelled'));
  }
});

test('the ceilings are sane', () => {
  // MAX_QTY is the one checkout enforces; an edit that could go past it would
  // be a way around the cart.
  assert.equal(MAX_QTY, 20);
  assert.ok(MAX_LINES > 1 && MAX_LINES <= 50);
});

/* ------------------------------------------------ input validation, no db */

test('editOrder refuses an id that is not a positive integer', async () => {
  for (const bad of [0, -1, 1.5, NaN, null, undefined, '', 'abc', {}]) {
    const res = await editOrder({ orderId: bad });
    assert.deepEqual(res, { ok: false, reason: 'bad-input' }, `accepted id ${String(bad)}`);
  }
});

test('editOrder refuses line and add arguments that are not lists', async () => {
  for (const bad of ['', 'abc', 1, {}, null]) {
    assert.deepEqual(await editOrder({ orderId: 1, lines: bad }), { ok: false, reason: 'bad-input' });
    assert.deepEqual(await editOrder({ orderId: 1, add: bad }), { ok: false, reason: 'bad-input' });
  }
});

test('a numeric string id is accepted, because a form field is a string', async () => {
  // Not asserting success — that needs a database. Asserting only that it did
  // not stop at the input check, which is what a strict typeof test would do
  // and would break every caller that reads an id out of a form.
  await assert.rejects(
    () => editOrder({ orderId: '12' }),
    err => !/bad-input/.test(String(err?.message)),
  );
});

/* -------------------------------------------------------- the audit note */

const line = (key, name, qty, price = 100) => ({ key, name, qty, price });
const state = (items, over = {}) => ({
  items,
  subtotal: items.reduce((s, i) => s + i.price * i.qty, 0),
  discount: 0,
  shipping: 30,
  total: items.reduce((s, i) => s + i.price * i.qty, 0) + 30,
  coupon: '',
  phone: '01028282216',
  address: 'a real looking address 12',
  city: 'Cairo',
  notes: '',
  ...over,
});

test('an edit that changed nothing describes nothing', () => {
  // The empty string is load-bearing: editOrder treats it as "no change" and
  // returns before it writes anything, so an admin pressing Save on an
  // untouched form does not bump the sequence or email the customer.
  const s = state([line('row:1', 'Red Wax', 2)]);
  assert.equal(describeEdit(s, s), '');
});

test('a quantity change names the line and both numbers', () => {
  const before = state([line('row:1', 'Red Wax', 1)]);
  const after = state([line('row:1', 'Red Wax', 3)]);
  const note = describeEdit(before, after);
  assert.match(note, /Red Wax x1 to x3/);
  assert.match(note, /total 130\.00 to 330\.00/);
});

test('an addition and a removal are both named, with the quantity', () => {
  const before = state([line('row:1', 'Red Wax', 1), line('row:2', 'Blue Gel', 2, 60)]);
  const after = state([line('row:1', 'Red Wax', 1), line('sku:S7-X', 'Black Wax', 1, 90)]);
  const note = describeEdit(before, after);
  assert.match(note, /\+ Black Wax x1 at 90\.00/);
  assert.match(note, /- Blue Gel x2 removed/);
});

test('the note carries both sides of an address, not just the new one', () => {
  // "the address is wrong" is the second most common sentence on the call, and
  // six weeks later the question is what it used to say.
  const before = state([line('row:1', 'Red Wax', 1)]);
  const after = state([line('row:1', 'Red Wax', 1)], { address: 'somewhere else 44' });
  assert.match(describeEdit(before, after), /address: "a real looking address 12" to "somewhere else 44"/);
});

test('a coupon coming and going both read as words, never as blanks', () => {
  const items = [line('row:1', 'Red Wax', 1)];
  assert.match(describeEdit(state(items), state(items, { coupon: 'SAVE10' })), /coupon none to SAVE10/);
  assert.match(describeEdit(state(items, { coupon: 'SAVE10' }), state(items)), /coupon SAVE10 to none/);
});

test('the note cannot grow without limit', () => {
  // It is read by a human in a list, and the note column is unbounded TEXT.
  const many = n => Array.from({ length: n }, (_, i) => line(`row:${i}`, `A very long product name ${i}`, 1));
  const note = describeEdit(state(many(40)), state(many(40).map(l => ({ ...l, qty: 2 }))));
  assert.ok(note.length <= 2000, `note is ${note.length} characters`);
});

/* ------------------------------------------------------------ the schema */

test('schema.sql adds orders.edit_seq idempotently', () => {
  // db:setup re-runs the whole file on every deploy, so a bare ADD COLUMN fails
  // the second time and takes the deploy with it.
  assert.match(schema, /ALTER TABLE orders ADD COLUMN IF NOT EXISTS edit_seq INT NOT NULL DEFAULT 0/);
});

test('nothing in schema.sql drops edit_seq or the events that go with it', () => {
  assert.doesNotMatch(schema, /orders DROP COLUMN[^;]*edit_seq/i);
  assert.doesNotMatch(schema, /DROP TABLE[^;]*order_events/i);
});

test('the order_events kind check allows the kind an edit writes', () => {
  // A kind the CHECK does not list is a constraint violation at runtime, not at
  // review time — and it would abort the whole edit transaction, so the first
  // symptom would be an order that refuses to be edited at all.
  const [, list] = schema.match(/ADD CONSTRAINT order_events_kind_check\s*\n?\s*CHECK \(kind IN \(([^)]*)\)\)/) || [];
  assert.ok(list, 'could not find the kind constraint');
  const allowed = list.split(',').map(s => s.trim().replace(/'/g, ''));
  assert.ok(allowed.includes('edit'), 'the edit kind is written by the code but not allowed by the schema');
  // And the constraint swap has to stay re-runnable, like everything else here.
  assert.match(schema, /ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_kind_check/);
});

test('the block this change added to schema.sql carries no apostrophes', () => {
  /*
   * scripts/sql-split.mjs counts quotes to find the end of a literal, and
   * tests/sql-split.test.mjs asserts every statement of the real file comes out
   * balanced. A comment with one apostrophe in it inside a statement breaks the
   * deploy, and the failure is a torn statement rather than a syntax error, so
   * it does not read as a punctuation problem when it happens.
   *
   * Scoped to the block this change added, because the file already contains
   * comments with balanced pairs of quotes in them.
   */
  const block = schema.slice(schema.indexOf('--  Editing an order that has not shipped yet'));
  assert.ok(block.length > 100, 'the edit block is not in the schema');
  for (const raw of block.split('\n')) {
    const m = /^\s*--(.*)$/.exec(raw);
    if (m) assert.ok(!m[1].includes("'"), `apostrophe in a SQL comment: ${raw.trim().slice(0, 70)}`);
  }
});

/* ------------------------------------------------------------ one writer */

test('the edit never writes orders.status', () => {
  /*
   * The rule lib/order-status.js exists for, restated from this side. An edit
   * READS the column — the guard that refuses a shipped order is a WHERE clause
   * on it — and reading it is the opposite of owning it. tests/order-status
   * greps the whole tree for the write; this asserts the intent locally so the
   * reason survives next to the code.
   */
  const assigns = code.split('\n').filter(l => /\bSET\b/.test(l) && /\bstatus\b/.test(l));
  assert.deepEqual(assigns, [], 'lib/order-edit.js assigns to status');
  assert.match(code, /o\.status = ANY\(\$\{EDITABLE\}::text\[\]\)/,
    'the editable guard is not a live-row test inside the UPDATE');
});

test('the guard tests the live row, not the copy that was read', () => {
  /*
   * The bug lib/order-status.js documents at length: testing the value a CTE
   * read at statement start compares a stale snapshot, and two concurrent
   * writers both pass. Both halves of this guard have to be against `o`, the
   * row being updated, which Postgres re-evaluates under READ COMMITTED.
   */
  assert.match(code, /WHERE o\.id = \$\{id\}\s*\n\s*AND o\.edit_seq = \$\{seq\}/);
});

test('every guarded write divides by its own row count', () => {
  // The house pattern. A guarded UPDATE that matches nothing is a quiet no-op
  // in Postgres; dividing by the count turns it into an abort that takes the
  // whole batch with it.
  const guards = code.match(/SELECT 1 \/ count\(\*\)::int AS guard/g) || [];
  assert.ok(guards.length >= 3,
    'the order swap, the stock take and the coupon spend each need their own guard');
});

test('the stock statements are ordered, so two edits cannot deadlock', () => {
  assert.match(code, /\[\.\.\.delta\.entries\(\)\]\.sort\(\(a, b\) => a\[0\] - b\[0\]\)/,
    'the per-product statements are not in a fixed order');
});

test('an edit that cannot change the money does not recompute it', () => {
  /*
   * The trap underneath "recompute the totals every time": the discount is
   * derived from the offers row and the delivery fee from the environment, and
   * both can move after an order is placed. A blind recompute on a contact-only
   * edit would quietly change what a customer owes at the door because somebody
   * corrected a house number — in whichever direction the shop happened to have
   * edited its own offer. The proof that it does not is in
   * scripts/verify-order-edit.mjs, against a real database and a real edited
   * offer; this pins the branch that makes it possible.
   */
  assert.match(code,
    /const touchesMoney = lines\.length > 0 \|\| add\.length > 0 \|\| coupon !== undefined;/);
  assert.match(code, /if \(asked && touchesMoney\)/,
    'the coupon is re-read even when nothing about the basket moved');
  assert.match(code, /const t = touchesMoney\s*\n\s*\? cartTotals\(/,
    'the totals are recomputed unconditionally');
});

test('the ceiling stops an order growing, it does not freeze a big one', () => {
  // Checkout puts no limit on distinct products, so orders larger than this
  // exist. A bound about transaction size must never be the reason a wrong
  // address cannot be corrected.
  assert.match(code, /kept\.length > MAX_LINES && kept\.length > existing\.length/);
});

test('a notice the shop chose not to send is recorded as such', () => {
  // "Was the customer told?" is half of any dispute about an edit, and an
  // absence of rows cannot answer it: a message that failed, one never
  // attempted and one nobody looked for all look the same.
  const fn = notify.slice(notify.indexOf('export async function editAndNotify'));
  assert.match(fn, /if \(!notify && res\.notify\)/);
  assert.match(fn, /note: 'edit notice deliberately NOT sent'/);
});

test('the edit does not touch the delivery window it was promised on', () => {
  // A window that slides forward every time somebody corrects a house number
  // is worse than no window. lib/order-status.js writes it once; nothing here
  // may write it at all.
  assert.ok(!/expected_from|expected_to/.test(code),
    'lib/order-edit.js touches the delivery window');
});

test('nothing under app/ calls editOrder directly', async () => {
  /*
   * editOrder() changes the order and says nothing. editAndNotify() changes it
   * and tells the customer what it now says. A screen that reaches past the
   * wrapper compiles, passes every other test, and silently stops telling
   * anyone that the amount they owe at the door has changed — which on a
   * cash-on-delivery shop is the whole reason the message exists. The same
   * rule, and the same test, that transition() already has.
   */
  const { execFileSync } = await import('node:child_process');
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-n', '-E', 'import[^;]*\\beditOrder\\b[^;]*order-edit', '--', 'app'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return; // git grep exits 1 with no matches, which is the passing case
  }
  assert.deepEqual(hits.split('\n').filter(Boolean), [],
    'app/ must import editAndNotify from lib/order-notify.js, not editOrder');
});

/* --------------------------------------------- what the customer is told */

test('an edit that only tidies an internal field is not news', () => {
  // The notify flag is decided in lib/order-edit.js from the fields that
  // changed, and `notes` is the one the customer would not recognise as their
  // order changing.
  assert.match(code, /const notify = !sameLines \|\|/);
  assert.ok(!/before\.notes !== after\.notes/.test(code.split('const notify')[1] || ''),
    'a note tidy-up would email the customer');
});

test('the edit notice is minted a link, and only once it is going to be sent', () => {
  // An unused token is a live credential nobody asked for. Every reason not to
  // send has to be found before the mint.
  const fn = notify.slice(notify.indexOf('export async function notifyEdit'));
  const mint = fn.indexOf('mintOrderLink(');
  assert.ok(mint > 0, 'the edit notice never mints a link');
  for (const bail of ['if (!order) return false;', 'if (!order.email) return false;', 'if (!items.length) return false;']) {
    assert.ok(fn.indexOf(bail) > 0 && fn.indexOf(bail) < mint, `a link is minted before: ${bail}`);
  }
  assert.match(fn, /tplOrderEdited\(order, items, [^)]*, trackUrl\)/,
    'the minted link is not handed to the template');
});

test('the edit notice is sent after the response, not before it', () => {
  // An admin on a phone call is waiting for the screen, not for Resend.
  const fn = notify.slice(notify.indexOf('export async function editAndNotify'));
  assert.match(fn, /after\(\(\) => notifyEdit/);
});

test('the revised order carries the new total, the lines and the reference', () => {
  const order = {
    ref: 'S7-2708-1234', name: 'Youssef', phone: '01028282216', lang: 'en',
    address: 'flat 4, 9 some street', city: 'Cairo',
    subtotal: 360, discount: 0, shipping: 0, total: 360,
  };
  const items = [{ name: 'Red Wax', price: 120, qty: 3 }];
  for (const lang of ['ar', 'en']) {
    const [subject, html] = tplOrderEdited(order, items, lang);
    assert.ok(subject.includes(order.ref), `${lang} subject omits the ref`);
    assert.doesNotMatch(subject, /[\r\n]/, `${lang} subject can hold a newline`);
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /Red Wax/);
    // The amount to have ready is the single most useful line in a
    // cash-on-delivery notice whose total just moved.
    assert.match(html, /360 EGP/);
    assert.match(html, /flat 4, 9 some street/);
  }
  assert.match(tplOrderEdited(order, items, 'ar')[1], /dir="rtl"/);
  assert.match(tplOrderEdited(order, items, 'en')[1], /dir="ltr"/);
});

test('the revised order escapes everything a customer can put in it', () => {
  const evil = {
    ref: '"><script>alert(1)</script>', phone: '<img src=x onerror=alert(1)>',
    address: '<b>nope</b>', city: '', lang: 'en',
    subtotal: 1, discount: 0, shipping: 0, total: '<b>0</b>',
  };
  const [, html] = tplOrderEdited(evil, [{ name: '<script>x</script>', price: 1, qty: 1 }], 'en');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>nope<\/b>/);
  // A total that is not a number must not reach the amount box as markup.
  assert.doesNotMatch(html, /<b>0<\/b>/);
});

test('the revised order invents no link when it is not given one', () => {
  const [, html] = tplOrderEdited(
    { ref: 'S7-1', lang: 'en', subtotal: 1, discount: 0, shipping: 0, total: 1 },
    [{ name: 'x', price: 1, qty: 1 }], 'en',
  );
  assert.doesNotMatch(html, /\/order\//, 'it links to an order page it cannot address');
});

test('an edit event never reaches the customer timeline', () => {
  /*
   * The filter in lib/order-access.js is a whitelist of kinds rather than a
   * list of the ones to hide, which is what makes this hold for a kind that
   * did not exist when it was written. Asserted here because the note on an
   * edit row carries the admin id and both sides of the address, and a
   * projection that never selects a column cannot leak it through a rendering
   * mistake later.
   */
  const access = read('lib/order-access.js');
  const from = access.indexOf('export async function timelineFor');
  const query = access.slice(from, access.indexOf('export async function itemsFor'));
  assert.match(query, /kind IN \('status', 'refund-request'\)/);
  assert.ok(!/'edit'/.test(query), 'the customer timeline lists the edit kind');
  assert.ok(!/\bactor\b/.test(query.split('ORDER BY id')[0]), 'the timeline selects the actor');
});

/* ------------------------------------------------------- the admin screen */

test('every server action on the order screen checks the admin and the token', () => {
  /*
   * Both halves, on every one of them. requireAdmin() answers who this is;
   * csrfOk() answers whether they meant to do it — a Server Action is a POST
   * to a URL like any other, and without the token any page on the internet
   * can make an admin browser edit an order.
   *
   * Read out of the source rather than listed by hand, so an action added
   * later without either check fails here rather than in production.
   */
  const actions = panel.split(/\n(?=async function )/).filter(s => s.includes("'use server'"));
  assert.ok(actions.length >= 5, `expected every action to be found, saw ${actions.length}`);
  for (const fn of actions) {
    const name = (/async function (\w+)/.exec(fn) || [])[1];
    assert.match(fn, /requireAdmin\(\)/, `${name} does not check the session`);
    assert.match(fn, /csrfOk\(formData\.get\('_csrf'\)\)/, `${name} does not check the CSRF token`);
    // And the token check must come before anything is written.
    const guard = fn.indexOf('csrfOk');
    for (const write of ['editAndNotify(', 'transitionAndNotify(', 'logEvent(', 'UPDATE ']) {
      const at = fn.indexOf(write);
      assert.ok(at === -1 || at > guard, `${name} writes before it checks the token`);
    }
  }
});

test('the edit forms carry the sequence they were rendered against', () => {
  // Without it a form opened an hour ago silently undoes whatever was saved in
  // between: the quantities in it describe a basket that no longer exists.
  assert.equal((panel.match(/name="seq"/g) || []).length, 2,
    'both edit forms must carry the sequence');
  assert.equal((panel.match(/expectSeq: Number\(formData\.get\('seq'\)\)/g) || []).length, 2,
    'both actions must pass it on');
});

test('the screen asks the module which orders are editable', () => {
  // A panel with its own opinion would eventually render a form the server
  // refuses, which is the mistake the Cancel button on the customer order page
  // exists not to make.
  assert.match(panel, /canEdit\(order\.status\)/);
  assert.ok(!/status === 'new'|status === 'confirmed'/.test(panel),
    'the screen has its own copy of the editable policy');
});

test('every refusal the module can answer with has something to say', () => {
  /*
   * A reason with no flash code, or a code with no message, renders as a
   * redirect back to the same screen with nothing on it — an admin who pressed
   * Save, watched the page reload, and has no idea whether it worked. Read out
   * of all three files rather than listed here, so a reason added to the module
   * without a sentence to go with it fails on the way in.
   *
   * ui.js is read as text because it is JSX and MESSAGES is private to it.
   */
  const ui = read('app/admin/_lib/ui.js');
  const reasons = new Set([...code.matchAll(/refuse\('([a-z-]+)'/g)].map(m => m[1]));
  assert.ok(reasons.size >= 12, `only found ${reasons.size} refusals`);

  const mapped = Object.fromEntries(
    [...panel.matchAll(/^\s+'?([a-z-]+)'?: '([a-z_]+)',$/gm)].map(m => [m[1], m[2]]),
  );

  for (const reason of reasons) {
    const code = mapped[reason];
    assert.ok(code, `${reason} has no flash code`);
    assert.match(ui, new RegExp(`^\\s+${code}: \\['(ok|err)', '`, 'm'),
      `${reason} maps to ${code}, which has no message`);
  }
});
