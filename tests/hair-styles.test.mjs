/**
 * Style tiles and product ranking — the guard on what the style finder claims.
 *
 * Written to the same shape as tests/hairtypes.test.mjs, because it is guarding
 * the same promise from the other end: a customer who taps a look is sent the
 * product that actually gets them there, and never one the same tile tells them
 * to avoid. The catalogue is kept literal so a reader can see what is being
 * ranked, and cross-checked against db/seed.sql so the two cannot drift.
 *
 * The one thing here that has no equivalent in the type suite is the matte
 * assertion. Nothing in this range is matte, the whole crop tile is built on
 * saying so, and a SKU quietly rated matte in lib/hairstyles.js would flip that
 * tile from an honest refusal into a recommendation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HAIR_STYLES, FINISH, KIND_FINISH, finishOf, bySlug, rankForStyle } from '../lib/hairstyles.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SLUGS = ['slick-back', 'low-taper-fade', 'defined-curls', 'curtains', 'quiff', 'textured-crop'];
// The tiles app/hair-styles/lib.js writes an honest range note for. Pinned here
// as well as there so a tile cannot be graded down in the data without one.
const GAP_TILES = ['textured-crop', 'curtains', 'defined-curls', 'quiff'];

/* ------------------------------------------------------------- the tiles */

test('exactly six tiles', () => {
  assert.equal(HAIR_STYLES.length, 6);
});

test('tiles are in the expected order', () => {
  assert.deepEqual(HAIR_STYLES.map(s => s.slug), SLUGS);
});

// One test per field so a gap names itself, the way the type suite does.
for (const tile of HAIR_STYLES) {
  for (const lang of ['ar', 'en']) {
    for (const key of ['name', 'short', 'look', 'why', 'avoid']) {
      test(`${tile.slug}.${lang}.${key} is filled`, () => {
        assert.equal(typeof tile[lang]?.[key], 'string');
        assert.notEqual((tile[lang]?.[key] ?? '').trim(), '');
      });
    }

    test(`${tile.slug}.${lang}.steps is a real sequence`, () => {
      const steps = tile[lang]?.steps;
      assert.ok(Array.isArray(steps), 'steps must be an array');
      assert.ok(steps.length >= 3, `only ${steps.length} steps`);
      for (const s of steps) {
        assert.equal(typeof s, 'string');
        assert.ok(s.trim().length > 8, `a step is too short to be one: "${s}"`);
      }
    });
  }

  test(`${tile.slug} has the same number of steps in both languages`, () => {
    // The steps are the content of a style page and they are rendered as a
    // numbered run. A step present in one language and not the other is one
    // audience being told to do something the other is not.
    assert.equal(tile.ar.steps.length, tile.en.steps.length);
  });

  test(`${tile.slug} carries a hold and finish label in both languages`, () => {
    assert.ok(String(tile.label).trim().length > 4, tile.label);
    assert.ok(String(tile.labelEn).trim().length > 4, tile.labelEn);
  });

  test(`${tile.slug} icon path ends in ${tile.slug}.svg`, () => {
    assert.ok(tile.icon.endsWith(`${tile.slug}.svg`), `got ${tile.icon}`);
  });

  test(`${tile.slug} names one hold band on the range-wide scale`, () => {
    assert.ok(Number.isInteger(tile.hold), `hold is ${tile.hold}`);
    assert.ok(tile.hold >= 1 && tile.hold <= 5, `hold ${tile.hold} is off the scale`);
  });
}

test('the shop serves four styles properly and two only partly', () => {
  // docs/hair-style-research.md §4. This is the verdict the views render: a
  // tile that is not fully served is offered the closest thing under a label
  // that says so. Softening any of these numbers is the whole feature quietly
  // turning back into marketing.
  //
  // The crop moved from 'no' to 'partly' when the clay wax was made. That is a
  // fact about the factory rather than a softening, and it is the only reason
  // this line may ever be relaxed: 'no' means the range has no route to the
  // look at all, 'partly' means the route exists and the shop has not listed it
  // yet. If a tile is ever moved between them, the reason belongs in the tile.
  const by = v => HAIR_STYLES.filter(s => s.served === v).map(s => s.slug);
  assert.deepEqual(by('no'), []);
  assert.deepEqual(by('partly'), ['curtains', 'textured-crop']);
  assert.equal(by('yes').length, 4);
});

