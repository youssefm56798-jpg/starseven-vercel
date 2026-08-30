/**
 * The grant matrix, checked against what the code actually does.
 *
 * db/grants.mjs is the smallest set of privileges the running site needs. That
 * is only true on the day it is written: the next feature that writes to a
 * table it currently only reads would fail at runtime, in production, with a
 * permission error nobody sees until an order does not save.
 *
 * So this re-derives the matrix from the queries in app/ and lib/ on every test
 * run and fails when the two disagree. Adding a write means adding a grant, and
 * the failure message says which. No database is needed - it is all text.
 *
 * scripts/verify-grants.mjs is the other half: it builds the real role in a
 * throwaway database and connects through it. This one catches the drift, that
 * one catches a matrix that is wrong about Postgres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GRANTS } from '../db/grants.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Source with comments removed, so prose about UPDATE is not read as SQL. */
function code(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(l => (l.trim().startsWith('//') ? '' : l))
    .join('\n');
}

const sources = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))].map(code);

/** table -> Set of verbs the code performs on it. */
const used = new Map();
const note = (table, verb) => {
  if (!used.has(table)) used.set(table, new Set());
  used.get(table).add(verb);
};

for (const src of sources) {
  for (const m of src.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)) {
    note(m[1].toLowerCase(), 'INSERT');
    // An upsert needs UPDATE as well, even though no UPDATE statement exists.
    // Look only as far as the end of this statement, not the rest of the file.
    const tail = src.slice(m.index, m.index + 700).split('`')[0];
    if (/ON\s+CONFLICT[\s\S]*?DO\s+UPDATE/i.test(tail)) note(m[1].toLowerCase(), 'UPDATE');
  }
  for (const m of src.matchAll(/UPDATE\s+([a-z_]+)\s+SET\b/gi)) note(m[1].toLowerCase(), 'UPDATE');
  for (const m of src.matchAll(/DELETE\s+FROM\s+([a-z_]+)/gi)) note(m[1].toLowerCase(), 'DELETE');
}

/** Real tables, from the schema — so a match on an alias is not mistaken for one. */
const schema = readFileSync(join(ROOT, 'db/schema.sql'), 'utf8');
const tables = new Set(
  [...schema.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()),
);

test('the schema and the matrix list the same tables', () => {
  const missing = [...tables].filter(t => !GRANTS[t]).sort();
  const extra = Object.keys(GRANTS).filter(t => !tables.has(t)).sort();
  assert.deepEqual(missing, [], `db/grants.mjs has no entry for: ${missing.join(', ')} — a new table needs a decision, not a default`);
  assert.deepEqual(extra, [], `db/grants.mjs grants on tables the schema does not create: ${extra.join(', ')}`);
});

test('every table the code writes to carries the grant for it', () => {
  const problems = [];
  for (const [table, verbs] of used) {
    if (!tables.has(table)) continue; // an alias or a CTE name, not a table
    const granted = GRANTS[table] || [];
    for (const verb of verbs) {
      if (!granted.includes(verb)) problems.push(`${table} needs ${verb} (code does it, matrix does not grant it)`);
    }
  }
  assert.deepEqual(problems, [], problems.join('; '));
});

test('every table can be read', () => {
  // Every grant list starts with SELECT. A write-only grant would be a mistake
  // rather than a policy: nothing in this app writes without reading first.
  const noRead = Object.entries(GRANTS).filter(([, v]) => !v.includes('SELECT')).map(([t]) => t);
  assert.deepEqual(noRead, [], `these carry no SELECT: ${noRead.join(', ')}`);
});

test('the matrix grants nothing the code never does', () => {
  /*
   * The direction that actually shrinks privilege. A grant nothing exercises is
   * one an attacker gets for free, so each is either removed or explained here.
   *
   * The two standing exceptions are both about tables whose writes live outside
   * app/ and lib/ - the seed writes articles and settings, and the seed runs as
   * the owner, not as this role.
   */
  const unexplained = [];
  for (const [table, verbs] of Object.entries(GRANTS)) {
    const does = used.get(table) || new Set();
    for (const verb of verbs) {
      if (verb === 'SELECT') continue;
      if (!does.has(verb)) unexplained.push(`${table}:${verb}`);
    }
  }
  assert.deepEqual(unexplained, [], `granted but never used — drop it: ${unexplained.join(', ')}`);
});
