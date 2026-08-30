import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEGAL } from '../app/_components/legalCopy.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(join(ROOT, p), 'utf8');

/**
 * The privacy policy, checked against the code it describes.
 *
 * This file exists because the previous policy was wrong, and wrong in the way
 * these documents always go wrong: nobody edited it while the product changed
 * underneath it. It told visitors that email was optional after checkout began
 * requiring it, and that there were no trackers while Vercel Analytics ran on
 * every page. Both were true when written. Neither was true when read.
 *
 * A privacy policy is the one document a stranger can check against the page
 * source in half a minute, so being casually wrong in it is worse than being
 * brief. What follows ties the claims to the facts that decide them: if
 * somebody adds an analytics script, or makes a field optional, or starts
 * storing something new, the assertion about it fails here rather than being
 * discovered by whoever is reading both.
 *
 * It deliberately does NOT check the policy is good law — that is a lawyer's
 * job and docs/LEGAL-BRIEF.md is what they get. It checks the policy is true.
 */

const BODIES = [
  ['privacy.ar', LEGAL.privacy.ar.body],
  ['privacy.en', LEGAL.privacy.en.body],
];
const ALL = [...BODIES, ['terms.ar', LEGAL.terms.ar.body], ['terms.en', LEGAL.terms.en.body]];

/* --------------------------------------------------------- shape and parity */

test('both documents exist in both languages, with a title and a body', () => {
  for (const doc of ['privacy', 'terms']) {
    for (const lang of ['ar', 'en']) {
      const entry = LEGAL[doc][lang];
      assert.ok(entry?.title?.length > 0, `${doc}.${lang} has no title`);
      assert.ok(entry?.body?.length > 200, `${doc}.${lang} has no real body`);
    }
  }
});

test('the two languages of a document cover the same ground', () => {
  // Not a translation check — it is a check that one language did not get an
  // extra section, or lose one, which is how a bilingual policy quietly starts
  // promising two different things to two sets of customers.
  for (const doc of ['privacy', 'terms']) {
    const count = lang => (LEGAL[doc][lang].body.match(/^## /gm) || []).length;
    assert.equal(count('ar'), count('en'),
      `${doc}: Arabic has ${count('ar')} sections and English has ${count('en')}`);
  }
});

/* ------------------------------------------- claims tied to what the code does */

test('if the site runs analytics, the privacy policy says so', () => {
  const layout = read('app/layout.js');
  const hasAnalytics = /@vercel\/analytics|@vercel\/speed-insights/.test(layout);

  for (const [name, body] of BODIES) {
    if (hasAnalytics) {
      assert.match(body, /Vercel/i, `${name} does not mention the analytics the site actually loads`);
    }
    // The sentence that made the old policy false. Kept as an explicit refusal
    // rather than relying on the positive check above, because "no tracking" is
    // exactly the reassurance somebody reaches for when tidying this copy.
    assert.doesNotMatch(body, /no tracking|not track you|مفيش تتبّع إعلاني/i,
      `${name} claims there is no tracking while ${hasAnalytics ? 'analytics is loaded' : 'this may change'}`);
  }
});

test('the policy does not call email optional while checkout requires it', () => {
  const route = read('app/api/order/route.js');
  const emailRequired = /if \(!isEmail\(custEmail\)\)/.test(route);
  assert.ok(emailRequired, 'checkout no longer validates a mandatory email — revisit this test');

  assert.doesNotMatch(LEGAL.privacy.en.body, /Email \(optional\)/i,
    'the English policy still calls email optional');
  assert.doesNotMatch(LEGAL.privacy.ar.body, /الإيميل \(اختياري\)/,
    'the Arabic policy still calls email optional');
});

test('every table that stores an IP is covered by the technical-data claim', () => {
  // The old policy said "your IP address at the time of an order". Four tables
  // store one, including a quiz answer from somebody who never orders.
  const schema = read('db/schema.sql');
  const withIp = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)]
    .filter(([, , cols]) => /^\s+ip\s+TEXT/m.test(cols))
    .map(([, name]) => name);

  assert.ok(withIp.length >= 3, `expected several tables with an ip column, found ${withIp.join(', ')}`);
  for (const [name, body] of BODIES) {
    assert.match(body, /IP/i, `${name} does not mention IP at all`);
  }
  // The quiz is the one a reader would not guess, so it is named explicitly.
  if (withIp.includes('quiz_results')) {
    assert.match(LEGAL.privacy.en.body, /quiz/i, 'the quiz stores data and the policy is silent about it');
    assert.match(LEGAL.privacy.ar.body, /اختبار/, 'the Arabic policy is silent about the quiz');
  }
});

