/**
 * POST /api/order/refund — "I want to cancel this order".
 *
 * The only mutation in the app behind a credential, and the credential is a
 * token that was emailed once and never stored. Three guards run before the
 * token is even looked at — origin, content-type, rate limit — and then
 * lib/order-access.js decides whether the caller holds the order.
 *
 * The property that matters most is the one its comment states: a wrong token,
 * a wrong reference and a reference that never existed have to be the same
 * answer. If they were not, the endpoint would confirm whether a given order
 * reference is real, and references are four digits within a day.
 *
 * It also does not cancel anything, which is easy to misread from the name. On
 * a cash-on-delivery shop the parcel may already be with a courier, so this
 * records the request and stamps the time; a human moves the status.
 */

import { median, auc } from './harness.mjs';

const settle = ms => new Promise(r => setTimeout(r, ms));

export default async function refund({ db, api, ip, check, checkThat, section, sub, note, base, makeOrder }) {
  section('POST /api/order/refund');

  const origin = base;                     // NEXT_PUBLIC_SITE_URL, as the server sees it

  const post = (json, who, extra = {}) => api('/api/order/refund', {
    method: 'POST', ip: ip(who), json,
    headers: { origin, ...(extra.headers || {}) },
    ...(extra.contentType !== undefined ? { contentType: extra.contentType } : {}),
  });

  const rowOf = async ref =>
    (await db`SELECT id, status, refund_requested_at, refund_reason FROM orders WHERE ref = ${ref}`)[0];
  const eventsOf = async id =>
    await db`SELECT kind, actor, note FROM order_events WHERE order_id = ${id} ORDER BY id`;

  /* ------------------------------------------------------------ the guards */

  sub('before the token is even read');

  const guard = await makeOrder();

  const cross = await post({ ref: guard.ref, t: guard.token }, 'ref-guard',
    { headers: { origin: 'https://evil.example' } });
  check('a foreign Origin → 403', [cross.status, cross.json?.error], [403, 'bad-origin']);

  const wrongScheme = await post({ ref: guard.ref, t: guard.token }, 'ref-guard',
    { headers: { origin: origin.replace('http://', 'https://') } });
  check('the right host on the wrong scheme → 403', wrongScheme.status, 403);

  const wrongPort = await post({ ref: guard.ref, t: guard.token }, 'ref-guard',
    { headers: { origin: origin.replace(/:\d+$/, ':1') } });
  check('the right host on the wrong port → 403', wrongPort.status, 403);

  const garbledOrigin = await post({ ref: guard.ref, t: guard.token }, 'ref-guard',
    { headers: { origin: 'not a url' } });
  check('an unparseable Origin → 403', garbledOrigin.status, 403);

  for (const site of ['cross-site', 'same-site']) {
    const r = await post({ ref: guard.ref, t: guard.token }, 'ref-guard2',
      { headers: { 'sec-fetch-site': site } });
    check(`Sec-Fetch-Site: ${site} → 403`, r.status, 403);
  }
  const sameOriginHeader = await post({ ref: guard.ref, t: guard.token }, 'ref-guard2',
    { headers: { 'sec-fetch-site': 'same-origin' } });
  check('Sec-Fetch-Site: same-origin is allowed through', sameOriginHeader.status, 200);

  // A same-origin claim does not excuse a foreign Origin — both are checked,
  // and the Origin header is the one a browser cannot forge.
  const lying = await post({ ref: guard.ref, t: guard.token }, 'ref-guard2',
    { headers: { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' } });
  check('and a same-origin claim beside a foreign Origin is still refused', lying.status, 403);

  // Deliberate: a request with no Origin and no Sec-Fetch-Site is allowed. That
  // is curl, or an old client, and the check exists to stop a browser being
  // used as a confused deputy — something with no browser behind it gains
  // nothing from it, and still needs the token.
  const headless = await api('/api/order/refund', {
    method: 'POST', ip: ip('ref-headless'), json: { ref: guard.ref, t: guard.token },
  });
  check('a request from something that is not a browser is allowed, and still needs the token',
    headless.status, 200);

  sub('content type');
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', null]) {
    const r = await post({ ref: guard.ref, t: guard.token }, 'ref-ct', { contentType: ct });
    check(`${ct ?? '(absent)'} → 415`, [r.status, r.json?.error], [415, 'bad-content-type']);
  }
  const charset = await post({ ref: guard.ref, t: guard.token }, 'ref-ct',
    { contentType: 'application/json; charset=utf-8' });
  check('a charset parameter is fine', charset.status, 200);

  // Content-Type is case-insensitive by the specification and this comparison
  // is not. No browser sends it this way, so it is a note rather than a
  // finding — but it is the kind of thing an integration written by hand hits.
  const upper = await post({ ref: guard.ref, t: guard.token }, 'ref-ct',
    { contentType: 'Application/JSON' });
  check('but the comparison is case-sensitive', upper.status, 415);
  note('content-type matching is case-sensitive here; the HTTP spec says it should not be');

  sub('size');
  const big = '{"ref":"' + guard.ref + '","t":"' + guard.token + '","reason":"' + 'x'.repeat(200_000) + '"}';
  const tooBig = await api('/api/order/refund', {
    method: 'POST', ip: ip('ref-size'), body: big,
    contentType: 'application/json', headers: { origin },
  });
  check('an oversized body → 413', [tooBig.status, tooBig.json?.error], [413, 'too-large']);

  /* ------------------------------------------------------------ happy path */

  sub('recording a request');

  const one = await makeOrder();
  const res = await post({ ref: one.ref, t: one.token, reason: '  too   slow,  changed my mind  ' }, 'ref-happy');

  check('200', res.status, 200);
  checkThat('with the time it was recorded', typeof res.json?.requestedAt === 'string', JSON.stringify(res.json));

  const row = await rowOf(one.ref);
  checkThat('the order is stamped', row?.refund_requested_at != null);
  check('the reason is collapsed and trimmed', row?.refund_reason, 'too slow, changed my mind');
  check('and the status is untouched — a human decides, not this route', row?.status, 'new');

  check('a refund-request event lands on the same timeline as status moves',
    await eventsOf(row.id),
    [{ kind: 'refund-request', actor: 'customer', note: 'too slow, changed my mind' }]);

  await settle(1200);
  const [mailed] = await db`SELECT to_email, subject, kind FROM email_log
                             WHERE kind = 'refund-request' ORDER BY id DESC LIMIT 1`;
  check('and the shop is told',
    [mailed?.to_email, mailed?.subject], ['ops@example.invalid', `Cancellation requested — ${one.ref}`]);

  sub('asking twice');
  const first = row.refund_requested_at;
  const again = await post({ ref: one.ref, t: one.token, reason: 'actually, wrong size' }, 'ref-happy');
  const after = await rowOf(one.ref);
  check('still 200', again.status, 200);
  check('the original timestamp is kept', String(after.refund_requested_at), String(first));
  check('but a new reason replaces the old one', after.refund_reason, 'actually, wrong size');

  const blank = await post({ ref: one.ref, t: one.token }, 'ref-happy');
  check('and no reason at all leaves the last one alone',
    [blank.status, (await rowOf(one.ref)).refund_reason], [200, 'actually, wrong size']);

  const longReason = await makeOrder();
  await post({ ref: longReason.ref, t: longReason.token, reason: 'y'.repeat(900) }, 'ref-long');
  check('a long reason is capped at 500', (await rowOf(longReason.ref)).refund_reason.length, 500);

  const oddReason = await makeOrder();
  await post({ ref: oddReason.ref, t: oddReason.token, reason: { why: 'because' } }, 'ref-odd');
  check('a reason that is not a string is stringified rather than rejected',
    (await rowOf(oddReason.ref)).refund_reason, '[object Object]');

  sub('an order that is already cancelled');
  const dead = await makeOrder({ status: 'cancelled' });
  const onDead = await post({ ref: dead.ref, t: dead.token }, 'ref-dead');
  check('409', [onDead.status, onDead.json?.error], [409, 'already-cancelled']);
  check('and nothing is recorded', (await rowOf(dead.ref)).refund_requested_at, null);
  check('and no event is written', (await eventsOf(dead.id)).length, 0);

  /* -------------------------------------------------- the three same misses */

  sub('a wrong token, a wrong reference and a reference that never existed');

  const mine = await makeOrder();
  const theirs = await makeOrder();

  const misses = {
    'a valid reference with the wrong token':
      await post({ ref: mine.ref, t: theirs.token }, 'ref-miss-1'),
    "a valid token against somebody else's reference":
      await post({ ref: theirs.ref, t: mine.token }, 'ref-miss-2'),
    'a reference that does not exist, with a real token':
      await post({ ref: 'S7-0101-9999', t: mine.token }, 'ref-miss-3'),
    'a reference and a token that are both invented':
      await post({ ref: 'S7-0101-9998', t: 'z'.repeat(43) }, 'ref-miss-4'),
  };

  for (const [label, r] of Object.entries(misses)) {
    check(`${label} → 404 not-found`, [r.status, r.json?.error], [404, 'not-found']);
  }

  const shapes = Object.values(misses);
  checkThat('all four are byte-identical',
    new Set(shapes.map(r => r.text)).size === 1, JSON.stringify(shapes.map(r => r.text)));
  checkThat('and carry identical headers',
    new Set(shapes.map(r => JSON.stringify(r.headers))).size === 1,
    JSON.stringify(shapes.map(r => r.headers)));

  check('and neither order was touched by any of it',
    [(await rowOf(mine.ref)).refund_requested_at, (await rowOf(theirs.ref)).refund_requested_at],
    [null, null]);

  sub('shapes that never reach the database');
  const rejected = [
    ['no body at all', {}],
    ['a token under twenty characters', { ref: mine.ref, t: 'short' }],
    ['a token that is not a string', { ref: mine.ref, t: 12345678901234567890 }],
    ['a reference with a slash in it', { ref: '../admin', t: mine.token }],
    ['a reference over thirty-two characters', { ref: 'S7-'.repeat(20), t: mine.token }],
    ['a reference that is not a string', { ref: { ref: mine.ref }, t: mine.token }],
    ['an id instead of a reference', { id: mine.id, t: mine.token }],
  ];
  for (const [label, json] of rejected) {
    const r = await post(json, 'ref-shape-' + label);
    check(`${label} → 404`, [r.status, r.json?.error], [404, 'not-found']);
  }

  // There is no order id parameter, and this is why: the row written to is
  // always the one the token unlocked, so there is nothing in the body to point
  // at somebody else's order.
  check('the id in the body did nothing',
    (await rowOf(mine.ref)).refund_requested_at, null);

  /* ------------------------------------------------------ timing of a miss */

  sub('and the three misses take the same time');

  // All three do exactly one query — the digest lookup — and differ only in
  // whether it returns a row and whether that row's reference matches. There is
  // no branch that returns early, so this should be flat. Reported as numbers
  // and asserted only against a wide ceiling: what would show up here is a
  // future change that short-circuits one of the three.
  const SAMPLES = 8;
  const wrongToken = [];
  const wrongRef = [];
  const noSuchRef = [];
  for (let i = 0; i < SAMPLES; i++) {
    wrongToken.push((await post({ ref: mine.ref, t: theirs.token }, `ref-t-${i}`)).ms);
    wrongRef.push((await post({ ref: theirs.ref, t: mine.token }, `ref-t-${i}`)).ms);
    noSuchRef.push((await post({ ref: 'S7-0101-9997', t: mine.token }, `ref-t-${i}`)).ms);
  }
  const meds = [median(wrongToken), median(wrongRef), median(noSuchRef)];
  note(`medians: wrong token ${meds[0].toFixed(0)}ms, wrong reference ${meds[1].toFixed(0)}ms, ` +
    `no such reference ${meds[2].toFixed(0)}ms`);
  note(`separability of a wrong token from a wrong reference: ${auc(wrongToken, wrongRef).toFixed(2)}`);

  const spread = Math.max(...meds) - Math.min(...meds);
  const ceiling = Math.max(Math.min(...meds) * 0.6, 60);
  checkThat('no branch answers noticeably sooner than the others',
    spread <= ceiling,
    `${spread.toFixed(0)}ms between the fastest and slowest branch, ` +
    `against a ${ceiling.toFixed(0)}ms ceiling`);

  /* ---------------------------------------------------------- concurrency */

  sub('the double submit');

  // A customer who taps the button twice, or a page that retries. The UPDATE
  // COALESCEs the timestamp, so the second must not move it — and the check is
  // that four at once still produce one moment in time, not four.
  const twice = await makeOrder();
  const parallel = await Promise.all(Array.from({ length: 4 }, () =>
    api('/api/order/refund', {
      method: 'POST', ip: ip('ref-race'), headers: { origin },
      json: { ref: twice.ref, t: twice.token, reason: 'please cancel' },
    })));

  check('all four are accepted', parallel.map(r => r.status), [200, 200, 200, 200]);
  check('and they all report the same moment',
    new Set(parallel.map(r => r.json?.requestedAt)).size, 1);
  const stamped = await rowOf(twice.ref);
  check('which is the one on the order',
    new Date(stamped.refund_requested_at).getTime(),
    new Date(parallel[0].json.requestedAt).getTime());

  // The timeline gets one row per request, because logEvent is an unconditional
  // INSERT and the route calls it every time. Recorded rather than asserted as
  // a defect: an append-only log of "the customer asked again" is defensible,
  // and four rows is what a shop reading the timeline would want to see if a
  // customer really did press it four times.
  note(`the timeline took ${(await eventsOf(stamped.id)).length} rows for four simultaneous requests`);

  /* ---------------------------------------------------------- rate limit */

  sub('twenty an hour, whoever you are');

  // Deliberately not keyed on the order or the token: someone holding one valid
  // token should not be able to hammer this, and someone holding none should
  // not be able to grind through references.
  const burst = ip('ref-burst');
  const key = burst.split('.').slice(0, 3).join('.') + '.0/24';
  await db`INSERT INTO rate_limits (bucket, ip, hits, window_start)
           VALUES ('order-refund', ${key}, 19, now())`;

  const twentieth = await api('/api/order/refund', {
    method: 'POST', ip: burst, headers: { origin }, json: { ref: 'S7-0101-0000', t: 'q'.repeat(43) },
  });
  check('the twentieth is served', twentieth.status, 404);
  const overLimit = await api('/api/order/refund', {
    method: 'POST', ip: burst, headers: { origin }, json: { ref: 'S7-0101-0000', t: 'q'.repeat(43) },
  });
  check('the twenty-first is 429', [overLimit.status, overLimit.json?.error], [429, 'too-many']);

  // The limiter sits behind the origin and content-type guards, so a refused
  // request costs the caller nothing — worth knowing, because it means those
  // two guards cannot be used to burn somebody else's budget either.
  const refusedFirst = await api('/api/order/refund', {
    method: 'POST', ip: ip('ref-order'), headers: { origin: 'https://evil.example' }, json: {},
  });
  const [spent] = await db`SELECT count(*)::int AS n FROM rate_limits
                            WHERE bucket = 'order-refund' AND ip = ${ip('ref-order').split('.').slice(0, 3).join('.') + '.0/24'}`;
  check('a request refused on origin never reaches the limiter',
    [refusedFirst.status, Number(spent.n)], [403, 0]);

  note('the escaping of the customer name in the notify email is not observable over HTTP —');
  note('        the log stores only the subject. It also duplicates the esc() helper in _lib/shared.js.');
}
