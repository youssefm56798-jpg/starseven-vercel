/**
 * GET  /api/unsubscribe?t=TOKEN — the link in the footer of every marketing mail.
 * POST /api/unsubscribe?t=TOKEN — the same thing, for the mailbox provider.
 *
 * One click, no questions asked, no login. Required by every mailbox provider
 * and by GDPR-style consent rules.
 *
 * ---------------------------------------------------------------------------
 * Why there is a POST
 *
 * Gmail and Yahoo have required one-click unsubscribe from bulk senders since
 * February 2024. The mechanism is RFC 8058: the message carries
 * `List-Unsubscribe-Post: List=One-Click` (lib/mail.js adds it), the client
 * draws an Unsubscribe button next to the sender name, and pressing it POSTs
 * here — no page load, no round trip through the browser.
 *
 * It has to be a POST and not the existing GET, and the reason is the same one
 * that makes the GET slightly unsafe: spam filters and link scanners follow
 * links in mail, so a GET is not evidence that a person did anything. Under RFC
 * 8058 the POST is the deliberate act, and the body it carries is
 * `List-Unsubscribe=One-Click`.
 *
 * The GET keeps working exactly as it did — it is what the footer link in the
 * mail body opens, and it renders a page a human can read. That the same token
 * in a scanner's GET would also unsubscribe them is a real if small cost, and
 * it is the one every link-based unsubscribe pays; the alternative, a confirm
 * button, breaks "one click, no questions asked" for everybody in order to
 * protect the few. What is NOT paid here is a wrongly-kept subscription, which
 * is the failure that matters.
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

/**
 * The write, shared by both verbs so the two cannot come to disagree about what
 * unsubscribing means.
 *
 * Status and language in one round trip: the row tells us both whether there
 * was anyone to unsubscribe and which language to answer in.
 */
async function unsubscribe(req) {
  const token = (new URL(req.url).searchParams.get('t') || '').trim();
  if (!/^[a-f0-9]{40}$/.test(token)) return { state: 'bad', lang: 'ar', status: 404 };

  try {
    const rows = await sql`
      UPDATE subscribers SET status = 'unsubscribed' WHERE token = ${token} RETURNING lang`;

    if (!rows[0]) return { state: 'bad', lang: 'ar', status: 404 };
    return { state: 'done', lang: rows[0].lang === 'en' ? 'en' : 'ar', status: 200 };
  } catch (e) {
    console.error('[s7] unsubscribe failed:', e?.message || e);
    return { state: 'bad', lang: 'ar', status: 500 };
  }
}

export async function GET(req) {
  const { state, lang, status } = await unsubscribe(req);
  const [title, body] = COPY[lang][state];
  return brandPage({ lang, title, body, status, accent: false });
}

/**
 * The one-click POST. Answered in plain text, because nobody reads it: the
 * mailbox provider makes this request on the subscriber's behalf and shows its
 * own confirmation.
 *
 * The body is ignored on purpose. RFC 8058 specifies `List-Unsubscribe=One-Click`
 * in it, but the token in the URL is the whole of the authority here, exactly as
 * it is for the GET, and a request that carried the right token with the wrong
 * body would be a subscriber who asked to leave and was not let out.
 */
export async function POST(req) {
  const { state, status } = await unsubscribe(req);
  return new Response(state === 'done' ? 'unsubscribed' : 'not found', {
    status,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
