/** Shared JSON helpers for the API routes. */

const SECURE = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export function ok(data = {}) {
  return Response.json({ ok: true, ...data }, { headers: SECURE });
}

export function fail(error, status = 400, extra = {}) {
  return Response.json({ ok: false, error, ...extra }, { status, headers: SECURE });
}

/** Reads a JSON body, refusing anything oversized. 128 KB is generous here. */
export const MAX_BODY = 128 * 1024;

export async function readJson(req) {
  // These endpoints only ever receive JSON, and every caller on the site sets
  // the header. Requiring it turns away a cross-site form POST, which a browser
  // can send as text/plain or form-encoded without a preflight - a simple
  // request. The endpoints are unauthenticated so there is no session to ride,
  // but the checkout and subscribe writes are worth not accepting from a form
  // on someone else's page regardless. The one token-authed mutation, the
  // refund, already enforces this plus an origin check of its own. A non-JSON
  // body is read as empty, so the route's own validation rejects it - no route
  // needs a new branch.
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return { body: {} };

  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return { tooLarge: true };
  const text = await req.text();
  if (text.length > MAX_BODY) return { tooLarge: true };
  try { return { body: JSON.parse(text || '{}') }; }
  catch { return { body: {} }; }
}

export const langOf = v => (v === 'en' ? 'en' : 'ar');

/**
 * A customer-facing order reference: S7-DDMM-NNNNN.
 *
 * ---------------------------------------------------------------------------
 * Why the digits are cryptographic
 *
 * Not because a reference is a secret. It is not: the credential for an order
 * is the token in lib/order-access.js, a reference on its own opens nothing,
 * and /order/find refuses to say whether one even exists without the matching
 * email. This is deliberate defence in depth.
 *
 * It used to be Math.random(), whose generator state is recoverable from a
 * handful of outputs — so anybody who placed three or four orders could predict
 * the references handed to the customers after them. Nothing in the app turns
 * that into an attack today. The rule being kept is that a value which names an
 * order must not be predictable, so that the day something DOES start treating
 * a reference as though it were unguessable, that assumption is already true
 * rather than needing to be noticed first.
 *
 * ---------------------------------------------------------------------------
 * Why five digits and not four
 *
 * The old space was ten thousand references inside a day, and the birthday
 * bound is brutal on a space that small: at a hundred orders in a day there is
 * roughly a two-in-five chance of at least one collision, and at three hundred
 * it is a near certainty of several. The retry loop in app/api/order/route.js
 * was silently carrying all of it, five attempts deep, on the critical path of
 * a checkout. A hundred thousand references makes a collision the rarity the
 * retry loop was written for.
 *
 * Orders already placed keep their four-digit references and every lookup still
 * accepts them — REF in app/api/order/find/route.js and orderFor() both match
 * on shape, not length. Only newly minted references are longer.
 *
 * ---------------------------------------------------------------------------
 * Rejection sampling, not a modulo
 *
 * 2**32 is not a multiple of 100000, so folding a random 32-bit value into the
 * range with a bare `%` would make the first 4,967,296 values — the low
 * references — measurably likelier than the rest. That is the exact bias that
 * makes a supposedly random value worth guessing at, so the tail above the
 * largest whole multiple is discarded and re-drawn instead. The loop retries
 * with probability under 0.003%, so it is not a loop anybody will ever observe.
 */
export function orderRef() {
  const d = new Date();
  const dm = String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0');

  const SPACE = 100000;
  const limit = Math.floor(0x100000000 / SPACE) * SPACE;

  const buf = new Uint32Array(1);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);

  return `S7-${dm}-${String(n % SPACE).padStart(5, '0')}`;
}

export const token40 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
