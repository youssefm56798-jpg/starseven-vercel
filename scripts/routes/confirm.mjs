/**
 * GET /api/confirm?t=TOKEN — the second half of the double opt-in.
 *
 * The only route in the app that a human opens directly, so it answers HTML
 * rather than JSON, and the interesting questions are different from every
 * other file here: does the token shape gate reach the database at all, does a
 * second click send a second welcome mail, and does the page say anything about
 * the token it was given.
 *
 * The 40-hex test on the token is not decoration. Without it, `t` goes into a
 * query on every request an idle crawler makes, and the route's own comment
 * says so: "Anything else never touches the query." That claim is checkable —
 * take the table away and see which inputs still answer 404 instead of 500.
 */

import { randomBytes } from 'node:crypto';

const settle = ms => new Promise(r => setTimeout(r, ms));
const token40 = () => randomBytes(20).toString('hex');

let n = 0;

export default async function confirm({ db, api, ip, check, checkThat, section, sub, note }) {
  section('GET /api/confirm');

  /** A pending subscriber with a token we chose, so the link is known up front. */
  const pending = async (lang = 'ar', status = 'pending') => {
    const token = token40();
    const email = `rt-confirm-${++n}-${Date.now().toString(36)}@example.test`;
    await db`INSERT INTO subscribers (email, lang, status, token, source, ip)
             VALUES (${email}, ${lang}, ${status}, ${token}, 'site', '10.0.0.1')`;
    return { email, token };
  };

  const statusOf = async email =>
    (await db`SELECT status, confirmed_at FROM subscribers WHERE email = ${email}`)[0];
  const mailsTo = async email =>
    await db`SELECT kind, status FROM email_log WHERE to_email = ${email} ORDER BY id`;

  /* ----------------------------------------------------------- happy path */

  sub('confirming');
  const a = await pending('ar');
  const res = await api(`/api/confirm?t=${a.token}`, { ip: ip('confirm') });

  check('200', res.status, 200);
  check('an HTML page, not JSON', res.header('content-type'), 'text/html; charset=utf-8');
  checkThat('with the confirmed copy', res.text.includes('تم تأكيد اشتراكك'), 'wrong page');

  const after = await statusOf(a.email);
  check('the subscriber is now active', after?.status, 'active');
  checkThat('and the confirmation is timestamped', after?.confirmed_at != null);

  await settle(1200);
  check('a welcome mail was attempted', (await mailsTo(a.email)).map(m => m.kind), ['welcome']);

  /* ------------------------------------------------------------ the page */

  sub('what the page discloses');

  // The token is a bearer credential for one subscriber's record. Reflecting it
  // into the HTML would put it in the browser's history and, on any outbound
  // link, in a Referer header.
  checkThat('the token is not echoed into the page',
    !res.text.includes(a.token), 'the confirmation token appears in the HTML');

  check('never cached', res.header('cache-control'), 'no-store');
  check('never indexed', res.header('x-robots-tag'), 'noindex');
  check('and nosniff, like every other response', res.header('x-content-type-options'), 'nosniff');
  checkThat('the page repeats the robots instruction in a meta tag',
    /<meta name="robots" content="noindex">/.test(res.text), 'no meta robots tag');

  sub('direction and language');
  const en = await pending('en');
  const enPage = await api(`/api/confirm?t=${en.token}`, { ip: ip('confirm') });
  checkThat('an English subscriber gets an English, left-to-right page',
    /<html lang="en" dir="ltr">/.test(enPage.text) && enPage.text.includes('Subscription confirmed'),
    'wrong language or direction');
  checkThat('an Arabic one gets right-to-left',
    /<html lang="ar" dir="rtl">/.test(res.text), 'wrong direction');

  /* ------------------------------------------------------- a second click */

  sub('clicking the link twice');
  const again = await api(`/api/confirm?t=${a.token}`, { ip: ip('confirm') });
  check('still 200', again.status, 200);
  checkThat('but the copy says already subscribed',
    again.text.includes('إنت مشترك بالفعل'), 'wrong page');

  await settle(1200);
  check('and no second welcome mail goes out',
    (await mailsTo(a.email)).length, 1);

  /* ------------------------------------------------------------- refusals */

  sub('links that are not links');
  const junk = [
    ['no parameter', ''],
    ['empty', '?t='],
    ['thirty-nine hex', '?t=' + 'a'.repeat(39)],
    ['forty-one hex', '?t=' + 'a'.repeat(41)],
    ['upper-case hex', '?t=' + 'A'.repeat(40)],
    ['not hex', '?t=' + 'z'.repeat(40)],
    ['a SQL fragment', "?t=' OR 1=1 --"],
    ['a path traversal', '?t=../../etc/passwd'],
  ];
  for (const [label, qs] of junk) {
    const r = await api(`/api/confirm${qs}`, { ip: ip('confirm') });
    check(`${label} → 404`, r.status, 404);
  }

  const unknown = await api(`/api/confirm?t=${token40()}`, { ip: ip('confirm') });
  check('a well-formed token nobody holds → 404', unknown.status, 404);
  checkThat('with the same "not valid" page a malformed one gets',
    unknown.text === (await api('/api/confirm?t=zzz', { ip: ip('confirm') })).text,
    'a malformed token and an unknown one render differently');

  /* --------------------------------------------------- the shape gate */

  sub('the shape gate really is a gate');

  // With the table gone, anything that reaches the query fails and the route
  // answers an honest 500. Anything that does not reach it still answers 404.
  // That difference is the proof that the 40-hex test happens first — and it is
  // the only way to demonstrate it from outside the process.
  await db`ALTER TABLE subscribers RENAME TO subscribers_hidden`;
  try {
    const wellFormed = await api(`/api/confirm?t=${token40()}`, { ip: ip('confirm') });
    check('a well-formed token with no database behind it → 500', wellFormed.status, 500);
    checkThat('and says the link may not have worked rather than that it was bad',
      wellFormed.text.includes('اللينك مش صالح'), 'unexpected copy');

    const malformed = await api('/api/confirm?t=nope', { ip: ip('confirm') });
    check('a malformed one still → 404, so it never reached the query', malformed.status, 404);
  } finally {
    await db`ALTER TABLE subscribers_hidden RENAME TO subscribers`;
  }

  /* ------------------------------------------- confirming after opting out */

  sub('an old confirmation link, clicked after unsubscribing');

  const leaver = await pending('en');
  await api(`/api/confirm?t=${leaver.token}`, { ip: ip('confirm') });
  await api(`/api/unsubscribe?t=${leaver.token}`, { ip: ip('confirm') });
  check('they are off the list', (await statusOf(leaver.email))?.status, 'unsubscribed');

  const revived = await api(`/api/confirm?t=${leaver.token}`, { ip: ip('confirm') });
  await settle(1200);
  const revivedRow = await statusOf(leaver.email);

  /**
   * These assertions were written the other way round, recording a finding
   * rather than a guarantee: /api/confirm re-activated anything that was not
   * already active, and because the unsubscribe link in the welcome mail
   * carries the SAME token as the confirm link in the opt-in mail, the original
   * confirmation email stayed a live re-subscribe button for as long as it sat
   * in someone's mailbox. Unsubscribe, then open the older message, and you
   * were back on the list with a fresh welcome — and a mailbox that prefetches
   * links did it with nobody clicking anything.
   *
   * The route now claims the row with a guarded UPDATE that matches only
   * 'pending' and 'bounced', which is the same rule /api/order already stated
   * for consent: someone who opted out stays opted out. So the link still
   * resolves, still answers 200, and still knows who they are — it simply does
   * not put them back.
   *
   * Kept here, flipped, rather than deleted. A regression would be silent
   * everywhere else: the page looks identical, the status quietly changes, and
   * the person it happens to is by definition someone who asked not to hear
   * from you.
   */
  check('an unsubscribed address stays unsubscribed', revivedRow?.status, 'unsubscribed');
  check('the link still resolves rather than 404ing', revived.status, 200);
  check('and no second welcome mail goes out',
    (await mailsTo(leaver.email)).map(m => m.kind), ['welcome']);

  /* --------------------------------------------------------------- limits */

  sub('what guards it');
  // Nothing, and that is a deliberate note rather than an assertion: adding a
  // limiter here would mean a shared office clicking their confirmation links
  // in the same minute could lock each other out of confirming. 2^160 tokens is
  // the guard, and it is a reasonable one.
  note('no rate limit on /api/confirm — the 40-hex token space is the only guard');
}
