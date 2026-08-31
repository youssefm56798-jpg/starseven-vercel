/**
 * The pure logic behind /hair-types and /hair-types/[slug].
 *
 * Two things are being guarded here. The first is bidi: a Latin run such as
 * "1A – 1C" or "120ml" inside an Arabic line reverses unless it carries
 * dir="ltr", and two of the six tiles carry an Arabic range label that must
 * NOT be forced to LTR — so the decision has to be conditional, and a test has
 * to hold it that way.
 *
 * The second is honesty. The catalogue is waxes and gels; the research names
 * three formats it does not contain. These tests assert that the structured
 * data carries no invented authorship or ratings, and that the "we don't make
 * one" notes still read as denials.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAIR_TYPES, bySlug } from '../lib/hairtypes.js';
import {
  HAIR_SLUGS, ld, isLatinRun, runDir, typeRange, clamp, formatCounts, gapNote,
  typeMeta, indexMeta, typeFaq, articleLd, breadcrumbLd, indexLd,
} from '../app/hair-types/lib.js';

const SLUGS = ['straight', 'wavy', 'curly', 'coily', 'fine', 'thick', 'white'];
// lib/config.js falls back to this when NEXT_PUBLIC_SITE_URL is unset,
// which is the case in tests.
const BASE = 'http://localhost:3000';

const LANGS = ['ar', 'en'];
const SITE = 'https://example.test';

/* ------------------------------------------------------------------ slugs */

test('the route builds exactly the seven tiles, in tile order', () => {
  assert.deepEqual(HAIR_SLUGS, SLUGS);
});

test('every slug the route publishes resolves back to a tile', () => {
  for (const slug of HAIR_SLUGS) assert.ok(bySlug(slug));
});

/* --------------------------------------------------------------- bidi ---
 * The bug this prevents has already shipped twice on this project. */

test('a Latin/numeric run is recognised', () => {
  for (const s of ['1A – 1C', '120ml', '5/5', 'Low density', 'EGP 45']) {
    assert.equal(isLatinRun(s), true, s);
  }
});

test('Arabic, mixed and empty runs are not Latin runs', () => {
  for (const s of ['أي نوع · كثافة قليلة', 'كثافة 120', '', '—', null, undefined]) {
    assert.equal(isLatinRun(s), false, String(s));
  }
});

test('runDir returns ltr only for a Latin run', () => {
  assert.equal(runDir('1A – 1C'), 'ltr');
  assert.equal(runDir('أي نوع · كثافة قليلة'), undefined);
});

test('the four curl tiles carry an LTR Walker range in Arabic', () => {
  for (const slug of ['straight', 'wavy', 'curly', 'coily']) {
    const r = typeRange(bySlug(slug), 'ar');
    assert.equal(r.dir, 'ltr', `${slug} range "${r.text}" must be forced LTR`);
  }
});

test('the two density tiles keep their Arabic range in RTL', () => {
  for (const slug of ['fine', 'thick']) {
    const r = typeRange(bySlug(slug), 'ar');
    assert.equal(r.dir, undefined, `${slug} range "${r.text}" must not be forced LTR`);
  }
});

test('every English range label is a Latin run', () => {
  for (const tile of HAIR_TYPES) {
    const r = typeRange(tile, 'en');
    assert.equal(r.text, tile.walkerEn);
    assert.equal(r.dir, 'ltr', tile.slug);
  }
});

test('typeRange picks the Arabic label for Arabic', () => {
  assert.equal(typeRange(bySlug('fine'), 'ar').text, bySlug('fine').walker);
});

/* --------------------------------------------------------------- clamp */

test('clamp leaves a short string alone', () => {
  assert.equal(clamp('short enough', 40), 'short enough');
});

test('clamp collapses whitespace', () => {
  assert.equal(clamp('a   b\n c', 40), 'a b c');
});

