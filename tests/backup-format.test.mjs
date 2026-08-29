/**
 * The dump format, with no database.
 *
 * scripts/verify-backup.mjs proves the round trip against a real Postgres, and
 * it is the check that matters — but it needs a server, so it is a script and
 * not a test, like every other database-backed check in this project. What is
 * left over is everything the file format decides on its own: whether a
 * truncated dump is detectable, whether a NULL survives as something other than
 * an empty string, whether the width of a row is enforced. All of that is pure,
 * so it belongs here where a fresh clone runs it in milliseconds.
 *
 * The guards at the end are a different kind of check and are here deliberately.
 * They read .gitignore as text and assert that a dump cannot be committed. There
 * is no behaviour to assert against — the failure they cover is somebody
 * tidying up an ignore rule and a file of customer addresses arriving in a
 * commit three weeks later — which is the same reason tests/fonts.test.mjs and
 * tests/hook-deps.test.mjs read source rather than run it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_VERSION, DumpReader, DumpWriter, TABLE_NAMES, TABLES,
  checkColumns, dumpFileName, parseDumpText,
} from '../scripts/backup-format.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NEWLINE = String.fromCharCode(10);

/** Builds a small dump the way scripts/backup-db.mjs does. */
function makeDump(blocks, { manifest = {} } = {}) {
  const w = new DumpWriter();
  let out = w.manifest({ generatedAt: '2026-08-29T00:00:00.000Z', ...manifest });
  for (const [table, columns, rows] of blocks) {
    out += w.begin(table, columns);
    for (const r of rows) out += w.row(r);
  }
  return out + w.finish();
}

/* ------------------------------------------------------------ round trips */

test('a value survives the round trip whatever is in it', () => {
  const nasty = [
    "O'Brien & Sons",
    '"quoted"',
    `two${NEWLINE}lines\tand a tab`,
    'back\\slash',
    'شمع أحمر — الشرقية',
    '100%',
    '',                       // the empty string, which this schema uses everywhere
    null,                     // and NULL, which it must never become
    '45.50',
    '9007199254740993',       // past the last integer JavaScript counts exactly
    '2026-09-03',
    '2026-08-27 14:03:22.123456+00',
  ];
  const text = makeDump([['orders', nasty.map((_, i) => `c${i}`), [nasty]]]);
  const { blocks } = parseDumpText(text);
  assert.deepEqual(blocks[0].rows[0], nasty);
});

test('NULL and the empty string stay different', () => {
  const text = makeDump([['offers', ['a', 'b'], [[null, '']]]]);
  const { blocks } = parseDumpText(text);
  assert.equal(blocks[0].rows[0][0], null);
  assert.equal(blocks[0].rows[0][1], '');
  assert.notEqual(blocks[0].rows[0][0], blocks[0].rows[0][1]);
});

test('several tables keep their order and their columns', () => {
  const text = makeDump([
    ['orders', ['id', 'ref'], [['1', 'S7-1'], ['2', 'S7-2']]],
    ['order_items', ['id', 'order_id'], [['1', '1']]],
  ]);
  const { blocks } = parseDumpText(text);
  assert.deepEqual(blocks.map(b => b.table), ['orders', 'order_items']);
  assert.deepEqual(blocks[0].columns, ['id', 'ref']);
  assert.equal(blocks[0].rows.length, 2);
  assert.equal(blocks[1].rows.length, 1);
});

test('an empty table is still a block, not a missing one', () => {
  const text = makeDump([['settings', ['key', 'value'], []]]);
  const { blocks } = parseDumpText(text);
  assert.deepEqual(blocks, [{ table: 'settings', columns: ['key', 'value'], rows: [] }]);
});

test('the manifest carries the format version', () => {
  const { manifest } = parseDumpText(makeDump([['settings', ['key'], [['a']]]]));
  assert.equal(manifest.nssBackup, BACKUP_VERSION);
});

/* ------------------------------------------------- a dump that is not one */

test('a dump with no footer is refused, not half-read', () => {
  const text = makeDump([['orders', ['id'], [['1'], ['2']]]]);
  const truncated = text.split(NEWLINE).slice(0, -2).join(NEWLINE);
  assert.throws(() => parseDumpText(truncated), /footer/i);
});

test('a dump cut off mid-table is refused', () => {
  const lines = makeDump([['orders', ['id'], [['1'], ['2'], ['3']]]]).split(NEWLINE);
  assert.throws(() => parseDumpText(lines.slice(0, 3).join(NEWLINE)), /footer/i);
});

test('an edited row breaks the checksum', () => {
  const text = makeDump([['orders', ['id', 'total'], [['1', '295.00']]]]);
  assert.throws(() => parseDumpText(text.replace('295.00', '29.50')), /checksum/i);
});

