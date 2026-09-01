/**
 * How long personal data actually stays in this database.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 *
 * The privacy policy has always had a retention section. Until this file, the
 * database had nothing that enforced it. db/schema.sql carried three
 * `DELETE ... WHERE created_at < now() - interval '30 days'` lines, each with a
 * comment explaining that the deploy was the recurring job "because there is no
 * scheduler on this stack" — and by then there was one, /api/cron/release, so
 * the reasoning had outlived itself. Nothing at all pruned the tables that
 * matter most: an IP address on a quiz answer from somebody who never ordered,
 * and every address the shop has ever emailed, both kept for ever.
 *
 * A published retention promise that nothing implements is the same defect as
 * the policy that said there were no trackers while analytics ran. This is the
 * implementation, and tests/legal-copy.test.mjs checks the policy against it.
 *
 * ---------------------------------------------------------------------------
 * It redacts. It does not delete.
 *
 * This is the important design decision and it is not the obvious one.
 *
 * db/grants.mjs deliberately withholds DELETE from `orders`, `order_events`,
 * `order_tokens`, `order_attempts`, `email_log` and `quiz_results` — they are
 * between them the order history and the audit trail, and "a runtime that
 * cannot erase them cannot be used to cover tracks" is a property worth more
 * than the convenience of a tidy sweep. A prune job that needed DELETE on all
 * six would hand every one of those tables to anything that reached SQL
 * execution, in exchange for retention hygiene.
 *
 * So every step below blanks the PERSONAL COLUMN and leaves the row. What is
 * kept afterwards is a fact with nobody attached: that an order existed, that
 * an email was sent on a date, that somebody took the quiz and got wax. What
 * goes is the part a data-protection request is about. The privilege this needs
 * is UPDATE, which the role largely has already, rather than DELETE, which is
 * the one it must not get.
 *
 * `rate_limits` is the exception and is deleted outright: a counter in a window
 * that closed a week ago is not a record of anything.
 *
 * ---------------------------------------------------------------------------
 * The windows
 *
 * Each is the shortest span that still lets somebody do their job, and each is
 * quoted verbatim in the privacy policy — app/_components/legalCopy.js reads
 * DAYS below rather than restating the numbers, so the published document
 * cannot drift from the job that enforces it.
 */

/**
 * Days before each thing is redacted. Read by the policy copy and by the sweep.
 *
 *   orderIp / subscriberIp   90. An IP is kept to investigate a fraudulent
 *                            order or a signup flood, and a quarter is well
 *                            past the point where anybody is still looking.
 *   quizIp                   30. Nobody investigates a quiz answer. It is
 *                            recorded because the endpoint is rate limited and
 *                            an abuse burst is visible for days, not months.
 *   idempotency              30. The stored checkout reply carries the order
 *                            reference and the phone number. A retry lands
 *                            within seconds and a browser replay within
 *                            minutes; a month is already generous.
 *   emailRecipient           180. Long enough to answer "you never sent me the
 *                            confirmation" for any order still being argued
 *                            about, and short of keeping a permanent list of
 *                            every address the shop has ever touched.
 *   adminResetIp             30. Matches the row's own lifetime in the schema.
 *   rateLimit                7. A closed window.
 *   orderIdentity            1825, five years. This is the one the policy calls
 *                            "as long as needed for accounting and tax". The
 *                            money columns and the reference stay — they are
 *                            the books — and the customer comes off them once
 *                            no tax authority can still ask.
 */
export const DAYS = {
  orderIp: 90,
  subscriberIp: 90,
  quizIp: 30,
  idempotency: 30,
  emailRecipient: 180,
  adminResetIp: 30,
  rateLimit: 7,
  orderIdentity: 1825,
};

/**
 * One pass of the sweep.
 *
 * `sql` is passed in rather than imported so this can be run against a
 * throwaway database by scripts/, the same way the other verify: scripts work.
 *
 * Each step is independent and each is idempotent: the predicates all test that
 * the column still HAS something in it, so a second run in the same minute
 * touches nothing, and a step that fails does not stop the ones after it. The
 * counts come back so the reply says what actually happened rather than 'ok'.
 *
 * There is no batching here, unlike the release sweep, and the reason is that
 * these statements send no email and move no stock — they are one UPDATE each
 * over a shop-sized table, and the first run is the only expensive one because
 * every run after it finds only what a single day added.
 */
