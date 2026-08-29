/**
 * One order's mail must never carry another order's address.
 *
 * The shop owner's second worry, in their words: "make sure each email goes
 * only to the user and it doesn't get sent to other users by mistake."
 *
 * The way that goes wrong in practice is not a wrong `to:` written by hand. It
 * is a variable that outlives one message — a module-level `let`, a loop
 * counter read after an await, a template built from a captured reference —
 * so that two sends racing each other blend. Those bugs are invisible to a
 * single-message test and to a source grep; they only appear when several
 * messages are in flight at once with different latencies.
 *
 * So this file runs many sends concurrently, gives each one a different random
 * delay, and then checks not just the recipient but the body: order 41's mail
 * must contain order 41's reference, its phone number, its total, and no other
 * order's reference anywhere.
 *
 * No database and no network: the Neon driver and the Resend client both go out
 * over `fetch`, so one stub stands in for both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL =
  'postgresql://u:p@ep-stub-000.us-east-2.aws.neon.tech/neondb?sslmode=require';
process.env.RESEND_API_KEY = 're_stub_key';
process.env.NEXT_PUBLIC_SITE_URL = 'https://newstarseven.test';

/* ------------------------------------------------------------- the fixtures */

const ORDERS = Array.from({ length: 120 }, (_, i) => ({
  id: i + 1,
  ref: `S7-2708-${1000 + i}`,
  name: `Customer ${i}`,
  phone: `0100${String(i).padStart(7, '0')}`,
  email: `customer${i}@example.test`,
  lang: i % 2 ? 'en' : 'ar',
  total: String(100 + i),
}));

const COLUMNS = ['id', 'ref', 'name', 'phone', 'email', 'lang', 'total'];
const FIELDS = COLUMNS.map((name, i) => ({
  name, dataTypeID: 25, tableID: 0, columnID: i + 1,
  dataTypeSize: -1, dataTypeModifier: -1, format: 'text',
}));

const sends = [];
const jitter = () => new Promise(r => setTimeout(r, Math.random() * 10));

