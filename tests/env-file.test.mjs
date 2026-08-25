/**
 * The .env parser behind `npm run db:setup`.
 *
 * Not in the PHP suite — the PHP build read config.php directly. It is tested
 * here because a DATABASE_URL that loses its trailing `?sslmode=require`, or
 * that quietly overrides the one Vercel injected, fails in ways that look like
 * a database problem rather than a parsing one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, applyEnv } from '../scripts/env-file.mjs';

test('parses plain KEY=VALUE', () => {
  assert.deepEqual(parseEnv('A=1\nB=two'), { A: '1', B: 'two' });
});

test('strips double and single quotes', () => {
  assert.deepEqual(parseEnv(`A="one"\nB='two'`), { A: 'one', B: 'two' });
});

test('tolerates an export prefix', () => {
  assert.deepEqual(parseEnv('export A=1'), { A: '1' });
});

test('ignores blank lines and full-line comments', () => {
  assert.deepEqual(parseEnv('\n# a comment\n\nA=1\n'), { A: '1' });
});

test('strips a trailing inline comment from an unquoted value', () => {
  assert.deepEqual(parseEnv('A=1 # why'), { A: '1' });
});

test('keeps a # that is part of an unquoted value', () => {
  // e.g. a brand colour. Only whitespace-then-# starts a comment.
  assert.deepEqual(parseEnv('COLOR=#D7291D'), { COLOR: '#D7291D' });
});

test('keeps a # inside a quoted value', () => {
  assert.deepEqual(parseEnv('A="one # two"'), { A: 'one # two' });
});

test('keeps everything after the first = in the value', () => {
  const url = 'postgresql://u:p==@host.neon.tech/db?sslmode=require';
  assert.deepEqual(parseEnv(`DATABASE_URL="${url}"`), { DATABASE_URL: url });
});

test('the real .env.example shape survives a round trip', () => {
  const parsed = parseEnv([
    '# ---- Database (Neon) ---------------------------------------------',
    'DATABASE_URL="postgresql://user:password@host.neon.tech/starseven?sslmode=require"',
    '',
    'SHIPPING_FEE="30"',
    'FREE_DELIVERY_OVER="300"',
  ].join('\n'));
  assert.equal(parsed.DATABASE_URL, 'postgresql://user:password@host.neon.tech/starseven?sslmode=require');
  assert.equal(parsed.SHIPPING_FEE, '30');
  assert.equal(parsed.FREE_DELIVERY_OVER, '300');
});

test('handles CRLF files', () => {
  assert.deepEqual(parseEnv('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

test('ignores lines with no = and implausible keys', () => {
  assert.deepEqual(parseEnv('junk\nnot a key = 1\n9BAD=1\nOK=1'), { OK: '1' });
});

test('a double-quoted value unescapes \\n', () => {
  assert.equal(parseEnv('K="a\\nb"').K, 'a\nb');
});

test('a single-quoted value keeps backslashes literal', () => {
  assert.equal(parseEnv("K='a\\nb'").K, 'a\\nb');
});

test('applyEnv fills gaps and reports how many it set', () => {
  const env = {};
  assert.equal(applyEnv('A=1\nB=2', env), 2);
  assert.deepEqual(env, { A: '1', B: '2' });
});

test('applyEnv never overrides what the real environment already set', () => {
  // Vercel injects DATABASE_URL; a stale .env.local must not win over it.
  const env = { DATABASE_URL: 'from-vercel' };
  assert.equal(applyEnv('DATABASE_URL=from-file\nOTHER=x', env), 1);
  assert.equal(env.DATABASE_URL, 'from-vercel');
  assert.equal(env.OTHER, 'x');
});

test('empty input is not an error', () => {
  assert.deepEqual(parseEnv(''), {});
  assert.deepEqual(parseEnv(null), {});
});