test('every tile that is not fully served admits it', () => {
  // The verdict and the note have to agree. A tile marked 'partly' or 'no' with
  // no gap note would be one that grades itself down in the data and says
  // nothing about it on the page. app/hair-styles/lib.js holds the notes; this
  // asserts the set they cover is a superset of the tiles that need one.
  for (const tile of HAIR_STYLES.filter(s => s.served !== 'yes')) {
    assert.ok(GAP_TILES.includes(tile.slug), `${tile.slug} is "${tile.served}" with no note`);
  }
});

test('bySlug resolves every tile, and nothing else', () => {
  for (const slug of SLUGS) assert.equal(bySlug(slug)?.slug, slug);
  assert.equal(bySlug('nope'), null);
});

test('the six tile colours are the six the palette already holds', () => {
  // docs/hair-style-research.md reuses the hair-type tile colours rather than
  // introducing six new tokens, so the two finders read as one system and the
  // grey lands on the tile the range cannot serve.
  assert.deepEqual(
    HAIR_STYLES.map(s => s.color),
    ['#2A6DE8', '#D9A81E', '#8B4DC9', '#5E9C2B', '#D7291D', '#55524A'],
  );
  assert.equal(new Set(HAIR_STYLES.map(s => s.color)).size, 6);
});

/* --------------------------------------------------------- icon files ---
 * A missing folder is a not-my-problem skip; a folder that exists but is
 * missing an icon is a real failure. Same treatment as the hair icons. */

const ICON_DIR = `${ROOT}public/assets/style`;
const iconsPresent = existsSync(ICON_DIR);

for (const tile of HAIR_STYLES) {
  test(`${tile.slug} icon file exists`, {
    skip: iconsPresent ? false : 'public/assets/style/ not present yet',
  }, () => {
    // tile.icon is site-relative ("assets/style/x.svg"); on disk it is under public/.
    assert.ok(existsSync(`${ROOT}public/${tile.icon}`), `missing public/${tile.icon}`);
  });
}

/* ------------------------------------------------------------- catalogue */

// Mirrors db/seed.sql, and cross-checked against the real file below so the two
// cannot drift. `kind` is carried as well as hold and the hair CSV, because the
// style ranker filters on format first and the type ranker never had to.
const CATALOGUE = [
  { sku: 'S7-WAX-RED', kind: 'wax', hold_level: 4, hair_types: 'wavy,thick' },
  { sku: 'S7-WAX-PUR', kind: 'wax', hold_level: 3, hair_types: 'coily,curly,thick' },
  { sku: 'S7-WAX-BLU', kind: 'wax', hold_level: 3, hair_types: 'curly,coily,wavy' },
  { sku: 'S7-WAX-BLK', kind: 'wax', hold_level: 3, hair_types: 'white,wavy,thick' },
  { sku: 'S7-WAX-YEL', kind: 'wax', hold_level: 4, hair_types: 'thick,straight,wavy,fine' },
  { sku: 'S7-GEL-YEL', kind: 'gel', hold_level: 5, hair_types: 'straight' },
  { sku: 'S7-GEL-GRN', kind: 'gel', hold_level: 5, hair_types: 'straight' },
  { sku: 'S7-GEL-BLU', kind: 'gel', hold_level: 5, hair_types: 'straight' },
];

/** Pulls (sku, kind, hold_level, hair_types) straight out of the products INSERT. */
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
      kind: unquote(cells[2]),
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

/* ------------------------------------------------ the manufacturer specs */

test('every product in the catalogue has a published finish rating', () => {
  for (const p of CATALOGUE) {
    assert.ok(FINISH[p.sku], `${p.sku} has no entry in FINISH`);
  }
});

test('finish ratings sit on the scale the ranker reads', () => {
  for (const [sku, f] of Object.entries(FINISH)) {
    for (const axis of ['shine', 'flex']) {
      assert.ok(Number.isInteger(f[axis]), `${sku}.${axis} is ${f[axis]}`);
      assert.ok(f[axis] >= 1 && f[axis] <= 3, `${sku}.${axis} is off the scale`);
    }
  }
});