test('a row appended after the fact breaks the checksum', () => {
  const lines = makeDump([['orders', ['id'], [['1']]]]).split(NEWLINE).filter(Boolean);
  lines.splice(lines.length - 1, 0, '["2"]');
  assert.throws(() => parseDumpText(lines.join(NEWLINE)), /checksum|row\(s\)/i);
});

test('anything after the footer is corruption', () => {
  const text = makeDump([['orders', ['id'], [['1']]]]) + '["2"]' + NEWLINE;
  assert.throws(() => parseDumpText(text), /after the footer/i);
});

test('a footer whose counts disagree with the body is refused', () => {
  const lines = makeDump([['orders', ['id'], [['1'], ['2']]]]).split(NEWLINE).filter(Boolean);
  const footer = JSON.parse(lines[lines.length - 1]);
  footer.counts.orders = 3;
  // The checksum still covers the body, so re-sign the footer to prove the
  // count check stands on its own rather than riding on the digest.
  lines[lines.length - 1] = JSON.stringify(footer);
  assert.throws(() => parseDumpText(lines.join(NEWLINE)), /footer says 3/i);
});

test('a file that is not JSON is refused before anything is loaded', () => {
  assert.throws(() => parseDumpText('this is not a backup'), /valid JSON/i);
});

test('a JSON file that is not one of ours is refused', () => {
  assert.throws(() => parseDumpText('{"hello":true}'), /manifest/i);
});

test('an empty file is refused', () => {
  assert.throws(() => parseDumpText(''), /empty/i);
});

test('a dump from a future format version is refused rather than guessed at', () => {
  const text = makeDump([['orders', ['id'], [['1']]]])
    .replace(`"nssBackup":${BACKUP_VERSION}`, '"nssBackup":99');
  assert.throws(() => parseDumpText(text), /version 99/);
});

test('a row before any table header is refused', () => {
  const w = new DumpWriter();
  const text = w.manifest({}) + '["1"]' + NEWLINE;
  assert.throws(() => parseDumpText(text), /before any table header/i);
});

test('a row of the wrong width is refused on read as well as on write', () => {
  const lines = makeDump([['orders', ['id', 'ref'], [['1', 'a']]]]).split(NEWLINE).filter(Boolean);
  lines.splice(2, 1, '["1"]');
  assert.throws(() => parseDumpText(lines.join(NEWLINE)), /1 value\(s\), header declares 2/);
});

test('the writer refuses a row that does not match its header', () => {
  const w = new DumpWriter();
  w.manifest({});
  w.begin('orders', ['id', 'ref']);
  assert.throws(() => w.row(['1']), /1 value\(s\), expected 2/);
});

test('the writer refuses to write a table twice', () => {
  const w = new DumpWriter();
  w.manifest({});
  w.begin('orders', ['id']);
  assert.throws(() => w.begin('orders', ['id']), /written twice/);
});

test('a trailing newline is not read as a row', () => {
  const text = makeDump([['orders', ['id'], [['1']]]]);
  assert.equal(parseDumpText(text + NEWLINE).blocks[0].rows.length, 1);
});

test('CRLF line endings read the same as LF', () => {
  const text = makeDump([['orders', ['id', 'ref'], [['1', "O'Brien"]]]]);
  const crlf = text.split(NEWLINE).join(String.fromCharCode(13) + NEWLINE);
  assert.deepEqual(parseDumpText(crlf).blocks[0].rows, [['1', "O'Brien"]]);
});

test('two identical bodies hash identically, and one changed byte does not', () => {
  const a = makeDump([['orders', ['id'], [['1']]]], { manifest: { database: 'one' } });
  const b = makeDump([['orders', ['id'], [['1']]]], { manifest: { database: 'two' } });
  const c = makeDump([['orders', ['id'], [['2']]]]);
  const sha = t => JSON.parse(t.trim().split(NEWLINE).pop()).sha256;
  // The manifest is not hashed, so the same rows from a different database
  // still compare equal — which is what makes the round-trip check in
  // scripts/verify-backup.mjs a comparison of data rather than of metadata.
  assert.equal(sha(a), sha(b));
  assert.notEqual(sha(a), sha(c));
});

/* --------------------------------------------------------- schema drift */

