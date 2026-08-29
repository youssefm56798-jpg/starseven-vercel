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
   * This is a finding, and the assertions below record what actually happens
   * rather than what should.
   *
   * /api/confirm re-activates anything that is not already active, and the
   * unsubscribe link in the welcome mail carries the SAME token as the confirm
   * link in the opt-in mail. So the original confirmation email stays a live
   * re-subscribe button for as long as it exists in someone's mailbox: click
   * unsubscribe, then click confirm in the older message, and you are back on
   * the list and sent a fresh welcome. A mailbox that prefetches links does it
   * without anyone clicking anything.
   *
   * /api/order already knows the rule — its consent upsert says "Someone who
   * opted out stays opted out; a checkout tick is not consent to undo that" and
   * enforces it in SQL. This route does not apply the same rule, and it is the
   * one with a link out in the world.
   *
   * The fix is small: treat 'unsubscribed' the way 'active' is treated, or
   * issue the unsubscribe link a token of its own.
   */
  check('the old confirm link puts them back on the list', revivedRow?.status, 'active');
  check('and it answered as though this were a normal confirmation', revived.status, 200);
  check('and mailed them again after they had opted out',
    (await mailsTo(leaver.email)).map(m => m.kind), ['welcome', 'welcome']);
  note('FINDING: /api/confirm re-activates an unsubscribed address, and the confirm');
  note('        and unsubscribe links share one token — so the old opt-in email is a');
  note('        permanent re-subscribe button. lib/order-status is not involved; the');
  note('        rule /api/order enforces on consent is simply not applied here.');

  /* --------------------------------------------------------------- limits */

  sub('what guards it');
  // Nothing, and that is a deliberate note rather than an assertion: adding a
  // limiter here would mean a shared office clicking their confirmation links
  // in the same minute could lock each other out of confirming. 2^160 tokens is
  // the guard, and it is a reasonable one.
  note('no rate limit on /api/confirm — the 40-hex token space is the only guard');
}
