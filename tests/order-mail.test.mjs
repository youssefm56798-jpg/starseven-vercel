import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tplStatus, MAILED } from '../lib/order-mail.js';
import { STATUSES } from '../lib/order-status.js';

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

/* ---------------------------------------------- the link that is not there */

test('no template links to the order page while there is no token to link with', () => {
  // The access token is never stored, only its digest, so at the moment a
  // status changes there is no way to rebuild the tracking URL. A template that
  // linked anyway would produce a dead link in a real customer's inbox.
  for (const status of MAILED) {
    const [, html] = tplStatus(order, status, 'en');
    assert.doesNotMatch(html, /\/order\//, `${status} links to an order page it cannot address`);
  }
});

test('but every template renders the link once it is given one', () => {
  // The retro-fit path: when the token table lands, each call site passes the
  // URL and the copy does not have to be touched.
  const url = 'https://newstarseven.com/order/S7-2708-1234?t=abc';
  for (const status of MAILED) {
    for (const lang of ['ar', 'en']) {
      const [, html] = tplStatus(order, status, lang, url);
      assert.ok(html.includes(url), `${status}/${lang} ignored the tracking url`);
    }
  }
});