test('the processors the code actually uses are named', () => {
  // A reader is entitled to know who else holds their address. These are the
  // three the code talks to, read out of package.json rather than remembered.
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.keys(pkg.dependencies || {});
  const expect = [
    [deps.some(d => d.includes('neon')), /Neon/i, 'the database provider'],
    [deps.includes('resend'), /Resend/i, 'the email provider'],
    [deps.some(d => d.startsWith('@vercel/')), /Vercel/i, 'the host'],
  ];
  for (const [used, pattern, what] of expect) {
    if (!used) continue;
    for (const [name, body] of BODIES) {
      assert.match(body, pattern, `${name} does not name ${what}`);
    }
  }
});

test('the policy says where the data physically lives', () => {
  // Egyptian customers, a database in Frankfurt. Whatever the legal answer to
  // that is, the factual one belongs in the policy.
  assert.match(LEGAL.privacy.en.body, /Frankfurt|Germany/i);
  assert.match(LEGAL.privacy.ar.body, /فرانكفورت|ألمانيا/);
});

test('there is a retention section, because "forever" is not an answer', () => {
  for (const [name, body] of BODIES) {
    assert.match(body, /## (How long we keep it|مدة الاحتفاظ)/,
      `${name} has no retention section`);
  }
});

/* ------------------------------------------------------------------- terms */

test('the terms describe the cancellation the site actually offers', () => {
  // SELF_CANCELLABLE is real, customer-facing, and was not mentioned at all.
  const status = read('lib/order-status.js');
  assert.match(status, /SELF_CANCELLABLE/, 'self-cancellation is gone — revisit the terms');

  assert.match(LEGAL.terms.en.body, /cancel it yourself/i);
  assert.match(LEGAL.terms.ar.body, /تلغيه بنفسك/);
});

test('the returns clause is not narrower than the statutory right', () => {
  // The old terms offered 48 hours, damaged-or-wrong only. Egyptian consumer
  // protection law appears to give 14 days without a reason. The exact scope is
  // a question for a lawyer — that is what the [[...]] marker is for — but the
  // published text must not promise less than the law while that is open.
  for (const [name, body] of [['terms.en', LEGAL.terms.en.body], ['terms.ar', LEGAL.terms.ar.body]]) {
    assert.match(body, /14/, `${name} no longer states the 14-day return right`);
    assert.doesNotMatch(body, /48 hours|48 ساعة/,
      `${name} still limits returns to 48 hours`);
  }
});

/* --------------------------------------------------- the things still owed */

test('every placeholder still owed is marked so it can be found', () => {
  // [[...]] is the marker, and it is greppable on purpose. This test does not
  // fail while they are present — they are honest — it fails if somebody
  // invents a company registration number to make the page look finished.
  const markers = ALL.flatMap(([, body]) => body.match(/\[\[[^\]]+\]\]/g) || []);
  assert.ok(markers.length > 0, 'the placeholders vanished — were they filled in, or deleted?');

  for (const [name, body] of ALL) {
    // A registration number that is not a placeholder must not be a guess.
    const invented = body.match(/(?:commercial register|سجل تجاري)\s+(?!\[\[)(\S+)/i);
    assert.equal(invented, null,
      `${name} states a commercial register value (${invented?.[1]}) that nobody supplied`);
  }
});

test('the lawyer brief exists and names the open questions', () => {
  const brief = read('docs/LEGAL-BRIEF.md');
  assert.match(brief, /151/, 'the brief does not reference the data protection law');
  assert.match(brief, /181|consumer/i, 'the brief does not reference consumer protection');
  assert.match(brief, /Frankfurt|cross-border|transfer/i, 'the brief omits the transfer question');
});
