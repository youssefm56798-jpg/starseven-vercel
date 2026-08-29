/**
 * POST /api/subscribe — newsletter signup, double opt-in.
 *
 * The route's own comment sets the bar this file has to clear. It says the
 * endpoint must not become an oracle for whether an address is already on the
 * list: the two branches — "we have never seen you" and "you are already an
 * active subscriber" — have to be indistinguishable to the caller. They were
 * not, twice. First the body differed ('already' against 'pending'). Then the
 * body matched but the LATENCY did not, because the new-subscriber branch
 * awaited a send to Resend and the active branch returned after one SELECT, so
 * the response time answered the question the body refused to.
 *
 * The mail send moved into after(), and this file is the first thing that has
 * ever checked either half of that claim.
 *
 * There is no way to make a black-box timing assertion that is both tight and
 * stable, so this does not try to pick a number out of the air. It measures
 * what one extra database round trip costs on the machine it is running on —
 * by timing two other routes that differ by exactly one — and then requires the
 * gap between the two subscribe branches to be within a small multiple of that.
 * A response that waits on a third-party mail API is nowhere near that budget.
 */

import { median, auc } from './harness.mjs';

const settle = ms => new Promise(r => setTimeout(r, ms));

let n = 0;
const fresh = () => `rt-new-${Date.now().toString(36)}-${++n}@example.test`;

