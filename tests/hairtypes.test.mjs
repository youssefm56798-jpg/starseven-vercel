/**
 * Hair-type tiles and product ranking — ported 1:1 from tests/run.php.
 *
 * These tests are the guard on the one thing the site promises: that a
 * customer who taps their hair type is sent the product the research argues
 * for, and never one the same tile tells them to avoid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HAIR_TYPES, bySlug, rankProducts } from '../lib/hairtypes.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SLUGS = ['straight', 'wavy', 'curly', 'coily', 'fine', 'thick'];

/* ------------------------------------------------------------- the tiles */

test('exactly six tiles', () => {
  assert.equal(HAIR_TYPES.length, 6);
});

test('tiles are in the expected order', () => {
  assert.deepEqual(HAIR_TYPES.map(t => t.slug), SLUGS);
});

// One test per field so a gap names itself, the way the PHP suite did.
for (const tile of HAIR_TYPES) {
  for (const lang of ['ar', 'en']) {
    for (const key of ['name', 'short', 'problem', 'answer', 'avoid']) {
      test(`${tile.slug}.${lang}.${key} is filled`, () => {
        assert.equal(typeof tile[lang]?.[key], 'string');
        assert.notEqual((tile[lang]?.[key] ?? '').trim(), '');
      });
    }
  }

  test(`${tile.slug} icon path ends in ${tile.slug}.svg`, () => {
    assert.ok(tile.icon.endsWith(`${tile.slug}.svg`), `got ${tile.icon}`);
  });
}

test('bySlug resolves every tile, and nothing else', () => {
  for (const slug of SLUGS) assert.equal(bySlug(slug)?.slug, slug);
  assert.equal(bySlug('nope'), null);
});

/* --------------------------------------------------------- icon files ---
 * The icons live in public/assets/hair/ in the Next build, and the agent that
 * copies them over may not have run yet. A missing folder is a not-my-problem
 * skip; a folder that exists but is missing an icon is a real failure. */

const ICON_DIR = `${ROOT}public/assets/hair`;
const iconsPresent = existsSync(ICON_DIR);

for (const tile of HAIR_TYPES) {
  test(`${tile.slug} icon file exists`, {
    skip: iconsPresent ? false : `public/assets/hair/ not present yet — icons not copied from the PHP build`,
  }, () => {
    // tile.icon is site-relative ("assets/hair/x.svg"); on disk it is under public/.
    assert.ok(existsSync(`${ROOT}public/${tile.icon}`), `missing public/${tile.icon}`);
  });
}

/* ------------------------------------------------------------- catalogue */

// Mirrors db/seed.sql. Kept literal so a reader can see what is being ranked,
// and cross-checked against the real file below so the two cannot drift.
//
// Gels sit above waxes because that is how Ovanza publish it - Premium gel is
// Ultra Strong / 48h, the waxes are Strong or Medium. The shop had it upside
// down, which put its own numbers in contradiction with the straight tile.
//
// Black Seed lost 'fine' with the matte claim it was sold on: it is a
// high-shine grey-covering wax with no matting agent in it. Pro carries the
// fine tile now - last in its list, so it takes nothing else over.
const CATALOGUE = [
  { sku: 'S7-WAX-RED', hold_level: 4, hair_types: 'wavy,thick' },
  { sku: 'S7-WAX-PUR', hold_level: 3, hair_types: 'coily,curly,thick' },
  { sku: 'S7-WAX-BLU', hold_level: 3, hair_types: 'curly,coily,wavy' },
  { sku: 'S7-WAX-BLK', hold_level: 3, hair_types: 'wavy,thick' },
  { sku: 'S7-WAX-YEL', hold_level: 4, hair_types: 'thick,straight,wavy,fine' },
  { sku: 'S7-GEL-YEL', hold_level: 5, hair_types: 'straight' },
  { sku: 'S7-GEL-GRN', hold_level: 5, hair_types: 'straight' },
  { sku: 'S7-GEL-BLU', hold_level: 5, hair_types: 'straight' },
];

