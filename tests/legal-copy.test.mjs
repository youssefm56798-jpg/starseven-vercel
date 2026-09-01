import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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

/* ------------------------------------------ retention, which is now a real job */

/**
 * The section that was aspirational until lib/retention.js existed.
 *
 * The policy used to say quiz answers and IP logs were kept "a short period"
 * while nothing in the deployment ever removed one. The three
 * `DELETE ... interval` lines in db/schema.sql run when the schema is applied
 * and never again, and none of them touched a column a customer would ask
 * about. These tests are what stops that drifting back: the periods in the
 * document are interpolated from DAYS, and the job that applies them has to be
 * scheduled and has to name every table the document mentions.
 */

test('every period the policy publishes is the one the sweep actually applies', async () => {
  const { DAYS } = await import('../lib/retention.js');

  // The document quotes days for these; a number that stopped matching would
  // mean the policy and the job had come apart, which is the whole failure.
  for (const key of ['orderIp', 'quizIp', 'idempotency', 'emailRecipient', 'rateLimit']) {
    for (const [name, body] of BODIES) {
      assert.match(body, new RegExp(`\\b${DAYS[key]}\\b`),
        `${name} does not state the ${key} window of ${DAYS[key]} days`);
    }
  }

  const years = Math.round(DAYS.orderIdentity / 365);
  assert.match(LEGAL.privacy.en.body, new RegExp(`\\b${years} years\\b`),
    'the English policy no longer says how long an order keeps a customer on it');
  assert.match(LEGAL.privacy.ar.body, new RegExp(`\\b${years} `),
    'the Arabic policy no longer says how long an order keeps a customer on it');
});

test('the retention sweep is scheduled, not merely written', () => {
  // A prune job nobody runs is the same defect as a policy nobody implements.
  const vercel = JSON.parse(read('vercel.json'));
  const paths = (vercel.crons || []).map(c => c.path);
  assert.ok(paths.includes('/api/cron/prune'),
    `vercel.json does not schedule the retention sweep: ${paths.join(', ') || 'no crons at all'}`);

  const route = read('app/api/cron/prune/route.js');
  assert.match(route, /prune\(sql\)/, 'the scheduled route does not run the sweep');
});

test('the sweep touches every table the policy names a period for', () => {
  const retention = read('lib/retention.js');
  for (const table of ['orders', 'subscribers', 'quiz_results', 'order_attempts', 'email_log', 'rate_limits']) {
    assert.match(retention, new RegExp(`\\b${table}\\b`),
      `the policy publishes a retention period that lib/retention.js does not apply to ${table}`);
  }
});

test('the sweep redacts and cannot delete the audit trail', async () => {
  /*
   * The design decision the policy depends on, asserted so that a later "tidy
   * up" cannot quietly turn the retention job into a way to erase orders.
   * db/grants.mjs withholds DELETE from the audit tables; if the sweep ever
   * needs it, this fails and the conversation happens here rather than after.
   */
  const { GRANTS } = await import('../db/grants.mjs');
  for (const table of ['orders', 'email_log', 'quiz_results', 'order_attempts']) {
    assert.ok(!GRANTS[table].includes('DELETE'),
      `${table} now grants DELETE to the runtime - the retention sweep is supposed to redact, not erase`);
    assert.ok(GRANTS[table].includes('UPDATE'),
      `${table} has no UPDATE, so the retention sweep cannot redact it`);
  }
});

/* --------------------------------------------------- analytics, when it changes */

test('the Google Analytics paragraph is gated on the same variable as the script', () => {
  /*
   * GA4 is wired up and dormant: app/_components/Telemetry.js loads it only when
   * NEXT_PUBLIC_GA_ID is set, and next.config.mjs opens the CSP for Google on
   * the same condition. Setting that variable in Vercel would put _ga cookies on
   * every visitor - which would make the cookie sentence in this policy false,
   * from a deploy, with no code review anywhere near it.
   *
   * So the copy reads the same gate. This asserts the wiring; the test below
   * asserts the behaviour.
   */
  assert.match(read('app/_components/Telemetry.js'), /NEXT_PUBLIC_GA_ID/,
    'Telemetry no longer gates GA on NEXT_PUBLIC_GA_ID - this test needs rewriting, not deleting');
  assert.match(read('app/_components/legalCopy.js'), /NEXT_PUBLIC_GA_ID/,
    'the policy does not read the GA gate, so turning GA on would leave it saying customers get no cookies');
});

