/**
 * The redaction that keeps an order's access token out of three analytics
 * dashboards.
 *
 * This is worth testing hard rather than eyeballing, because the failure is
 * silent in both directions. A redaction that stops working sends a live
 * credential to Google and Vercel and nothing anywhere goes red; a redaction
 * that is too eager quietly empties the shop's own funnel. Neither shows up in
 * a page that renders correctly.
 *
 * lib/analytics-url.js carries the argument for why the token is in a URL at
 * all and why this is the fix rather than moving it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redactUrl, redactEvent, REDACTED, SECRET_PARAMS, ID_PARAMS } from '../lib/analytics-url.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Source with comments removed, so prose ABOUT a tag is not read as the tag.
 * Same helper as tests/db-grants.test.mjs, and it earned its place here the
 * same way: the first version of the wiring check below matched the phrase
 * "<Analytics /> directly" inside a comment and reported the real, correctly
 * guarded tag forty lines further down as unguarded.
 */
function code(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(l => (l.trim().startsWith('//') ? '' : l))
    .join('\n');
}

/* ------------------------------------------------------------ the token */

test('the access token is replaced, absolute and relative alike', () => {
  const token = 'FQ8b3Xk2mQ7wRt5vZ1nL9pYcJ4hG6sD0aE2iU8oK3xM';

  for (const url of [
    `https://newstarseven.com/order/S7-2708-12345?t=${token}`,
    `/order/S7-2708-12345?t=${token}`,
    `https://newstarseven.com/en/order/S7-2708-12345?t=${token}&utm_source=email`,
  ]) {
    const out = redactUrl(url);
    assert.ok(!out.includes(token), `the token survived redaction in ${url} -> ${out}`);
    assert.match(out, /t=redacted/, `the parameter was dropped rather than redacted: ${out}`);
  }
});

test('a relative URL stays relative, and an absolute one keeps its origin', () => {
  assert.equal(
    redactUrl('/order/S7-2708-12345?t=abcdefghijklmnop'),
    `/order/${REDACTED}?t=${REDACTED}`,
  );
  assert.ok(
    redactUrl('https://newstarseven.com/order/S7-2708-12345?t=abcdefghijklmnop')
      .startsWith('https://newstarseven.com/'),
    'an absolute URL lost its origin, which would break every host breakdown in the dashboard',
  );
});

test('the confirm and unsubscribe tokens are covered by the same rule', () => {
  // They are spelled `t` too, which is the reason SECRET_PARAMS has one entry.
  // If somebody ever renames one of them, this is where that shows up.
  assert.deepEqual(SECRET_PARAMS, ['t']);

  for (const path of ['/api/confirm', '/api/unsubscribe']) {
    const out = redactUrl(`https://newstarseven.com${path}?t=0123456789abcdef0123456789abcdef01234567`);
    assert.ok(!out.includes('0123456789abcdef'), `${path} leaked its token: ${out}`);
  }
});

/* -------------------------------------------------------- the reference */

test('the order reference is redacted out of the path', () => {
  assert.equal(redactUrl('/order/S7-2708-12345'), `/order/${REDACTED}`);
  assert.equal(redactUrl('/en/order/S7-2708-12345'), `/en/order/${REDACTED}`);
});

test('/order/find is not mistaken for an order reference', () => {
  // It is a real, public, indexable-shaped page that every customer who has
  // lost their link lands on, and collapsing it into /order/redacted would
  // merge the recovery funnel into the order-page one.
  assert.equal(redactUrl('/order/find'), '/order/find');
  assert.equal(redactUrl('/en/order/find'), '/en/order/find');
});

test('a path that merely starts with the word order is left alone', () => {
  for (const url of ['/orders', '/ordering-guide', '/product/order-of-things', '/en/orders']) {
    assert.equal(redactUrl(url), url, `${url} was redacted and should not have been`);
  }
});

/* ----------------------------------------------------- everything else */

test('an ordinary page view is passed through byte for byte', () => {
  // Returned as the caller spelled it, not as a normalised rebuild: a URL that
  // came back with a different trailing slash or a re-encoded parameter would
  // split one row in the dashboard into two.
  for (const url of [
    'https://newstarseven.com/',
    'https://newstarseven.com/shop/wax?sort=price',
    '/en/product/gel-wax-140-argan',
    'https://newstarseven.com/checkout',
  ]) {
    assert.equal(redactUrl(url), url);
  }
});

