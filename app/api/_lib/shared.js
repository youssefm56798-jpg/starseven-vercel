/**
 * Small helpers shared by the API routes.
 *
 * The leading underscore keeps this folder out of Next's router, so nothing in
 * here is reachable as an endpoint — only `route.js` files are.
 */

import { fail } from '../../../lib/http.js';
import { site } from '../../../lib/config.js';

/** Escapes a value for HTML text or a double-quoted attribute. */
export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Trimmed string field, capped at the column's length so Postgres never truncates for us. */
export const str = (v, max = 255) =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '').trim().slice(0, max);

/**
 * Honeypot test: did something type into the field no human can see?
 *
 * A browser form always submits a string, so only a non-empty one counts —
 * plus an explicit `true`, which an untouched field never produces. Anything
 * else (0, false, null, '') falls through to normal validation on purpose: a
 * false positive here throws a real customer's order away without a word, so
 * the bias has to be towards letting doubtful values past.
 */
export const trapped = v => (typeof v === 'string' && v.trim() !== '') || v === true;

/**
 * Deliberately permissive: the confirmation email is the real deliverability
 * test, so this only rejects shapes that cannot possibly be addresses.
 * 190 is the practical cap the subscribers.email column was sized for.
 */
export const isEmail = v => {
  const s = String(v ?? '');
  return s.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
};

/** Uniform 429, bilingual like every other customer-visible message. */
export const tooMany = lang =>
  fail(lang === 'ar'
    ? 'طلبات كتير أوي في وقت قصير. استنى شوية وجرّب تاني.'
    : 'Too many requests. Try again in a little while.', 429);

/** Body bigger than lib/http.js allows. Not customer copy — bots hit this, not people. */
export const tooBig = () => fail('Request too large.', 413);

/**
 * The branded landing page the confirm / unsubscribe links render.
 * These are opened by a human in a browser, so they answer with HTML rather
 * than the JSON every other route returns.
 *
 * `accent` is the celebratory treatment (star, red offset shadow, filled
 * button) used on confirmation; unsubscribe gets the quieter outlined card.
 */
export function brandPage({ lang = 'ar', title, body, status = 200, accent = false }) {
  const rtl = lang === 'ar';
  const back = rtl ? 'ارجع للموقع' : 'Back to the site';

  // The offset shadow has to fall away from the text, so it flips with direction.
  const shadow = accent ? `box-shadow:${rtl ? '-9px 9px' : '9px 9px'} 0 #D7291D;` : '';
  const button = accent
    ? 'background:#D7291D;color:#ffffff;'
    : 'border:2px solid #12100B;color:#12100B;';

  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — ${esc(site.name)}</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:grid;place-items:center;background:#FFFDF8;color:#12100B;
       font-family:'Cairo',system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px;line-height:1.7}
  .card{max-width:520px;width:100%;text-align:center;background:#fff;
        border:2px solid #12100B;border-radius:22px;padding:clamp(28px,6vw,56px);${shadow}}
  .star{font-size:52px;color:#D7291D;line-height:1}
  h1{font-size:clamp(22px,5vw,32px);font-weight:900;margin:${accent ? '14px 0 10px' : '0 0 10px'}}
  p{color:#6E6A60;font-weight:600;margin-bottom:28px}
  a.btn{display:inline-block;font-weight:900;text-decoration:none;
        padding:14px 32px;border-radius:99px;${button}}
</style>
</head>
<body>
  <div class="card">
    ${accent ? '<div class="star">★</div>' : ''}
    <h1>${esc(title)}</h1>
    <p>${esc(body)}</p>
    <a class="btn" href="${esc(site.url)}">${esc(back)}</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
