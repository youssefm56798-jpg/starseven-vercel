import { sql } from '../../../../lib/db.js';
import { ok, fail } from '../../../../lib/http.js';
import { cronAuthorised } from '../../../../lib/cron-auth.js';
import { prune, DAYS } from '../../../../lib/retention.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/prune — make the privacy policy's retention section true.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 *
 * The policy tells customers that IP logs are kept "a short period", that quiz
 * answers are not kept indefinitely, and that orders come off the books once
 * the tax period has passed. None of that happened. The three
 * `DELETE ... interval` lines in db/schema.sql run when the schema is applied
 * and at no other time, and they do not cover a single one of the columns a
 * customer would actually ask about: the IP on their order, the IP on their
 * quiz answer, their address in the send log.
 *
 * So this is the job the document was describing. It runs nightly, an hour
 * after the release sweep, and lib/retention.js holds both the windows and the
 * argument for each of them.
 *
 * ---------------------------------------------------------------------------
 * It redacts columns, it does not delete rows
 *
 * The full reasoning is in lib/retention.js, and it is worth knowing before
 * reading the reply: this route cannot erase an order, a send-log line or a
 * quiz answer, and it is not meant to be able to. db/grants.mjs withholds
 * DELETE from those tables on purpose. What the sweep removes is the personal
 * column; what it leaves is the fact, with nobody attached to it.
 *
 * ---------------------------------------------------------------------------
 * Nothing here is destructive to the shop
 *
 * Which is why, unlike the release sweep, it has no kill switch. Turning the
 * release sweep off is a real operational choice — it decides whether stock
 * comes back. Turning this off would only mean keeping personal data the shop
 * has published a promise not to keep, and if that is ever needed the answer is
 * to change the window in lib/retention.js and the policy sentence that quotes
 * it, together, in one commit.
 *
 * The guard is the same as the release sweep's, shared rather than copied —
 * see lib/cron-auth.js, which fails closed when CRON_SECRET is unset.
 */
export async function GET(req) {
  if (!cronAuthorised(req)) return fail('forbidden', 403);

  const { done, failed } = await prune(sql);

  const total = Object.values(done).reduce((a, b) => a + b, 0);
  if (total || failed.length) {
    console.log(`[s7] retention sweep: redacted ${total}, failed ${failed.length}`);
  }

  /*
   * The per-step counts, not a total, and the windows alongside them.
   *
   * Somebody reads this reply exactly once — the day they are asked to prove
   * the shop does what its policy says. A single number would answer "did it
   * run"; this answers "and what did it do, under which rule", which is the
   * question that was actually asked.
   */
  return ok({ redacted: done, failed, windowDays: DAYS });
}
