'use server';

import { csrfOk, currentAdmin } from '../../../lib/auth.js';
import { sql } from '../../../lib/db.js';
import { sendMail, tplOffer } from '../../../lib/mail.js';

/**
 * One slice of a broadcast.
 *
 * A serverless function is killed long before a four-thousand-name list is
 * finished, so the browser drives the send: it calls this action, gets back a
 * cursor, and calls again until `done`. Each call is a short, ordinary request.
 *
 * The cursor is the last subscriber id rather than an OFFSET, so someone
 * unsubscribing mid-broadcast cannot shift the window and make the loop skip
 * the person who happened to slide into the seam.
 */
const BATCH = 25;

export async function sendOfferBatch({ offerId, afterId = 0, csrf }) {
  if (!(await currentAdmin())) return { error: 'auth' };
  if (!(await csrfOk(csrf))) return { error: 'csrf' };

  const id = Number(offerId);
  const after = Number(afterId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(after) || after < 0) {
    return { error: 'bad_input' };
  }

  const [offer] = await sql`SELECT * FROM offers WHERE id = ${id}`;
  if (!offer) return { error: 'missing' };

  const batch = await sql`
    SELECT id, email, lang, token
      FROM subscribers
     WHERE status = 'active' AND id > ${after}
     ORDER BY id ASC
     LIMIT ${BATCH}`;

  let sent = 0;
  for (const sub of batch) {
    const [subject, html] = tplOffer(offer, sub.lang === 'en' ? 'en' : 'ar', sub.token);
    if (await sendMail({ to: sub.email, subject, html, kind: 'offer' })) sent++;
  }

  if (sent > 0) {
    await sql`UPDATE offers SET sent_count = sent_count + ${sent}, sent_at = now() WHERE id = ${id}`;
  }

  const last = batch.length ? Number(batch[batch.length - 1].id) : after;
  return {
    error: null,
    sent,
    processed: batch.length,
    nextAfterId: last,
    done: batch.length < BATCH,
  };
}