test('clamp trims to the limit and marks the cut', () => {
  const out = clamp('one two three four five six seven eight nine ten', 20);
  assert.ok(out.length <= 21, out);
  assert.ok(out.endsWith('…'), out);
  assert.ok(!out.includes('  '));
});

test('clamp does not leave dangling punctuation before the ellipsis', () => {
  assert.equal(clamp('alpha beta, gamma delta', 11), 'alpha beta…');
});

test('clamp survives nullish input', () => {
  assert.equal(clamp(null, 10), '');
  assert.equal(clamp(undefined, 10), '');
});

/* ------------------------------------------------------- format counts */

const ZERO = { wax: 0, gel: 0, cream: 0, gelwax: 0, clay: 0, pomade: 0, total: 0 };

test('formatCounts counts each kind', () => {
  const rows = [{ kind: 'wax' }, { kind: 'wax' }, { kind: 'gel' },
                { kind: 'cream' }, { kind: 'gelwax' }, { kind: 'cologne' },
                { kind: 'clay' }, { kind: 'pomade' }, { kind: 'pomade' }];
  assert.deepEqual(formatCounts(rows),
    { wax: 2, gel: 1, cream: 1, gelwax: 1, clay: 1, pomade: 2, total: 9 });
});

test('formatCounts on an empty or missing catalogue is all zeros', () => {
  assert.deepEqual(formatCounts([]), ZERO);
  assert.deepEqual(formatCounts(null), ZERO);
  assert.deepEqual(formatCounts(undefined), ZERO);
});

test('every format the table has a row for is counted', () => {
  // The "we make it?" column on /hair-types is generated from these numbers. A
  // format that stopped being counted would send its cell back to a hard-coded
  // answer, and a hard-coded answer is wrong the day the shop changes. Clay and
  // pomade are the live case: both read "no" today and must flip themselves the
  // moment the client switches one on.
  for (const kind of ['cream', 'clay', 'pomade', 'gelwax']) {
    assert.equal(formatCounts([{ kind }])[kind], 1, kind);
    assert.equal(formatCounts([{ kind: 'wax' }])[kind], 0, kind);
  }
});

/* ---------------------------------------------------------- range gaps */

test('the three tiles still waiting on a product carry a gap note', () => {
  for (const slug of ['fine', 'curly', 'coily']) {
    for (const lang of LANGS) {
      const note = gapNote(slug, lang);
      assert.equal(typeof note, 'string', `${slug}/${lang}`);
      assert.notEqual(note.trim(), '');
    }
  }
});

test('tiles with a product built for them admit nothing', () => {
  for (const slug of ['straight', 'wavy', 'thick', 'white']) {
    for (const lang of LANGS) assert.equal(gapNote(slug, lang), null);
  }
});

test('an English gap note names a product that is not on the shop', () => {
  // It used to have to read as a flat denial. Two of the three notes have since
  // been overtaken by products the factory actually makes, so the claim the
  // test guards is narrower and truer: the note must say the thing is not
  // available here yet, in words a reader cannot mistake for an offer.
  for (const slug of ['fine', 'curly', 'coily']) {
    const note = gapNote(slug, 'en');
    assert.ok(
      /do not|don.t|not in the range|still in production|on the shop yet/i.test(note),
      `${slug}: "${note}" must state that it is not available yet`,
    );
  }
});

test('an Arabic gap note is written in Arabic and states the absence', () => {
  for (const slug of ['fine', 'curly', 'coily']) {
    const note = gapNote(slug, 'ar');
    assert.ok(/[\u0600-\u06FF]/.test(note), slug);
    // The claim, not one spelling of it. This used to pin the exact inflection
    // "مبنعملهاش", so rewriting the note in the plural broke a test that has
    // no opinion about the plural.
    assert.ok(/مفيش|مبنعمل|لسه/.test(note), `${slug} does not say the thing is absent: "${note}"`);
  }
});

test('gapNote defaults to Arabic for anything that is not "en"', () => {
  assert.equal(gapNote('curly', undefined), gapNote('curly', 'ar'));
});

/* ----------------------------------------------------------- metadata */

