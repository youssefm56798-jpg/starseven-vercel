#!/usr/bin/env node
/**
 * Apply the runtime role's grants. Called by setup-db.mjs on every deploy, and
 * runnable on its own:
 *
 *   node scripts/apply-grants.mjs            apply, using DATABASE_URL
 *   node scripts/apply-grants.mjs --show     print the statements, touch nothing
 *   node scripts/apply-grants.mjs --check    report what the role can do today
 *
 * It is a no-op when the role does not exist, and says so. That matters: this
 * runs inside the deploy, and a deployment must not fail because a hardening
 * step that nobody has finished setting up yet has nothing to talk to. The role
 * is created by a human once - see docs/DEPLOY.md - because creating it means
 * choosing a password, and that is not a thing a build script should invent.
 */

import { APP_ROLE, GRANTS, grantStatements } from '../db/grants.mjs';

/** True when the role exists. */
export async function roleExists(exec, role = APP_ROLE) {
  const rows = await exec(`SELECT 1 AS ok FROM pg_roles WHERE rolname = '${role}'`);
  return Array.isArray(rows) ? rows.length > 0 : Boolean(rows?.rows?.length);
}

/**
 * Apply every grant. Returns a short report rather than printing, so the caller
 * decides how loud to be.
 */
export async function applyGrants(exec, role = APP_ROLE) {
  if (!(await roleExists(exec, role))) {
    return { applied: 0, skipped: true, role };
  }
  const statements = grantStatements(role);
  for (const stmt of statements) await exec(stmt);
  return { applied: statements.length, skipped: false, role };
}

/**
 * What the role can actually do, read back from the catalogue.
 *
 * Asking Postgres rather than trusting the statements we just sent is the only
 * way to know a grant landed - and it is what the throwaway-database proof in
 * scripts/verify-grants.mjs compares against the matrix.
 */
export async function readGrants(exec, role = APP_ROLE) {
  const rows = await exec(`
    SELECT table_name, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
      FROM information_schema.role_table_grants
     WHERE grantee = '${role}' AND table_schema = 'public'
     GROUP BY table_name ORDER BY table_name`);
  const list = Array.isArray(rows) ? rows : rows?.rows || [];
  return Object.fromEntries(list.map(r => [r.table_name, r.privs.split(',')]));
}

/* ------------------------------------------------------------------ cli */

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') ||
    process.argv[1]?.endsWith('apply-grants.mjs')) {
  const argv = process.argv.slice(2);

  if (argv.includes('--show')) {
    console.log(grantStatements().join(';\n') + ';');
    process.exit(0);
  }

  const { readFileSync, existsSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { applyEnv } = await import('./env-file.mjs');
  const { neon } = await import('@neondatabase/serverless');

  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
  }
  if (!process.env.DATABASE_URL) {
    console.error('\n  ERROR  DATABASE_URL is not set.\n');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const exec = typeof sql.query === 'function' ? t => sql.query(t) : t => sql(t);

  if (argv.includes('--check')) {
    const have = await readGrants(exec);
    const tables = [...new Set([...Object.keys(GRANTS), ...Object.keys(have)])].sort();
    console.log(`\n  privileges held by ${APP_ROLE}\n`);
    for (const t of tables) {
      const want = (GRANTS[t] || []).slice().sort().join(',');
      const got = (have[t] || []).slice().sort().join(',');
      const mark = want === got ? 'ok  ' : '  **';
      console.log(`   ${mark} ${t.padEnd(24)} want: ${want || '(none)'}${want === got ? '' : `   have: ${got || '(none)'}`}`);
    }
    console.log('');
    process.exit(0);
  }

  const res = await applyGrants(exec);
  console.log(res.skipped
    ? `\n  Role ${res.role} does not exist - nothing to grant. See docs/DEPLOY.md.\n`
    : `\n  Applied ${res.applied} grant statement(s) to ${res.role}.\n`);
}
