/**
 * The pure logic behind /hair-styles and /hair-styles/[slug].
 *
 * Three things are being guarded, and they are the same three the type suite
 * guards, because the two finders ship as one system.
 *
 * BIDI. Every English label here is a Latin run ("Hold 5 · Wet shine") and
 * reverses inside a line without dir="ltr". Every Arabic label is written with
 * Arabic-Indic numerals precisely so that it is NOT a Latin run and must not be
 * forced — "تثبيت 5" with a Latin five would reorder and read wrong. That
 * decision is conditional, and this file holds it that way; the bug it prevents
 * has already shipped twice on this project.
 *
 * HONESTY. Four of the six tiles admit something the range does not contain,
 * and two of those four point at the same missing clay the /hair-types fine
 * tile blames. These tests assert the notes still read as denials, and that the
 * structured data carries no invented authorship, dates or ratings.
 *
 * THE SITEMAP. Seven new URLs per language, every one of which has to have a
 * route file behind it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAIR_STYLES, bySlug } from '../lib/hairstyles.js';
import { HAIR_TYPES, bySlug as typeBySlug } from '../lib/hairtypes.js';
import {
  STYLE_SLUGS, ld, isLatinRun, runDir, clamp, styleLabel, finishCounts, styleGap,
  styleMeta, styleIndexMeta, styleFaq, howToLd, styleBreadcrumbLd, styleIndexLd,
} from '../app/hair-styles/lib.js';
import * as typeLib from '../app/hair-types/lib.js';

const SLUGS = ['slick-back', 'low-taper-fade', 'defined-curls', 'curtains', 'quiff', 'textured-crop'];
// lib/config.js falls back to this when NEXT_PUBLIC_SITE_URL is unset,
// which is the case in tests.
const BASE = 'http://localhost:3000';

const LANGS = ['ar', 'en'];
const SITE = 'https://example.test';

/* ------------------------------------------------------------------ slugs */

test('the route builds exactly the six tiles, in tile order', () => {
  assert.deepEqual(STYLE_SLUGS, SLUGS);
});

test('every slug the route publishes resolves back to a tile', () => {
  for (const slug of STYLE_SLUGS) assert.ok(bySlug(slug));
});

test('no style slug collides with a hair-type slug', () => {
  // The nav decides which item is active with startsWith on the path string,
  // and both finders sit under a "hair-" prefix. A shared slug would also mean
  // two pages competing for one query.
  const types = new Set(typeLib.HAIR_SLUGS);
  for (const slug of STYLE_SLUGS) assert.equal(types.has(slug), false, slug);
});

/* ------------------------------------------------- the shared primitives */

test('the bidi and clamp helpers are the hair-types ones, not a second copy', () => {
  // A second implementation of a bidi rule is a second place for it to be
  // wrong, and these two finders have to make the same call about the same
  // string. app/hair-styles/lib.js re-exports rather than reimplements.
  assert.equal(isLatinRun, typeLib.isLatinRun);
  assert.equal(runDir, typeLib.runDir);
  assert.equal(clamp, typeLib.clamp);
  assert.equal(ld, typeLib.ld);
});

/* --------------------------------------------------------------- bidi --- */

test('every English hold-and-finish label is a Latin run', () => {
  for (const tile of HAIR_STYLES) {
    const l = styleLabel(tile, 'en');
    assert.equal(l.text, tile.labelEn);
    assert.equal(l.dir, 'ltr', `${tile.slug}: "${l.text}" must be forced LTR`);
  }
});

test('no Arabic label is forced to LTR', () => {
  // Each one carries Arabic words and Arabic-Indic numerals, so it is a genuine
  // RTL run. Writing "تثبيت 5" with a Latin five would flip this to ltr and
  // reorder the whole line, which is exactly what this test exists to notice.
  for (const tile of HAIR_STYLES) {
    const l = styleLabel(tile, 'ar');
    assert.equal(l.text, tile.label);
    assert.equal(l.dir, undefined, `${tile.slug}: "${l.text}" must not be forced LTR`);
  }
});

test('styleLabel defaults to Arabic for anything that is not "en"', () => {
  assert.equal(styleLabel(bySlug('quiff'), undefined).text, bySlug('quiff').label);
});

/* ------------------------------------------------------- finish counts */

const ZERO = { total: 0, matte: 0, medium: 0, high: 0, spray: 0 };

