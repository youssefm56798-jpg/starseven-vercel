/**
 * What the running application is allowed to do to this database.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * The app connected as `neondb_owner`: the role Neon hands you, which owns
 * every table, can run any DDL, and carries the BYPASSRLS attribute. That is
 * the right credential for a migration and the wrong one for a web server.
 * Anything that reached SQL execution through the running site - an injection
 * that gets past the tagged templates, a compromised dependency, a mistake in a
 * future query - inherited the power to DROP the orders table.
 *
 * So the runtime gets its own role with the smallest set of grants that still
 * lets every code path work, and the owner string stays behind, used only by
 * the migration that genuinely needs DDL.
 *
 * This is NOT row-level security and does not pretend to be. RLS answers "which
 * rows may this USER see", and this application has no per-user database
 * identity to answer it with - customers have no accounts at all, and reach an
 * order through a hashed access token. What this does answer is "what may the
 * web server do at all", which is the question that actually has teeth here.
 *
 * ---------------------------------------------------------------------------
 * How the matrix was arrived at
 *
 * Every entry was read out of the queries in app/ and lib/, not guessed, and
 * tests/db-grants.test.mjs re-derives it from the source on every run - so a
 * new write to a table with no grant for it fails the suite rather than failing
 * in production at midnight. Two rules are easy to get wrong and are worth
 * naming:
 *
 *   - `INSERT ... ON CONFLICT DO UPDATE` needs UPDATE as well as INSERT, even
 *     where no UPDATE statement is written anywhere. rate_limits is the case
 *     that looks read-only-ish and is not.
 *   - Identity columns need no sequence grant: INSERT covers the sequence
 *     Postgres creates behind the column. A STANDALONE sequence is a different
 *     object with its own privileges, and calling nextval() on one needs USAGE
 *     granted explicitly. This schema has exactly one — order_ref_seq, which
 *     mints the customer-facing order number — and it is the kind of omission
 *     that cannot be found in development: the owner role can do anything, so
 *     the checkout works locally and every order fails in production with a
 *     permission error. SEQUENCES below exists so that it is written down, and
 *     tests/db-grants.test.mjs fails if the code calls nextval() on a sequence
 *     that is not listed.
 *
 * ---------------------------------------------------------------------------
 * The absences are the point
 *
 * DELETE is withheld from `orders`, `order_events`, `order_tokens`,
 * `order_attempts`, `email_log` and `quiz_results`. Nothing in the code deletes
 * from them, and they are between them the order history and the audit trail -
 * the records that answer what happened after something goes wrong. A runtime
 * that cannot erase them cannot be used to cover tracks. Three of the six do
 * carry UPDATE, so that lib/retention.js can blank the personal columns on old
 * rows without being able to remove the rows themselves; see the note on them
 * in the matrix. `articles` is
 * read-only because the seed is the only thing that writes it, and `settings`
 * is read-only because nothing writes it YET: when the owner cockpit lands, the
 * test below will fail and say so, which is the intended way to find out.
 *
 * No grant here includes TRUNCATE, REFERENCES, TRIGGER, or anything at the
 * schema level beyond USAGE. The role cannot create, alter or drop anything.
 */

/** The role the running site connects as. Created by hand; see docs/DEPLOY.md. */
export const APP_ROLE = 's7_app';

const RW = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const RWU = ['SELECT', 'INSERT', 'UPDATE'];
const APPEND = ['SELECT', 'INSERT'];
/**
 * Written once and taken back whole, never edited in place. Exactly one table
 * has this shape: a coupon redemption is a fact that either happened or was
 * undone by a cancellation, and there is no such thing as amending one.
 * Withholding UPDATE means a redemption cannot be quietly reassigned to a
 * different customer, which is the one edit that would make the per-customer
 * cap meaningless while leaving the row count looking right.
 */
const APPEND_UNDO = ['SELECT', 'INSERT', 'DELETE'];
const READ = ['SELECT'];

/**
 * Standalone sequences the runtime may draw from, and nothing else.
 *
 * USAGE is what nextval() needs. Deliberately not SELECT: reading a sequence's
 * current value is not something any code path does, and currval/last_value on
 * the order numbering would hand out the shop's running order count to anything
 * that could reach a query. The runtime may take the next number and may not
 * ask what the last one was.
 *
 * UPDATE is withheld for the reason it matters most — it is what setval()
 * needs. The web server must not be able to wind the order numbering backwards
 * and start reissuing references that already belong to real orders.
 */
export const SEQUENCE_GRANTS = {
  order_ref_seq: ['USAGE'],
};

export const GRANTS = {
  admins: RW,
  admin_password_resets: RWU,
  admin_recovery_codes: RW,
  articles: READ,
  /*
   * email_log, order_attempts and quiz_results carry UPDATE and not DELETE, and
   * the distinction is the whole design of lib/retention.js.
   *
   * The retention sweep has to be able to honour the privacy policy - an IP on
   * a two-year-old quiz answer, the address of every mail ever sent - and the
   * obvious implementation is DELETE. That would mean handing DELETE on the
   * audit trail to anything that reaches SQL execution through the web server,
   * which is exactly the privilege the absences below exist to withhold.
   *
   * So the sweep redacts instead: it blanks the personal column and leaves the
   * row, so what survives is a fact with nobody attached - an email was sent on
   * a date, somebody took the quiz and got wax. That needs UPDATE, which cannot
   * be used to make a record disappear, rather than DELETE, which can.
   */
  email_log: RWU,
  offer_redemptions: APPEND_UNDO,
  offers: RW,
  order_attempts: RWU,
  order_events: APPEND,
  order_items: RW,
  order_tokens: APPEND,
  orders: RWU,
  products: RW,
  quiz_results: RWU,
  rate_limits: RW,
  settings: READ,
  subscribers: RW,
  /*
   * Webhook ids already handled. INSERT to claim one, SELECT to read the claim
   * back, and nothing else - a handler that could UPDATE or DELETE these could
   * un-remember a message it had already acted on, which is the one thing the
   * table exists to make impossible.
   */
  wa_events: APPEND,
};

/**
 * The statements that put the matrix into effect, in order.
 *
 * Every one is safe to re-run, because this is applied on every deploy: a table
 * added by a later migration picks its grants up on the next one rather than
 * needing somebody to remember. REVOKE comes first so that a privilege removed
 * from the matrix is actually removed from the database, instead of lingering
 * because it was granted by an older version of this file.
 */
export function grantStatements(role = APP_ROLE) {
  const out = [
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
    // Sequences are revoked as their own object class. `ALL TABLES` does not
    // reach them, so without this line a privilege dropped from
    // SEQUENCE_GRANTS would stay granted for ever.
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
  ];
  for (const [table, privs] of Object.entries(GRANTS)) {
    out.push(`GRANT ${privs.join(', ')} ON ${table} TO ${role}`);
  }
  for (const [seq, privs] of Object.entries(SEQUENCE_GRANTS)) {
    out.push(`GRANT ${privs.join(', ')} ON SEQUENCE ${seq} TO ${role}`);
  }
  return out;
}
