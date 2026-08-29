import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { tplStatus, tplOrderLink, MAILED } from '../lib/order-mail.js';
import { STATUSES } from '../lib/order-status.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * The status notices, with no database and no mail server.
 *
 * These are strings, and the two things that go wrong with strings the compiler
 * cannot catch: a customer value interpolated without escaping, and a template
 * that quietly does not exist for a status the state machine can reach. Both
 * are checked here against the real transition table, so adding a status later
 * fails this file rather than sending nothing.
 */

const order = {
  id: 1,
  ref: 'S7-2708-1234',
  name: 'Youssef',
  phone: '01028282216',
  email: 'a@b.com',
  lang: 'ar',
  total: 295,
};

test('every mailed status has a template in both languages', () => {
  for (const status of MAILED) {
    for (const lang of ['ar', 'en']) {
      const built = tplStatus(order, status, lang);
      assert.ok(built, `${status}/${lang} has no template`);
      assert.equal(built.length, 2);
      assert.ok(built[0].length > 0, `${status}/${lang} has an empty subject`);
      assert.match(built[1], /<!DOCTYPE html>/);
    }
  }
});

test('every mailed status is a status the machine can actually reach', () => {
  for (const status of MAILED) {
    assert.ok(STATUSES.includes(status), `${status} is mailed but is not a real status`);
  }
});

test('new has no template, because checkout already sent one', () => {
  // Two emails saying an order was received is the bug this guards against.
  assert.equal(tplStatus(order, 'new', 'ar'), null);
  assert.equal(tplStatus(order, 'new', 'en'), null);
});

test('an unknown status produces nothing rather than an empty email', () => {
  for (const bad of ['', 'nonsense', 'NEW', null, undefined]) {
    assert.equal(tplStatus(order, bad, 'ar'), null, `built a message for ${String(bad)}`);
  }
});

test('the subject carries the reference, so a thread is findable', () => {
  for (const status of MAILED) {
    for (const lang of ['ar', 'en']) {
      const [subject] = tplStatus(order, status, lang);
      assert.ok(subject.includes(order.ref), `${status}/${lang} subject omits the ref`);
    }
  }
});

test('the language argument decides the language', () => {
  const [, ar] = tplStatus(order, 'shipped', 'ar');
  const [, en] = tplStatus(order, 'shipped', 'en');
  assert.match(ar, /dir="rtl"/);
  assert.match(en, /dir="ltr"/);
  assert.match(en, /on its way/i);
  assert.doesNotMatch(en, /في الطريق/);
});

test('anything other than en is Arabic, matching the rest of the site', () => {
  for (const lang of ['ar', '', null, undefined, 'fr']) {
    const [, html] = tplStatus(order, 'confirmed', lang);
    assert.match(html, /dir="rtl"/, `lang ${String(lang)} did not fall back to Arabic`);
  }
});

test('the shipping notice states the amount to have ready', () => {
  // Cash on delivery: the courier wants exact change and the customer has had
  // no reason to remember the total since checkout.
  for (const lang of ['ar', 'en']) {
    const [, html] = tplStatus({ ...order, total: 295 }, 'shipped', lang);
    assert.match(html, /295/);
  }
});

test('the cancellation notice says nothing is owed and sells nothing', () => {
  const [, ar] = tplStatus(order, 'cancelled', 'ar');
  const [, en] = tplStatus(order, 'cancelled', 'en');
  assert.match(en, /owe nothing/i);
  assert.match(ar, /مفيش أي مبلغ/);
  // No shop button on a cancellation — an order just fell through, and the
  // useful thing is not to advertise.
  assert.doesNotMatch(en, /See the rest of the range/);
});

/* ------------------------------------------------------------ escaping */

test('a reference is escaped everywhere it is rendered', () => {
  const evil = { ...order, ref: '"><script>alert(1)</script>' };
  for (const status of MAILED) {
    for (const lang of ['ar', 'en']) {
      const [subject, html] = tplStatus(evil, status, lang);
      assert.doesNotMatch(html, /<script>/, `${status}/${lang} rendered a raw tag`);
      assert.ok(html.includes('&lt;script&gt;'), `${status}/${lang} did not escape the ref`);
      // The subject is a header, not markup — it must not be escaped into
      // gibberish, but it must also never carry a newline, which would let a
      // reference inject a second header.
      assert.doesNotMatch(subject, /[\r\n]/, `${status}/${lang} subject can hold a newline`);
    }
  }
});

test('a phone number is escaped in the shipping notice', () => {
  const evil = { ...order, phone: '<img src=x onerror=alert(1)>' };
  const [, html] = tplStatus(evil, 'shipped', 'en');
  assert.doesNotMatch(html, /<img src=x/);
  assert.ok(html.includes('&lt;img'));
});

test('a total that is not a number does not reach the message as text', () => {
  // total comes back from Postgres as a NUMERIC string, and a bad one must not
  // be interpolated raw into the amount box.
  const [, html] = tplStatus({ ...order, total: '<b>0</b>' }, 'shipped', 'en');
  assert.doesNotMatch(html, /<b>0<\/b>/);
  assert.match(html, /\b0 EGP\b/);
});