test('every type page canonicalises to its OWN language URL', () => {
  // The canonical must follow the language being rendered. When every English
  // page canonicalled to its Arabic twin, Google filed all 22 of them under
  // "Alternate page with proper canonical tag" and the English site could not
  // be indexed at all. Absolute URLs, because relative ones are resolved
  // against metadataBase and that silently dropped the query on the home page.
  for (const tile of HAIR_TYPES) {
    const path = `/hair-types/${tile.slug}`;
    assert.equal(typeMeta(tile, 'ar').alternates.canonical, `${BASE}${path}`);
    assert.equal(typeMeta(tile, 'en').alternates.canonical, `${BASE}/en${path}`);

    for (const lang of LANGS) {
      const L = typeMeta(tile, lang).alternates.languages;
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
  assert.equal(indexMeta('ar').alternates.canonical, `${BASE}/hair-types`);
  assert.equal(indexMeta('en').alternates.canonical, `${BASE}/en/hair-types`);
  for (const lang of LANGS) {
    const L = indexMeta(lang).alternates.languages;
    assert.equal(L.en, `${BASE}/en/hair-types`);
    assert.equal(L['x-default'], `${BASE}/hair-types`);
  }
});

test('every alternate resolves to a distinct URL', () => {
  // A set of alternates that all point at the same address is decoration, not
  // hreflang — which is exactly what the home page shipped.
  for (const m of [indexMeta('ar'), ...HAIR_TYPES.map(t => typeMeta(t, 'ar'))]) {
    const L = m.alternates.languages;
    assert.notEqual(L.ar, L.en, 'ar and en alternates point at the same URL');
    assert.equal(new Set(Object.values(L)).size, 2, 'expected exactly two distinct URLs');
  }
});

test('every page has a title and a usable description length', () => {
  const metas = [indexMeta('ar'), indexMeta('en'), ...HAIR_TYPES.flatMap(t => LANGS.map(l => typeMeta(t, l)))];
  for (const m of metas) {
    assert.ok(m.title.trim().length > 10, m.title);
    assert.ok(m.description.trim().length > 40, m.description);
    assert.ok(m.description.length <= 166, `${m.description.length}: ${m.description}`);
  }
});

test('the two languages do not share a title', () => {
  for (const tile of HAIR_TYPES) {
    assert.notEqual(typeMeta(tile, 'ar').title, typeMeta(tile, 'en').title);
  }
  assert.notEqual(indexMeta('ar').title, indexMeta('en').title);
});

test('titles are unique across every type page', () => {
  for (const lang of LANGS) {
    const titles = HAIR_TYPES.map(t => typeMeta(t, lang).title);
    assert.equal(new Set(titles).size, titles.length, lang);
  }
});

/* ---------------------------------------------------------------- FAQ */

test('each type page asks three questions, answered from its own copy', () => {
  for (const tile of HAIR_TYPES) {
    for (const lang of LANGS) {
      const c = lang === 'en' ? tile.en : tile.ar;
      const faq = typeFaq(tile, lang);
      assert.equal(faq.length, 3);
      assert.equal(faq[0].a, c.problem);
      assert.ok(faq[1].a.startsWith(c.answer));
      assert.equal(faq[2].a, c.avoid);
      for (const f of faq) assert.ok(f.q.trim().length > 5, f.q);
    }
  }
});

test('the product is named in the answer only when there is one', () => {
  const tile = bySlug('curly');
  assert.ok(typeFaq(tile, 'en', { name: 'Premium Wax Argan' })[1].a.includes('Premium Wax Argan'));
  assert.equal(typeFaq(tile, 'en', null)[1].a, tile.en.answer);
  assert.equal(typeFaq(tile, 'ar')[1].a, tile.ar.answer);
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

test('the Article claims no authorship, date, rating or review', () => {
  for (const tile of HAIR_TYPES) {
    for (const lang of LANGS) {
      const j = articleLd({
        tile, lang, url: `${SITE}/hair-types/${tile.slug}`, siteUrl: SITE, siteName: 'New Star Seven',
      });
      const keys = keysOf(j);
      for (const banned of [
        'author', 'aggregateRating', 'review', 'reviewCount', 'ratingValue',
        'datePublished', 'dateModified',
      ]) {
        assert.equal(keys.has(banned), false, `${tile.slug}/${lang} must not carry "${banned}"`);
      }
    }
  }
});

test('the Article is well formed and points at its own page', () => {
  const tile = bySlug('coily');
  const url = `${SITE}/hair-types/coily`;
  const j = articleLd({ tile, lang: 'ar', url, siteUrl: SITE, siteName: 'New Star Seven' });
  assert.equal(j['@type'], 'Article');
  assert.equal(j['@context'], 'https://schema.org');
  assert.equal(j.mainEntityOfPage['@id'], url);
  assert.equal(j.image, `${SITE}/${tile.icon}`);
  assert.equal(j.publisher['@type'], 'Organization');
  assert.equal(j.inLanguage, 'ar-EG');
  assert.ok(j.description.length <= 301);
});

test('breadcrumbs are two deep on the index and three on a type page', () => {
  const idx = breadcrumbLd({ tile: null, lang: 'ar', siteUrl: SITE });
  assert.equal(idx.itemListElement.length, 2);
  assert.equal(idx.itemListElement[1].item, `${SITE}/hair-types`);

  const one = breadcrumbLd({ tile: bySlug('fine'), lang: 'en', siteUrl: SITE });
  assert.equal(one.itemListElement.length, 3);
  assert.deepEqual(one.itemListElement.map(i => i.position), [1, 2, 3]);
  assert.equal(one.itemListElement[2].item, `${SITE}/hair-types/fine`);
  assert.equal(one.itemListElement[2].name, bySlug('fine').en.name);
});

test('the index ItemList links every type page, in order', () => {
  const j = indexLd({ lang: 'en', siteUrl: SITE });
  assert.equal(j['@type'], 'CollectionPage');
  assert.deepEqual(
    j.mainEntity.itemListElement.map(i => i.url),
    SLUGS.map(s => `${SITE}/hair-types/${s}`),
  );
  assert.deepEqual(
    j.mainEntity.itemListElement.map(i => i.position),
    SLUGS.map((_, i) => i + 1),
  );
});

test('every JSON-LD block this route emits is serialisable and script-safe', () => {
  const blocks = [
    indexLd({ lang: 'ar', siteUrl: SITE }),
    breadcrumbLd({ tile: null, lang: 'ar', siteUrl: SITE }),
    ...HAIR_TYPES.flatMap(tile => LANGS.flatMap(lang => [
      articleLd({ tile, lang, url: `${SITE}/hair-types/${tile.slug}`, siteUrl: SITE, siteName: 'New Star Seven' }),
      breadcrumbLd({ tile, lang, siteUrl: SITE }),
    ])),
  ];
  for (const b of blocks) {
    const s = ld(b);
    assert.ok(!s.includes('<'), 'an unescaped "<" could close the script tag early');
    assert.deepEqual(JSON.parse(s), b);
  }
});

test('ld escapes a "<" that arrives inside a string value', () => {
  assert.equal(ld({ a: '</script>' }), '{"a":"\\u003c/script>"}');
});

/* --------------------------------------------------------- the sitemap */

test('the sitemap lists the index and all six type pages', async () => {
  const { default: sitemap } = await import('../app/sitemap.js');
  const urls = (await sitemap()).map(e => e.url);
  const base = urls[0].replace(/\/$/, '');

  assert.ok(urls.includes(`${base}/hair-types`), 'the index is missing from the sitemap');
  for (const slug of SLUGS) {
    assert.ok(urls.includes(`${base}/hair-types/${slug}`), `${slug} is missing from the sitemap`);
  }
  assert.equal(new Set(urls).size, urls.length, 'the sitemap repeats a URL');
});
