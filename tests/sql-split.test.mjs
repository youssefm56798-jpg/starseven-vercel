/**
 * The statement splitter used by scripts/setup-db.mjs.
 *
 * There is no test for setup-db.mjs itself (it needs a live Neon database),
 * so this is where the risky half of that script is proven: a naive
 * `sql.split(';')` would tear this project's seed apart inside the Arabic
 * article bodies, which contain both semicolons and apostrophes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitStatements } from '../scripts/sql-split.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('splits plain statements', () => {
  assert.deepEqual(splitStatements('SELECT 1; SELECT 2;'), ['SELECT 1', 'SELECT 2']);
});

test('a trailing statement without its semicolon still counts', () => {
  assert.deepEqual(splitStatements('SELECT 1;\nSELECT 2'), ['SELECT 1', 'SELECT 2']);
});

test('comment-only chunks are dropped, not sent as empty queries', () => {
  const out = splitStatements('-- header\n/* block */\nSELECT 1;\n-- trailer\n');
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith('SELECT 1'));
});

test('a semicolon inside a line comment does not split', () => {
  assert.equal(splitStatements('SELECT 1 -- not; a; split\n , 2;').length, 1);
});

test('a semicolon inside a block comment does not split', () => {
  assert.equal(splitStatements('SELECT /* not; here */ 1;').length, 1);
});

test('a semicolon inside a single-quoted string does not split', () => {
  const out = splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;");
  assert.equal(out.length, 2);
  assert.ok(out[0].includes("'a;b'"));
});

test("doubled '' inside a literal does not end the string", () => {
  const out = splitStatements("INSERT INTO t VALUES ('it''s; fine'); SELECT 1;");
  assert.equal(out.length, 2);
  assert.ok(out[0].includes("'it''s; fine'"));
});

test('a multi-line literal keeps its newlines and its semicolons', () => {
  const sql = "INSERT INTO t VALUES ('line one;\n\nline two; still one value');\nSELECT 1;";
  const out = splitStatements(sql);
  assert.equal(out.length, 2);
  assert.ok(out[0].includes('line two; still one value'));
});

test('semicolons inside quoted Arabic do not split the statement', () => {
  // Arabic semicolon (U+061B) and an ASCII one, inside one literal.
  const sql = "INSERT INTO articles (body) VALUES ('ابدأ من شعرك؛ مش من البرطمان; تمام');\nSELECT 1;";
  const out = splitStatements(sql);
  assert.equal(out.length, 2);
  assert.ok(out[0].includes('مش من البرطمان; تمام'));
  // Proof the naive approach really would have broken here.
  assert.ok(sql.split(';').length > 2);
});

test('a semicolon inside a quoted identifier does not split', () => {
  assert.equal(splitStatements('SELECT "od;d" FROM t;').length, 1);
});

test('a semicolon inside a dollar-quoted body does not split', () => {
  const sql = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql;\nSELECT 1;";
  assert.equal(splitStatements(sql).length, 2);
});

test('a semicolon inside a tagged dollar-quoted body does not split', () => {
  assert.equal(splitStatements("SELECT $tag$a;b$tag$;\nSELECT 1;").length, 2);
});

test("a backslash-escaped quote inside E'' does not end the string", () => {
  const bs = String.fromCharCode(92);
  const sql = `SELECT E'a${bs}'b;c';\nSELECT 1;`;
  assert.equal(splitStatements(sql).length, 2);
});

test('an E that is only the tail of a word is not an escape string', () => {
  // `TRUE'x;y'` — the quote opens an ordinary literal, not an E'' string.
  assert.equal(splitStatements("SELECT TRUE'x;y';").length, 1);
});

test('empty input yields no statements', () => {
  assert.deepEqual(splitStatements(''), []);
  assert.deepEqual(splitStatements('   \n\n  '), []);
  assert.deepEqual(splitStatements(';;;'), []);
});

/* ------------------------------------------- against the real .sql files */