test('a numeric string total is formatted, not mangled', () => {
  const [, html] = tplStatus({ ...order, total: '295.00' }, 'shipped', 'en');
  assert.match(html, /295 EGP/);
});

/* ---------------------------------------------------------------- the link */

test('a template invents no link when it is not given one', () => {
  // These notices now carry a real tracking URL, minted per message against
  // the order_tokens table. The one thing that must not happen when the mint
  // fails is a fabricated URL: a link built from a guess, or from a token that
  // was never stored, is a dead link in a real customer inbox and worse than
  // the button being absent. A missing trackUrl means no button at all.
  for (const status of MAILED) {
    const [, html] = tplStatus(order, status, 'en');
    assert.doesNotMatch(html, /\/order\//, `${status} links to an order page it cannot address`);
  }
});

test('every template renders the link once it is given one', () => {
  const url = 'https://newstarseven.com/order/S7-2708-1234?t=abc';
  for (const status of MAILED) {
    for (const lang of ['ar', 'en']) {
      const [, html] = tplStatus(order, status, lang, url);
      assert.ok(html.includes(url), `${status}/${lang} ignored the tracking url`);
    }
  }
});

test('the footer stops telling people to find a link that is already on screen', () => {
  const url = 'https://newstarseven.com/order/S7-2708-1234?t=abc';
  const [, without] = tplStatus(order, 'shipped', 'en');
  const [, with_] = tplStatus(order, 'shipped', 'en', url);
  assert.match(without, /Open the tracking link in your order confirmation email/);
  assert.doesNotMatch(with_, /Open the tracking link in your order confirmation email/);
  // WhatsApp survives both. It is the only way to reach a human from an email
  // sent from a no-reply address.
  for (const html of [without, with_]) assert.match(html, /wa\.me/);
});

test('a status notice actually gets a link at the call site', () => {
  /*
   * The templates have taken a `trackUrl` since they were written and rendered
   * nothing, because nothing passed one. That is the bug this whole change
   * exists to fix, and it lives at the call site rather than in the copy — so
   * it would come back silently, and every test above would still pass.
   */
  const notify = readFileSync(join(ROOT, 'lib/order-notify.js'), 'utf8');
  assert.match(notify, /mintOrderLink\(order, 'status-mail'\)/,
    'notifyStatus does not mint a link');
  assert.match(notify, /tplStatus\(order, status, [^)]*, trackUrl\)/,
    'the minted link is not handed to the template');
  // And nothing may be minted for a status that produces no message: an unused
  // token is a live credential nobody asked for.
  assert.ok(notify.indexOf('MAILED.includes(status)') < notify.indexOf('mintOrderLink('),
    'a link is minted before it is known that a message will be sent');
});

/* ------------------------------------------------- the link, sent again */

const found = { ref: 'S7-2708-1234', email: 'a@b.com', lang: 'ar' };
const link = 'https://newstarseven.com/order/S7-2708-1234?t=xyz';

test('the recovery mail carries the link and the reference, in both languages', () => {
  for (const lang of ['ar', 'en']) {
    const [subject, html] = tplOrderLink(found, lang, link);
    assert.ok(subject.includes(found.ref), `${lang} subject omits the ref`);
    assert.doesNotMatch(subject, /[\r\n]/);
    assert.ok(html.includes(link), `${lang} body omits the link`);
    assert.match(html, /<!DOCTYPE html>/);
  }
  assert.match(tplOrderLink(found, 'ar', link)[1], /dir="rtl"/);
  assert.match(tplOrderLink(found, 'en', link)[1], /dir="ltr"/);
});

test('the recovery mail tells someone who did not ask for it that nothing happened', () => {
  // Anyone who knows a customer address can cause this to be sent. The person
  // who receives one they did not ask for has to be able to tell, from the mail
  // alone, that no action is required of them.
  assert.match(tplOrderLink(found, 'en', link)[1], /If you did not ask for this link/);
  assert.match(tplOrderLink(found, 'ar', link)[1], /لو مش إنت اللي طلبت اللينك/);
});

test('the recovery mail carries nothing about the order but its reference', () => {
  // It goes to whoever asked. The endpoint answers a stranger exactly as it
  // answers the customer, so a wrong guess must not be worth making: no name,
  // no address, no phone number, no total.
  // A phone number that shares no digits with the shop own WhatsApp number,
  // which every one of these mails carries in its footer by design.
  const rich = { ...found, name: 'Youssef', phone: '01555444333', total: 295,
    address: '12 Some Street', city: 'Cairo' };
  for (const lang of ['ar', 'en']) {
    const [, html] = tplOrderLink(rich, lang, link);
    for (const leak of ['Youssef', '01555444333', 'Some Street', 'Cairo', '295']) {
      assert.ok(!html.includes(leak), `${lang} recovery mail leaks ${leak}`);
    }
  }
});

test('a crafted reference cannot inject markup into the recovery mail', () => {
  const evil = { ...found, ref: '"><script>alert(1)</script>' };
  const [, html] = tplOrderLink(evil, 'en', link);
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes('&lt;script&gt;'));
});