/** Pulls (sku, hold_level, hair_types) straight out of the products INSERT. */
function catalogueFromSeed(text) {
  const start = text.indexOf('INSERT INTO products');
  const end = text.indexOf('ON CONFLICT (sku)');
  const block = text.slice(start, end);
  const rows = [];

  for (const m of block.matchAll(/\(\s*'(S7-[A-Z-]+)'/g)) {
    // Walk the row from the SKU to its closing paren, splitting on top-level
    // commas only, so quoted values containing commas stay whole.
    let i = m.index + 1;
    const cells = [];
    let cell = '';
    for (; i < block.length; i++) {
      const c = block[i];
      if (c === "'") {
        cell += c;
        for (i++; i < block.length; i++) {
          cell += block[i];
          if (block[i] === "'") {
            if (block[i + 1] === "'") { cell += "'"; i++; continue; }
            break;
          }
        }
        continue;
      }
      if (c === ',') { cells.push(cell.trim()); cell = ''; continue; }
      if (c === ')') { cells.push(cell.trim()); break; }
      cell += c;
    }
    const unquote = s => s.replace(/^'|'$/g, '');
    rows.push({
      sku: unquote(cells[0]),
      hold_level: Number(cells[14]),
      hair_types: unquote(cells[15]),
    });
  }
  return rows;
}

test('db/seed.sql still describes the catalogue these tests rank', () => {
  const seedPath = `${ROOT}db/seed.sql`;
  assert.ok(existsSync(seedPath), 'db/seed.sql is missing');
  assert.deepEqual(catalogueFromSeed(readFileSync(seedPath, 'utf8')), CATALOGUE);
});

/* --------------------------------------------------------------- ranking */

const first = type => rankProducts(CATALOGUE, type, 3)[0]?.sku ?? 'NONE';

const primaries = [
  ['wavy', 'S7-WAX-RED', 'Pro X (Wave & Groom)'],
  ['curly', 'S7-WAX-BLU', 'Argan'],
  ['coily', 'S7-WAX-PUR', 'Shea butter'],
  ['fine', 'S7-WAX-YEL', 'Pro (the one Ovanza call all-hair-types)'],
  ['thick', 'S7-WAX-YEL', 'Pro (daily strong)'],
];

for (const [type, sku, why] of primaries) {
  test(`${type} -> ${why}`, () => {
    assert.equal(first(type), sku);
  });
}

test('straight -> a gel', () => {
  assert.ok(first('straight').includes('GEL'), `got ${first('straight')}`);
});

for (const slug of SLUGS) {
  test(`${slug} has at least one match`, () => {
    assert.ok(rankProducts(CATALOGUE, slug, 3).length > 0);
  });
}

/* Coherence: a tile must never be sent a format its own "avoid" line warns
 * against. The three gels carry 'straight' alone for exactly this reason —
 * the wavy tile tells the customer hard gels flatten the wave, and the fine
 * tile warns off shine, so ranking either into a gel would put the panel in
 * contradiction with itself. */
for (const slug of ['wavy', 'curly', 'coily', 'fine', 'thick']) {
  test(`${slug} is never recommended a gel`, () => {
    const gels = rankProducts(CATALOGUE, slug, 8)
      .map(p => p.sku)
      .filter(sku => sku.includes('GEL'));
    assert.deepEqual(gels, []);
  });
}

test('straight is the tile the gels are for', () => {
  const skus = rankProducts(CATALOGUE, 'straight', 8).map(p => p.sku);
  assert.ok(skus.some(sku => sku.includes('GEL')));
  assert.ok(first('straight').includes('GEL'));
});

test('respects the limit', () => {
  assert.equal(rankProducts(CATALOGUE, 'straight', 2).length, 2);
});

test('unknown type returns nothing', () => {
  assert.deepEqual(rankProducts(CATALOGUE, 'nope', 3), []);
});

test('an empty catalogue returns nothing', () => {
  assert.deepEqual(rankProducts([], 'wavy', 3), []);
});

test('primary match is rank 1', () => {
  assert.equal(rankProducts(CATALOGUE, 'coily', 3)[0].match_rank, 1);
});

test('secondary match ranks after the primary', () => {
  assert.ok(rankProducts(CATALOGUE, 'coily', 3)[1].match_rank > 1);
});

test('scores descend', () => {
  const scores = rankProducts(CATALOGUE, 'thick', 3).map(p => p.match_score);
  assert.ok(scores.length > 1);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('every product in the catalogue is reachable from some tile', () => {
  const reachable = new Set(SLUGS.flatMap(s => rankProducts(CATALOGUE, s, 8).map(p => p.sku)));
  assert.deepEqual([...reachable].sort(), CATALOGUE.map(p => p.sku).sort());
});

test('no tile is decided by a tie the sort broke for us', () => {
  // Position in the CSV is the ranking, and hold breaks the tie. Two products
  // on the same score leave the answer to Array.sort's stability - an accident
  // that reads as a decision rather than one.
  //
  // 'straight' is the exception, and a known one: Golden, Green and Blue are
  // the same gel in three scents at the same hold, so they tie at 105 and seed
  // order decides which one leads. That is a real question - which gel fronts
  // the tile - and it is the client's to answer, not a bug to break here.
  for (const slug of SLUGS.filter(s => s !== 'straight')) {
    const scores = rankProducts(CATALOGUE, slug, 3).map(p => p.match_score);
    assert.equal(new Set(scores).size, scores.length,
      `${slug} has two products on the same score: ${scores.join(', ')}`);
  }
});

test('the black wax is off the fine tile and still reachable', () => {
  // It was fine's primary on a matte finish it does not have. It keeps a place
  // where medium hold and high flexibility are genuinely the point, and leads
  // neither of them.
  const fine = rankProducts(CATALOGUE, 'fine', 8).map(p => p.sku);
  assert.ok(!fine.includes('S7-WAX-BLK'), 'the black wax is still sold to fine hair');

  for (const slug of ['wavy', 'thick']) {
    const ranked = rankProducts(CATALOGUE, slug, 8).map(p => p.sku);
    assert.ok(ranked.includes('S7-WAX-BLK'), `unreachable from ${slug}`);
    assert.notEqual(ranked[0], 'S7-WAX-BLK', `it should not lead ${slug}`);
  }
});