globalThis.fetch = async (url, init) => {
  if (String(url).includes('resend')) {
    const body = JSON.parse(init.body);
    await jitter();                       // let the sends interleave
    sends.push(body);
    return new Response(JSON.stringify({ id: `m_${sends.length}` }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }

  const body = JSON.parse(init.body);
  await jitter();
  if (/INSERT INTO/i.test(body.query)) {
    return new Response(JSON.stringify({ command: 'INSERT', rowCount: 1, rows: [], fields: [], rowAsArray: false }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const order = ORDERS.find(o => o.id === Number(body.params[0]));
  const rows = order ? [COLUMNS.map(c => order[c])] : [];
  return new Response(
    JSON.stringify({ command: 'SELECT', rowCount: rows.length, rows, fields: FIELDS, rowAsArray: false }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

// lib/order-notify.js imports `after` from next/server, which only resolves
// inside the Next runtime. notifyStatus itself never calls it — only
// transitionAndNotify does — so a stub module is enough to load the file.
const { register } = await import('node:module');
register(new URL('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(spec, ctx, next) {
     if (spec === 'next/server') {
       return { url: 'data:text/javascript,export const after = fn => { const r = fn(); if (r && r.then) r.catch(() => {}); };', shortCircuit: true };
     }
     return next(spec, ctx);
   }`)));

const { notifyStatus } = await import('../lib/order-notify.js');
const { tplStatus, MAILED } = await import('../lib/order-mail.js');
const { tplOrder, tplOrderAdmin } = await import('../lib/mail.js');
const { orderUrl, newAccessToken } = await import('../lib/order-access.js');

/* ------------------------------------------------------------------- tests */

test('120 concurrent status notices each reach only their own order', async () => {
  sends.length = 0;
  const statuses = ['confirmed', 'shipped', 'delivered', 'cancelled'];

  await Promise.all(ORDERS.map((o, i) => notifyStatus(o.id, statuses[i % 4])));

  assert.equal(sends.length, ORDERS.length, 'a send was lost or duplicated');

  const recipients = sends.map(s => (Array.isArray(s.to) ? s.to[0] : s.to));
  assert.equal(new Set(recipients).size, ORDERS.length,
    'two messages went to the same address');

  for (const send of sends) {
    const to = Array.isArray(send.to) ? send.to[0] : send.to;
    const index = Number(String(to).match(/customer(\d+)@/)[1]);
    const own = ORDERS[index];

    assert.ok(send.html.includes(own.ref),
      `mail to ${to} does not carry its own reference ${own.ref}`);

    // The decisive check: no other order's reference may appear anywhere in
    // this message. A shared buffer or a leaked loop variable shows up here.
    for (const other of ORDERS) {
      if (other.id === own.id) continue;
      assert.ok(!send.html.includes(other.ref),
        `mail to ${to} carries ${other.ref}, which belongs to someone else`);
    }
    // The shipped notice prints a phone number and an amount to have ready.
    // Both must be this customer's.
    if (send.html.includes('0100')) {
      assert.ok(send.html.includes(own.phone),
        `mail to ${to} carries another customer's phone number`);
    }
  }
});

test('an order with no email address sends nothing rather than sending wrongly', async () => {
  ORDERS.push({ id: 9001, ref: 'S7-2708-9001', name: 'No Mail', phone: '01099999999',
    email: '', lang: 'ar', total: '50' });
  sends.length = 0;
  const result = await notifyStatus(9001, 'shipped');
  assert.equal(result, false);
  assert.equal(sends.length, 0, 'a message went out for an order with no address');
});

test('a status notice for a missing order sends nothing', async () => {
  sends.length = 0;
  assert.equal(await notifyStatus(999999, 'shipped'), false);
  assert.equal(sends.length, 0);
});

test('the access token reaches the customer and nobody else', () => {
  const order = { ref: 'S7-2708-1111', name: 'Alice', phone: '01000000000',
    address: '1 Nile St', city: 'Cairo', notes: '', lang: 'ar',
    subtotal: 100, shipping: 30, discount: 0, total: 130 };
  const items = [{ name: 'Gel', qty: 1, price: 100 }];
  const token = newAccessToken();

  const [, customer] = tplOrder(order, items, 'ar', orderUrl(order.ref, token, 'ar'));
  assert.ok(customer.includes(token),
    'the confirmation does not carry the link — it is the only copy there will be');

  // The shop's own new-order alert must not. If it did, the credential for
  // every order would accumulate in one inbox.
  const [, admin] = tplOrderAdmin(order, items);
  assert.ok(!admin.includes(token), "the shop's alert carries the customer's token");
  assert.ok(!/\?t=/.test(admin), "the shop's alert carries a tracking link");
});

test('a status notice carries a link only when it is given one', () => {
  // Revisited deliberately, which is what the previous version of this test
  // asked for. It asserted that no notice could ever carry a token, because at
  // the time none was recoverable — the digest was all that was stored. The
  // order_tokens table changed that: a notice can now mint its own link
  // without disturbing the one already in the customer's inbox.
  //
  // What survives is the half that was always the real guarantee — a template
  // invents nothing. Given no URL it renders no link, so a caller that cannot
  // safely produce one cannot accidentally publish a guessable one.
  const order = { ref: 'S7-2708-1111', name: 'Alice', phone: '01000000000', total: 130 };
  for (const status of MAILED) {
    for (const lang of ['ar', 'en']) {
      const [, bare] = tplStatus({ ...order, lang }, status, lang);
      assert.ok(!/\?t=/.test(bare), `the ${status} notice (${lang}) invented a tracking link`);
    }
  }
});

test('nothing in the mail path holds state between messages', async () => {
  // A module-level `let` is how one order's address ends up on another order's
  // mail. Sending the same order twice, with a different order in between, must
  // produce the same message to the same person.
  //
  // This used to assert byte-equality, and that stopped being the right proxy
  // when each notice began minting its own single-use link: two sends for one
  // order now legitimately differ, in the token and nowhere else. Comparing the
  // messages with the tokens masked keeps the original property — that nothing
  // is retained between sends — while allowing the one difference that is
  // supposed to be there.
  sends.length = 0;
  await notifyStatus(1, 'shipped');
  await notifyStatus(2, 'shipped');
  await notifyStatus(1, 'shipped');

  const maskToken = html => String(html).replace(/([?&]t=)[^"'&\s]+/g, '$1<TOKEN>');

  assert.equal(sends.length, 3);
  assert.deepEqual(sends[0].to, sends[2].to);
  assert.equal(sends[0].subject, sends[2].subject);
  assert.equal(maskToken(sends[0].html), maskToken(sends[2].html),
    'the same order produced two different messages — something is being held between sends');
  assert.notDeepEqual(sends[0].to, sends[1].to);

  // And the reason the mask is safe: where a token IS present, it must differ
  // every time. A repeated one would mean a link was being reused or cached,
  // which is the failure the mask could otherwise hide.
  const tokens = sends.map(s => (String(s.html).match(/[?&]t=([^"'&\s]+)/) || [])[1]).filter(Boolean);
  assert.equal(new Set(tokens).size, tokens.length, 'a tracking token was reused across messages');
});