test('finishCounts groups the live catalogue by published shine', () => {
  const rows = [
    { sku: 'S7-GEL-BLU', kind: 'gel' },   // strong shine
    { sku: 'S7-GEL-GRN', kind: 'gel' },   // medium shine
    { sku: 'S7-WAX-PUR', kind: 'wax' },   // medium shine
    { sku: 'S7-HS500-ULTRAS', kind: 'spray' },
  ];
  assert.deepEqual(finishCounts(rows), { total: 4, matte: 0, medium: 2, high: 1, spray: 1 });
});

test('finishCounts on an empty or missing catalogue is all zeros', () => {
  assert.deepEqual(finishCounts([]), ZERO);
  assert.deepEqual(finishCounts(null), ZERO);
  assert.deepEqual(finishCounts(undefined), ZERO);
});

test('matte is counted, because the index claims nothing on the shop is matte', () => {
  // The "nothing here is matte" line on /hair-styles is generated from this
  // number. If matte stopped being counted the claim would silently go back to
  // hard-coded and would be false the day a clay is switched on — the same
  // reason formatCounts counts clay and pomade on /hair-types.
  assert.equal(finishCounts([{ sku: 'S7-WAX-PUR' }]).matte, 0);
  assert.equal(finishCounts([{ sku: 'S7-FAKE', kind: 'wax' }]).matte, 0);
  // And the day one is stocked, the number moves on its own. This is the whole
  // point of counting rather than typing: nobody has to remember this page.
  assert.equal(finishCounts([{ sku: 'S7-NEW', kind: 'clay' }]).matte, 1);
  assert.equal(finishCounts([{ sku: 'S7-NEW2', kind: 'pomade' }]).matte, 1);
});

/* ---------------------------------------------------------- range gaps */

const ADMITTING = ['textured-crop', 'curtains', 'defined-curls', 'quiff'];
const SERVED = ['slick-back', 'low-taper-fade'];

test('the four tiles the research flags carry a gap note', () => {
  for (const slug of ADMITTING) {
    for (const lang of LANGS) {
      const note = styleGap(slug, lang);
      assert.equal(typeof note, 'string', `${slug}/${lang}`);
      assert.notEqual(note.trim(), '');
    }
  }
});

test('tiles the range genuinely serves admit nothing', () => {
  for (const slug of SERVED) {
    for (const lang of LANGS) assert.equal(styleGap(slug, lang), null);
  }
});

test('an English gap note names a product the shop cannot sell today', () => {
  // It used to have to read as a flat denial. Three of the four notes have
  // since been overtaken by products the factory actually makes, so the claim
  // this guards is narrower and truer: the note must say the thing is not
  // available here yet, in words a reader cannot mistake for an offer.
  for (const slug of ADMITTING) {
    const note = styleGap(slug, 'en');
    assert.ok(
      /do not make|not in the range|still in production|not on the shop/i.test(note),
      `${slug}: "${note}" must state that it is not available yet`,
    );
  }
});

test('an Arabic gap note is written in Arabic and states the absence', () => {
  for (const slug of ADMITTING) {
    const note = styleGap(slug, 'ar');
    // Written as escapes rather than literal characters so this test is
    // readable in any editor and cannot be broken by a re-encode of the file.
    assert.ok(/[؀-ۿ]/.test(note), slug);
    // The claim, not one spelling of it. tests/hair-type-pages.test.mjs learned
    // this the hard way when it pinned a single inflection and a rewrite in the
    // plural broke a test that has no opinion about the plural.
    assert.ok(/مفيش|مبنعمل|مش بنعمل|لسه/.test(note), `${slug} does not say the thing is absent: "${note}"`);
  }
});

test('the crop tile and the fine tile name the same product', () => {
  // The crop and fine hair both want the clay, and the two finders have to
  // agree about it or one page is selling what the other is declining. Both
  // notes now say the same thing — the clay is made and not listed — and both
  // tiles name it in their own copy as well, because the note is the aside and
  // the copy is what a customer actually reads.
  assert.match(styleGap('textured-crop', 'en'), /clay/i);
  assert.match(styleGap('textured-crop', 'ar'), /كلاي/);
  assert.match(typeLib.gapNote('fine', 'en'), /clay/i);
  assert.match(typeLib.gapNote('fine', 'ar'), /كلاي/);
  assert.match(bySlug('textured-crop').en.why, /clay/i);
  assert.match(typeBySlug('fine').en.answer, /clay/i);
  assert.match(typeBySlug('fine').ar.answer, /كلاي/);
});

