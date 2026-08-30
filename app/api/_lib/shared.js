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
/*
 * No webfont link in the markup below, deliberately.
 *
 * This page used to pull Cairo straight from fonts.googleapis.com, and three
 * things were wrong with that at once.
 *
 * The rest of the site does not do it: lib/fonts.js loads Cairo through
 * next/font/google, which downloads the files at BUILD time and serves them
 * from this origin - which is why the site CSP names no Google host at all.
 * That one hand-written link was the only request to Google in the whole app.
 *
 * It was refused anyway. The /api header rule sends default-src 'none', so the
 * stylesheet, the preconnects and the inline <style> were all blocked, and every
 * subscriber who clicked confirm or unsubscribe got an unstyled page in
 * production. next.config.mjs now gives these two routes a document policy.
 *
 * And of all the pages to call Google from, the unsubscribe link is the worst:
 * somebody telling us to stop contacting them should not have their IP handed to
 * a third party by the click that does it.
 *
 * The stack starts at system-ui, which resolves to a real Arabic face on every
 * platform this is read on.
 *
 * Kept as a JS comment rather than an HTML one - the first version of this
 * explanation sat inside the template literal and shipped to every visitor.
 */
export function brandPage({ lang = 'ar', title, body, status = 200, accent = false }) {
  const rtl = lang === 'ar';
  // Derived, not printed from the argument. This is the only text/html response
  // in the app, and `lang` sits inside a quoted attribute in it. Both callers
  // normalise to the two literals before calling, so nothing can reach it today
  // - but that is a property of those two files, not of this one.
  const tag = rtl ? 'ar' : 'en';
  const back = rtl ? 'ارجع للموقع' : 'Back to the site';

  // The offset shadow has to fall away from the text, so it flips with direction.
  const shadow = accent ? `box-shadow:${rtl ? '-9px 9px' : '9px 9px'} 0 #D7291D;` : '';
  const button = accent
    ? 'background:#D7291D;color:#ffffff;'
    : 'border:2px solid #12100B;color:#12100B;';

  const html = `<!DOCTYPE html>
<html lang="${tag}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — ${esc(site.name)}</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:grid;place-items:center;background:#FFFDF8;color:#12100B;
       font-family:system-ui,-apple-system,'Segoe UI',Tahoma,'Noto Sans Arabic',sans-serif;
       padding:24px;line-height:1.7}
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
