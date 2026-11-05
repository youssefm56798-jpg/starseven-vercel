import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import nextConfig from '../next.config.mjs';
const require = createRequire(import.meta.url);
const { buildReport, TARGETS } = require('../scripts/release-action-metadata.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
function fixture() {
  const node = {}, modules = [];
  let index = 0;
  for (const [file, names] of Object.entries(TARGETS)) {
    const worker = file.replace(/\.js$/, '');
    const code = names.map((name, n) => {
      const id = '40' + createHash('sha1').update('SYNTHETIC-' + index++).digest('hex');
      node[id] = { exportedName: '$$RSC_SERVER_ACTION_' + n, filename: file, workers: { [worker]: { moduleId: 'synthetic' } } };
      return 'var ' + name + ' = $$RSC_SERVER_ACTION_' + n + ';';
    }).join('\n');
    modules.push({ resource: path.join(root, file), originalSource: () => ({ source: () => code }) });
  }
  // A real but held action on the same order-list page must not appear.
  node['ff'.repeat(21)] = { exportedName: '$$RSC_SERVER_ACTION_99', filename: 'app/admin/(panel)/orders/page.js',
    workers: { 'app/admin/(panel)/orders/page': { moduleId: 'held' } } };
  const manifest = { node, edge: {}, encryptionKey: 'SYNTHETIC_ENCRYPTION_KEY_MUST_NOT_LEAK', secret: 'UNEXPECTED_FIELD_MUST_NOT_LEAK' };
  return { manifest, modules, getAssets: () => [{ name: 'server-reference-manifest.json', source: { source: () => JSON.stringify(manifest) } }] };
}

test('the actual compiler bindings and manifest co-bind only the 18 reviewed actions', () => {
  const f = fixture(), report = buildReport(f, root);
  assert.equal(report.actions.length, 18);
  assert.deepEqual(report.actions.filter(a => a.file.includes('/reset/')).map(a => a.action), ['setNewPassword']);
  assert.equal(report.actions.filter(a => a.file.includes('/orders/[id]/')).length, 6);
  assert.ok(report.actions.every(a => /^[a-f0-9]{64}$/.test(a.sourceSha256)));
  assert.doesNotMatch(JSON.stringify(report), /ENCRYPTION|UNEXPECTED|releaseHeldStock|ff{40}/);
});

test('wrong worker, filename or exported symbol cannot produce a report', () => {
  for (const field of ['workers', 'filename', 'exportedName']) {
    const f = fixture(), entry = Object.values(f.manifest.node)[0];
    entry[field] = field === 'workers' ? { 'app/admin/(auth)/reset/page': {} } : 'wrong';
    assert.throws(() => buildReport(f, root), /RELEASE_ACTION_METADATA_BINDING_UNRESOLVED/);
  }
});

test('production concatenation retains each original page binding', () => {
  const f = fixture();
  f.modules = [{ modules: f.modules }];
  assert.equal(buildReport(f, root).actions.length, 18);
});

test('missing manifest or action coverage stops instead of widening or guessing', () => {
  const f = fixture();
  assert.throws(() => buildReport({ ...f, getAssets: () => [] }, root), /MANIFEST_MISSING/);
  f.modules.pop();
  assert.throws(() => buildReport(f, root), /COVERAGE_INCOMPLETE/);
});

test('the hook runs only for the production Node compiler and preserves the config', () => {
  for (const context of [{ dev: true, isServer: true, nextRuntime: 'nodejs' },
    { dev: false, isServer: false }, { dev: false, isServer: true, nextRuntime: 'edge' }]) {
    const config = { plugins: [] };
    assert.equal(nextConfig.webpack(config, context), config);
    assert.equal(config.plugins.length, 0);
  }
  const config = { plugins: [] };
  nextConfig.webpack(config, { dev: false, isServer: true, nextRuntime: 'nodejs' });
  assert.equal(config.plugins.length, 1);
});
