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
 *   - Identity columns need no sequence grant. This schema has zero standalone
 *     sequences; INSERT covers them.
 *
 * ---------------------------------------------------------------------------
 * The absences are the point
 *
 * DELETE is withheld from `orders`, `order_events`, `order_tokens`,
 * `order_attempts`, `email_log` and `quiz_results`. Nothing in the code deletes
 * from them, and they are between them the order history and the audit trail -
 * the records that answer what happened after something goes wrong. A runtime
 * that cannot erase them cannot be used to cover tracks. `articles` is
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
const READ = ['SELECT'];

export const GRANTS = {
  admins: RW,
  admin_password_resets: RWU,
  admin_recovery_codes: RW,
  articles: READ,
  email_log: APPEND,
  offers: RW,
  order_attempts: APPEND,
  order_events: APPEND,
  order_items: RW,
  order_tokens: APPEND,
  orders: RWU,
  products: RW,
  quiz_results: APPEND,
  rate_limits: RW,
  settings: READ,
  subscribers: RW,
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
    `REVOKE ALL ON SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
  ];
  for (const [table, privs] of Object.entries(GRANTS)) {
    out.push(`GRANT ${privs.join(', ')} ON ${table} TO ${role}`);
  }
  return out;
}