test('none of the eight launch SKUs is matte', () => {
  // There is no silica, no starch and no clay in any of these eight formulas,
  // so a per-SKU matte rating here would be a claim the printed ingredient list
  // contradicts. The range does have matte products now — the clay wax and the
  // pomade — but they are rated by format in KIND_FINISH, precisely because
  // this table is the panel on the jar and those jars have no panel on file.
  const matte = Object.entries(FINISH).filter(([, f]) => f.shine === 1).map(([sku]) => sku);
  assert.deepEqual(matte, []);
});

test('the two matte formats are rated matte, by format', () => {
  // The crop tile asks for shine 1. Nothing could answer it while matte was
  // unreachable; these two are what make it answerable, and they have to stay
  // rated at the bottom of the scale or the tile silently goes back to leading
  // with a wax that shines.
  for (const kind of ['clay', 'pomade']) {
    assert.equal(KIND_FINISH[kind].shine, 1, kind);
    assert.equal(finishOf({ sku: 'S7-UNKNOWN', kind }).shine, 1, kind);
  }
  // A per-SKU rating still wins over the format default, so a clay the
  // manufacturer publishes a real number for can be corrected without this
  // table having to be special-cased.
  assert.equal(finishOf({ sku: 'S7-WAX-RED', kind: 'clay' }).shine, 3);
  assert.equal(finishOf({ sku: 'S7-NOPE', kind: 'wax' }), null);
});

test('the Shea wax is the only wax rated below high shine', () => {
  const waxes = CATALOGUE.filter(p => p.kind === 'wax');
  const dull = waxes.filter(p => FINISH[p.sku].shine < 3).map(p => p.sku);
  assert.deepEqual(dull, ['S7-WAX-PUR']);
});

test('the Blue gel is the only gel rated strong shine', () => {
  const gels = CATALOGUE.filter(p => p.kind === 'gel');
  const shiny = gels.filter(p => FINISH[p.sku].shine === 3).map(p => p.sku);
  assert.deepEqual(shiny, ['S7-GEL-BLU']);
});

test('Pro X is the only product rated below high flexibility among the waxes', () => {
  const waxes = CATALOGUE.filter(p => p.kind === 'wax');
  const firm = waxes.filter(p => FINISH[p.sku].flex < 3).map(p => p.sku);
  assert.deepEqual(firm, ['S7-WAX-RED']);
});

/* --------------------------------------------------------------- ranking */

const rank = (slug, limit = 3) => rankForStyle(CATALOGUE, bySlug(slug), limit);
const first = slug => rank(slug)[0]?.sku ?? 'NONE';

const primaries = [
  ['slick-back', 'S7-GEL-BLU', 'Premium Gel Blue, the only Strong Shine gel'],
  ['low-taper-fade', 'S7-WAX-YEL', 'Premium Wax Pro, hold 4 and high flexibility'],
  ['defined-curls', 'S7-WAX-BLU', 'Premium Wax Argan, hold 3 on purpose'],
  ['curtains', 'S7-WAX-PUR', 'Premium Wax Shea, the only Medium-shine wax, holds the centre part'],
  ['quiff', 'S7-WAX-RED', 'Premium Wax Pro X, the only medium-flexibility product'],
  ['textured-crop', 'S7-WAX-PUR', 'Premium Wax Shea, the least shiny thing on the shop'],
];

for (const [slug, sku, why] of primaries) {
  test(`${slug} -> ${why}`, () => {
    assert.equal(first(slug), sku);
  });
}