export default async function subscribe({ db, api, ip, check, checkThat, section, sub, note }) {
  section('POST /api/subscribe');

  const post = (json, who) => api('/api/subscribe', { method: 'POST', ip: ip(who), json });

  const rowFor = async email =>
    (await db`SELECT email, name, phone, lang, hair_type, source, status, token, ip, confirmed_at
                FROM subscribers WHERE email = ${email}`)[0] || null;
  const mailsTo = async email =>
    Number((await db`SELECT count(*)::int AS n FROM email_log WHERE to_email = ${email}`)[0].n);

  /* ----------------------------------------------------------- happy path */

  sub('a new address');
  const first = fresh();
  const res = await post({ email: first, name: 'Nour', lang: 'en', source: 'footer', hair_type: 'curly' }, 'sub-a');

  check('200', res.status, 200);
  check('the body says pending and claims a mail is on its way',
    res.json, {
      ok: true, status: 'pending', emailed: true,
      message: 'Check your inbox for a confirmation email.',
    });

  const row = await rowFor(first);
  check('the row lands pending, not active', row?.status, 'pending');
  checkThat('with a 40-hex confirmation token', /^[a-f0-9]{40}$/.test(row?.token || ''), row?.token);
  check('and the fields it was given', [row?.name, row?.lang, row?.source, row?.hair_type],
    ['Nour', 'en', 'footer', 'curly']);
  check('and the caller address, in full', row?.ip, ip('sub-a'));

  // after() runs once the response is on the wire, so the log row appears a
  // moment later rather than before the request returns.
  await settle(1500);
  check('a confirmation was attempted', await mailsTo(first), 1);
  const [logged] = await db`SELECT kind, status FROM email_log WHERE to_email = ${first}`;
  check('as a confirm mail, and it failed cleanly with no key configured',
    [logged.kind, logged.status], ['confirm', 'failed']);

  sub('normalisation');
  const mixed = `RT-Mixed-${Date.now().toString(36)}@Example.TEST`;
  await post({ email: mixed }, 'sub-a');
  check('the address is lower-cased so one mailbox cannot hold two rows',
    (await rowFor(mixed.toLowerCase()))?.email, mixed.toLowerCase());

  const phoned = fresh();
  await post({ email: phoned, phone: '+20 101 234 5678' }, 'sub-a');
  check('an international phone is normalised to local form',
    (await rowFor(phoned))?.phone, '01012345678');

  const noType = fresh();
  await post({ email: noType, hair_type: 'mullet' }, 'sub-a');
  check('an unrecognised hair type is dropped, not rejected',
    [(await rowFor(noType))?.status, (await rowFor(noType))?.hair_type], ['pending', '']);

  const defaulted = fresh();
  await post({ email: defaulted }, 'sub-b');
  check('source defaults to site', (await rowFor(defaulted))?.source, 'site');

  /* ------------------------------------------------------------ rejections */

  sub('addresses it will not take');
  const bad = [
    ['missing', {}],
    ['blank', { email: '   ' }],
    ['no at sign', { email: 'nobody.example.test' }],
    ['no domain dot', { email: 'nobody@example' }],
    ['one-letter tld', { email: 'nobody@example.t' }],
    ['spaces inside', { email: 'no body@example.test' }],
    ['two at signs', { email: 'a@b@example.test' }],
    ['over 190 characters', { email: 'a'.repeat(180) + '@example-long-domain.test' }],
    ['not a string', { email: { address: 'a@b.test' } }],
  ];
  for (const [label, json] of bad) {
    const r = await post(json, 'sub-bad-' + label);
    check(`email ${label} → 422`, [r.status, r.json?.field], [422, 'email']);
  }

  const badPhone = await post({ email: fresh(), phone: '0999999999' }, 'sub-c');
  check('a phone that is not an Egyptian mobile → 422', [badPhone.status, badPhone.json?.field], [422, 'phone']);
  const blankPhone = await post({ email: fresh(), phone: '   ' }, 'sub-c');
  check('but a blank phone is simply absent', blankPhone.status, 200);

  /* -------------------------------------------------------------- honeypot */

  sub('the honeypot');
  const trapped = fresh();
  const hp = await post({ email: trapped, hp: 'http://spam.example' }, 'sub-hp');
  check('a filled trap answers 200', hp.status, 200);
  check('and nothing is written', await rowFor(trapped), null);
  await settle(800);
  check('and nothing is sent', await mailsTo(trapped), 0);

  const hpTrue = fresh();
  await post({ email: hpTrue, hp: true }, 'sub-hp');
  check('an explicit true is a trap too', await rowFor(hpTrue), null);

  // trapped() is deliberately generous towards the human: only a non-empty
  // string or a literal true counts. A form that submits hp="" — which is what
  // an untouched hidden input actually sends — must go through as a real
  // signup, or the shop silently bins genuine subscribers.
  for (const value of ['', 0, false, null]) {
    const email = fresh();
    await post({ email, hp: value }, 'sub-hp2');
    checkThat(`hp = ${JSON.stringify(value)} is treated as untouched`,
      (await rowFor(email))?.status === 'pending', 'the signup was silently discarded');
  }

  // The trap is checked before the limiter, so a bot cannot spend a real
  // visitor's budget by hammering the endpoint with the field filled in.
  const hpBudget = ip('sub-hp-budget');
  for (let i = 0; i < 8; i++) {
    await api('/api/subscribe', { method: 'POST', ip: hpBudget, json: { email: fresh(), hp: 'x' } });
  }
  const afterBot = await api('/api/subscribe', { method: 'POST', ip: hpBudget, json: { email: fresh() } });
  check('eight trapped requests spend none of the limit', afterBot.status, 200);

  // Worth recording rather than asserting as a flaw: the trapped response is
  // `{ok, status}` and a real one is `{ok, status, emailed, message}`, so a bot
  // that compares the two CAN tell that the field gave it away. Harmless as
  // long as the trap is not the only defence — the limiter and the honest
  // validation are both behind it — but it is not the "answer exactly like a
  // success" the route comment describes.
  const realBody = await post({ email: fresh() }, 'sub-shape');
  checkThat('the trapped body is a strict subset of a real one, not a copy of it',
    JSON.stringify(hp.json) !== JSON.stringify(realBody.json),
    'they matched — the note below is out of date, which is good news');
  note('FINDING (minor): the honeypot reply omits `emailed` and `message`, so a bot');
  note('        can tell the trap fired. Returning the same body would close it.');

  /* -------------------------------------------------- re-subscribing paths */

  sub('an address that is already known');

  const pending = fresh();
  await post({ email: pending, name: 'First Name', phone: '01012345678', hair_type: 'wavy' }, 'sub-d');
  const before = await rowFor(pending);
  await post({ email: pending, name: '', phone: '', lang: 'en' }, 'sub-d');
  const after = await rowFor(pending);
  check('a pending address gets a new token', before?.token !== after?.token, true);
  check('blank fields keep what was already known',
    [after?.name, after?.phone, after?.hair_type], ['First Name', '01012345678', 'wavy']);
  check('but language and source always follow the latest request', after?.lang, 'en');
  await post({ email: pending, name: 'Second Name' }, 'sub-d');
  check('a filled field overwrites', (await rowFor(pending))?.name, 'Second Name');

  const gone = fresh();
  await post({ email: gone }, 'sub-e');
  await db`UPDATE subscribers SET status = 'unsubscribed' WHERE email = ${gone}`;
  const back = await post({ email: gone }, 'sub-e');
  check('someone who left can come back, through the same double opt-in',
    [back.status, (await rowFor(gone))?.status], [200, 'pending']);

  /* ------------------------------------------------------------ the oracle */

  sub('an active address is not an oracle');

  const active = `rt-active-${Date.now().toString(36)}@example.test`;
  await db`INSERT INTO subscribers (email, name, lang, source, status, token, ip, confirmed_at)
           VALUES (${active}, 'Already In', 'en', 'site', 'active', ${'a'.repeat(40)}, '10.0.0.1', now())`;

  const known = await post({ email: active }, 'sub-oracle-1');
  const unknown = await post({ email: fresh() }, 'sub-oracle-2');

  check('the status codes match', [known.status, unknown.status], [200, 200]);
  check('the bodies match byte for byte', known.text, unknown.text);
  check('and so do the headers', known.headers, unknown.headers);
  check('including the claim that a mail went out', known.json?.emailed, true);

  // ...which is a lie for the active branch, and has to be. The point of the
  // silent no-op is that an attacker cannot use this endpoint to mail an
  // arbitrary address the shop's confirmation over and over.
  await settle(1200);
  const activeRow = await rowFor(active);
  check('nothing was written for the active address', activeRow?.token, 'a'.repeat(40));
  check('its status is untouched', activeRow?.status, 'active');
  check('and no mail was sent to it', await mailsTo(active), 0);

  /* ---------------------------------------------------- the timing channel */

  sub('and the two branches are not separable by latency');

  const SAMPLES = 14;

  /**
   * One database round trip, measured here rather than guessed.
   *
   * /api/quiz with an unknown hair type does exactly one query — the rate-limit
   * UPSERT — and then refuses. /api/coupon with an unknown code does that same
   * UPSERT and then one SELECT. The difference between their medians is what a
   * single round trip to this Postgres costs from this machine right now.
   *
   * Every request below gets its own /24, so all of them take the INSERT arm of
   * the limiter's UPSERT and none of them can exhaust a bucket. The subscribe
   * limit is five an hour, so a timing study is not possible any other way.
   */
  const oneQuery = [];
  const twoQueries = [];
  for (let i = 0; i < SAMPLES; i++) {
    oneQuery.push((await api('/api/quiz', {
      method: 'POST', ip: ip(`cal-q-${i}`), json: { hair_type: 'mullet' },
    })).ms);
    twoQueries.push((await api('/api/coupon', {
      method: 'POST', ip: ip(`cal-c-${i}`), json: { code: 'NOSUCHCODE', subtotal: 100 },
    })).ms);
  }
  const unit = Math.max(median(twoQueries) - median(oneQuery), 15);

  // Interleaved rather than one group after the other, so a slow patch of
  // network lands on both branches instead of only on whichever went second.
  const activeMs = [];
  const newMs = [];
  for (let i = 0; i < SAMPLES; i++) {
    activeMs.push((await post({ email: active }, `t-active-${i}`)).ms);
    newMs.push((await post({ email: fresh() }, `t-new-${i}`)).ms);
  }

  const gap = Math.abs(median(newMs) - median(activeMs));

  /**
   * The budget, and an honest account of what this assertion is worth.
   *
   * The strong evidence that the two branches are indistinguishable is above
   * this: identical status, identical bytes, identical headers, and an active
   * address that is neither written nor mailed while the reply insists
   * otherwise. Those are deterministic.
   *
   * This is not. Fourteen samples over a network to a remote Postgres cannot
   * separate "one extra INSERT" from "one extra INSERT and something else"
   * with any confidence, and a timing test that fails once a week on a busy
   * laptop gets deleted rather than investigated. So the budget is set wide
   * enough to be stable and is claimed only as what it is: a ceiling that an
   * awaited third-party mail call — the thing that actually was the oracle —
   * would have to be extraordinarily quick to slip under. It fires on a
   * regression of that size, not on a subtle one.
   *
   * Three terms because any one of them alone has a failure mode: the
   * calibration can under-measure on a quiet network, the proportional term
   * collapses if the database is local and fast, and the floor covers both.
   */
  const budget = Math.max(unit * 4, median(activeMs) * 0.9, 300);

  note(`one database round trip ≈ ${unit.toFixed(0)}ms`);
  note(`active branch median ${median(activeMs).toFixed(0)}ms, new branch median ${median(newMs).toFixed(0)}ms`);
  note(`separability (0.5 = indistinguishable, 1.0 = a perfect oracle): ${auc(newMs, activeMs).toFixed(2)}`);

  checkThat('neither branch waits on anything the other does not',
    gap <= budget,
    `gap ${gap.toFixed(0)}ms against a ${budget.toFixed(0)}ms ceiling — ` +
    `something in the new-subscriber path is being awaited that should be deferred`);

  /* ------------------------------------------------------- shapes and limits */

  sub('bodies and limits');
  const form = await api('/api/subscribe', {
    method: 'POST', ip: ip('sub-shapes'), json: { email: fresh() }, contentType: 'text/plain',
  });
  check('a cross-site form post cannot subscribe anyone',
    [form.status, form.json?.field], [422, 'email']);

  const big = '{"email":"a@b.test","name":"' + 'x'.repeat(200_000) + '"}';
  const tooBig = await api('/api/subscribe', {
    method: 'POST', ip: ip('sub-shapes'), body: big, contentType: 'application/json',
  });
  check('an oversized body is 413', tooBig.status, 413);

  /* ---------------------------------------------------------- rate limit */

  sub('five an hour, and the sixth is refused');

  // Small enough to do for real, so this is the one limiter in the suite that
  // is filled entirely by traffic — no row is wound forward by hand.
  const burst = ip('sub-burst');
  const codes = [];
  for (let i = 0; i < 6; i++) {
    codes.push((await api('/api/subscribe', {
      method: 'POST', ip: burst, json: { email: fresh() },
    })).status);
  }
  check('the first five are served and the sixth is not',
    codes, [200, 200, 200, 200, 200, 429]);

  const concurrent = ip('sub-race');
  const at = await Promise.all(Array.from({ length: 12 }, () =>
    api('/api/subscribe', { method: 'POST', ip: concurrent, json: { email: fresh() } })));
  const served = at.filter(r => r.status === 200).length;

  // The limiter is a single UPSERT that returns the post-increment count, so
  // twelve requests arriving together cannot each read "0 so far" and all pass.
  // A read-then-write limiter would let most of these through.
  check('twelve at once still only get five', served, 5);
}
