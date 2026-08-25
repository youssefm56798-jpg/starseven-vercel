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
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return { tooLarge: true };
  const text = await req.text();
  if (text.length > MAX_BODY) return { tooLarge: true };
  try { return { body: JSON.parse(text || '{}') }; }
  catch { return { body: {} }; }
}

export const langOf = v => (v === 'en' ? 'en' : 'ar');

export function orderRef() {
  const d = new Date();
  const dm = String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0');
  return `S7-${dm}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
}

export const token40 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
