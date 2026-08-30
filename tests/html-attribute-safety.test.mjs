/**
 * The three places a value lands inside an HTML attribute unescaped.
 *
 * Almost everything this app renders is JSX, which escapes on its own. Three
 * things are not: the email templates in lib/mail.js and lib/order-mail.js, the
 * branded confirm/unsubscribe page in app/api/_lib/shared.js, and the JSON-LD
 * blocks. The first two build HTML by string concatenation, which means every
 * interpolation is a decision.
 *
 * Most of those decisions go through esc(). Three did not, and were safe anyway
 * because every caller happened to pass a normalised value first - the language
 * came from langOf() or a ternary, the phone came from normalizePhone(). That is
 * a fact about the call sites, not about the functions, and it holds only until
 * someone adds a twelfth caller.
 *
 * So the functions now constrain their own output, and this calls them with
 * hostile input to prove it. Behaviour, not grep: a test that searched the
 * source for esc() would pass on code that escaped the wrong variable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shell, tplOrderAdmin } from '../lib/mail.js';
import { brandPage } from '../app/api/_lib/shared.js';

/** Breaks out of a double-quoted attribute if anything lets it. */
const BREAKOUT = '"><script>alert(1)</script><x y="';

test('an email shell cannot be given a language that escapes the attribute', () => {
  const html = shell('<p>body</p>', BREAKOUT);
  assert.ok(!html.includes('<script>'), 'the payload reached the document');
  assert.ok(!html.includes('alert(1)'), 'the payload reached the document');
  // Two possible values, decided inside the function.
  assert.match(html, /<html lang="(ar|en)"/);
});

test('the email shell still renders the two real languages correctly', () => {
  // The constraint must not have flattened the feature it guards.
  assert.match(shell('<p>x</p>', 'ar'), /<html lang="ar" dir="rtl"/);
  assert.match(shell('<p>x</p>', 'en'), /<html lang="en" dir="ltr"/);
});

test('the confirm page cannot be given a language that escapes the attribute', async () => {
  const res = brandPage({ lang: BREAKOUT, title: 'T', body: 'B' });
  const html = await res.text();
  assert.ok(!html.includes('<script>alert'), 'the payload reached the document');
  assert.match(html, /<html lang="(ar|en)"/);
});

test('the confirm page escapes the title and body it is given', async () => {
  const res = brandPage({ lang: 'en', title: '<img src=x onerror=alert(1)>', body: '</p><script>x</script>' });
  const html = await res.text();
  assert.ok(!html.includes('<img src=x'), 'the title was not escaped');
  assert.ok(!html.includes('<script>x</script>'), 'the body was not escaped');
});

test('a phone number cannot break out of the WhatsApp href', () => {
  /*
   * This one is the sharpest of the three. order.phone is customer free text at
   * the column level - normalizePhone() guards the checkout path, and nothing
   * guards a row that arrives any other way - and it lands inside href="...".
   * The template is the shop's own new-order alert, so the reader is the owner:
   * a successful injection here runs in the inbox of the person with the admin
   * session.
   */
  const [, html] = tplOrderAdmin(
    {
      ref: 'S7-0001', name: 'x', phone: '01000000000" onmouseover="alert(1)',
      address: 'a', city: 'c', notes: '', total: 100,
    },
    [{ name: 'item', qty: 1, price: 100 }],
  );
  /*
   * Checked as an attribute, not as a substring.
   *
   * The same phone is also printed as the link TEXT, through esc(), so the
   * characters "onmouseover" do legitimately appear in the output - as
   * onmouseover=&quot;alert(1), which is inert. An assertion that the string is
   * absent fails on correct code, which is how this test read on its first run.
   * What must not exist is a live attribute: that needs a real quote.
   */
  assert.ok(!/onmouseover\s*=\s*"/.test(html), 'the phone became a live attribute');

  const href = (html.match(/href="(https:\/\/wa\.me\/[^"]*)"/) || [])[1];
  assert.ok(href, 'the WhatsApp link is gone');
  assert.match(href, /^https:\/\/wa\.me\/\d+$/, `the href is not digits only: ${href}`);
});

test('the order alert escapes the customer free-text fields', () => {
  // The comments in the cancel and refund routes record this as a real bug once
  // - a name of "<a href=//evil>update your address</a>" rendering as a live
  // link inside the shop's own inbox. Same template family, same reader.
  const [, html] = tplOrderAdmin(
    {
      ref: 'S7-0002', name: '<a href="//evil">update your address</a>',
      phone: '01000000000', address: '<b>addr</b>', city: 'c',
      notes: '<script>n</script>', total: 100,
    },
    [{ name: '<i>item</i>', qty: 1, price: 100 }],
  );
  for (const raw of ['<a href="//evil">', '<b>addr</b>', '<script>n</script>', '<i>item</i>']) {
    assert.ok(!html.includes(raw), `unescaped in the owner's inbox: ${raw}`);
  }
});
