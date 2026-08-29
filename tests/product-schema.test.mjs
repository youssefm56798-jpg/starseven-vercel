/**
 * The two columns the product admin adds, and the seed statements that had to
 * learn about them.
 *
 * File reads, no database, like the rest of tests/. What this catches is the
 * class of mistake a database test cannot: db/schema.sql and db/seed.sql are
 * BOTH re-run on every single deploy, so a statement that is correct once and
 * destructive twice looks perfect in staging and eats the shop on the second
 * push. The statements themselves are proved against a real Postgres by
 * scripts/verify-product-admin.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitStatements } from '../scripts/sql-split.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const schema = read('db/schema.sql');
const seed = read('db/seed.sql');

/* ------------------------------------------------------------- the columns */

test('the two new product columns are added idempotently', () => {
  for (const column of ['origin', 'archived_at']) {
    assert.match(schema, new RegExp(`ALTER TABLE products ADD COLUMN IF NOT EXISTS\\s+${column}\\b`),
      `${column} is not added, or not added idempotently`);
  }
});

test('origin defaults to seed, because every row that exists today came from one', () => {
  // The default is what makes this safe to add to a live database: 63 products
  // are already in there, all of them seeded, and none of them may start
  // looking like something the admin created.
  assert.match(schema, /ADD COLUMN IF NOT EXISTS\s+origin\s+TEXT NOT NULL DEFAULT 'seed'/);
});

test('the origin CHECK is dropped before it is added, like every other CHECK here', () => {
  // Postgres has no ALTER CONSTRAINT for a CHECK, so a bare ADD CONSTRAINT
  // fails on the second deploy and takes the build with it.
  const drop = schema.indexOf('DROP CONSTRAINT IF EXISTS products_origin_check');
  const add = schema.indexOf('ADD CONSTRAINT products_origin_check');
  assert.ok(drop > 0, 'the origin CHECK is never dropped');
  assert.ok(add > drop, 'the origin CHECK is added before it is dropped');
});

test('nothing in the schema drops the products table or either new column', () => {
  // db/schema.sql runs on every deploy. A DROP in here is not a migration, it
  // is the shop losing its catalogue every time somebody pushes.
  assert.doesNotMatch(schema, /DROP TABLE[^;]*products/i);
  assert.doesNotMatch(schema, /ALTER TABLE products DROP COLUMN[^;]*(origin|archived_at)/i);
});

test('the columns the code reads are the columns the schema creates', () => {
  const sources = ['lib/product-admin.js', 'app/admin/(panel)/products/page.js'].map(read).join('\n');
  for (const column of ['origin', 'archived_at']) {
    assert.match(sources, new RegExp(`\\b${column}\\b`),
      `${column} is in the schema but nothing reads it — is it dead?`);
  }
});

/* -------------------------------------------------------- the seed statements */

test('the seed cannot publish a product the admin is still writing', () => {
  /*
   * Three statements in db/seed.sql are guarded on a shape rather than on a
   * SKU: price is 0 and active is false. That is the catalogue rows waiting
   * for a price — and it is also, character for character, a product an owner
   * created in the admin ten minutes ago and has not finished. Two of the
   * three would price it at 45 or 40 EGP, stock it at 200 and put it on the
   * shop; the third would publish it at no price at all. On the next deploy,
   * with nobody having asked.
   *
   * So every seed statement that matches on that shape must also require
   * origin = 'seed'. This is the test that says so.
   */
  const shaped = splitStatements(seed)
    .filter(s => /UPDATE products/.test(s))
    .filter(s => /price = 0 AND active = FALSE/.test(s));

  assert.equal(shaped.length, 3, 'the number of shape-guarded seed statements changed');
  for (const stmt of shaped) {
    assert.match(stmt, /origin = 'seed'/,
      `a seed statement matches unpriced hidden rows without checking origin, so it would ` +
      `publish an admin draft on the next deploy:\n${stmt.slice(0, 160)}`);
  }
});

