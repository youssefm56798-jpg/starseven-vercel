/**
 * POST /api/quiz — the hair-type matcher.
 *
 * The cheapest write in the app, and the one that shows the shape every other
 * POST here follows: read a JSON body, take the language, spend a rate-limit
 * hit, validate, answer. So this file also carries the tests for the pieces
 * that are shared — the 413, the content-type guard, the limiter filling — and
 * the other route files test their own versions only where they differ.
 */

const MAX_BODY = 128 * 1024;

/** A JSON body of exactly `bytes` bytes, valid and with a usable hair type. */
function bodyOfSize(bytes) {
  const head = '{"hair_type":"straight","concern":"x","pad":"';
  const tail = '"}';
  return head + 'a'.repeat(bytes - head.length - tail.length) + tail;
}

export default async function quiz({ db, api, ip, check, checkThat, section, sub, SKU }) {
  section('POST /api/quiz');

  /* ----------------------------------------------------------- happy path */

  sub('a match');
  const res = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json: { hair_type: 'wavy', concern: 'frizz' } });
  check('200', res.status, 200);
  check('the tile comes back whole',
    Object.keys(res.json?.hair_type || {}).sort(),
    ['color', 'copy', 'icon', 'slug', 'walker', 'walkerEn']);
  check('and it is the one asked for', res.json?.hair_type?.slug, 'wavy');

  // Ranking is position in the products.hair_types CSV, hold level breaking
  // ties: the gel lists wavy first, the wax lists it second.
  check('ranked by how central the type is to the product',
    (res.json?.products || []).map(p => [p.sku, p.match_rank]),
    [[SKU.gel, 1], [SKU.wax, 2]]);

  // Both of these would otherwise rank at the top of 'wavy'. Recommending
  // something nobody can add to a basket is the failure this guards.
  check('an out-of-stock product is never recommended',
    res.text.includes(SKU.outOfStock), false);
  const straight = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json: { hair_type: 'straight' } });
  check('nor an inactive one', straight.text.includes(SKU.inactive), false);

  sub('at most three');
  // Five products matching one type, so the cap has something to cut.
  await db`UPDATE products SET hair_types = hair_types || ',fine'
            WHERE sku IN (${SKU.wax}, ${SKU.gel}, ${SKU.scarce}, ${SKU.bulk})`;
  try {
    const many = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json: { hair_type: 'fine' } });
    check('three, out of five that match', (many.json?.products || []).length, 3);
    check('best match first', many.json?.products?.[0]?.sku, SKU.stocky);
  } finally {
    await db`UPDATE products SET hair_types = replace(hair_types, ',fine', '')
              WHERE sku IN (${SKU.wax}, ${SKU.gel}, ${SKU.scarce}, ${SKU.bulk})`;
  }

  /* ------------------------------------------------------------ languages */

  sub('language');
  const en = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json: { hair_type: 'curly', lang: 'en' } });
  check('en gets the English copy', en.json?.hair_type?.copy?.name, 'Curly');
  const ar = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json: { hair_type: 'curly' } });
  checkThat('ar is the default', typeof ar.json?.hair_type?.copy?.name === 'string'
    && ar.json.hair_type.copy.name !== 'Curly', `got ${ar.json?.hair_type?.copy?.name}`);
  const fr = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json: { hair_type: 'curly', lang: 'fr' } });
  check('an unserved language falls back to Arabic rather than minting a third',
    fr.json?.hair_type?.copy?.name, ar.json?.hair_type?.copy?.name);

  /* ----------------------------------------------------------- validation */

  sub('rejections');
  const bad = [
    ['missing', {}],
    ['empty string', { hair_type: '' }],
    ['unknown slug', { hair_type: 'mullet' }],
    ['a number', { hair_type: 4 }],
    ['an object', { hair_type: { slug: 'wavy' } }],
    ['an array', { hair_type: ['wavy'] }],
    ['near miss on case', { hair_type: 'Wavy' }],
    ["a SQL fragment", { hair_type: "wavy'; DROP TABLE products; --" }],
  ];
  for (const [label, json] of bad) {
    const r = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json });
    check(`hair_type ${label} → 422`, [r.status, r.json?.field], [422, 'hair_type']);
  }

  // Trimmed, not rejected. str() strips whitespace before the slug is looked
  // up, so a value a form helpfully padded still matches. Asserted because the
  // matching is exact in every other respect — 'Wavy' above is refused — and
  // the difference between the two is easy to lose in a refactor.
  const padded = await api('/api/quiz', { method: 'POST', ip: ip('quiz'), json: { hair_type: '  wavy  ' } });
  check('surrounding whitespace is trimmed rather than refused',
    [padded.status, padded.json?.hair_type?.slug], [200, 'wavy']);
  // Belt and braces on the one above that was trying to be clever.
  const alive = await db`SELECT count(*)::int AS n FROM products`;
  checkThat('and the products table is still there afterwards', Number(alive[0].n) > 0);

  /* ------------------------------------------------------------- logging */

  sub('what it writes');
  const mark = 'concern-' + Math.random().toString(16).slice(2, 8);
  await api('/api/quiz', { method: 'POST', ip: ip('quiz-log'), json: { hair_type: 'thick', concern: mark, lang: 'en' } });
  const [row] = await db`SELECT hair_type, concern, sku, lang, ip FROM quiz_results
                          WHERE concern = ${mark}`;
  check('the answer is logged', [row?.hair_type, row?.concern, row?.lang], ['thick', mark, 'en']);
  check('with the product it recommended', row?.sku, SKU.scarce);
  // The audit column keeps the address in full. Only the rate-limit KEY is
  // coarsened to a /24 — if the two were ever confused, forensics would lose
  // the last octet of every visitor.
  check('and the full client address, not the limiter bucket', row?.ip, ip('quiz-log'));

  const long = 'x'.repeat(200);
  await api('/api/quiz', { method: 'POST', ip: ip('quiz-log'), json: { hair_type: 'thick', concern: long } });
  const [capped] = await db`SELECT concern FROM quiz_results WHERE concern LIKE 'xxx%' LIMIT 1`;
  check('a long concern is capped by the app, not truncated by Postgres',
    capped?.concern.length, 24);

  // Analytics must never be able to fail the answer. The insert is in its own
  // try/catch for exactly this, and nothing had ever proved it.
  await db`ALTER TABLE quiz_results RENAME TO quiz_results_hidden`;
  try {
    const stillOk = await api('/api/quiz', { method: 'POST', ip: ip('quiz-log'), json: { hair_type: 'thick' } });
    check('a failing analytics write does not fail the quiz', stillOk.status, 200);
  } finally {
    await db`ALTER TABLE quiz_results_hidden RENAME TO quiz_results`;
  }

  /* ------------------------------------------------------- request shapes */

  sub('bodies the route should not accept');

  // readJson only parses application/json, so a cross-site form post — which a
  // browser can send as text/plain or form-encoded with no preflight — arrives
  // as an empty body and dies on validation. That is the entire CSRF story for
  // the unauthenticated routes, so it is worth checking it actually holds.
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', null]) {
    const r = await api('/api/quiz', {
      method: 'POST', ip: ip('quiz-shapes'),
      json: { hair_type: 'wavy' }, contentType: ct,
    });
    check(`content-type ${ct ?? '(absent)'} is read as an empty body`,
      [r.status, r.json?.field], [422, 'hair_type']);
  }
  const withCharset = await api('/api/quiz', {
    method: 'POST', ip: ip('quiz-shapes'),
    json: { hair_type: 'wavy' }, contentType: 'application/json; charset=utf-8',
  });
  check('but a charset parameter is still JSON', withCharset.status, 200);

  const malformed = await api('/api/quiz', {
    method: 'POST', ip: ip('quiz-shapes'), body: '{not json', contentType: 'application/json',
  });
  check('unparseable JSON is an empty body, not a 500',
    [malformed.status, malformed.json?.field], [422, 'hair_type']);

  sub('size');
  const atLimit = await api('/api/quiz', {
    method: 'POST', ip: ip('quiz-size'), body: bodyOfSize(MAX_BODY), contentType: 'application/json',
  });
  check(`exactly ${MAX_BODY} bytes is accepted`, atLimit.status, 200);
  const overLimit = await api('/api/quiz', {
    method: 'POST', ip: ip('quiz-size'), body: bodyOfSize(MAX_BODY + 1), contentType: 'application/json',
  });
  check('one byte more is 413', [overLimit.status, overLimit.json?.error], [413, 'Request too large.']);

  /* ---------------------------------------------------------- rate limit */

  sub('the limiter filling');

  // 60 an hour is too many to send one at a time for a test, and sending 60
  // real requests would prove the loop rather than the limit. The window is
  // wound forward to one hit short of the cap and then the last two requests
  // are real, so the transition — the only part that can be wrong — happens for
  // real, against the same single-statement UPSERT the route uses.
  const burst = ip('quiz-burst');
  await db`INSERT INTO rate_limits (bucket, ip, hits, window_start)
           VALUES ('quiz', ${burst.split('.').slice(0, 3).join('.') + '.0/24'}, 59, now())`;

  const last = await api('/api/quiz', { method: 'POST', ip: burst, json: { hair_type: 'wavy' } });
  check('the sixtieth request is still served', last.status, 200);
  const over = await api('/api/quiz', { method: 'POST', ip: burst, json: { hair_type: 'wavy' } });
  check('the sixty-first is 429', over.status, 429);
  checkThat('and says so in Arabic by default', /استنى/.test(over.json?.error || ''), over.json?.error);
  const overEn = await api('/api/quiz', { method: 'POST', ip: burst, json: { hair_type: 'wavy', lang: 'en' } });
  check('or in English when asked', overEn.json?.error, 'Too many requests. Try again in a little while.');

  // The bucket is the /24, not the address. A second machine on the same block
  // inherits the block's spent budget — which is the property that makes the
  // limiter worth having at all, since a single attacker with a /64 or a /24
  // would otherwise get a fresh allowance per request.
  const neighbour = burst.replace(/\.7$/, '.212');
  const shared = await api('/api/quiz', { method: 'POST', ip: neighbour, json: { hair_type: 'wavy' } });
  check('a neighbour in the same /24 shares the exhausted bucket', shared.status, 429);

  // ...and a different /24 does not, or every visitor behind one busy network
  // would take the whole shop down.
  const elsewhere = await api('/api/quiz', { method: 'POST', ip: ip('quiz-elsewhere'), json: { hair_type: 'wavy' } });
  check('a different block is unaffected', elsewhere.status, 200);
}