test('styleGap defaults to Arabic for anything that is not "en"', () => {
  assert.equal(styleGap('quiff', undefined), styleGap('quiff', 'ar'));
});

/* ----------------------------------------------------------- metadata */

test('every style page canonicalises to its OWN language URL', () => {
  for (const tile of HAIR_STYLES) {
    const path = `/hair-styles/${tile.slug}`;
    assert.equal(styleMeta(tile, 'ar').alternates.canonical, `${BASE}${path}`);
    assert.equal(styleMeta(tile, 'en').alternates.canonical, `${BASE}/en${path}`);

    for (const lang of LANGS) {
      const L = styleMeta(tile, lang).alternates.languages;
      assert.equal(L.ar, `${BASE}${path}`);
      assert.equal(L.en, `${BASE}/en${path}`);
      // Egypt is the only market that can be fulfilled, so the regional tags
      // are the ones that matter; x-default falls back to Arabic, not English.
      assert.equal(L['ar-EG'], `${BASE}${path}`);
      assert.equal(L['en-EG'], `${BASE}/en${path}`);
      assert.equal(L['x-default'], `${BASE}${path}`);
    }
  }
});

test('the index canonicalises to its own language URL', () => {
  assert.equal(styleIndexMeta('ar').alternates.canonical, `${BASE}/hair-styles`);
  assert.equal(styleIndexMeta('en').alternates.canonical, `${BASE}/en/hair-styles`);
  for (const lang of LANGS) {
    const L = styleIndexMeta(lang).alternates.languages;
    assert.equal(L.en, `${BASE}/en/hair-styles`);
    assert.equal(L['x-default'], `${BASE}/hair-styles`);
  }
});

test('every alternate resolves to a distinct URL', () => {
  for (const m of [styleIndexMeta('ar'), ...HAIR_STYLES.map(t => styleMeta(t, 'ar'))]) {
    const L = m.alternates.languages;
    assert.notEqual(L.ar, L.en, 'ar and en alternates point at the same URL');
    assert.equal(new Set(Object.values(L)).size, 2, 'expected exactly two distinct URLs');
  }
});

test('every page has a title and a usable description length', () => {
  const metas = [
    styleIndexMeta('ar'), styleIndexMeta('en'),
    ...HAIR_STYLES.flatMap(t => LANGS.map(l => styleMeta(t, l))),
  ];
  for (const m of metas) {
    assert.ok(m.title.trim().length > 10, m.title);
    assert.ok(m.description.trim().length > 40, m.description);
    assert.ok(m.description.length <= 166, `${m.description.length}: ${m.description}`);
  }
});

test('the two languages do not share a title', () => {
  for (const tile of HAIR_STYLES) {
    assert.notEqual(styleMeta(tile, 'ar').title, styleMeta(tile, 'en').title);
  }
  assert.notEqual(styleIndexMeta('ar').title, styleIndexMeta('en').title);
});

test('titles are unique across the six style pages', () => {
  for (const lang of LANGS) {
    const titles = HAIR_STYLES.map(t => styleMeta(t, lang).title);
    assert.equal(new Set(titles).size, titles.length, lang);
  }
});

test('no style page title collides with a hair-type page title', () => {
  // Twelve guide pages now sit under a "hair-" prefix in two languages. Two of
  // them sharing a title is two pages competing for one query, and it is also
  // the first symptom of a slug having been copied across the two finders.
  for (const lang of LANGS) {
    const taken = new Set(HAIR_TYPES.map(t => typeLib.typeMeta(t, lang).title));
    for (const tile of HAIR_STYLES) {
      assert.equal(taken.has(styleMeta(tile, lang).title), false, `${tile.slug}/${lang}`);
    }
  }
});

/* ---------------------------------------------------------------- FAQ */

test('each style page asks three questions, answered from its own copy', () => {
  for (const tile of HAIR_STYLES) {
    for (const lang of LANGS) {
      const c = lang === 'en' ? tile.en : tile.ar;
      const faq = styleFaq(tile, lang);
      assert.equal(faq.length, 3);
      assert.equal(faq[0].a, c.look);
      assert.ok(faq[1].a.startsWith(c.why));
      assert.equal(faq[2].a, c.avoid);
      for (const f of faq) assert.ok(f.q.trim().length > 5, f.q);
    }
  }
});

