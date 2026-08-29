#!/usr/bin/env node
/**
 * NEW STAR SEVEN — admin two-factor and session revocation, against a real
 * Postgres.
 *
 *   npm run verify:auth
 *
 * The same arrangement as scripts/verify-order-status.mjs, for the same reason.
 * Everything under tests/ runs with no database on purpose, so tests/totp.test
 * can prove the arithmetic against the RFC vectors and nothing more. What it
 * cannot prove is the half of lib/admin-security.js that is SQL — and that half
 * is where the properties that matter live:
 *
 *   a recovery code works once, even against two requests arriving together
 *   a TOTP code works once, for the same reason and by the same mechanism
 *   revoking a session actually moves the number the token is checked against
 *   changing a password revokes, and turning two-factor off revokes
 *
 * Every one of those is a guarded UPDATE whose guard is the whole point, and a
 * guard that does not guard looks exactly like a guard that does until the day
 * it matters. So they are exercised here against real statements.
 *
 * It creates its own database, works only in there, and drops it in a finally.
 * Before the first write it asserts that current_database() is the throwaway one
 * and that `admins` resolves to nothing — if either check fails it aborts,
 * because the failure it is guarding against is writing to the real admins
 * table.
 */

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!base) {
  console.error('\n  ERROR  DATABASE_URL is not set. See .env.example.\n');
  process.exit(1);
}

// The sealing key. Set before anything imports lib/totp.js, and deliberately
// not the real one: nothing this script writes should ever be openable by the
// live environment.
process.env.SESSION_SECRET = `verify-${randomBytes(16).toString('hex')}`;

const DB = `s7_auth_${randomBytes(4).toString('hex')}`;

const { neon } = await import('@neondatabase/serverless');
const admin = neon(base);

const url = new URL(base);
url.pathname = `/${DB}`;
const raw = neon(url.toString());
const db = typeof raw.query === 'function' ? text => raw.query(text) : text => raw(text);

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  console.log(`          want ${JSON.stringify(want)}`);
}