test('every seed statement that writes products is scoped to a SKU or to origin', () => {
  // The general form of the rule above. A statement that can reach an
  // arbitrary row of this table runs again on every deploy against a table the
  // owner has been editing all week.
  for (const stmt of splitStatements(seed)) {
    if (!/^\s*UPDATE products/m.test(stmt)) continue;
    const scoped = /sku = '/.test(stmt) || /origin = 'seed'/.test(stmt) || /p\.sku = v\.sku/.test(stmt);
    assert.ok(scoped, `an UPDATE on products is scoped to nothing:\n${stmt.slice(0, 160)}`);
  }
});

test('the product seeds still conflict on the SKU rather than overwriting', () => {
  // DO NOTHING is what stops a redeploy reverting a price the owner set. It is
  // also, indirectly, why a hard delete of a seeded product is not offered:
  // a deleted row stops conflicting, so the next deploy inserts it again.
  const inserts = splitStatements(seed).filter(s => /^\s*INSERT INTO products/m.test(s));
  assert.equal(inserts.length, 2, 'the number of product seed inserts changed');
  for (const stmt of inserts) {
    assert.match(stmt, /ON CONFLICT \(sku\) DO NOTHING/,
      'a product seed would overwrite a row the owner has edited');
  }
});

test('the seed writes no origin of its own, so the default is what it gets', () => {
  // If a seed INSERT ever named origin explicitly it could name the wrong one,
  // and an admin-owned row inserted by the seed is a contradiction that would
  // quietly disable every guard above.
  for (const stmt of splitStatements(seed)) {
    if (!/^\s*INSERT INTO products/m.test(stmt)) continue;
    assert.doesNotMatch(stmt, /\borigin\b/, 'a product seed sets origin by hand');
  }
});

/* ------------------------------------------------------- the delete decision */

test('nothing outside lib/product-admin.js deletes from products', async () => {
  // The same rule orders.status has. A DELETE anywhere else is a second
  // opinion about a decision that took four paragraphs to reach, and the cost
  // of getting it wrong is stock that never comes back from a cancelled order.
  const { execFileSync } = await import('node:child_process');
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-n', '-E', 'DELETE FROM products', '--', 'app', 'lib'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return; // git grep exits 1 with no matches, which is the passing case
  }
  const offenders = hits.split('\n').filter(Boolean)
    .filter(l => !l.startsWith('lib/product-admin.js:'));
  assert.deepEqual(offenders, [],
    `products rows are deleted outside lib/product-admin.js:\n${offenders.join('\n')}`);
});

test('the one delete carries all three of its conditions', () => {
  const src = read('lib/product-admin.js');
  const stmt = src.slice(src.indexOf('DELETE FROM products'));
  assert.match(stmt, /p\.origin = 'admin'/, 'a seeded product could be deleted, and the seed would re-add it');
  assert.match(stmt, /p\.archived_at IS NOT NULL/, 'a live product could be deleted outright');
  assert.match(stmt, /NOT EXISTS \(SELECT 1 FROM order_items i WHERE i\.product_id = p\.id\)/,
    'an ordered product could be deleted, which breaks the restock of that order');
});

test('archiving takes the product off the shop in the same statement', () => {
  // Two statements would leave a window where a row is archived and still
  // sellable, and the storefront only filters on active.
  const src = read('lib/product-admin.js');
  const stmt = src.slice(src.indexOf('export async function archiveProduct'));
  assert.match(stmt.slice(0, 800), /SET active = FALSE, archived_at = now\(\)/);
  assert.match(stmt.slice(0, 800), /WHERE id = \$\{productId\} AND archived_at IS NULL/,
    'archiving twice would write a second timestamp');
});

test('restoring does not put the product back on the shop by itself', () => {
  const src = read('lib/product-admin.js');
  const stmt = src.slice(src.indexOf('export async function restoreProduct'),
    src.indexOf('export async function discardProduct'));
  assert.doesNotMatch(stmt, /active = TRUE/,
    'restore republishes, so one click separates a filed-away product from a live one');
});