test('a column the target has gained is fine and is reported', () => {
  const v = checkColumns({
    table: 'settings',
    dumpColumns: ['key', 'value'],
    targetColumns: [
      { name: 'key', notNull: true, hasDefault: false, isIdentity: false },
      { name: 'value', notNull: true, hasDefault: true, isIdentity: false },
      { name: 'note', notNull: true, hasDefault: true, isIdentity: false },
    ],
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.addedInTarget, ['note']);
  assert.deepEqual(v.load, ['key', 'value']);
});

test('a column the target has lost stops the restore', () => {
  const v = checkColumns({
    table: 'settings',
    dumpColumns: ['key', 'value', 'updated_by'],
    targetColumns: [
      { name: 'key', notNull: true, hasDefault: false, isIdentity: false },
      { name: 'value', notNull: true, hasDefault: true, isIdentity: false },
    ],
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.missingInTarget, ['updated_by']);
  assert.match(v.errors[0], /updated_by/);
  // The load list is still usable, which is what --drop-unknown-columns loads.
  assert.deepEqual(v.load, ['key', 'value']);
});

test('a new NOT NULL column with no default stops the restore', () => {
  const v = checkColumns({
    table: 'orders',
    dumpColumns: ['id'],
    targetColumns: [
      { name: 'id', notNull: true, hasDefault: false, isIdentity: true },
      { name: 'branch', notNull: true, hasDefault: false, isIdentity: false },
    ],
  });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /branch/);
});

test('an identity column the dump does not carry is not treated as unfillable', () => {
  const v = checkColumns({
    table: 'orders',
    dumpColumns: ['ref'],
    targetColumns: [
      { name: 'id', notNull: true, hasDefault: false, isIdentity: true },
      { name: 'ref', notNull: true, hasDefault: false, isIdentity: false },
    ],
  });
  assert.equal(v.ok, true);
});

/* ---------------------------------------------------------- the file name */

test('a dump file name sorts by age and is legal on Windows', () => {
  const name = dumpFileName(new Date('2026-08-29T14:03:22.987Z'));
  assert.equal(name, 'starseven-2026-08-29T14-03-22Z.ndjson');
  assert.equal(name.includes(':'), false);
  const earlier = dumpFileName(new Date('2026-08-29T09:00:00.000Z'));
  assert.ok(earlier < name, 'the older name must sort first');
});

/* ------------------------------------------------------------ the tables */

test('the backup covers the tables a restore cannot rebuild from git', () => {
  // Not a list for its own sake: each of these holds something db/seed.sql
  // cannot regenerate. products is the one that looks skippable and is not —
  // the seed is ON CONFLICT DO NOTHING, so it restores the catalogue as it
  // shipped and declines to touch the prices the owner has edited since.
  assert.deepEqual(TABLE_NAMES, [
    'settings', 'admins', 'admin_recovery_codes', 'products', 'offers',
    'subscribers', 'orders', 'order_items', 'order_events', 'order_tokens',
  ]);
});

test('parents are dumped before the rows that reference them', () => {
  const at = name => TABLE_NAMES.indexOf(name);
  for (const child of ['order_items', 'order_events', 'order_tokens']) {
    assert.ok(at('orders') < at(child), `orders must come before ${child}`);
  }
  assert.ok(at('admins') < at('admin_recovery_codes'));
});

test('every table pages on a column of its own', () => {
  for (const t of TABLES) assert.equal(typeof t.pk, 'string', `${t.name} needs a pk`);
});

/* ------------------------------------------- a dump can never be committed */

test('.gitignore keeps dumps out of the repository, twice over', () => {
  const root = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  const inner = readFileSync(join(ROOT, 'backups/.gitignore'), 'utf8');

  const lines = t => t.split(/\r?\n/).map(l => l.trim());

  // The default output directory, and the two extensions that catch a dump
  // written anywhere else with --out.
  assert.ok(lines(root).includes('backups/*'), '.gitignore must ignore backups/*');
  assert.ok(lines(root).includes('*.ndjson'), '.gitignore must ignore *.ndjson');
  assert.ok(lines(root).includes('*.pg_dump.sql'), '.gitignore must ignore *.pg_dump.sql');

  // And the rule from inside, which survives an edit to the root file.
  assert.ok(lines(inner).includes('*'), 'backups/.gitignore must ignore everything');
  assert.ok(lines(inner).includes('!.gitignore'), 'backups/.gitignore must keep itself');

  // The root rule has to be `backups/*` and not `backups/`: git does not
  // descend into an excluded directory, so `backups/` would exclude
  // backups/.gitignore itself and the second rule would never be committed.
  assert.ok(!lines(root).includes('backups/'), 'use backups/* so backups/.gitignore stays tracked');
});

test('the backup script writes into the gitignored directory by default', () => {
  const src = readFileSync(join(ROOT, 'scripts/backup-db.mjs'), 'utf8');
  assert.match(src, /join\(ROOT, 'backups'\)/, 'the default --out must be backups/');
});

test('the backup script only ever sends SELECT', () => {
  // A source assertion because the guard has no behaviour until somebody adds
  // the statement it exists to stop. backup-db.mjs is the one script in this
  // project that is pointed at production on purpose.
  const src = readFileSync(join(ROOT, 'scripts/backup-db.mjs'), 'utf8');
  assert.match(src, /may only run SELECT/);
  assert.match(src, /\^\\s\*select\\b/i);
});

test('nothing in the backup scripts prints a connection string unredacted', () => {
  for (const f of ['scripts/backup-db.mjs', 'scripts/restore-db.mjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /redact/, `${f} must have a redactor`);
    assert.ok(
      !/console\.log\([^)]*\$\{url\}/.test(src),
      `${f} must never interpolate a raw connection string into output`
    );
  }
});
