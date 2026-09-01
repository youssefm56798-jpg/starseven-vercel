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

/*
 * orderRef() used to live here: S7-DDMM-NNNNN, five random digits inside a day.
 *
 * It is gone, not moved. The customer-facing number is now a plain counting
 * number drawn from a Postgres sequence, which cannot be generated without a
 * database round trip - so it does not belong in this file, which is pure
 * helpers with no imports. See lib/order-number.js, which also carries the two
 * functions every screen and every lookup now goes through so that the old
 * S7- references keep working alongside the new ones.
 */

export const token40 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
