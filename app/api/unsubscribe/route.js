/**
 * GET /api/unsubscribe?t=TOKEN
 * One click, no questions asked, no login. Required by every mailbox provider
 * and by GDPR-style consent rules.
 */

import { sql } from '../../../lib/db.js';
import { brandPage } from '../_lib/shared.js';

export const dynamic = 'force-dynamic';

const COPY = {
  ar: {
    done: ['تم إلغاء الاشتراك', 'مش هيوصلك أي إيميلات تانية منّنا. لو غيّرت رأيك، تقدر تشترك تاني من الموقع في أي وقت.'],
    bad: ['اللينك مش صالح', 'ممكن تكون ألغيت الاشتراك قبل كده.'],
  },
  en: {
    done: ['Unsubscribed', 'You will not receive any more emails from us. Changed your mind? Subscribe again any time.'],
    bad: ['This link is not valid', 'You may have unsubscribed already.'],
  },
};

export async function GET(req) {
  const token = (new URL(req.url).searchParams.get('t') || '').trim();

  let state = 'bad';
  let lang = 'ar';
  let status = 404;

  if (/^[a-f0-9]{40}$/.test(token)) {
    try {
      // Status and language in one round trip: the row tells us both whether
      // there was anyone to unsubscribe and which language to answer in.
      const rows = await sql`
        UPDATE subscribers SET status = 'unsubscribed' WHERE token = ${token} RETURNING lang`;

      if (rows[0]) {
        lang = rows[0].lang === 'en' ? 'en' : 'ar';
        state = 'done';
        status = 200;
      }
    } catch (e) {
      console.error('[s7] unsubscribe failed:', e?.message || e);
      status = 500;
    }
  }

  const [title, body] = COPY[lang][state];
  return brandPage({ lang, title, body, status, accent: false });
}
