/**
 * The login screen must cost the same whether the address exists or not.
 *
 * Everything else about this app's authentication is careful about not
 * answering the question "is this a real account": /admin/forgot has one
 * redirect reached from both branches, /api/order/find builds its single answer
 * before it looks anything up, and the order lookup is digest-first so a real
 * reference and a fake one cost the same query. The login screen joins that by
 * spending a bcrypt comparison against a dummy hash when the email is unknown.
 *
 * That only works if the dummy costs what a real hash costs. It did not. Real
 * passwords were written at cost 12 and the dummy sat at cost 10, which is a
 * quarter of the work - 72ms against 284ms on the machine where it was found.
 * bcrypt's cost factor is exponential, so a one-step mismatch is not a rounding
 * difference, it is a 4x tell that needs no statistics: one POST per candidate
 * address, read the clock, learn which mailboxes reach the panel.
 *
 * Nothing failed when that drifted. The screen worked, the tests passed, and
 * the comment above the constant still said it equalised the time. This is what
 * fails instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { BCRYPT_COST } from '../lib/credentials.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(join(ROOT, p), 'utf8');

const loginSrc = read('app/admin/(auth)/login/page.js');

/** The cost factor out of a bcrypt hash: $2a$12$... -> 12 */
const costOf = hash => Number(String(hash).split('$')[2]);

test('the dummy hash is a real bcrypt hash', () => {
  const m = loginSrc.match(/const DUMMY_HASH = '([^']+)'/);
  assert.ok(m, 'DUMMY_HASH is gone from the login page');
  assert.match(m[1], /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, `not a bcrypt hash: ${m[1]}`);
});

test('the dummy hash costs exactly what a stored password costs', () => {
  const dummy = loginSrc.match(/const DUMMY_HASH = '([^']+)'/)[1];
  assert.equal(costOf(dummy), BCRYPT_COST,
    `DUMMY_HASH is cost ${costOf(dummy)} but passwords are written at cost ${BCRYPT_COST} — `
    + 'the unknown-address branch is now measurably cheaper than the known-address one, '
    + 'which is an enumeration oracle. Regenerate it: '
    + `node -e "console.log(require('bcryptjs').hashSync(require('crypto').randomUUID(), ${BCRYPT_COST}))"`);
});

test('every place that writes a password uses the shared cost', () => {
  // The drift happened because the number was typed in five places. A literal
  // here is how it starts again.
  const writers = [
    'lib/admin-accounts.js',
    'lib/admin-reset.js',
    'lib/admin-security.js',
    'app/admin/(auth)/setup/page.js',
  ];
  /*
   * A window after the call rather than a [^)]* capture.
   *
   * Every one of these calls wraps its first argument - bcrypt.hash(
   * String(password), BCRYPT_COST) - so a non-greedy match to the first ')'
   * stops inside String(...) and never sees the cost. The first version of this
   * test did exactly that and reported all three correct files as broken.
   */
  const problems = [];
  for (const file of writers) {
    const src = read(file);
    for (const m of src.matchAll(/bcrypt\.hash(?:Sync)?\(/g)) {
      const call = src.slice(m.index, m.index + 120);
      if (!/BCRYPT_COST/.test(call)) {
        problems.push(`${file}: ${call.split('\n')[0].trim()}`);
      }
    }
  }
  assert.deepEqual(problems, [],
    `these hash at a hard-coded cost instead of BCRYPT_COST:\n${problems.join('\n')}`);
});

test('the cost is high enough to be worth having', () => {
  // Below 10 a stolen table is worth brute-forcing on commodity hardware. This
  // is a floor, not a target - raising BCRYPT_COST is safe, since an existing
  // hash carries its own cost in its prefix and keeps verifying.
  assert.ok(BCRYPT_COST >= 12, `BCRYPT_COST is ${BCRYPT_COST}, which is too cheap`);
});

test('the two branches actually take comparable time', { timeout: 60_000 }, () => {
  /*
   * The behavioural half. The assertions above compare two numbers in the
   * source, which is what catches the drift; this one proves the numbers mean
   * what we think they mean, by running the comparison the login screen runs.
   *
   * Generous bounds on purpose. This is a correctness test for the cost factor,
   * not a benchmark, and it shares a machine with whatever else is running -
   * so it asserts the same ORDER OF MAGNITUDE, which is all that separates a
   * matched pair from a one-step mismatch (4x) or a two-step one (16x).
   */
  const dummy = loginSrc.match(/const DUMMY_HASH = '([^']+)'/)[1];
  const real = bcrypt.hashSync('a-real-password-of-some-length', BCRYPT_COST);

  const time = hash => {
    const started = process.hrtime.bigint();
    bcrypt.compareSync('whatever-the-attacker-typed', hash);
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  const median = hash => {
    const runs = Array.from({ length: 5 }, () => time(hash)).sort((a, b) => a - b);
    return runs[2];
  };

  const missBranch = median(dummy);
  const hitBranch = median(real);
  const ratio = Math.max(missBranch, hitBranch) / Math.min(missBranch, hitBranch);

  assert.ok(ratio < 1.6,
    `the unknown-address branch takes ${missBranch.toFixed(0)}ms and the known-address branch `
    + `${hitBranch.toFixed(0)}ms (${ratio.toFixed(2)}x). They must be within noise of each other, `
    + 'or the response time tells an attacker which addresses are real.');
});
