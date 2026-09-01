/**
 * POST /api/order — cash-on-delivery checkout.
 *
 * The route that takes money, on a shop where "taking money" means a driver
 * turns up at a door expecting cash. Two claims in its own comments are worth
 * more than everything else in this file put together:
 *
 *   1. Whatever the browser sends about money is a suggestion, never a fact.
 *      Prices, names, discounts, shipping and the total are all recomputed from
 *      the catalogue. So the tests do not merely check that a tampered body is
 *      rejected — a tampered body is ACCEPTED, and the order that lands has the
 *      catalogue's numbers in it.
 *
 *   2. It cannot oversell. The pre-write stock check is a courtesy; the real
 *      guard is a divide-by-row-count inside the write transaction, which turns
 *      "someone took the last one while we were deciding" into a division by
 *      zero and rolls the whole order back. A sequential test cannot see that
 *      guard at all — the courtesy check answers first — so the only test that
 *      means anything is the concurrent one.
 *
 * The same is true of the coupon cap, which has its own copy of the same trick,
 * and of the rate limiter, whose single-statement UPSERT exists precisely so
 * that requests arriving together cannot each read a stale count.
 *
 * Note on budgets: the limit is ten orders an hour per /24, so every group
 * below takes a fresh address and no group may exceed ten requests.
 */

const settle = ms => new Promise(r => setTimeout(r, ms));

let n = 0;
const buyer = () => `rt-buyer-${Date.now().toString(36)}-${++n}@example.test`;

