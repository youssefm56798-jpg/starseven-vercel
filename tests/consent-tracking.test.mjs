import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_KEY, CONSENT_MS, readConsent, saveConsent, privateAnalyticsUrl, clearAnalyticsCookies } from '../lib/consent.js';
import { track } from '../lib/track.js';
import { addToCart, CART_KEY, MAX_LINES } from '../lib/cart.js';

function browser() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
  };
  const events = [];
  globalThis.window = {
    location: { href: 'https://newstarseven.com/shop', hostname: 'newstarseven.com' },
    dispatchEvent() {},
    gtag: (...args) => events.push(['ga', ...args]),
    clarity: (...args) => events.push(['clarity', ...args]),
  };
  globalThis.CustomEvent = class {};
  return { data, events };
}
afterEach(() => {
  delete globalThis.window; delete globalThis.document;
  delete globalThis.localStorage; delete globalThis.CustomEvent;
});

test('missing, broken, expired or unknown consent fails closed', () => {
  const { data } = browser();
  for (const stored of [null, 'broken', '{}', JSON.stringify({ version: 1, value: 'accepted', expires: Date.now() - 1 }),
    JSON.stringify({ version: 2, value: 'accepted', expires: Date.now() + CONSENT_MS })]) {
    data.set(CONSENT_KEY, stored);
    assert.equal(readConsent(), null);
  }
  localStorage.getItem = () => { throw new Error('blocked'); };
  assert.equal(readConsent(), null);
});

test('accept/reject are stored with a version and six-month expiry', () => {
  const { data } = browser();
  for (const value of ['accepted', 'rejected']) {
    const before = Date.now();
    saveConsent(value);
    assert.equal(readConsent(), value);
    assert.ok(JSON.parse(data.get(CONSENT_KEY)).expires >= before + CONSENT_MS);
  }
});

test('private routes and credentials excluded in either language', () => {
  for (const path of ['/admin', '/admin/orders', '/order/find', '/order/thanks?ref=123', '/en/order/123?t=secret', '/shop?t=secret', '/shop?ref=123']) {
    assert.equal(privateAnalyticsUrl(path), true, path);
  }
  for (const path of ['/', '/en', '/checkout', '/en/checkout', '/privacy', '/ordering-guide', '/shop?sort=price']) {
    assert.equal(privateAnalyticsUrl(path), false, path);
  }
});

test('events require consent, never run on private pages, and service failures do not throw', () => {
  const { events } = browser();
  track('purchase');
  saveConsent('rejected'); track('purchase');
  assert.equal(events.length, 0);
  saveConsent('accepted');
  window.location.href = 'https://newstarseven.com/admin/orders'; track('purchase');
  assert.equal(events.length, 0);
  window.location.href = 'https://newstarseven.com/checkout'; track('purchase', { value: 10 });
  assert.deepEqual(events, [['ga', 'event', 'purchase', { value: 10 }], ['clarity', 'event', 'purchase']]);
  window.gtag = window.clarity = () => { throw new Error('failed'); };
  assert.doesNotThrow(() => track('purchase'));
});

test('cart event measures actual additions, not refused or capped quantities', () => {
  const { events, data } = browser(); saveConsent('accepted');
  addToCart('a', 19); addToCart('a', 5); addToCart('a', 1);
  assert.deepEqual(events.filter(e => e[0] === 'ga').map(e => e[3].items[0].quantity), [19, 1]);
  data.set(CART_KEY, JSON.stringify(Array.from({ length: MAX_LINES }, (_, i) => ({ sku: `p${i}`, qty: 1 }))));
  const before = events.length; addToCart('new');
  assert.equal(events.length, before);
  localStorage.setItem = () => { throw new Error('full'); };
  addToCart('p0'); assert.equal(events.length, before);
});

test('cookie cleanup removes analytics only, retaining cart/auth/security state', () => {
  browser();
  const writes = [];
  globalThis.document = {
    get cookie() { return '_clck=old; _clsk=old; _ga_ABC=old; s7_session=keep; s7_csrf=keep'; },
    set cookie(value) { writes.push(value); },
  };
  clearAnalyticsCookies();
  assert.ok(writes.some(c => c.startsWith('_clck=; Max-Age=0; Path=/')));
  assert.ok(writes.some(c => c.includes('Domain=newstarseven.com')));
  assert.ok(writes.every(c => !c.includes('s7_session') && !c.includes('s7_csrf')));
});
