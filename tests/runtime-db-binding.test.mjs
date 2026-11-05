import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const swc = require('next/dist/build/swc');
const source = await readFile(new URL('../lib/db.js', import.meta.url), 'utf8');
const compiled = await swc.transform(source, { filename: 'db.js',
  jsc: { target: 'es2022', parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' } });

function fixture({ environment = 'production', appUrl = 'synthetic-app-secret', row = {}, fail = false } = {}) {
  const calls = [], logs = [], clients = [], module = { exports: {} };
  const client = async (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    if (fail) throw Error('synthetic-sensitive-driver-detail');
    return [row];
  };
  client.transaction = (...args) => ({ unchangedTransaction: args });
  const env = { VERCEL_ENV: environment, DATABASE_URL: 'synthetic-owner-secret' };
  if (appUrl) env.DATABASE_URL_APP = appUrl;
  new vm.Script(compiled.code).runInNewContext({ module, exports: module.exports, process: { env },
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    require(id) { assert.equal(id, '@neondatabase/serverless');
      return { neon: url => { clients.push(url); return client; } }; } });
  return { ...module.exports, calls, logs, clients };
}

test('the production observation uses the same app client, runs once and logs only booleans', async () => {
  const f = fixture({ row: { restricted_role: true, database_matches: true, branch_matches: true, major_matches: true,
    unexpected_secret: 'synthetic-sensitive-row-detail' } });
  await Promise.all([f.observeRuntimeDbBinding(), f.observeRuntimeDbBinding()]);
  await f.observeRuntimeDbBinding();
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].text, /^SELECT current_user/);
  assert.doesNotMatch(f.calls[0].text, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|FROM)\b/);
  assert.deepEqual(f.clients, ['synthetic-app-secret']);
  assert.equal(f.logs.length, 1);
  assert.deepEqual(JSON.parse(f.logs[0][1]), { appCredentialConfigured: true, restrictedRole: true,
    databaseMatches: true, branchMatches: true, majorMatches: true });
  assert.doesNotMatch(JSON.stringify(f.logs), /synthetic|unexpected_secret/);
  assert.deepEqual(f.sql.transaction('sentinel').unchangedTransaction, ['sentinel']);
});

test('missing credentials and unexpected result types cannot create a successful proof', async () => {
  const f = fixture({ appUrl: '', row: { restricted_role: 'true', database_matches: 1, branch_matches: null, major_matches: true } });
  await f.observeRuntimeDbBinding();
  assert.deepEqual(f.clients, ['synthetic-owner-secret']);
  assert.deepEqual(JSON.parse(f.logs[0][1]), { appCredentialConfigured: false, restrictedRole: false,
    databaseMatches: false, branchMatches: false, majorMatches: true });
});

test('driver failures produce a generic private log without changing page availability', async () => {
  const f = fixture({ fail: true });
  await f.observeRuntimeDbBinding();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.logs, [['[s7] runtime-db-binding-v1 unavailable']]);
  assert.doesNotMatch(JSON.stringify(f.logs), /synthetic-sensitive|secret/);
});

test('local and preview renders make no observation query', async () => {
  for (const environment of ['preview', 'development', '']) {
    const f = fixture({ environment });
    await f.observeRuntimeDbBinding();
    assert.equal(f.calls.length, 0);
    assert.equal(f.logs.length, 0);
  }
});
