/**
 * POST /api/coupon — what a code is worth on this basket.
 *
 * A preview. It is the only route in the app that reads the offers table and
 * changes nothing in it, and that is the property most worth pinning: if this
 * ever started spending a use, every shopper who typed a code into the cart and
 * then abandoned it would burn one.
 *
 * The subtotal comes from the browser, which is fine here and nowhere else —
 * the number is only used to decide what to SHOW. /api/order recomputes the
 * whole basket from the catalogue and never looks at anything sent with it.
 */

export default async function coupon({ db, api, ip, check, checkThat, section, sub, CODE }) {
  section('POST /api/coupon');

  const ask = (json, who = 'coupon') =>
    api('/api/coupon', { method: 'POST', ip: ip(who), json });

  /* ----------------------------------------------------------- happy path */

  sub('what a code is worth');
  const ten = await ask({ code: CODE.tenPercent, subtotal: 1000 });
  check('a percentage', [ten.status, ten.json?.code, ten.json?.discount, ten.json?.label],
    [200, CODE.tenPercent, 100, '10%']);

  const half = await ask({ code: CODE.fraction, subtotal: 200 });
  // '12.5%' rather than '12.50%' — and, just as important, not '13%'.
  check('a fractional percentage keeps its half', half.json?.label, '12.5%');

  const fixed = await ask({ code: CODE.fixed, subtotal: 400 });
  check('a fixed amount', [fixed.json?.discount, fixed.json?.label], [100, '100 EGP']);

  // A 100-off code on a 50-pound basket must not produce a negative total
  // downstream. The clamp lives in lib/pricing.js; this proves the route uses it.
  const clamped = await ask({ code: CODE.fixed, subtotal: 50 });
  check('a fixed amount never exceeds the basket', clamped.json?.discount, 50);

  const lower = await ask({ code: CODE.tenPercent.toLowerCase(), subtotal: 1000 });
  check('codes are case-insensitive, and echo back upper-cased',
    [lower.status, lower.json?.code], [200, CODE.tenPercent]);
  const padded = await ask({ code: `  ${CODE.tenPercent}  `, subtotal: 1000 });
  check('and are trimmed', padded.status, 200);

  /* ------------------------------------------------------------- refusals */

  sub('codes that do not apply');
  const refusals = [
    ['unknown', { code: 'NOSUCHCODE', subtotal: 1000 }, 'coupon'],
    ['inactive', { code: CODE.disabled, subtotal: 1000 }, 'coupon'],
    ['expired', { code: CODE.expired, subtotal: 1000 }, 'coupon'],
    ['not started yet', { code: CODE.future, subtotal: 1000 }, 'coupon'],
    ['fully used', { code: CODE.exhausted, subtotal: 1000 }, 'coupon'],
    ['under the minimum', { code: CODE.minimum, subtotal: 100 }, 'coupon'],
    ['worth nothing on this basket', { code: CODE.noDiscount, subtotal: 1000 }, 'coupon'],
    ['no code', { subtotal: 1000 }, 'coupon'],
    ['blank code', { code: '   ', subtotal: 1000 }, 'coupon'],
    ['no subtotal', { code: CODE.tenPercent }, 'items'],
    ['zero subtotal', { code: CODE.tenPercent, subtotal: 0 }, 'items'],
    ['negative subtotal', { code: CODE.tenPercent, subtotal: -500 }, 'items'],
    ['a subtotal that is not a number', { code: CODE.tenPercent, subtotal: 'lots' }, 'items'],
  ];
  for (const [label, json, field] of refusals) {
    const r = await ask(json);
    check(`${label} → 422 on ${field}`, [r.status, r.json?.field], [422, field]);
  }

  // The message has to carry the threshold, because "that code does not apply"
  // with no number is the kind of copy that generates a WhatsApp message.
  const under = await ask({ code: CODE.minimum, subtotal: 100, lang: 'en' });
  checkThat('the minimum is named in the refusal',
    /500 EGP/.test(under.json?.error || ''), under.json?.error);
  const overMin = await ask({ code: CODE.minimum, subtotal: 500 });
  check('and it applies at exactly the minimum', [overMin.status, overMin.json?.discount], [200, 100]);

  const arabic = await ask({ code: 'NOSUCHCODE', subtotal: 1000 });
  checkThat('refusals are Arabic by default', /كود/.test(arabic.json?.error || ''), arabic.json?.error);
  const english = await ask({ code: 'NOSUCHCODE', subtotal: 1000, lang: 'en' });
  check('and English on request', english.json?.error, 'That discount code is not valid.');

  /* -------------------------------------------------------- side effects */

  sub('it is a preview and nothing more');
  const before = await db`SELECT used_count FROM offers WHERE code = ${CODE.tenPercent}`;
  for (let i = 0; i < 5; i++) await ask({ code: CODE.tenPercent, subtotal: 1000 });
  const after = await db`SELECT used_count FROM offers WHERE code = ${CODE.tenPercent}`;
  check('previewing a code five times spends none of it',
    Number(after[0].used_count), Number(before[0].used_count));

  const orders = await db`SELECT count(*)::int AS n FROM orders`;
  check('and writes no orders', Number(orders[0].n), 0);

  /* ------------------------------------------------------ request shapes */

  sub('bodies and limits');
  const form = await api('/api/coupon', {
    method: 'POST', ip: ip('coupon-shapes'),
    json: { code: CODE.tenPercent, subtotal: 1000 }, contentType: 'text/plain',
  });
  check('a non-JSON content-type is an empty body', [form.status, form.json?.field], [422, 'coupon']);

  const big = '{"code":"' + 'A'.repeat(200_000) + '","subtotal":100}';
  const tooBig = await api('/api/coupon', {
    method: 'POST', ip: ip('coupon-shapes'), body: big, contentType: 'application/json',
  });
  check('an oversized body is 413', tooBig.status, 413);

  // str() caps at 64 before the lookup, so a 200-character code cannot become a
  // 200-character query parameter. Under the size limit, so it reaches the SQL.
  const longCode = await ask({ code: 'A'.repeat(500), subtotal: 1000 });
  check('an over-long code is refused as unknown, not as an error', longCode.status, 422);

  /* ---------------------------------------------------------- rate limit */

  sub('it shares the quiz budget');

  // Both are read-only lookups, so the route deliberately spends the 'quiz'
  // bucket rather than one of its own. That is a decision worth a test: it means
  // a shopper who has taken the quiz a lot has less coupon budget, and it means
  // hammering /api/coupon cannot be used to sidestep the quiz limit.
  const shared = ip('coupon-shared');
  const key = shared.split('.').slice(0, 3).join('.') + '.0/24';
  await db`INSERT INTO rate_limits (bucket, ip, hits, window_start)
           VALUES ('quiz', ${key}, 59, now())`;

  const one = await api('/api/coupon', { method: 'POST', ip: shared, json: { code: CODE.tenPercent, subtotal: 1000 } });
  check('the last of the shared allowance is served', one.status, 200);
  const spent = await api('/api/quiz', { method: 'POST', ip: shared, json: { hair_type: 'wavy' } });
  check('and the quiz is then out of budget too — one bucket, not two', spent.status, 429);

  const [hits] = await db`SELECT hits FROM rate_limits WHERE bucket = 'quiz' AND ip = ${key}`;
  checkThat('the coupon request is what spent it', Number(hits.hits) >= 61, `hits = ${hits.hits}`);
}
