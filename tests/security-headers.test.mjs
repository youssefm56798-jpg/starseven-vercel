/**
 * The headers every response carries, pinned.
 *
 * These are the cheapest security controls in the app and the easiest to lose:
 * they live in one config object, nothing renders differently when one goes
 * missing, and no page breaks. A header quietly dropped in a refactor is
 * invisible until somebody thinks to run curl against production.
 *
 * The ordering assertion is the one that matters most, and it is here because
 * the bug it guards has already happened once. next.config.mjs declares two
 * rules: a catch-all on '/:path*' and a tighter one on '/api/:path*'. A header
 * declared in this config REPLACES one set by a route handler rather than
 * merging with it, and among config rules the LATER match wins - so if the two
 * are ever swapped, every JSON response goes back to shipping the page policy,
 * which permits inline script and allows same-origin framing. Nothing about the
 * site looks wrong when that happens.
 *
 * NODE_ENV is set before the import because the policy branches on it: the dev
 * server needs 'unsafe-eval' for Fast Refresh and a production build must never
 * ship it. Importing without this would test the development policy and quietly
 * assert nothing about what is deployed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'production';
const { default: config } = await import('../next.config.mjs');
const rules = await config.headers();

/** The headers of the first rule whose source matches exactly. */
function rule(source) {
  const found = rules.find(r => r.source === source);
  assert.ok(found, `no header rule for ${source}`);
  return Object.fromEntries(found.headers.map(h => [h.key, h.value]));
}

const PAGE = '/:path*';
const API = '/api/:path*';
const API_HTML = '/api/:path(confirm|unsubscribe)';

test('the api rule comes after the catch-all, or it does not apply', () => {
  const page = rules.findIndex(r => r.source === PAGE);
  const api = rules.findIndex(r => r.source === API);
  assert.ok(page >= 0 && api >= 0, 'both header rules must exist');
  assert.ok(api > page,
    'the /api rule must sit AFTER the catch-all - later rules win, and swapping them puts the page CSP back on every JSON response');
});

test('every response carries the baseline headers', () => {
  for (const source of [PAGE, API]) {
    const h = rule(source);
    // Repeated on the api rule deliberately: replacing is replacing, so
    // omitting them there would strip nosniff and HSTS from /api entirely.
    assert.match(h['Strict-Transport-Security'] || '', /max-age=\d{7,}/, `${source} lost HSTS`);
    assert.equal(h['X-Content-Type-Options'], 'nosniff', `${source} lost nosniff`);
    assert.ok(h['X-Frame-Options'], `${source} lost X-Frame-Options`);
    assert.ok(h['Referrer-Policy'], `${source} lost Referrer-Policy`);
    assert.ok(h['Content-Security-Policy'], `${source} lost its CSP`);
  }
});

test('the page policy closes the directives that do not need to be open', () => {
  const csp = rule(PAGE)['Content-Security-Policy'];
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",   // no Flash/applet vector
    "base-uri 'self'",     // an injected <base> cannot repoint every relative URL
    "form-action 'self'",  // a planted form cannot post the customer's data off-origin
    "frame-ancestors 'self'",
    "connect-src 'self'",
  ]) {
    assert.ok(csp.includes(directive), `the page CSP no longer says ${directive}`);
  }
});

test('the shipped policy never carries unsafe-eval', () => {
  // Guarded on NODE_ENV in the config: the dev server needs it for Fast
  // Refresh, a production build does not, and shipping it would hand any
  // injected string a way to become code.
  const csp = rule(PAGE)['Content-Security-Policy'];
  assert.ok(!csp.includes('unsafe-eval'),
    `production CSP contains unsafe-eval: ${csp}`);
});