for (const slug of SLUGS) {
  test(`${slug} has at least one match`, () => {
    assert.ok(rank(slug).length > 0);
  });

  test(`${slug} is only ever ranked products in the hold band it argues for`, () => {
    // Every tile names its own hold number out loud, and the copy argues for
    // that number: the slick back says a hold-4 wax is back on your forehead by
    // two, the curls tile says anything above 3 locks the curl shut. Ranking
    // outside the band would put the panel in contradiction with its own text.
    const tile = bySlug(slug);
    for (const p of rank(slug, 8)) {
      assert.equal(Number(p.hold_level), tile.hold, `${p.sku} is hold ${p.hold_level}`);
    }
  });

  test(`${slug} leads on a decisive score, not on a tie`, () => {
    const scores = rank(slug, 8).map(p => p.match_score);
    if (scores.length < 2) return;
    assert.ok(scores[0] > scores[1],
      `${slug} leads on a tie at ${scores[0]}, so seed order is picking the answer`);
  });

  test(`${slug} ranks descend and are numbered from 1`, () => {
    const ranked = rank(slug, 8);
    assert.deepEqual(ranked.map(p => p.match_rank), ranked.map((_, i) => i + 1));
    const scores = ranked.map(p => p.match_score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });
}

/* Coherence: a tile must never be sent a format its own copy rules out. This is
 * enforced structurally rather than by data — rankForStyle filters on kind
 * before it scores anything — which is the whole argument for deriving the
 * mapping in code instead of handing the client a second free-text taxonomy. */

for (const slug of ['defined-curls', 'low-taper-fade', 'curtains', 'quiff', 'textured-crop']) {
  test(`${slug} is never recommended a gel`, () => {
    const gels = rank(slug, 8).map(p => p.sku).filter(sku => sku.includes('GEL'));
    assert.deepEqual(gels, []);
  });
}

test('the crop tile warns against gel in both languages, and cannot be sent one', () => {
  const crop = bySlug('textured-crop');
  assert.match(crop.en.avoid, /\bgel\b/i);
  assert.match(crop.ar.avoid, /الجل/);
  assert.deepEqual(rank('textured-crop', 8).filter(p => p.kind === 'gel'), []);
});

test('the format filter is load-bearing, and not shadowed by the hold band', () => {
  // Every format test above this line passes with the format filter deleted,
  // because in the eight rows of CATALOGUE no wax and no gel share a hold band:
  // the hold filter alone happens to separate the two formats there, so the
  // tests cannot tell the two filters apart and were proving nothing about the
  // one they name. The live shop is not shaped like that. It stocks styling
  // gels at hold 4 beside the hold-4 waxes, so the format filter is the only
  // thing standing between a gel and the two wax tiles that argue against gel
  // in their own copy. This is the catalogue that tells the filters apart.
  const mixed = [
    ...CATALOGUE,
    { sku: 'S7-SG250-WHITE', kind: 'gel', hold_level: 4, hair_types: 'wavy,thick' },
    { sku: 'S7-G999-TEST', kind: 'gel', hold_level: 3, hair_types: 'curly,thick' },
    { sku: 'S7-WAX-HOLD5', kind: 'wax', hold_level: 5, hair_types: 'straight' },
  ];
  const kinds = slug => rankForStyle(mixed, bySlug(slug), 12).map(p => p.kind);

  for (const slug of ['defined-curls', 'low-taper-fade', 'curtains', 'quiff', 'textured-crop']) {
    assert.deepEqual(kinds(slug).filter(k => k !== 'wax'), [],
      `${slug} argues against gel in its own copy and was sent one anyway`);
  }
  for (const slug of ['slick-back']) {
    assert.deepEqual(kinds(slug).filter(k => k !== 'gel'), [],
      `${slug} says a wax drops out of this look and was sent a wax anyway`);
  }
});

for (const slug of ['slick-back']) {
  test(`${slug} is never recommended a wax`, () => {
    // The slick-back tile says in its own copy that a wax holds at 4 and never
    // sets, so the front drops. Ranking one here would contradict the sentence
    // directly above it on the same card.
    const waxes = rank(slug, 8).map(p => p.kind).filter(k => k === 'wax');
    assert.deepEqual(waxes, []);
  });
}

test('the crop tile is led by the least shiny product it can reach', () => {
  // The whole tile depends on looking dry. It cannot have matte, so the least
  // bad answer has to lead it — a higher-shine wax at the top of this tile
  // would be the Black-is-matte error committed a second time.
  const ranked = rank('textured-crop', 8);
  const shine = ranked.map(p => finishOf(p).shine);
  assert.equal(shine[0], Math.min(...shine), `led by shine ${shine[0]} of ${shine.join(', ')}`);
});

test('the quiff is led by the only product that keeps a set shape', () => {
  // Medium flexibility is the entire argument on that tile: it is the one
  // product that holds the shape you set instead of relaxing out of it.
  assert.equal(FINISH[first('quiff')].flex, 2);
});

test('the slick back is the only style a gel fronts, and it is the Blue', () => {
  // Applying the maker's shine ratings, the Blue is the only gel that leads a
  // style tile now that the crunchy gel spike is retired: it is the one gel
  // rated Strong Shine. The Green and the Golden front no style, which leaves
  // the Golden to lead the straight hair-type tile by elimination rather than
  // by sort accident.
  const leads = SLUGS.map(first).filter(sku => sku.includes('GEL'));
  assert.deepEqual(leads, ['S7-GEL-BLU']);
  assert.equal(leads.includes('S7-GEL-GRN'), false);
  assert.equal(leads.includes('S7-GEL-YEL'), false);
});

test('every tile that names a lead leads with it', () => {
  for (const tile of HAIR_STYLES.filter(t => t.needs.lead)) {
    assert.equal(first(tile.slug), tile.needs.lead, tile.slug);
  }
});

test('every named lead is a product the seed actually stocks', () => {
  const skus = new Set(CATALOGUE.map(p => p.sku));
  for (const tile of HAIR_STYLES.filter(t => t.needs.lead)) {
    assert.ok(skus.has(tile.needs.lead), `${tile.slug} leads with ${tile.needs.lead}, which is not in the catalogue`);
  }
});

test('a tile may name no lead, and only the crop does', () => {
  // The crop is the one tile whose right answer is a format rather than a SKU:
  // a clay, and no clay is on the shop to name. A lead pointing at a SKU that
  // does not exist is a lead that can only ever be wrong, so the tile names
  // none and lets the shine axis decide — which is also what lets a clay take
  // the tile on the day it is switched on, with no code change.
  const unled = HAIR_STYLES.filter(t => !t.needs.lead).map(t => t.slug);
  assert.deepEqual(unled, ['textured-crop']);
});

test('a clay takes the crop tile from the wax the moment one exists', () => {
  const withClay = [...CATALOGUE,
    { sku: 'S7-CLAY-1', kind: 'clay', hold_level: 3, hair_types: 'fine,thick' }];
  const ranked = rankForStyle(withClay, bySlug('textured-crop'), 8);
  assert.equal(ranked[0]?.sku, 'S7-CLAY-1');
  // And it does not gatecrash a tile that never asked for a matte finish.
  assert.equal(rankForStyle(withClay, bySlug('defined-curls'), 8)
    .some(p => p.sku === 'S7-CLAY-1'), false);
});

test('every product in the catalogue is reachable from some tile', () => {
  const reachable = new Set(SLUGS.flatMap(s => rank(s, 8).map(p => p.sku)));
  assert.deepEqual([...reachable].sort(), CATALOGUE.map(p => p.sku).sort());
});

test('respects the limit', () => {
  assert.equal(rank('defined-curls', 2).length, 2);
});

test('an unknown style returns nothing', () => {
  assert.deepEqual(rankForStyle(CATALOGUE, bySlug('nope'), 3), []);
  assert.deepEqual(rankForStyle(CATALOGUE, null, 3), []);
});

test('an empty or missing catalogue returns nothing', () => {
  assert.deepEqual(rankForStyle([], bySlug('quiff'), 3), []);
  assert.deepEqual(rankForStyle(null, bySlug('quiff'), 3), []);
});

test('a product with no published finish rating still ranks', () => {
  // The client can add a SKU from the admin tomorrow, and it will have no entry
  // in FINISH because FINISH is the manufacturer's published spec rather than
  // anything the shop owner sets. It has to fall to the middle of both scales
  // rather than disappearing out of the finder entirely.
  const withNew = [...CATALOGUE, { sku: 'S7-WAX-NEW', kind: 'wax', hold_level: 4, hair_types: 'wavy' }];
  const skus = rankForStyle(withNew, bySlug('quiff'), 8).map(p => p.sku);
  assert.ok(skus.includes('S7-WAX-NEW'), 'an unrated product vanished from the finder');
  assert.equal(skus[0], 'S7-WAX-RED', 'an unrated product took the lead from the named one');
});