for (const [file, min] of [['db/schema.sql', 10], ['db/seed.sql', 3]]) {
  test(`${file} splits into runnable statements`, { skip: existsSync(`${ROOT}${file}`) ? false : `${file} not present` }, () => {
    const raw = readFileSync(`${ROOT}${file}`, 'utf8');
    const out = splitStatements(raw);
    assert.ok(out.length >= min, `expected at least ${min} statements, got ${out.length}`);
    for (const stmt of out) {
      // Every statement must be balanced on quotes, or the split cut one open.
      const singles = (stmt.match(/'/g) ?? []).length;
      assert.equal(singles % 2, 0, `unbalanced quotes in: ${stmt.slice(0, 80)}`);
      assert.notEqual(stmt.trim(), '');
    }
  });
}

test('db/seed.sql is the seeds, the copy update, the article wave, the link fix and the catalogue', {
  skip: existsSync(`${ROOT}db/seed.sql`) ? false : 'db/seed.sql not present',
}, () => {
  const out = splitStatements(readFileSync(`${ROOT}db/seed.sql`, 'utf8'));
  assert.equal(out.length, 11);
  assert.ok(out[0].includes('INSERT INTO products') && out[0].includes('ON CONFLICT (sku)'));
  assert.ok(out[1].includes('INSERT INTO offers') && out[1].includes('ON CONFLICT (code)'));
  // Both article statements must target the (slug, lang) index. The old
// global unique on slug is dropped by schema.sql, so `ON CONFLICT (slug)`
// now fails with "no unique or exclusion constraint matching".
  assert.ok(out[2].includes('INSERT INTO articles'));
  assert.ok(out[2].includes('ON CONFLICT (slug, lang)'),
    'the first article seed must conflict on (slug, lang)');

  // The copy update must stay non-destructive: every column it touches is
  // guarded so a re-run cannot overwrite wording edited in the admin.
  const copy = out[3];
  assert.ok(copy.includes('UPDATE products p SET'));
  for (const col of ['long_ar', 'long_en', 'howto_ar', 'howto_en', 'highlights_ar', 'highlights_en']) {
    assert.ok(
      copy.includes(`${col}       = CASE WHEN p.${col}`) ||
      copy.includes(`${col}      = CASE WHEN p.${col}`) ||
      copy.includes(`${col} = CASE WHEN p.${col}`),
      `${col} is not guarded by a CASE WHEN ... = '' check`
    );
  }
  // Eight products, each contributing one tuple to the VALUES list.
  assert.equal((copy.match(/'S7-[A-Z-]+'/g) || []).length, 8);

  // The second article wave. This one DOES upsert on purpose — two of the eight
  // are rewrites of articles that already exist at 116 and 151 words, and the
  // new body is the entire point of the rewrite.
  const articles = out[4];
  assert.ok(articles.includes('INSERT INTO articles'));
  assert.ok(articles.includes('ON CONFLICT (slug, lang) DO UPDATE'),
    'the article wave must upsert, or the two rewrites never land');
  assert.ok(/body\s*=\s*EXCLUDED\.body/.test(articles),
    'the rewritten body must be part of the update');

  // Twins share a slug and a group_key so the language toggle has a key to
  // switch on. Both languages of the two paired articles must be present.
  for (const slug of ['wax-or-gel', 'make-your-style-last-all-day']) {
    const hits = articles.match(new RegExp(`'${slug}', '(ar|en)'`, 'g')) || [];
    assert.equal(hits.length, 2, `${slug} should exist in both languages`);
  }

  // The link fix. The rows it edits were seeded ON CONFLICT DO NOTHING, so
  // they can only be changed by a statement like this one — and it has to stay
  // guarded, or it rewrites a body an admin has edited on every deploy.
  const linkfix = out[5];
  assert.ok(linkfix.includes('UPDATE articles'));
  assert.ok(linkfix.includes("replace(body, '](/#hair)'"),
    'the link fix must target the old home-page anchor');
  assert.ok(linkfix.includes("WHERE body LIKE '%](/#hair)%'"),
    'the link fix must be a no-op once it has run');
  // English articles live under /en, so the English body cannot be given the
  // Arabic hub's URL.
  assert.ok(linkfix.includes("'](/en/hair-types)'") && linkfix.includes("'](/hair-types)'"),
    'the replacement must be language-correct');

  // The rest of the range. It must stay DO NOTHING and it must stay inactive:
  // these rows carry price 0 because the manufacturer feed has no prices, and
  // a zero-price product that reached the storefront would be free.
  const catalogue = out[6];
  assert.ok(catalogue.includes('INSERT INTO products'));
  assert.ok(catalogue.includes('ON CONFLICT (sku) DO NOTHING'),
    'the catalogue seed must never overwrite a row the client has priced');
  assert.ok(!/,\s*TRUE,\s*\d+\)/.test(catalogue),
    'no catalogue row may seed active = TRUE while its price is 0');
  // Matched as a VALUES field, not as the bare word — the comment above the
  // statement explains the FALSE and would otherwise be counted as a row.
  assert.equal((catalogue.match(/,\s*FALSE,/g) || []).length,
    (catalogue.match(/'S7-/g) || []).length,
    'every catalogue row must be seeded inactive');

  // The two pricing statements that follow. Both must stay guarded on
  // price = 0 AND active = false, so a row is priced once and a price the
  // client later sets in the admin is never overwritten by a redeploy.
  for (const stmt of out.slice(7, 9)) {
    assert.match(stmt, /UPDATE products/);
    assert.match(stmt, /price = 0 AND active = FALSE/,
      'a pricing statement is unguarded and would overwrite an admin edit');
  }

  // And neither may reach a format whose size makes the copied price wrong.
  const priced = out.slice(7, 9).join('\n');
  assert.ok(!/'spray'|'cologne'|'depilatory'/.test(priced),
    'a format with no priced sibling is being given a copied price');
  assert.ok(/size_ml = 250/.test(priced),
    'the gel pricing must be pinned to the size it was copied from');
});

test('db/seed.sql keeps the Arabic article bodies whole', {
  skip: existsSync(`${ROOT}db/seed.sql`) ? false : 'db/seed.sql not present',
}, () => {
  const [, , articles] = splitStatements(readFileSync(`${ROOT}db/seed.sql`, 'utf8'));
  // First and last paragraph of the Arabic "last all day" piece must be in the
  // same statement — the naive splitter would have cut between them.
  assert.ok(articles.includes('## ١. نشّف الأول، وشعرك شبه ناشف'));
  assert.ok(articles.includes('مش كمية أكبر.'));
  assert.equal((articles.match(/'ar'/g) ?? []).length, 2);
  assert.equal((articles.match(/'en'/g) ?? []).length, 2);
});

test('db/seed.sql is UTF-8 without a BOM and uses LF endings', {
  skip: existsSync(`${ROOT}db/seed.sql`) ? false : 'db/seed.sql not present',
}, () => {
  const raw = readFileSync(`${ROOT}db/seed.sql`, 'utf8');
  assert.notEqual(raw.charCodeAt(0), 0xFEFF);
  assert.ok(!raw.includes('\r'));
});
