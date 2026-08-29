/**
 * POST /api/order/find
 * Emails a fresh tracking link to the address an order was placed with.
 *
 * Body: { email, ref, lang?, hp? }
 * `hp` is a honeypot — bots fill it, humans never see it.
 *
 * ---------------------------------------------------------------------------
 * This endpoint must never answer the question it is asked
 *
 * The whole order model rests on one property: a wrong token, a wrong
 * reference and a reference that does not exist are indistinguishable from
 * outside. See lib/order-access.js. An endpoint that takes a reference and an
 * email and says whether they match would hand that property back, and it
 * would be worse than the page it protects — a reference is four random digits
 * inside a day, so an attacker who has one customer email can walk the space.
 *
 * So there is one answer here and every path returns it: if that matches an
 * order, we have sent the link. It is built before the lookup and returned
 * whether or not the lookup found anything, so there is no second response
 * expression in this file for the two to drift apart.
 *
 * Identical wording is only half of it. The other half is time, and the two
 * places it could leak are both closed:
 *
 *   the database  the lookup and the mint are ONE statement, so a hit and a
 *                 miss cost the same round trip and differ by one inserted
 *                 row. See issueRecoveryToken() in lib/order-access.js.
 *
 *   the mail      sent from after(), so it lands outside the response. Awaiting
 *                 Resend inline would make a match take hundreds of
 *                 milliseconds longer than a miss and answer the question in
 *                 latency that the body refuses to answer in words.
 *                 app/api/subscribe/route.js writes the same trap up at
 *                 length; it applies here for the same reason.
 *
 * The two 422s below are about the shape of what was typed and nothing else. A
 * caller learns that an address needs an @ in it, which they knew, and the
 * shape of a reference, which is printed in every email the shop sends. No
 * well-formed pair can reach them, so an attacker probing real references
 * takes the same path every time.
 */

import { after } from 'next/server';
import { clientIp, rateOk } from '../../../../lib/db.js';
import { ok, fail, readJson, langOf } from '../../../../lib/http.js';
import { sendMail } from '../../../../lib/mail.js';
import { tplOrderLink } from '../../../../lib/order-mail.js';
import { issueRecoveryToken, orderUrl } from '../../../../lib/order-access.js';
import { limits } from '../../../../lib/config.js';
import { str, trapped, isEmail, tooMany, tooBig } from '../../_lib/shared.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The shape a reference has, and the only one worth a database round trip. */
const REF = /^[A-Za-z0-9-]{1,32}$/;

export async function POST(req) {
  const { body = {}, tooLarge } = await readJson(req);
  if (tooLarge) return tooBig();

  const lang = langOf(body.lang);
  const ar = lang === 'ar';

  // The one answer. Built here, before anything has been looked up, so that
  // nothing downstream can accidentally make it depend on what was found.
  const answer = () => ok({
    status: 'sent',
    message: ar
      ? 'لو البيانات دي بتخص أوردر، بعتنا اللينك على الإيميل ده. شوف الإيميل — وبص في السبام كمان.'
      : 'If that matches an order, we have sent the link to that address. Check your inbox, and your spam folder.',
  });

  // Honeypot: answer exactly as if it worked, look nothing up, send nothing.
  if (trapped(body.hp)) return answer();

  const ip = clientIp(req);
  if (!(await rateOk('order-find', ip, ...limits.orderFind))) return tooMany(lang);

  const email = str(body.email, 190).toLowerCase();
  if (!isEmail(email)) {
    return fail(
      ar ? 'اكتب الإيميل اللي طلبت بيه.' : 'Enter the email you ordered with.',
      422, { field: 'email' },
    );
  }

  // Uppercased because references are minted uppercase and a customer reading
  // one off a phone screen types whatever they see.
  const ref = str(body.ref, 32).toUpperCase();
  if (!REF.test(ref)) {
    return fail(
      ar ? 'رقم الأوردر شكله كده: S7-2708-1234' : 'An order number looks like this: S7-2708-1234',
      422, { field: 'ref' },
    );
  }

  // Per email as well as per IP. One stops somebody grinding references from a
  // network; the other stops anybody using the shop to mail a person they do
  // not own. See the note on limits.orderFind in lib/config.js.
  if (!(await rateOk('order-find-email', email, ...limits.orderFindEmail))) return tooMany(lang);

  const issued = await issueRecoveryToken(ref, email);

  if (issued) {
    const { order, token } = issued;

    // The order remembers the language it was placed in, and that is the one
    // the mail is written in — not the language of the page the request came
    // from. The customer read Arabic at checkout; a stranger picking `lang`
    // does not get to change what lands in somebody else inbox.
    const mailLang = order.lang === 'en' ? 'en' : 'ar';
    const [subject, html] = tplOrderLink(order, mailLang, orderUrl(order.ref, token, mailLang));

    after(async () => {
      try {
        await sendMail({ to: order.email, subject, html, kind: 'order-link' });
      } catch (e) {
        console.error('[s7] order link mail failed:', e?.message || e);
      }
    });
  }

  return answer();
}