test('an empty referrer is passed through rather than becoming the word redacted', () => {
  // document.referrer is '' on a direct visit, and reporting the literal string
  // "redacted" as the referrer of every landing would be worse than reporting
  // nothing.
  assert.equal(redactUrl(''), '');
  assert.equal(redactUrl(null), '');
  assert.equal(redactUrl(undefined), '');
});

test('anything unparseable fails closed', () => {
  // Not reachable through a browser — every input is parsed against a base, so
  // even a bare path resolves. Asserted anyway, because the whole value of this
  // module is that there is no input for which it forwards something it has not
  // understood.
  const hostile = { toString() { throw new Error('nope'); } };
  assert.equal(redactUrl(hostile), REDACTED);
});

/* --------------------------------------------------------- beforeSend */

test('redactEvent keeps the event and changes only its url', () => {
  const event = { type: 'pageview', url: '/order/S7-2708-12345?t=abcdefghijklmnop' };
  const out = redactEvent(event);

  assert.equal(out.type, 'pageview', 'the event type was lost, so the SDK would drop it');
  assert.ok(!out.url.includes('abcdefghijklmnop'));
  assert.notEqual(out, event, 'the caller\'s object was mutated rather than copied');
});

test('redactEvent survives an event shape it does not recognise', () => {
  // Returning undefined or null here would silently stop ALL analytics, which
  // is a bigger outage than the one this module exists to prevent.
  for (const odd of [{ type: 'vital' }, {}, null, undefined]) {
    assert.doesNotThrow(() => redactEvent(odd));
  }
  assert.deepEqual(redactEvent({ type: 'vital' }), { type: 'vital' });
});

/* ------------------------------------------------- the wiring, not the unit */

test('nothing renders an analytics component without the redaction', () => {
  /*
   * The unit above can be perfect and the site can still leak, because the leak
   * is not in this function — it is in a component rendered without it. This is
   * the check that would have caught the original bug: <Analytics /> with no
   * beforeSend at all.
   */
  const telemetry = code(`${ROOT}app/_components/Telemetry.js`);

  for (const tag of ['<Analytics', '<SpeedInsights']) {
    const at = telemetry.indexOf(tag);
    assert.ok(at >= 0, `${tag} is no longer in Telemetry.js — has it moved somewhere unguarded?`);
    const openTag = telemetry.slice(at, telemetry.indexOf('>', at));
    assert.match(openTag, /beforeSend=\{redactEvent\}/,
      `${tag} is rendered without beforeSend, so it reports the full URL including the order token`);
  }

  assert.match(telemetry, /send_page_view:\s*false/,
    'the GA4 config no longer disables the automatic page view, so gtag reads location.href itself');
  assert.match(telemetry, /page_location:\s*redactUrl\(/,
    'the GA4 page view no longer redacts its page_location');

  const layout = code(`${ROOT}app/layout.js`);
  assert.doesNotMatch(layout, /<Analytics|<SpeedInsights|googletagmanager/,
    'an analytics tag is back in the root layout, which is a server component and cannot pass beforeSend');
});

/* ----------------------------------------------- the reference, as a param */

test('the reference is redacted out of the thank-you page query', () => {
  /*
   * /order/thanks?ref=S7-... is where the checkout lands every customer who
   * completes an order, so it is simultaneously one of the highest-traffic URLs
   * on the site and one that carries a real order number. Not a credential —
   * the reference opens nothing without the token or the email — but it does
   * name one customer's order, and a chart of unique references counts to one
   * over and over.
   */
  assert.deepEqual(ID_PARAMS, ['ref']);
  assert.equal(
    redactUrl('/order/thanks?ref=S7-2708-12345'),
    `/order/thanks?ref=${REDACTED}`,
  );
});

test('/order/thanks keeps its own name in the path', () => {
  // It is a page, not a reference. Collapsing it to /order/redacted would merge
  // the conversion page into the order-status page and make both unreadable.
  assert.equal(redactUrl('/order/thanks'), '/order/thanks');
  assert.equal(redactUrl('/en/order/thanks'), '/en/order/thanks');
  assert.match(redactUrl('/en/order/thanks?ref=S7-2708-12345'), /^\/en\/order\/thanks\?/);
});
