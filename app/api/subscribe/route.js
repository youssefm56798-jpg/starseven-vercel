/**
 * POST /api/subscribe
 * Newsletter signup for sale/offer announcements. Double opt-in: the row lands
 * as `pending` and only becomes `active` when the emailed link is clicked.
 *
 * Body: { email, name?, phone?, hair_type?, lang?, source?, hp? }
 * `hp` is a honeypot — bots fill it, humans never see it.
 */

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

  const existing = await sql`SELECT status FROM subscribers WHERE email = ${email} LIMIT 1`;
  if (existing[0]?.status === 'active') {
    return ok({
      status: 'already',
      message: ar ? 'إنت مشترك بالفعل ★' : 'You are already on the list ★',
    });
  }

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

  const [subject, html] = tplConfirm(token, lang);
  const emailed = await sendMail({ to: email, subject, html, kind: 'confirm' });

  return ok({
    status: 'pending',
    emailed,
    message: ar
      ? 'بعتنالك إيميل تأكيد — افتحه وأكّد اشتراكك.'
      : 'Check your inbox — confirm your subscription from the email we just sent.',
  });
}