export async function prune(sql) {
  const done = {};
  const failed = [];

  const step = async (name, run) => {
    try {
      done[name] = (await run()).length;
    } catch (e) {
      failed.push(name);
      console.error('[s7] retention step failed:', name, e?.message || e);
    }
  };

  // The IP recorded with an order, and with a newsletter signup.
  await step('orderIp', () => sql`
    UPDATE orders SET ip = ''
     WHERE ip <> '' AND created_at < now() - (${String(DAYS.orderIp)} || ' days')::interval
    RETURNING 1`);

  await step('subscriberIp', () => sql`
    UPDATE subscribers SET ip = ''
     WHERE ip <> '' AND created_at < now() - (${String(DAYS.subscriberIp)} || ' days')::interval
    RETURNING 1`);

  // A quiz answer keeps its shape — hair type, concern, what it recommended —
  // and loses the only column that pointed at a person. The row is the demand
  // signal the policy says it is kept for, and it stays.
  await step('quizIp', () => sql`
    UPDATE quiz_results SET ip = ''
     WHERE ip <> '' AND created_at < now() - (${String(DAYS.quizIp)} || ' days')::interval
    RETURNING 1`);

  /*
   * The stored checkout reply, which contains the reference and the phone
   * number the shop was about to call.
   *
   * Emptied rather than deleted, which leaves a key that would answer a replay
   * with an empty object instead of the original reply. That is only reachable
   * by a retry of a request made a month ago, which no browser and no network
   * performs — and db/schema.sql deletes these rows outright on the next deploy
   * anyway. What this covers is the stretch between deploys.
   */
  await step('idempotency', () => sql`
    UPDATE order_attempts SET response = '{}'::json
     WHERE response::text <> '{}'
       AND created_at < now() - (${String(DAYS.idempotency)} || ' days')::interval
    RETURNING 1`);

  // The send log keeps that a message of this kind went out on this day, and
  // whether it failed. Who it went to is the part with a person in it.
  await step('emailRecipient', () => sql`
    UPDATE email_log SET to_email = ''
     WHERE to_email <> ''
       AND created_at < now() - (${String(DAYS.emailRecipient)} || ' days')::interval
    RETURNING 1`);

  // Staff rather than customers, and the row is already dead — the token is
  // expired and usually used. The IP is the only part still worth removing.
  await step('adminResetIp', () => sql`
    UPDATE admin_password_resets SET requested_ip = ''
     WHERE requested_ip <> ''
       AND created_at < now() - (${String(DAYS.adminResetIp)} || ' days')::interval
    RETURNING 1`);

  // The one outright delete, and the one table where the row IS the personal
  // data: a counter keyed on an IP address.
  await step('rateLimit', () => sql`
    DELETE FROM rate_limits
     WHERE window_start < now() - (${String(DAYS.rateLimit)} || ' days')::interval
    RETURNING 1`);

  /*
   * Five years on, the customer comes off the order.
   *
   * The reference, the dates, the money and the line items all stay — they are
   * the accounts, and a consumer sale's record is still a valid one with the
   * buyer's name off it. What goes is name, phone, address, notes, email and
   * the access-token digest, which together are the whole of what the policy
   * promises is not kept for ever.
   *
   * Blanking `access_hash` also retires the order's tracking link, since
   * lib/order-access.js matches a presented token against that digest and there
   * will no longer be one to match.
   */
  await step('orderIdentity', () => sql`
    UPDATE orders
       SET name = '', phone = '', address = '', notes = '', email = '', access_hash = ''
     WHERE (name <> '' OR phone <> '' OR address <> '' OR email <> '' OR access_hash <> '')
       AND created_at < now() - (${String(DAYS.orderIdentity)} || ' days')::interval
    RETURNING 1`);

  return { done, failed };
}