test("script-src still allows inline, and the reason is still written down", async () => {
  /*
   * Not a rule so much as a tripwire on a known, argued trade-off.
   *
   * A statically prerendered Next app hydrates from inline bootstrap scripts,
   * so removing 'unsafe-inline' means nonces, and reading a per-request nonce
   * is a dynamic API that opts every page out of static rendering - undoing the
   * migration this site was rebuilt around. The trade is deliberate.
   *
   * This asserts the two halves stay together: if someone removes the
   * allowance, they have done the nonce work and this test should be updated
   * with it; if someone removes the explanation, the next reader has no way to
   * tell a decision from an oversight.
   */
  const csp = rule(PAGE)['Content-Security-Policy'];
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');

  assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"), 'script-src changed - update this test with the reasoning');
  assert.match(src, /nonce/i, 'the argument for allowing inline script has gone from next.config.mjs');
});

test('the browser features this shop never uses are switched off', () => {
  const pp = rule(PAGE)['Permissions-Policy'];
  assert.ok(pp, 'Permissions-Policy is gone');
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
    assert.match(pp, new RegExp(`${feature}=\\(\\)`),
      `${feature} is no longer disabled - this shop takes cash at the door and uses none of these`);
  }
});

test('a tab opened from the shop cannot reach back into it', () => {
  // The storefront links out to wa.me on nearly every screen. Without this each
  // of those gets a live window.opener back into the shop tab, which is the
  // tabnabbing shape.
  assert.equal(rule(PAGE)['Cross-Origin-Opener-Policy'], 'same-origin',
    'COOP is gone - every wa.me link is a tabnabbing vector again');
});

test('the two html routes under /api can render themselves', () => {
  /*
   * /api/confirm and /api/unsubscribe are opened by a person from an email link
   * and answer with a branded HTML page. The JSON policy - default-src 'none' -
   * refused that page's own inline <style> and its favicon, so every subscriber
   * who confirmed or unsubscribed saw the unstyled fallback. It was live in
   * production, and it fails safe, so nothing ever reported it.
   */
  const csp = rule(API_HTML)['Content-Security-Policy'];
  assert.ok(csp.includes("style-src 'unsafe-inline'"), 'the page cannot load its own stylesheet again');
  assert.ok(csp.includes("img-src 'self' data:"), 'the favicon is blocked again');

  // Still no script, anywhere. These pages are static markup with no behaviour,
  // so default-src 'none' governing script is a promise that costs nothing.
  assert.ok(!/script-src/.test(csp), 'a script-src appeared - these pages run no script');
  assert.ok(csp.includes("default-src 'none'"), 'default-src must stay none so script stays refused');
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("form-action 'none'"));
});

test('the html rule sits after the json rule it overrides', () => {
  const api = rules.findIndex(r => r.source === API);
  const html = rules.findIndex(r => r.source === API_HTML);
  assert.ok(api >= 0 && html >= 0, 'both api rules must exist');
  assert.ok(html > api,
    'the confirm/unsubscribe rule must come AFTER the general /api rule, or the JSON policy wins and the pages go unstyled again');
});

test('no page reaches outside this origin for a font', () => {
  /*
   * lib/fonts.js loads Cairo through next/font/google, which downloads the
   * files at BUILD time and serves them from here - which is why the CSP names
   * no Google host. brandPage() had a hand-written fonts.googleapis.com <link>,
   * the only request to Google in the app, on the page whose entire purpose is
   * somebody asking not to be contacted.
   */
  const csp = rule(PAGE)['Content-Security-Policy'];
  assert.ok(csp.includes("font-src 'self' data:"), 'font-src widened');
  for (const host of ['googleapis.com', 'gstatic.com']) {
    assert.ok(!csp.includes(host), `the CSP now allows ${host}`);
  }
});

test('the api policy is tighter than the page policy', () => {
  const api = rule(API)['Content-Security-Policy'];
  assert.ok(api.includes("default-src 'none'"), 'the api CSP should allow nothing by default');
  assert.ok(api.includes("frame-ancestors 'none'"), 'nothing in an api response belongs in a frame');
  assert.ok(!api.includes('unsafe-inline'), 'the api CSP must not permit inline anything');
  assert.equal(rule(API)['X-Frame-Options'], 'DENY');
  assert.equal(rule(API)['Referrer-Policy'], 'no-referrer');
});