test('the product is named in the answer only when there is one', () => {
  const tile = bySlug('quiff');
  assert.ok(styleFaq(tile, 'en', { name: 'Premium Wax Pro X' })[1].a.includes('Premium Wax Pro X'));
  assert.equal(styleFaq(tile, 'en', null)[1].a, tile.en.why);
  assert.equal(styleFaq(tile, 'ar')[1].a, tile.ar.why);
});

/* ------------------------------------------------------------ JSON-LD */

/** Every key present anywhere in a structured-data object. */
function keysOf(node, out = new Set()) {
  if (Array.isArray(node)) { node.forEach(n => keysOf(n, out)); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { out.add(k); keysOf(v, out); }
  }
  return out;
}

test('the HowTo claims no authorship, date, rating, review, time or cost', () => {
  for (const tile of HAIR_STYLES) {
    for (const lang of LANGS) {
      const j = howToLd({
        tile, lang, url: `${SITE}/hair-styles/${tile.slug}`, siteUrl: SITE, siteName: 'New Star Seven',
      });
      const keys = keysOf(j);
      for (const banned of [
        'author', 'aggregateRating', 'review', 'reviewCount', 'ratingValue',
        'datePublished', 'dateModified', 'totalTime', 'estimatedCost', 'yield',
      ]) {
        assert.equal(keys.has(banned), false, `${tile.slug}/${lang} must not carry "${banned}"`);
      }
    }
  }
});

test('the HowTo is well formed and its steps are the tile own steps', () => {
  const tile = bySlug('slick-back');
  const url = `${SITE}/hair-styles/slick-back`;
  const j = howToLd({ tile, lang: 'ar', url, siteUrl: SITE, siteName: 'New Star Seven' });
  assert.equal(j['@type'], 'HowTo');
  assert.equal(j['@context'], 'https://schema.org');
  assert.equal(j.mainEntityOfPage['@id'], url);
  assert.equal(j.image, `${SITE}/${tile.icon}`);
  assert.equal(j.publisher['@type'], 'Organization');
  assert.equal(j.inLanguage, 'ar-EG');
  assert.ok(j.description.length <= 301);
  assert.deepEqual(j.step.map(s => s.text), tile.ar.steps);
  assert.deepEqual(j.step.map(s => s.position), tile.ar.steps.map((_, i) => i + 1));
});

test('breadcrumbs are two deep on the index and three on a style page', () => {
  const idx = styleBreadcrumbLd({ tile: null, lang: 'ar', siteUrl: SITE });
  assert.equal(idx.itemListElement.length, 2);
  assert.equal(idx.itemListElement[1].item, `${SITE}/hair-styles`);

  const one = styleBreadcrumbLd({ tile: bySlug('textured-crop'), lang: 'en', siteUrl: SITE });
  assert.equal(one.itemListElement.length, 3);
  assert.deepEqual(one.itemListElement.map(i => i.position), [1, 2, 3]);
  assert.equal(one.itemListElement[2].item, `${SITE}/hair-styles/textured-crop`);
  assert.equal(one.itemListElement[2].name, bySlug('textured-crop').en.name);
});

test('the index ItemList links all six style pages, in order', () => {
  const j = styleIndexLd({ lang: 'en', siteUrl: SITE });
  assert.equal(j['@type'], 'CollectionPage');
  assert.deepEqual(
    j.mainEntity.itemListElement.map(i => i.url),
    SLUGS.map(s => `${SITE}/hair-styles/${s}`),
  );
  assert.deepEqual(j.mainEntity.itemListElement.map(i => i.position), [1, 2, 3, 4, 5, 6]);
});

test('every JSON-LD block this route emits is serialisable and script-safe', () => {
  const blocks = [
    styleIndexLd({ lang: 'ar', siteUrl: SITE }),
    styleBreadcrumbLd({ tile: null, lang: 'ar', siteUrl: SITE }),
    ...HAIR_STYLES.flatMap(tile => LANGS.flatMap(lang => [
      howToLd({ tile, lang, url: `${SITE}/hair-styles/${tile.slug}`, siteUrl: SITE, siteName: 'New Star Seven' }),
      styleBreadcrumbLd({ tile, lang, siteUrl: SITE }),
    ])),
  ];
  for (const b of blocks) {
    const s = ld(b);
    assert.ok(!s.includes('<'), 'an unescaped "<" could close the script tag early');
    assert.deepEqual(JSON.parse(s), b);
  }
});

