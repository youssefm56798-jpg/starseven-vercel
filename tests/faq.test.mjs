import test from 'node:test';
import assert from 'node:assert/strict';
import { productFaq, faqJsonLd } from '../lib/faq.js';
import { site } from '../lib/config.js';

/**
 * The FAQ is the one place on the product page that states delivery cost and
 * payment terms in prose. If those drift from configuration the page starts
 * quoting a fee the checkout does not charge, so the numbers are asserted to
 * come from `site` rather than from typed-in text.
 */

test('both languages answer the same questions', () => {
  const ar = productFaq('ar');
  const en = productFaq('en');
  assert.equal(ar.length, en.length);
  assert.ok(ar.length >= 4, 'a page with three questions is not worth the section');
  for (const list of [ar, en]) {
    for (const item of list) {
      assert.ok(item.q.trim().length > 0, 'empty question');
      assert.ok(item.a.trim().length > 20, 'answer too short to be useful');
    }
  }
});

test('the delivery answer quotes the configured fee and threshold', () => {
  for (const lang of ['ar', 'en']) {
    const joined = productFaq(lang).map(f => f.a).join(' ');
    assert.ok(joined.includes(String(site.shipping)), `${lang}: shipping fee missing`);
    if (site.freeOver > 0) {
      assert.ok(joined.includes(String(site.freeOver)), `${lang}: free-delivery threshold missing`);
    }
  }
});

test('the payment answer does not promise card payment', () => {
  // Cash on delivery is the only method today; the report and the privacy
  // policy both say so. The FAQ must not contradict them.
  const en = productFaq('en').map(f => f.a).join(' ').toLowerCase();
  assert.ok(en.includes('cash on delivery'));
  assert.ok(!/\bvisa\b|\bmastercard\b|\bpay online\b/.test(en));
});

test('the WhatsApp number is shown in local form, not with a country prefix', () => {
  const joined = productFaq('ar').map(f => f.a).join(' ');
  assert.ok(joined.includes('01028282216'), 'expected the local 01... form');
  assert.ok(!joined.includes('201028282216'), 'raw international form leaked into the copy');
});

test('faqJsonLd emits a valid FAQPage', () => {
  const items = productFaq('en');
  const ld = faqJsonLd(items);
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity.length, items.length);
  for (const q of ld.mainEntity) {
    assert.equal(q['@type'], 'Question');
    assert.equal(q.acceptedAnswer['@type'], 'Answer');
    assert.ok(q.name && q.acceptedAnswer.text);
  }
});

test('nothing in the FAQ can break out of the JSON-LD script tag', () => {
  // The page escapes "<" when serialising; confirm the copy itself is clean so
  // the escape is a belt-and-braces measure rather than the only defence.
  for (const lang of ['ar', 'en']) {
    for (const f of productFaq(lang)) {
      assert.ok(!f.q.includes('<') && !f.a.includes('<'), 'raw < in FAQ copy');
    }
  }
});