test('turning Google Analytics on turns the Google paragraph on', () => {
  /*
   * Loaded in a child process with the variable set, because the module reads it
   * once at import and this suite has already imported it without.
   */
  const script = `
    import { LEGAL } from './app/_components/legalCopy.js';
    const out = { en: LEGAL.privacy.en.body, ar: LEGAL.privacy.ar.body };
    process.stdout.write(JSON.stringify(out));
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NEXT_PUBLIC_GA_ID: 'G-TESTONLY' },
  });
  assert.equal(res.status, 0, `could not render the policy with GA configured: ${res.stderr}`);

  const withGa = JSON.parse(res.stdout);
  assert.match(withGa.en, /Google Analytics/,
    'GA is configured and the English policy does not mention Google');
  assert.match(withGa.ar, /Google Analytics/,
    'GA is configured and the Arabic policy does not mention Google');
  assert.match(withGa.en, /_ga/, 'the policy does not say GA sets a cookie');

  // And with it unset - the state this suite already has - it must not.
  assert.doesNotMatch(LEGAL.privacy.en.body, /Google Analytics/,
    'the policy names Google Analytics while no GA id is configured');
});

/* ------------------------------------------------- consent, and for what channel */

test('the checkout consent asks for the channel the code actually uses', () => {
  /*
   * The checkbox said "Send me offers and discounts on my number" and what it
   * did was add an EMAIL address to the list that lib/mail.js broadcasts to.
   * Consent gathered for one channel and used on another is not consent for the
   * channel it was used on, whatever the policy says elsewhere.
   */
  const checkout = read('app/checkout/CheckoutClient.js');
  const offers = read('app/admin/_lib/offer-actions.js');

  assert.match(offers, /sendMail\(/, 'offers are no longer sent by email - the consent copy needs revisiting');
  assert.doesNotMatch(offers, /whatsapp|sms/i,
    'offers now go out on another channel; the checkout checkbox and the policy both say email only');

  assert.doesNotMatch(checkout, /offers and discounts on my number/i,
    'the English checkbox still asks for the mobile number to be used for marketing');
  assert.doesNotMatch(checkout, /العروض والخصومات على رقمي/,
    'the Arabic checkbox still asks for the mobile number to be used for marketing');

  for (const [name, body] of BODIES) {
    assert.match(body, /email|الإيميل/i, `${name} does not say which channel offers are sent on`);
  }
});

/* ----------------------------------------------- the deadline the shop enforces */

test('the terms state the hold window that actually cancels the order', async () => {
  /*
   * /api/cron/release cancels an unconfirmed order after ORDER_HOLD_HOURS, and
   * after the shorter ORDER_WARNED_HOLD_HOURS when the WhatsApp confirmation
   * was delivered and ignored. A customer whose order disappears overnight was
   * told about it nowhere until this clause existed.
   */
  const { orderHoldHours, orderWarnedHoldHours } = await import('../lib/config.js');
  if (!orderHoldHours) return; // the sweep is off, and so is the clause

  assert.match(LEGAL.terms.en.body, new RegExp(`\\b${orderHoldHours} hours\\b`),
    'the English terms do not state the hold window that cancels an unconfirmed order');
  assert.match(LEGAL.terms.ar.body, new RegExp(`\\b${orderHoldHours} `),
    'the Arabic terms do not state the hold window that cancels an unconfirmed order');
  assert.match(LEGAL.terms.en.body, new RegExp(`\\b${orderWarnedHoldHours} hours\\b`),
    'the English terms do not state the shorter window applied after a delivered WhatsApp confirmation');
});