console.log('\n  New Star Seven — admin two-factor and session revocation');
console.log(`  throwaway database: ${DB}`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  const [{ d }] = await raw`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);
  const [{ t }] = await raw`SELECT to_regclass('admins')::text AS t`;
  if (t !== null) throw new Error(`"admins" already resolves to ${t}. Aborting.`);
  console.log(`  guard: current_database() = ${d}, and it is empty\n`);

  const statements = splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
  for (const stmt of statements) await db(stmt);

  // The modules read DATABASE_URL on their first query, so it has to point at
  // the throwaway database before anything imports them.
  process.env.DATABASE_URL = url.toString();

  const bcrypt = (await import('bcryptjs')).default;
  const {
    beginEnrolment, cancelEnrolment, changePassword, confirmEnrolment,
    disableTotp, regenerateRecoveryCodes, securityFor, verifySecondFactor,
  } = await import('../lib/admin-security.js');
  const { bumpSessionEpoch: revokeSessions } = await import('../lib/session-epoch.js');
  const { openSecret, stepFor, totpAt } = await import('../lib/totp.js');

  const PASS = 'a-perfectly-fine-password';
  const [me] = await raw`
    INSERT INTO admins (email, pass_hash, name)
    VALUES ('verify@example.com', ${await bcrypt.hash(PASS, 4)}, 'Verify')
    RETURNING id`;
  const ID = Number(me.id);

  const epochOf = async () =>
    Number((await raw`SELECT session_epoch FROM admins WHERE id = ${ID}`)[0].session_epoch);
  const codeNow = async secret => totpAt(secret, stepFor());

  /* ------------------------------------------------------------------ 1 */

  console.log('  enrolment');
  let secret;
  let codes;
  {
    const start = await beginEnrolment(ID);
    secret = start.secret;
    check('a secret is issued', /^[A-Z2-7]{32}$/.test(secret), true);
    check('the enrolment URI names the account',
      start.uri.includes(encodeURIComponent('New Star Seven:verify@example.com')), true);

    const [row] = await raw`SELECT totp_pending, totp_secret FROM admins WHERE id = ${ID}`;
    check('the pending secret is not stored in the clear', row.totp_pending.includes(secret), false);
    check('the pending secret opens back to itself', await openSecret(row.totp_pending), secret);
    check('nothing is live yet', row.totp_secret, '');
    check('and the account is not enrolled yet', (await securityFor(ID)).enrolled, false);

    // The whole point of pending: a wrong code changes nothing.
    check('a wrong code does not enrol',
      await confirmEnrolment(ID, '000000'), { ok: false, reason: 'bad-code' });
    check('still not enrolled', (await securityFor(ID)).enrolled, false);

    const res = await confirmEnrolment(ID, await codeNow(secret));
    check('the right code enrols', res.ok, true);
    codes = res.codes;
    check('ten recovery codes come back', codes.length, 10);

    const after = await securityFor(ID);
    check('the account is enrolled', [after.enrolled, after.enrolling], [true, false]);
    check('with ten codes unused', after.recoveryLeft, 10);
  }

  /* ------------------------------------------------------------------ 2 */

  console.log('\n  recovery codes are stored as digests, not codes');
  {
    const rows = await raw`SELECT code_hash FROM admin_recovery_codes WHERE admin_id = ${ID}`;
    check('ten rows', rows.length, 10);
    check('every row is a SHA-256', rows.every(r => /^[0-9a-f]{64}$/.test(r.code_hash)), true);
    const blob = rows.map(r => r.code_hash).join(' ');
    check('no plaintext code appears anywhere in the table',
      codes.some(c => blob.includes(c.replace('-', ''))), false);
  }

  /* ------------------------------------------------------------------ 3 */

  console.log('\n  a TOTP code at sign-in');
  {
    /*
     * Several checks below need a code to be ACCEPTED, and by design a code is
     * accepted once per thirty-second step - enrolment a moment ago already
     * consumed the current one. Winding the watermark back between them is the
     * harness giving itself a fresh step without waiting half a minute, and it
     * is done with raw SQL so that nothing under test is involved in it.
     *
     * The checks that matter deliberately do NOT wind it back. A replay is
     * exactly the thing being tested.
     */
    const rewind = () => raw`UPDATE admins SET totp_last_step = 0 WHERE id = ${ID}`;

    await rewind();
    const step = stepFor();
    const code = await totpAt(secret, step);
    check('accepted', await verifySecondFactor(ID, code), { ok: true, via: 'totp' });

    // The replay guard. The code is still inside its ninety-second life and
    // must not be usable again - this is the difference between one-time and
    // valid-for-a-minute-and-a-half.
    check('the same code is refused a second time',
      await verifySecondFactor(ID, code), { ok: false });

    const [row] = await raw`SELECT totp_last_step FROM admins WHERE id = ${ID}`;
    check('the accepted step was recorded', Number(row.totp_last_step), step);

    await rewind();
    check('a wrong code is refused', await verifySecondFactor(ID, '000000'), { ok: false });
    check('a failed attempt does not move the watermark',
      Number((await raw`SELECT totp_last_step FROM admins WHERE id = ${ID}`)[0].totp_last_step), 0);
    check('the spacing an app displays is still accepted',
      (await verifySecondFactor(ID, code.replace(/(\d{3})/, '$1 '))).ok, true);
  }

  /* ------------------------------------------------------------------ 4 */

  console.log('\n  a recovery code at sign-in');
  {
    const used = codes[0];
    const res = await verifySecondFactor(ID, used);
    check('accepted, and says which kind it was', [res.ok, res.via], [true, 'recovery']);
    check('nine left', res.left, 9);
    check('the same code is refused a second time',
      await verifySecondFactor(ID, used), { ok: false });
    check('the count did not move on the refusal', (await securityFor(ID)).recoveryLeft, 9);

    check('typed lowercase and without the hyphen, a fresh code still works',
      (await verifySecondFactor(ID, codes[1].toLowerCase().replace('-', ''))).ok, true);
    check('a code that was never issued is refused',
      await verifySecondFactor(ID, 'ZZZZZ-ZZZZZ'), { ok: false });
  }

  /* ------------------------------------------------------------------ 5 */

  console.log('\n  two requests racing on one recovery code');
  {
    // The invariant the guarded UPDATE exists for. Written as a read and then a
    // write, both of these would see an unused code and both would be let in.
    const target = codes[5];
    const race = () => verifySecondFactor(ID, target).catch(e => ({ ok: false, threw: String(e) }));
    const [a, b] = await Promise.all([race(), race()]);
    check('exactly one is let in', [a.ok, b.ok].filter(Boolean).length, 1);
    const [row] = await raw`
      SELECT COUNT(*)::int AS c FROM admin_recovery_codes
       WHERE admin_id = ${ID} AND used_at IS NOT NULL`;
    check('exactly three codes are spent in total', Number(row.c), 3);
  }

  /* ------------------------------------------------------------------ 6 */

  console.log('\n  reissuing recovery codes');
  {
    const fresh = await regenerateRecoveryCodes(ID);
    check('ten new codes', fresh.length, 10);
    check('all ten are unused again', (await securityFor(ID)).recoveryLeft, 10);
    check('an old code no longer works',
      await verifySecondFactor(ID, codes[9]), { ok: false });
    check('a new one does', (await verifySecondFactor(ID, fresh[0])).ok, true);
  }

  /* ------------------------------------------------------------------ 7 */

  console.log('\n  session revocation');
  {
    const before = await epochOf();
    const bumped = await revokeSessions(ID);
    check('the epoch moves by one', bumped, before + 1);
    check('and it moved in the row too', await epochOf(), before + 1);
    check('an admin that does not exist revokes nothing', await revokeSessions(999999), null);
  }

  /* ------------------------------------------------------------------ 8 */

  console.log('\n  changing the password revokes every session');
  {
    const before = await epochOf();

    check('the wrong current password is refused',
      await changePassword(ID, 'not-the-password', 'a-brand-new-password'),
      { ok: false, reason: 'wrong-password' });
    check('and nothing was revoked', await epochOf(), before);

    check('a weak new password is refused',
      (await changePassword(ID, PASS, 'password123')).reason, 'common');
    check('a short new password is refused',
      (await changePassword(ID, PASS, 'short')).reason, 'too-short');
    check('the same password again is refused',
      (await changePassword(ID, PASS, PASS)).reason, 'unchanged');
    check('still nothing revoked', await epochOf(), before);

    const res = await changePassword(ID, PASS, 'a-brand-new-password-x');
    check('a good change succeeds', res.ok, true);
    check('and hands back the new epoch', res.epoch, before + 1);
    check('which is what is in the row', await epochOf(), before + 1);

    const [row] = await raw`SELECT pass_hash, password_changed_at FROM admins WHERE id = ${ID}`;
    check('the new password verifies', await bcrypt.compare('a-brand-new-password-x', row.pass_hash), true);
    check('the old one does not', await bcrypt.compare(PASS, row.pass_hash), false);
    check('and the change is dated', row.password_changed_at !== null, true);
  }

  /* ------------------------------------------------------------------ 9 */

  console.log('\n  turning two-factor off');
  {
    const before = await epochOf();
    await disableTotp(ID);

    const after = await securityFor(ID);
    check('not enrolled any more', after.enrolled, false);
    check('no recovery codes left behind', after.recoveryLeft, 0);
    const [row] = await raw`
      SELECT totp_secret, totp_pending, totp_last_step FROM admins WHERE id = ${ID}`;
    check('the secret is gone', [row.totp_secret, row.totp_pending], ['', '']);
    check('and the replay watermark is reset', Number(row.totp_last_step), 0);
    check('every session was revoked', await epochOf(), before + 1);
    check('nothing verifies against an account with no second factor',
      await verifySecondFactor(ID, '000000'), { ok: false });
    check('not even a code from the secret that used to work',
      await verifySecondFactor(ID, await codeNow(secret)), { ok: false });
  }

  /* ----------------------------------------------------------------- 10 */

  console.log('\n  an abandoned enrolment cannot lock anyone out');
  {
    await beginEnrolment(ID);
    check('a setup is pending', (await securityFor(ID)).enrolling, true);
    check('but the account is not enrolled', (await securityFor(ID)).enrolled, false);
    await cancelEnrolment(ID);
    check('and cancelling clears it', (await securityFor(ID)).enrolling, false);

    // Starting a second enrolment while one is already live must not disturb
    // the live one - an admin who wanders off mid-setup still has a phone that
    // works.
    const first = await beginEnrolment(ID);
    await confirmEnrolment(ID, await codeNow(first.secret));
    check('enrolled on the first secret', (await securityFor(ID)).enrolled, true);
    await beginEnrolment(ID);
    check('a second setup does not disturb the live one',
      (await verifySecondFactor(ID, await totpAt(first.secret, stepFor() + 1))).ok, true);
  }

} finally {
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  all checks passed\n');
process.exit(failures ? 1 : 0);
