/**
 * POST /api/subscribe
 * Newsletter signup for sale/offer announcements. Double opt-in: the row lands
 * as `pending` and only becomes `active` when the emailed link is clicked.
 *
 * Body: { email, name?, phone?, hair_type?, lang?, source?, hp? }
 * `hp` is a honeypot — bots fill it, humans never see it.
 */

import { after } from 'next/server';
import { sql, clientIp, rateOk } from '../../../lib/db.js';
import { ok, fail, readJson, langOf, token40 } from '../../../lib/http.js';
import { normalizePhone } from '../../../lib/phone.js';
import { sendMail, tplConfirm } from '../../../lib/mail.js';
import { bySlug } from '../../../lib/hairtypes.js';
import { limits } from '../../../lib/config.js';
import { str, trapped, isEmail, tooMany, tooBig } from '../_lib/shared.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { body = {}, tooLarge } = await readJson(req);
  if (tooLarge) return tooBig();

  const lang = langOf(body.lang);
  const ar = lang === 'ar';

  // Honeypot: pretend it worked, save nothing.
  if (trapped(body.hp)) return ok({ status: 'pending' });

  const ip = clientIp(req);
  if (!(await rateOk('subscribe', ip, ...limits.subscribe))) return tooMany(lang);

  // Lowercased so one person cannot occupy two rows with the same mailbox.
  const email = str(body.email, 190).toLowerCase();
  if (!isEmail(email)) {
    return fail(
      ar ? 'اكتب إيميل صحيح.' : 'Please enter a valid email address.',
      422, { field: 'email' },
    );
  }

  const name = str(body.name, 120);
  const source = str(body.source, 48) || 'site';

  // Optional, but if they typed something it has to be a real number.
  let phone = '';
  if (str(body.phone, 32) !== '') {
    phone = normalizePhone(body.phone) || '';
    if (!phone) {
      return fail(
        ar ? 'رقم موبايل مصري غير صحيح.' : 'Please enter a valid Egyptian mobile number.',
        422, { field: 'phone' },
      );
    }
  }

  // An unrecognised hair type is dropped rather than rejected — it is a nice
  // to have on a signup form, not something worth blocking a subscriber over.
  const hair = bySlug(str(body.hair_type, 40))?.slug || '';

  // Whether this address is already on the list is not something an
  // unauthenticated caller may learn. The endpoint used to answer 'already' for
  // an active subscriber and 'pending' for anyone else, which turns one POST
  // into a yes/no oracle for any email. And re-sending a confirmation to an
  // ALREADY-ACTIVE address on demand makes the endpoint a way to mail an
  // arbitrary person the shop's confirmation, repeatedly. So an active address
  // is a silent no-op that returns the same shape as a genuine signup: nothing
  // written, nothing sent, and the caller cannot tell the two apart.
  const existing = await sql`SELECT status FROM subscribers WHERE email = ${email} LIMIT 1`;
  const alreadyActive = existing[0]?.status === 'active';
  const pendingResponse = ok({
    status: 'pending',
    emailed: true,
    message: ar
      ? 'بعتنالك إيميل تأكيد — افتحه وأكّد اشتراكك.'
      : 'Check your inbox for a confirmation email.',
  });
  if (alreadyActive) return pendingResponse;

  // Pending or previously unsubscribed — refresh the token and re-send.
  // Blank fields keep whatever we already knew instead of wiping it.
  const token = token40();
  await sql`
    INSERT INTO subscribers (email, name, phone, lang, hair_type, source, status, token, ip)
    VALUES (${email}, ${name}, ${phone}, ${lang}, ${hair}, ${source}, 'pending', ${token}, ${ip})
    ON CONFLICT (email) DO UPDATE
      SET name      = COALESCE(NULLIF(EXCLUDED.name, ''),      subscribers.name),
          phone     = COALESCE(NULLIF(EXCLUDED.phone, ''),     subscribers.phone),
          hair_type = COALESCE(NULLIF(EXCLUDED.hair_type, ''), subscribers.hair_type),
          lang      = EXCLUDED.lang,
          source    = EXCLUDED.source,
          status    = 'pending',
          token     = EXCLUDED.token,
          ip        = EXCLUDED.ip`;

  // The confirmation mail goes out AFTER the response, not before it. Content
  // and headers were already identical between an active address and a new one,
  // but timing was not: the active branch does one SELECT and returns in tens
  // of milliseconds, while awaiting a send to Resend added hundreds - so the
  // latency alone answered "is this address already a subscriber", which is the
  // exact oracle the identical body was meant to close. Deferring the send
  // takes the mail round-trip out of the response path; what is left between
  // the two branches is a single INSERT, lost in the jitter of a remote query.
  const [subject, html] = tplConfirm(token, lang);
  after(async () => {
    try {
      await sendMail({ to: email, subject, html, kind: 'confirm' });
    } catch (e) {
      console.error('[s7] confirm mail failed:', e?.message || e);
    }
  });

  return pendingResponse;
}
