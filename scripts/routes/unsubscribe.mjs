/**
 * GET /api/unsubscribe?t=TOKEN — one click, no login, no questions.
 *
 * Every mailbox provider expects this to work from a single GET with no
 * confirmation step, which means it has to be safe to hit repeatedly and by
 * accident: a link scanner, a prefetching client and a customer clicking twice
 * must all leave the same result. So the tests here are mostly about
 * idempotence and about the same token-shape gate /api/confirm has.
 */

import { randomBytes } from 'node:crypto';

const token40 = () => randomBytes(20).toString('hex');

let n = 0;

export default async function unsubscribe({ db, api, ip, check, checkThat, section, sub, note }) {
  section('GET /api/unsubscribe');

  const subscriber = async (lang = 'ar', status = 'active') => {
    const token = token40();
    const email = `rt-unsub-${++n}-${Date.now().toString(36)}@example.test`;
    await db`INSERT INTO subscribers (email, lang, status, token, source, ip, confirmed_at)
             VALUES (${email}, ${lang}, ${status}, ${token}, 'site', '10.0.0.1', now())`;
    return { email, token };
  };
  const rowFor = async email =>
    (await db`SELECT status, token FROM subscribers WHERE email = ${email}`)[0];

  /* ----------------------------------------------------------- happy path */

  sub('one click');
  const a = await subscriber('ar');
  const res = await api(`/api/unsubscribe?t=${a.token}`, { ip: ip('unsub') });

  check('200', res.status, 200);
  check('HTML', res.header('content-type'), 'text/html; charset=utf-8');
  checkThat('the done copy', res.text.includes('تم إلغاء الاشتراك'), 'wrong page');
  check('they are off the list', (await rowFor(a.email))?.status, 'unsubscribed');

  check('never cached', res.header('cache-control'), 'no-store');
  check('never indexed', res.header('x-robots-tag'), 'noindex');
  checkThat('the token is not echoed into the page',
    !res.text.includes(a.token), 'the token appears in the HTML');

  // The row keeps its token, which is what lets the same person subscribe again
  // later and lets the address be recognised rather than duplicated.
  check('the token survives, so the address stays recognisable',
    (await rowFor(a.email))?.token, a.token);

  sub('language');
  const en = await subscriber('en');
  const enPage = await api(`/api/unsubscribe?t=${en.token}`, { ip: ip('unsub') });
  checkThat('an English subscriber gets the English page, left to right',
    /<html lang="en" dir="ltr">/.test(enPage.text) && enPage.text.includes('Unsubscribed'),
    'wrong language or direction');

  /* ---------------------------------------------------------- idempotence */

  sub('clicked again, and again');

  // A mailbox that prefetches links will hit this before the human does, and a
  // customer who is not sure it worked will click twice. Both must see the
  // same page, and the second must not report failure.
  const second = await api(`/api/unsubscribe?t=${a.token}`, { ip: ip('unsub') });
  check('the same 200', second.status, 200);
  check('and the same page, byte for byte', second.text, res.text);
  check('still unsubscribed', (await rowFor(a.email))?.status, 'unsubscribed');

  const third = await api(`/api/unsubscribe?t=${a.token}`, { ip: ip('unsub') });
  check('and a third time', third.status, 200);

  // A pending subscriber who never confirmed can still opt out. Worth pinning:
  // the UPDATE has no status condition on purpose, so the link works from any
  // state rather than only from 'active'.
  const never = await subscriber('ar', 'pending');
  await api(`/api/unsubscribe?t=${never.token}`, { ip: ip('unsub') });
  check('someone who never confirmed can still opt out',
    (await rowFor(never.email))?.status, 'unsubscribed');

  /* ------------------------------------------------------------- refusals */

  sub('links that are not links');
  for (const [label, qs] of [
    ['no parameter', ''],
    ['empty', '?t='],
    ['thirty-nine hex', '?t=' + 'a'.repeat(39)],
    ['upper-case hex', '?t=' + 'A'.repeat(40)],
    ['not hex', '?t=' + 'z'.repeat(40)],
    ['a SQL fragment', "?t=' OR 1=1 --"],
  ]) {
    const r = await api(`/api/unsubscribe${qs}`, { ip: ip('unsub') });
    check(`${label} → 404`, r.status, 404);
  }

  const unknown = await api(`/api/unsubscribe?t=${token40()}`, { ip: ip('unsub') });
  check('a well-formed token nobody holds → 404', unknown.status, 404);

  // The blanket UPDATE could have unsubscribed every row if the token had ever
  // been interpolated rather than parameterised. It has not, and this is the
  // cheapest way to keep it that way.
  const survivors = await db`SELECT count(*)::int AS n FROM subscribers WHERE status <> 'unsubscribed'`;
  checkThat('and none of the SQL above unsubscribed anybody else',
    Number(survivors[0].n) > 0, 'every subscriber was unsubscribed by one of those requests');

  /* ---------------------------------------------------- the shape gate */

  sub('the shape gate, again');
  await db`ALTER TABLE subscribers RENAME TO subscribers_hidden`;
  try {
    const wellFormed = await api(`/api/unsubscribe?t=${token40()}`, { ip: ip('unsub') });
    check('a well-formed token with no database behind it → 500', wellFormed.status, 500);
    const malformed = await api('/api/unsubscribe?t=nope', { ip: ip('unsub') });
    check('a malformed one → 404, having never reached the query', malformed.status, 404);
  } finally {
    await db`ALTER TABLE subscribers_hidden RENAME TO subscribers`;
  }

  // The 500 page is the Arabic default, because there is no row to read a
  // language from. Stated rather than asserted as a defect: answering in the
  // wrong language beats answering with a stack trace, and the alternative
  // would be guessing from Accept-Language.
  note('a 500 here always renders in Arabic — the language lives in the row it could not read');
}