export default async function order({ db, api, ip, check, checkThat, section, sub, note, SKU, CODE }) {
  section('POST /api/order');

  const good = (over = {}) => ({
    name: 'Youssef Tester',
    phone: '01012345678',
    address: '12 Test Street, Nasr City',
    email: buyer(),
    city: 'Cairo',
    lang: 'en',
    items: [{ sku: SKU.wax, qty: 1 }],
    ...over,
  });

  /*
   * Post an order, having first forgotten what this phone number has ordered.
   *
   * The checkout has two limiters on it: ten an hour per /24, which the header
   * note above budgets for by giving each group a fresh address, and six an
   * hour per phone number. The second one cannot be budgeted for the same way,
   * because `good()` sends one number and several groups deliberately depend on
   * that — the reply message is asserted to name it, and the normalisation
   * group sends four spellings that all have to arrive as the SAME number.
   * Without this, everything after the sixth order in the whole file answers
   * 429 and every assertion downstream reads as a route bug.
   *
   * So the phone bucket is cleared per request and the suite tests routes, not
   * limits. The per-IP burst further down is untouched by this — it keys on the
   * address, which is the limit that test is about — and the phone limiter gets
   * its own group at the end rather than being proven by accident here.
   */
  const forgetPhone = () => db`DELETE FROM rate_limits WHERE bucket = 'order-phone'`;

  const place = async (json, who) => {
    await forgetPhone();
    return api('/api/order', { method: 'POST', ip: ip(who), json });
  };

  const orderRow = async ref =>
    (await db`SELECT * FROM orders WHERE ref = ${ref}`)[0] || null;
  const itemsOf = async ref =>
    await db`SELECT i.sku, i.name, i.price, i.qty FROM order_items i
               JOIN orders o ON o.id = i.order_id WHERE o.ref = ${ref} ORDER BY i.id`;
  const stockOf = async sku =>
    Number((await db`SELECT stock FROM products WHERE sku = ${sku}`)[0].stock);
  const usesOf = async code =>
    Number((await db`SELECT used_count FROM offers WHERE code = ${code}`)[0].used_count);

  /* ----------------------------------------------------------- happy path */

  sub('an order');
  const stockBefore = await stockOf(SKU.wax);
  const email = buyer();
  const res = await place(good({ email: email.toUpperCase(), notes: 'ring the top bell' }), 'ord-happy');

  check('200', res.status, 200);
  checkThat('with a reference in the documented shape',
    /^\d{4,}$/.test(res.json?.ref || ''), res.json?.ref);
  check('and the money, computed here',
    [res.json?.subtotal, res.json?.discount, res.json?.shipping, res.json?.total],
    [100, 0, 30, 130]);
  checkThat('a prefilled WhatsApp message carrying the reference',
    (res.json?.wa || '').startsWith('https://wa.me/')
    && res.json.wa.includes(encodeURIComponent(res.json.ref)), res.json?.wa);
  checkThat('and a confirmation naming the number we will ring',
    (res.json?.message || '').includes('01012345678'), res.json?.message);

  const row = await orderRow(res.json.ref);
  check('the row is new, from the web, in the language asked for',
    [row?.status, row?.source, row?.lang], ['new', 'web', 'en']);
  check('the money on the row matches the reply',
    [Number(row?.subtotal), Number(row?.discount), Number(row?.shipping), Number(row?.total)],
    [100, 0, 30, 130]);
  check('the address is lower-cased so the customer can always be found by it',
    row?.email, email);
  checkThat('an access digest was stored', /^[a-f0-9]{64}$/.test(row?.access_hash || ''), row?.access_hash);
  check('and the token itself is nowhere in the reply',
    res.text.includes(row.access_hash), false);
  check('the caller address is recorded in full', row?.ip, ip('ord-happy'));
  check('notes and city are kept', [row?.notes, row?.city], ['ring the top bell', 'Cairo']);

  check('one line, priced from the catalogue',
    (await itemsOf(res.json.ref)).map(i => [i.sku, i.name, Number(i.price), Number(i.qty)]),
    [[SKU.wax, `Product ${SKU.wax}`, 100, 1]]);
  check('stock came down by the quantity ordered', await stockOf(SKU.wax), stockBefore - 1);

  await settle(1500);
  const mails = await db`SELECT kind FROM email_log WHERE to_email IN (${email}, 'ops@example.invalid')
                          ORDER BY id DESC LIMIT 2`;
  check('the shop and the customer were both told',
    mails.map(m => m.kind).sort(), ['order', 'order-admin']);

  sub('the reply in Arabic');
  const ar = await place(good({ lang: 'ar' }), 'ord-happy');
  checkThat('is Arabic', /استلمنا طلبك/.test(ar.json?.message || ''), ar.json?.message);
  check('and the line is stored under the Arabic name',
    (await itemsOf(ar.json.ref))[0]?.name, `منتج ${SKU.wax}`);

  /* ------------------------------------------------- the browser is a liar */

  sub('nothing about money is taken from the browser');

  // Not rejected — accepted, and every number replaced. Rejecting would be a
  // weaker guarantee: it would mean the server had to recognise tampering,
  // rather than never having consulted the figures in the first place.
  const before = await stockOf(SKU.wax);
  const tampered = await place(good({
    items: [{ sku: SKU.wax, qty: 1, price: 1, name: 'FREE WAX', total: 0 }],
    subtotal: 0, discount: 9999, shipping: 0, total: 0,
    price: 1, status: 'delivered', ref: 'S7-0000-0001', access_hash: 'x'.repeat(64),
    created_at: '1999-01-01', id: 1, source: 'admin',
  }), 'ord-tamper');

  check('the order is placed', tampered.status, 200);
  check('at the catalogue price, not the one sent',
    [tampered.json?.subtotal, tampered.json?.discount, tampered.json?.shipping, tampered.json?.total],
    [100, 0, 30, 130]);
  const tRow = await orderRow(tampered.json.ref);
  check('the row ignores the status and source it was handed',
    [tRow?.status, tRow?.source], ['new', 'web']);
  check('the reference is the one the server minted', tampered.json.ref !== 'S7-0000-0001', true);
  check('the line name comes from the catalogue, not the cart',
    (await itemsOf(tampered.json.ref))[0]?.name, `Product ${SKU.wax}`);
  check('and one unit really did leave stock', await stockOf(SKU.wax), before - 1);

  /* ------------------------------------------------------------- the cart */

  sub('quantities');
  const qtyCases = [
    ['zero becomes one', 0, 1],
    ['negative becomes one', -5, 1],
    ['a string is read as a number', '3', 3],
    ['a fraction is truncated', 2.9, 2],
    ['missing becomes one', undefined, 1],
    ['nonsense becomes one', 'lots', 1],
    ['over twenty is capped at twenty', 999, 20],
  ];
  for (const [label, qty, want] of qtyCases) {
    const r = await place(good({ items: [{ sku: SKU.bulk, ...(qty === undefined ? {} : { qty }) }] }), 'ord-qty');
    check(`qty: ${label}`, (await itemsOf(r.json?.ref || ''))[0]?.qty, want);
  }

  sub('lines');
  const merged = await place(good({
    items: [{ sku: SKU.bulk, qty: 15 }, { sku: SKU.bulk, qty: 15 }],
  }), 'ord-lines');
  // Two lines of fifteen must not become two rows that each pass the stock
  // check on their own. They are one row, and still capped at twenty.
  check('duplicate SKUs merge into one line, still capped',
    (await itemsOf(merged.json?.ref || '')).map(i => [i.sku, Number(i.qty)]),
    [[SKU.bulk, 20]]);

  const mixed = await place(good({
    items: [{ sku: SKU.wax, qty: 1 }, { sku: 'RT-NO-SUCH-SKU', qty: 4 }],
  }), 'ord-lines');
  check('an unknown SKU beside a real one is dropped, not fatal',
    [mixed.status, mixed.json?.subtotal], [200, 100]);
  check('and only the real line is written',
    (await itemsOf(mixed.json.ref)).map(i => i.sku), [SKU.wax]);

  const junkLines = await place(good({
    items: [null, 'RT-WAX-A', 42, { qty: 3 }, { sku: '' }, { sku: SKU.gel, qty: 2 }],
  }), 'ord-lines');
  check('junk entries are skipped and the one real line survives',
    [junkLines.status, junkLines.json?.subtotal], [200, 111]);

  const noItems = good();
  delete noItems.items;
  const missing = await api('/api/order', { method: 'POST', ip: ip('ord-empty-none'), json: noItems });
  check('no items key at all → 422 on items', [missing.status, missing.json?.field], [422, 'items']);

  const emptyish = [
    ['a null items key', { items: null }],
    ['an empty array', { items: [] }],
    ['not an array', { items: { sku: SKU.wax } }],
    ['a string', { items: 'RT-WAX-A' }],
    ['only junk', { items: [null, 7, { qty: 2 }] }],
    ['only unknown SKUs', { items: [{ sku: 'RT-NOPE-1' }, { sku: 'RT-NOPE-2' }] }],
    ['only an inactive product', { items: [{ sku: SKU.inactive }] }],
  ];
  for (const [label, over] of emptyish) {
    const r = await place(good(over), 'ord-empty-' + label);
    check(`${label} → 422 on items`, [r.status, r.json?.field], [422, 'items']);
  }

  /* -------------------------------------------------------- stock and price */

  sub('what cannot be bought');

  const short = await place(good({ items: [{ sku: SKU.scarce, qty: 2 }] }), 'ord-refuse');
  check('more than we have → 409, saying which and how many',
    [short.status, short.json?.field, short.json?.sku, short.json?.stock],
    [409, 'items', SKU.scarce, 1]);

  const none = await place(good({ items: [{ sku: SKU.outOfStock, qty: 1 }] }), 'ord-refuse');
  check('nothing left → 409', [none.status, none.json?.stock], [409, 0]);

  // The rule the route says out loud rather than leaning on: a product with no
  // price is unorderable because it has no price, not because its stock happens
  // to be zero. The fixture gives it five units precisely so the stock check
  // cannot be what refuses it.
  const unpriced = await place(good({ items: [{ sku: SKU.unpriced, qty: 1 }] }), 'ord-refuse');
  check('a product with no price → 409, even with stock on the shelf',
    [unpriced.status, unpriced.json?.field, unpriced.json?.sku], [409, 'items', SKU.unpriced]);
  checkThat('and says to ask, rather than pretending it is out of stock',
    /WhatsApp/.test(unpriced.json?.error || ''), unpriced.json?.error);
  check('and it is still on the shelf afterwards', await stockOf(SKU.unpriced), 5);

  /* ----------------------------------------------------------- validation */

  sub('the order the fields are checked in');

  // Pinned deliberately. A form shows one error at a time, so which field a
  // half-filled body complains about is user-visible behaviour, and it is the
  // kind of thing that changes silently when a check is moved.
  const chain = [
    ['nothing at all', {}, 'name'],
    ['a name only', { name: 'Youssef Tester' }, 'phone'],
    ['name and phone', { name: 'Youssef Tester', phone: '01012345678' }, 'address'],
    ['and an address', { name: 'Youssef Tester', phone: '01012345678', address: '12 Test Street, Nasr City' }, 'items'],
    ['and a basket', {
      name: 'Youssef Tester', phone: '01012345678', address: '12 Test Street, Nasr City',
      items: [{ sku: SKU.wax, qty: 1 }],
    }, 'email'],
    ['and a bad coupon, which is checked before the email', {
      name: 'Youssef Tester', phone: '01012345678', address: '12 Test Street, Nasr City',
      items: [{ sku: SKU.wax, qty: 1 }], coupon: 'NOSUCHCODE', email: 'still-bad',
    }, 'coupon'],
  ];
  for (const [label, json, field] of chain) {
    const r = await api('/api/order', { method: 'POST', ip: ip('ord-chain-' + field), json });
    check(`${label} → complains about ${field}`, [r.status, r.json?.field], [422, field]);
  }

  sub('each field on its own');
  const fieldCases = [
    ['a two-character name', { name: 'Yo' }, 'name'],
    ['a name of spaces', { name: '     ' }, 'name'],
    ['a name that is a number', { name: 12 }, 'name'],
    ['a landline', { phone: '0223456789' }, 'phone'],
    ['a phone with a bad prefix', { phone: '01312345678' }, 'phone'],
    ['a phone one digit short', { phone: '0101234567' }, 'phone'],
    ['a seven-character address', { address: '12 Cair' }, 'address'],
    ['an email with no domain dot', { email: 'buyer@example' }, 'email'],
    ['an email with a space', { email: 'bu yer@example.test' }, 'email'],
    ['no email at all', { email: undefined }, 'email'],
  ];
  for (const [label, over, field] of fieldCases) {
    const body = good(over);
    if (over.email === undefined && 'email' in over) delete body.email;
    const r = await place(body, 'ord-field-' + label);
    check(`${label} → 422 on ${field}`, [r.status, r.json?.field], [422, field]);
  }

  const phones = [
    ['+20 with spaces', '+20 101 234 5678'],
    ['0020 prefix', '00201012345678'],
    ['bare ten digits', '1012345678'],
    ['dashes', '010-1234-5678'],
  ];
  for (const [label, phone] of phones) {
    const r = await place(good({ phone }), 'ord-phones');
    check(`${label} is accepted and normalised`,
      [r.status, (await orderRow(r.json?.ref || ''))?.phone], [200, '01012345678']);
  }

  sub('lengths');
  const capped = await place(good({
    name: 'N'.repeat(300), address: 'A'.repeat(600), city: 'C'.repeat(200), notes: 'X'.repeat(900),
  }), 'ord-caps');
  const cRow = await orderRow(capped.json?.ref || '');
  check('the app caps every free-text field before Postgres has to',
    [cRow?.name.length, cRow?.address.length, cRow?.city.length, cRow?.notes.length],
    [120, 255, 80, 500]);

  /* -------------------------------------------------------------- coupons */

  sub('coupons at checkout');
  const usesBefore = await usesOf(CODE.tenPercent);
  const withCode = await place(good({ coupon: CODE.tenPercent.toLowerCase() }), 'ord-coupon');
  check('a valid code discounts the basket',
    [withCode.status, withCode.json?.discount, withCode.json?.total], [200, 10, 120]);
  check('and is stored upper-cased on the order',
    (await orderRow(withCode.json.ref))?.coupon, CODE.tenPercent);
  check('and is spent exactly once', await usesOf(CODE.tenPercent), usesBefore + 1);

  for (const [label, code] of [
    ['unknown', 'NOSUCHCODE'],
    ['inactive', CODE.disabled],
    ['expired', CODE.expired],
    ['not started', CODE.future],
    ['fully used', CODE.exhausted],
  ]) {
    const r = await place(good({ coupon: code }), 'ord-coupon-' + label);
    check(`a ${label} code → 422 on coupon`, [r.status, r.json?.field], [422, 'coupon']);
  }

  const underMin = await place(good({ coupon: CODE.minimum }), 'ord-coupon-min');
  check('a code under its minimum → 422', [underMin.status, underMin.json?.field], [422, 'coupon']);

  const noOrders = await db`SELECT count(*)::int AS n FROM orders WHERE coupon = ${CODE.minimum}`;
  check('and no order was written for it', Number(noOrders[0].n), 0);

  /* ------------------------------------------------------------- delivery */

  sub('the free-delivery line');
  const free = await place(good({ items: [{ sku: SKU.wax, qty: 3 }] }), 'ord-ship');
  check('three hundred exactly is free delivery',
    [free.json?.subtotal, free.json?.shipping, free.json?.total], [300, 0, 300]);

  const under = await place(good({ items: [{ sku: SKU.wax, qty: 2 }] }), 'ord-ship');
  check('under it is not', [under.json?.subtotal, under.json?.shipping, under.json?.total], [200, 30, 230]);

  // Deliberate, and the same rule the checkout page shows: delivery is decided
  // on what is actually paid, so a discount can tip an order back under the
  // threshold and the shipping line reappears.
  const tipped = await place(good({ items: [{ sku: SKU.wax, qty: 3 }], coupon: CODE.tenPercent }), 'ord-ship');
  check('a discount that drops the basket back under it brings delivery back',
    [tipped.json?.subtotal, tipped.json?.discount, tipped.json?.shipping, tipped.json?.total],
    [300, 30, 30, 300]);

  /* -------------------------------------------------------------- honeypot */

  sub('the honeypot');
  const stockAtTrap = await stockOf(SKU.wax);
  const trapEmail = buyer();
  const trap = await place(good({ email: trapEmail, hp: 'buy cheap pills' }), 'ord-hp');

  check('answers 200, like a real order', trap.status, 200);
  checkThat('with a reference indistinguishable from a real one',
    /^\d{4,}$/.test(trap.json?.ref || ''), trap.json?.ref);
  check('but nothing is written', await orderRow(trap.json.ref), null);
  check('and no stock moves', await stockOf(SKU.wax), stockAtTrap);
  await settle(1000);
  check('and nobody is emailed',
    Number((await db`SELECT count(*)::int AS n FROM email_log WHERE to_email = ${trapEmail}`)[0].n), 0);

  // Unlike /api/subscribe, the trapped reply here is a strict subset of a real
  // one in the same way — {ok, ref} against {ok, ref, subtotal, ...} — so the
  // same observation applies. It matters less: an order reply carries totals a
  // bot has no way to predict, so there is no "identical body" to return.
  checkThat('the trapped reply carries no totals, unlike a real one',
    trap.json?.total === undefined, JSON.stringify(trap.json));

  const trapBudget = ip('ord-hp-budget');
  for (let i = 0; i < 14; i++) {
    await api('/api/order', { method: 'POST', ip: trapBudget, json: good({ hp: 'x' }) });
  }
  const afterBot = await api('/api/order', { method: 'POST', ip: trapBudget, json: good() });
  check('fourteen trapped attempts spend none of a real customer\'s ten', afterBot.status, 200);

  /* ---------------------------------------------------------------- consent */

  sub('the marketing tick');
  const optIn = buyer();
  await place(good({ email: optIn, consent: true }), 'ord-consent');
  const sub1 = (await db`SELECT status, source, confirmed_at FROM subscribers WHERE email = ${optIn}`)[0];
  check('a ticked box subscribes them straight away, with no second email',
    [sub1?.status, sub1?.source, sub1?.confirmed_at != null], ['active', 'checkout', true]);

  for (const value of [1, '1']) {
    const e = buyer();
    await place(good({ email: e, consent: value }), 'ord-consent');
    checkThat(`consent ${JSON.stringify(value)} counts`,
      (await db`SELECT 1 FROM subscribers WHERE email = ${e}`).length === 1);
  }
  const noTick = buyer();
  await place(good({ email: noTick }), 'ord-consent');
  check('an unticked box subscribes nobody',
    (await db`SELECT 1 FROM subscribers WHERE email = ${noTick}`).length, 0);

  const yes = buyer();
  await place(good({ email: yes, consent: 'yes' }), 'ord-consent');
  check('and only the three documented truthy values count',
    (await db`SELECT 1 FROM subscribers WHERE email = ${yes}`).length, 0);

  // The rule that /api/confirm does not apply, applied here in SQL: a checkout
  // tick is not consent to undo an unsubscribe.
  const left = buyer();
  await db`INSERT INTO subscribers (email, status, token, source, ip)
           VALUES (${left}, 'unsubscribed', ${'b'.repeat(40)}, 'site', '10.0.0.1')`;
  await place(good({ email: left, consent: true }), 'ord-consent2');
  check('someone who opted out stays opted out',
    (await db`SELECT status FROM subscribers WHERE email = ${left}`)[0]?.status, 'unsubscribed');

  /* -------------------------------------------------------- request shapes */

  sub('bodies and limits');
  const form = await api('/api/order', {
    method: 'POST', ip: ip('ord-shapes'), json: good(), contentType: 'application/x-www-form-urlencoded',
  });
  check('a cross-site form post cannot place an order',
    [form.status, form.json?.field], [422, 'name']);

  const big = JSON.stringify(good({ notes: 'x'.repeat(200_000) }));
  const tooBig = await api('/api/order', {
    method: 'POST', ip: ip('ord-shapes'), body: big, contentType: 'application/json',
  });
  check('an oversized body is 413, before any validation', tooBig.status, 413);

  /*
   * The line cap, which used to be the note under this check rather than a rule.
   *
   * The quantity per line was always capped at twenty; the number of LINES was
   * not capped at all, and the two are not the same protection. On a shop with
   * no payment step, one request naming every SKU in the catalogue at twenty
   * each passed every check in the route and took the whole shop to "out of
   * stock" in a single transaction — comfortably inside the 128 KB body limit,
   * and cheap enough to repeat. The client had a cap; the endpoint that
   * actually decrements stock did not, and only the client called it.
   *
   * Eighty-one lines is now refused outright rather than trimmed. Silently
   * dropping the excess would confirm an order that is not the one the customer
   * pressed Confirm on, and on a shop that collects cash at the door the first
   * they would hear of it is the driver arriving with the wrong box.
   */
  const wide = await place(good({
    items: [...Array.from({ length: 80 }, (_, i) => ({ sku: `RT-GHOST-${i}`, qty: 1 })),
      { sku: SKU.wax, qty: 1 }],
  }), 'ord-wide');
  check('eighty-one distinct SKUs in one basket is refused, not trimmed',
    [wide.status, wide.json?.field], [422, 'items']);
  checkThat('and the refusal says how many an order may hold',
    (wide.json?.error || '').includes('20'), wide.json?.error);

  // And the cap is a cap on DISTINCT products, not on lines in the request:
  // a cart listing the same jar twenty times over is one product, and the
  // merge in the route runs before the count so it is never refused for it.
  const repeated = await place(good({
    items: Array.from({ length: 40 }, () => ({ sku: SKU.wax, qty: 1 })),
  }), 'ord-repeat');
  check('while forty lines naming ONE product is a normal order',
    [repeated.status, repeated.json?.subtotal], [200, 2000]);

  /* ---------------------------------------------------------- concurrency */

  sub('two customers, one unit of stock');

  // The whole reason the write is a guarded UPDATE dividing by its own row
  // count. Sequentially the pre-write check answers first and this proves
  // nothing; fired together, six requests all pass that check with stock = 1
  // and the transaction guard has to be what stops five of them.
  const scarceStock = await stockOf(SKU.scarce);
  check('one unit on the shelf', scarceStock, 1);

  // Every request in this group carries the same phone number, and the
  // per-phone limiter would refuse the tail of it — which is the one thing
  // this group must not be measuring. Cleared here so what the burst proves
  // is the guard inside the write transaction and nothing else.
  await forgetPhone();
  const raceIp = ip('ord-race-stock');
  const rush = await Promise.all(Array.from({ length: 6 }, () =>
    api('/api/order', { method: 'POST', ip: raceIp, json: good({ items: [{ sku: SKU.scarce, qty: 1 }] }) })));

  check('exactly one order is placed', rush.filter(r => r.status === 200).length, 1);
  check('the other five are refused with 409', rush.filter(r => r.status === 409).length, 5);
  check('stock lands on zero, never below', await stockOf(SKU.scarce), 0);
  check('and there is exactly one order line for it',
    Number((await db`SELECT count(*)::int AS n FROM order_items WHERE sku = ${SKU.scarce}`)[0].n), 1);

  // Two different refusals are correct here and which one a given request gets
  // is a matter of nanoseconds. Whoever read the catalogue after the winner had
  // already taken the unit is stopped by the courtesy check and told the
  // quantity is not available; whoever read it before is stopped by the guard
  // inside the write transaction and told the item just sold out. Both are
  // true, so the assertion is that every loser is told about availability —
  // and the split is printed, because a run where nothing reached the write
  // guard has not exercised the interesting half.
  const guarded = rush.filter(r => /sold out|خلص من المخزن/.test(r.json?.error || '')).length;
  const preChecked = rush.filter(r => /do not have that many|مش متوفرة/.test(r.json?.error || '')).length;
  checkThat('every loser is refused on availability, not with a server error',
    guarded + preChecked === 5,
    JSON.stringify(rush.map(r => [r.status, r.json?.error])));
  note(`${preChecked} stopped by the pre-write check, ${guarded} by the guard inside the transaction`);

  sub('eight customers, three units');

  // The same race with more room in it, so several requests are certain to be
  // deciding at once rather than one having simply won outright. The number
  // that succeeds has to equal the stock exactly: one short would be lost
  // business, one over is a driver at a door with nothing to hand over.
  await db`UPDATE products SET stock = 3 WHERE sku = ${SKU.scarce}`;
  // Every request in this group carries the same phone number, and the
  // per-phone limiter would refuse the tail of it — which is the one thing
  // this group must not be measuring. Cleared here so what the burst proves
  // is the guard inside the write transaction and nothing else.
  await forgetPhone();
  const threeIp = ip('ord-race-three');
  const eight = await Promise.all(Array.from({ length: 8 }, () =>
    api('/api/order', { method: 'POST', ip: threeIp, json: good({ items: [{ sku: SKU.scarce, qty: 1 }] }) })));
  check('exactly three succeed', eight.filter(r => r.status === 200).length, 3);
  check('and stock is exactly zero', await stockOf(SKU.scarce), 0);
  check('and the order lines add up to the stock that existed',
    Number((await db`SELECT coalesce(sum(qty),0)::int AS n FROM order_items WHERE sku = ${SKU.scarce}`)[0].n), 4);

  sub('five customers, one redemption of a capped code');

  check('the cap starts unspent', await usesOf(CODE.capOne), 0);
  // Every request in this group carries the same phone number, and the
  // per-phone limiter would refuse the tail of it — which is the one thing
  // this group must not be measuring. Cleared here so what the burst proves
  // is the guard inside the write transaction and nothing else.
  await forgetPhone();
  const couponIp = ip('ord-race-coupon');
  const grab = await Promise.all(Array.from({ length: 5 }, () =>
    api('/api/order', {
      method: 'POST', ip: couponIp,
      json: good({ coupon: CODE.capOne, items: [{ sku: SKU.bulk, qty: 1 }] }),
    })));

  check('exactly one gets the discount', grab.filter(r => r.status === 200).length, 1);
  check('the code is spent exactly once', await usesOf(CODE.capOne), 1);

  // The important half: the losing requests must not leave an order behind at a
  // discount the code was not entitled to give. The INSERT and the guarded
  // UPDATE are in one transaction, so a failed guard takes the order with it.
  check('and exactly one order carries it',
    Number((await db`SELECT count(*)::int AS n FROM orders WHERE coupon = ${CODE.capOne}`)[0].n), 1);
  check('with the discount actually applied',
    Number((await db`SELECT discount FROM orders WHERE coupon = ${CODE.capOne}`)[0].discount), 50);

  /**
   * The losers are told the wrong thing, and it is worth recording.
   *
   * Both guards — the stock one and the coupon one — fail as division by zero,
   * and the handler maps SQLSTATE 22012 to a single message: "One of those
   * items just sold out." So a customer who loses a race for the last use of a
   * discount code is told the product sold out, and will go and look at a
   * product page that says it is in stock.
   *
   * Distinguishing them is not free — the batch fails as a whole and Postgres
   * does not say which statement divided by zero — but the message could at
   * least be neutral, or the coupon guard could raise a different error.
   */
  /*
   * A loser lands in one of two places, and which one is a matter of timing.
   *
   * If it reads used_count BEFORE the winner commits, it reaches the write and
   * fails on the guard inside the transaction: SQLSTATE 22012, answered as 409.
   * If it reads AFTER, the courteous check at the top of the coupon block
   * answers first with 422 and the accurate sentence. Both are correct, both
   * leave no order behind, and neither is worth pinning to a fixed count — the
   * split moves with how fast the database happens to be, so asserting four
   * 409s was a test that measured the network.
   *
   * What IS worth pinning is the invariant: every loser is refused, none of
   * them is a 500, and none of them left an order at a discount. The count of
   * orders carrying the code is checked above and is one.
   */
  const losers = grab.filter(r => r.status !== 200);
  check('the four losers are all refused, none with a server error',
    [losers.length, losers.every(r => r.status === 409 || r.status === 422)], [4, true]);

  const wrongly = losers.filter(r => /sold out|خلص من المخزن/.test(r.json?.error || ''));
  checkThat('and the ones refused by the guard are told the item sold out, which is not what happened',
    wrongly.length === losers.filter(r => r.status === 409).length,
    JSON.stringify(losers.map(r => [r.status, r.json?.error])));
  note('FINDING (minor): a lost race for a capped coupon reports "one of those items');
  note('        just sold out" — the stock guard, the coupon-cap guard and the');
  note('        per-customer guard all fail as 22012 and share one message. The');
  note('        courteous check above answers accurately whenever it wins the race.');

  sub('the limiter under a burst');

  // Invalid bodies on purpose: the limiter is spent before validation, so this
  // fills the window without writing fifteen orders. Fifteen at once must not
  // each read a stale count — the UPSERT returns the post-increment value in
  // one statement precisely so they cannot.
  const burstIp = ip('ord-burst');
  const burst = await Promise.all(Array.from({ length: 15 }, () =>
    api('/api/order', { method: 'POST', ip: burstIp, json: {} })));
  check('ten get through and five are refused',
    [burst.filter(r => r.status === 422).length, burst.filter(r => r.status === 429).length], [10, 5]);

  const seqIp = ip('ord-seq');
  const seq = [];
  for (let i = 0; i < 11; i++) {
    seq.push((await api('/api/order', { method: 'POST', ip: seqIp, json: {} })).status);
  }
  check('and one at a time gives the same answer', seq.slice(9), [422, 429]);

  sub('the limiter that is keyed on the phone, not the network');

  /*
   * The second bucket on this route, and the one every other group in this file
   * clears out of its way. Proven here, once, on purpose.
   *
   * Six an hour per number. It is NOT a defence against a distributed flood —
   * an attacker already rotating addresses rotates numbers in the same loop —
   * and lib/config.js says so at length. What it stops is the naive script and
   * the runaway retry, and what it must never do is refuse a second honest
   * order from a household that ordered an hour ago.
   *
   * Each request carries a FRESH address, so the per-IP limit of ten cannot be
   * what refuses the seventh. That is the whole design of this group: if the
   * phone limiter were deleted tomorrow, every one of these would answer 200
   * and this check would fail.
   */
  await forgetPhone();
  const shared = '01099887766';
  const byPhone = [];
  for (let i = 0; i < 7; i++) {
    const r = await api('/api/order', {
      method: 'POST',
      ip: ip(`ord-phone-limit-${i}`),
      json: good({ phone: shared, items: [{ sku: SKU.bulk, qty: 1 }] }),
    });
    byPhone.push(r.status);
  }
  check('six orders on one number get through', byPhone.slice(0, 6), [200, 200, 200, 200, 200, 200]);
  check('and the seventh is refused, from an address that has ordered once',
    byPhone[6], 429);

  // The refusal has to be the shared, bilingual 429 every other limit answers
  // with. A message naming the phone number would tell an attacker which of
  // their two knobs they had run out of.
  const seventh = await api('/api/order', {
    method: 'POST', ip: ip('ord-phone-limit-msg'),
    json: good({ phone: shared, items: [{ sku: SKU.bulk, qty: 1 }] }),
  });
  checkThat('and says only that there were too many requests',
    seventh.status === 429 && !(seventh.json?.error || '').includes(shared),
    JSON.stringify([seventh.status, seventh.json?.error]));

  // A different number is unaffected — the bucket is the number, not the shop.
  const other = await api('/api/order', {
    method: 'POST', ip: ip('ord-phone-other'),
    json: good({ phone: '01055443322', items: [{ sku: SKU.bulk, qty: 1 }] }),
  });
  check('while a different number orders normally', other.status, 200);

  // Not tested, and worth saying why: the reference is four random digits
  // within a day, so a collision — the one thing the retry loop around the
  // write exists for — cannot be provoked from outside. It would need either a
  // seeded random or a fixture order occupying every reference for today.
  note('the duplicate-reference retry loop is not reachable from an HTTP test');
}
