// Build-only evidence. Never serialize the manifest: it contains an encryption key.
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const TARGETS = {
  'app/admin/(auth)/login/page.js': ['doLogin'],
  'app/admin/(auth)/forgot/page.js': ['requestReset'],
  'app/admin/(auth)/reset/page.js': ['setNewPassword'],
  'app/admin/(panel)/orders/page.js': ['saveStatus'],
  'app/admin/(panel)/orders/[id]/page.js': ['saveStatus', 'addNote', 'saveDispatch', 'saveSettlement', 'saveItems', 'saveContact'],
  'app/admin/(panel)/offers/page.js': ['createOffer', 'offerAction'],
  'app/admin/(panel)/stock/page.js': ['adjust', 'importChanges'],
  'app/admin/(panel)/returns/new/page.js': ['open'],
  'app/admin/(panel)/returns/[id]/page.js': ['move'],
  'app/admin/(panel)/shipping/page.js': ['save'],
  'app/admin/(panel)/settlements/page.js': ['record'],
};
const stopped = code => { throw new Error('RELEASE_ACTION_METADATA_' + code); };

function buildReport(compilation, root) {
  const assets = compilation.getAssets().filter(a => /(^|\/)server-reference-manifest\.json$/.test(a.name));
  if (assets.length !== 1) stopped('MANIFEST_MISSING');
  let manifest;
  try { manifest = JSON.parse(assets[0].source.source().toString()); }
  catch { stopped('MANIFEST_INVALID'); }
  if (!manifest.node || typeof manifest.node !== 'object') stopped('NODE_MANIFEST_MISSING');
  const found = new Map();
  // Production webpack can place the original page inside a concatenated module.
  const modules = [...compilation.modules], visited = new Set();
  for (const mod of modules) {
    if (visited.has(mod)) continue;
    visited.add(mod);
    if (mod.modules) modules.push(...mod.modules);
    if (!mod.resource) continue;
    const resource = mod.resource.split('?')[0];
    const file = path.relative(root, resource).replaceAll('\\', '/');
    if (!Object.hasOwn(TARGETS, file)) continue;
    const code = mod.originalSource()?.source().toString() || '';
    for (const action of TARGETS[file]) {
      // Next 15's actual transformed binding, before minification; never infer
      // an action's ID from its source order or from another build.
      const aliases = [...code.matchAll(new RegExp('^\\s*(?:var|let|const)\\s+' + action + '\\s*=\\s*(\\$\\$RSC_SERVER_ACTION_\\d+)\\s*;', 'gm'))];
      for (const alias of aliases) {
        const symbol = alias[1], worker = file.replace(/\.js$/, '');
        const matches = Object.entries(manifest.node).filter(([id, entry]) => {
          const filename = typeof entry.filename === 'string' ? entry.filename.replaceAll('\\', '/') : '';
          return /^[a-f0-9]{40,64}$/.test(id) && entry.exportedName === symbol &&
            (filename === file || filename.endsWith('/' + file)) && Object.hasOwn(entry.workers || {}, worker);
        });
        if (matches.length !== 1) stopped('BINDING_UNRESOLVED');
        const id = matches[0][0], key = file + ':' + action;
        if (found.has(key) && found.get(key).id !== id) stopped('BINDING_AMBIGUOUS');
        found.set(key, { file, action, id, worker, exportedName: symbol,
          sourceSha256: createHash('sha256').update(readFileSync(resource)).digest('hex') });
      }
    }
  }
  const actions = [];
  for (const [file, names] of Object.entries(TARGETS)) {
    for (const name of names) {
      const entry = found.get(file + ':' + name);
      if (!entry) stopped('COVERAGE_INCOMPLETE:' + file + ':' + name + ':' + found.size);
      actions.push(entry);
    }
  }
  if (actions.length !== 18 || new Set(actions.map(a => a.id)).size !== 18) stopped('SCOPE_INVALID');
  return { status: 'release-server-action-ids', version: 1, actions };
}

function emitReport(report, write = console.log) {
  // Providers truncate long log events. Keep one short, allowlisted record per action.
  const actions = report.actions.map(({ file, action, id, worker, exportedName, sourceSha256 }) =>
    ({ file, action, id, worker, exportedName, sourceSha256 }));
  for (const action of actions) write(JSON.stringify({ status: 'release-server-action-id', version: 1, ...action }));
  write(JSON.stringify({ status: 'release-server-action-ids-complete', version: 1, count: actions.length,
    digest: createHash('sha256').update(JSON.stringify(actions)).digest('hex') }));
}

class ReleaseActionMetadataPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('ReleaseActionMetadata', compilation => {
      compilation.hooks.processAssets.tap({ name: 'ReleaseActionMetadata',
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        emitReport(buildReport(compilation, path.resolve(__dirname, '..')));
      });
    });
  }
}
module.exports = ReleaseActionMetadataPlugin;
module.exports.buildReport = buildReport;
module.exports.TARGETS = TARGETS;
module.exports.emitReport = emitReport;
