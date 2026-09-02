/**
 * Whether a request really came from the scheduler.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own file
 *
 * There are two scheduled routes now — /api/cron/release, which cancels orders
 * in bulk, and /api/cron/prune, which redacts personal data — and both are
 * public URLs whose only guard is this comparison. A second copy of a
 * constant-time compare is a copy that can be "simplified" to === by somebody
 * who does not know why it is written the way it is, in a file the reviewer of
 * the first one never opens. One implementation, one place to get it right.
 *
 * ---------------------------------------------------------------------------
 * It fails closed, including on the scheduler
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every invocation —
 * but ONLY when CRON_SECRET is set on the project. With the variable unset it
 * sends no header at all, and a route that read a missing header as "must be
 * the scheduler, then" would be a public URL that cancels orders.
 *
 * So no secret configured means nothing is authorised, including the scheduler.
 * A sweep that is not running is a visible problem — stock stops coming back,
 * and each route's reply says why. A sweep anybody can trigger is an invisible
 * one.
 *
 * The comparison is length-checked first and then runs over the whole string
 * without returning early on the first byte that differs. A timing oracle on a
 * secret this valuable is not worth saving three lines over.
 */
export function cronAuthorised(req) {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return false;

  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (given.length !== secret.length) return false;

  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