/* --------------------------------------------------------- the sitemap */

/* ------------------------------------------------------------ the mounts ---
 * Everything above this line tests pure functions, and every one of those tests
 * keeps passing when the feature is never rendered at all: the home strip can
 * be unmounted, the nav item deleted, and the crop tile can start listing
 * runners-up under a badge that calls one of them the answer, without a single
 * assertion going red. A green suite would then be measuring the data and not
 * the site.
 *
 * These four read the components as text rather than importing them, which is
 * the same treatment tests/shop-pages.test.mjs already gives the nav and the
 * home pickers, and for the same reason: they are server and client components
 * pulling in next/link, next/navigation and the database, so none of them can
 * be imported under node:test. */

/**
 * A component's source with its comments stripped, so a needle matches markup
 * and never the prose explaining it. The `[^:]` guard is what keeps a
 * 'https://...' literal from being read as the start of a line comment.
 */
async function source(rel) {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  return readFileSync(join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('the home page actually mounts the style strip', async () => {
  const src = await source('app/_components/Landing.js');
  assert.match(src, /HAIR_STYLES\.map\(/,
    'Landing.js no longer maps HAIR_STYLES, so the home strip renders no tiles.');
  assert.match(src, /rankForStyle\(/,
    'the strip no longer ranks the catalogue, so its tiles name no product and ' +
    'the home page and the guide can drift apart on which jar they recommend.');
  assert.match(src, /href=\{L\('\/hair-styles'\)\}/,
    'the strip no longer links to the index, so the six guides are reachable ' +
    'from the nav only.');
});

test('the nav and the footer both link the style finder', async () => {
  const src = await source('app/_components/Chrome.js');
  const links = src.match(/L\('\/hair-styles'\)/g) || [];
  assert.equal(links.length, 2,
    `expected the nav item and the footer Links entry, found ${links.length}`);
  assert.match(src, /path\.startsWith\('hair-styles'\)/,
    'the nav item cannot mark itself active, so nothing lights up on /hair-styles.');
});

test('a style the shop cannot serve properly is never shown a runner-up', async () => {
  // This is the whole argument of the crop and curtains tiles, and it lives
  // only in the view: rankForStyle still returns three matches, and the view is
  // the one thing that refuses to print two of them and relabels the third as
  // the nearest thing rather than the answer. Delete either check and the page
  // goes back to selling a look it has just finished grading itself down on.
  const src = await source('app/_views/hair-style.js');
  assert.match(src, /tile\.served === 'yes' && alts\.length > 0/,
    'the alternates block no longer checks served, so the crop tile lists runners-up.');
  assert.match(src, /tile\.served !== 'yes'/,
    'the pick badge no longer checks served, so the closest thing is sold as the answer.');
});

test('no claim about matte outlives a matte product being stocked', async () => {
  // finishCounts().matte is only a mechanism if every sentence making the claim
  // sits behind it. The index states it twice - once in the generated gap list
  // and once, harder, in the honest aside - and an ungated copy would survive
  // exactly the change the gate exists to catch, which is the day a clay is
  // stocked and "nothing we make is matte" stops being true.
  const src = await source('app/_views/hair-styles-index.js');
  const claims = ['they are the two matte formats', 'none of it is matte'];
  for (const claim of claims) {
    assert.ok(src.includes(claim), `the index no longer says "${claim}"`);
  }
  const gates = (src.match(/counts\.matte === 0/g) || []).length;
  assert.ok(gates >= claims.length,
    `${claims.length} matte claims on the index but only ${gates} counts.matte gates`);
});

/* --------------------------------------------------------- the sitemap */

test('the sitemap lists the index and all six style pages', async () => {
  const { default: sitemap } = await import('../app/sitemap.js');
  const urls = (await sitemap()).map(e => e.url);
  const base = urls[0].replace(/\/$/, '');

  assert.ok(urls.includes(`${base}/hair-styles`), 'the index is missing from the sitemap');
  for (const slug of SLUGS) {
    assert.ok(urls.includes(`${base}/hair-styles/${slug}`), `${slug} is missing from the sitemap`);
  }
  assert.equal(new Set(urls).size, urls.length, 'the sitemap repeats a URL');
});
