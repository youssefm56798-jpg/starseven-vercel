/**
 * Pure helpers for the /hair-types pages.
 *
 * Everything here is plain data-in / data-out so it can be tested without a
 * database, a renderer or a browser — the pages themselves stay thin.
 *
 * Nothing in this file invents a claim. Copy comes from lib/hairtypes.js, and
 * the two editorial blocks that are written here (the honest limits of curl
 * typing, and the gaps in the range) trace line by line to
 * docs/hair-type-research.md §1 and §"Gaps this exposes in the current range".
 */
import { HAIR_TYPES } from '../../lib/hairtypes.js';
import { alternatesForLang } from '../../lib/urls.js';

/** Every slug, in tile order. The route's static params come from here. */
export const HAIR_SLUGS = HAIR_TYPES.map(t => t.slug);

/**
 * One escaper for every JSON-LD block: a "</script>" inside any string value
 * would otherwise close the tag early. Same helper the product page uses.
 */
export const ld = j => JSON.stringify(j).replace(/</g, '\\u003c');

// Written as escapes rather than literal characters so the test for this is
// readable in any editor and cannot be broken by a re-encode of the file.
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN = /[A-Za-z0-9]/;

/**
 * True when a string is a pure Latin/numeric run — "1A – 1C", "120ml", "5/5".
 *
 * Such a run inside an Arabic (RTL) line has to carry dir="ltr" or the bidi
 * algorithm reorders it and the customer reads "C1 – A1". The check has to be
 * conditional rather than blanket, because two of the six tiles carry an
 * Arabic range label ("أي نوع · كثافة قليلة") that must stay RTL.
 */
export function isLatinRun(s) {
  const t = String(s ?? '');
  return LATIN.test(t) && !ARABIC.test(t);
}

/** `dir` attribute value for a run, or undefined to inherit. */
export function runDir(s) {
  return isLatinRun(s) ? 'ltr' : undefined;
}

/** The Walker/density range label for a tile, with the direction it needs. */
export function typeRange(tile, lang) {
  const text = lang === 'en' ? tile.walkerEn : tile.walker;
  return { text, dir: runDir(text) };
}

/** Trims to a meta-description length on a word boundary. */
export function clamp(text, max = 160) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s،,.:-]+$/, '') + '…';
}

/** How many of each format the live catalogue actually holds. */
export function formatCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const of = k => list.filter(p => String(p.kind) === k).length;
  // cream and gelwax are counted because the formats table and the "what we do
  // not make" list are both generated from these numbers. The range has grown
  // past wax and gel; a hard-coded "we make no cream" would have gone from a
  // point of honesty to a plain falsehood the day a cream gel was priced.
  return {
    wax: of('wax'), gel: of('gel'), cream: of('cream'), gelwax: of('gelwax'),
    // The two newest formats, counted for the same reason as the two above
    // them: the formats table on /hair-types says out loud which of the five
    // shelf formats this brand actually makes, and until these arrived the
    // answer for both was a hard-coded "no". A hard-coded yes would be the
    // same mistake wearing the opposite sign.
    clay: of('clay'), pomade: of('pomade'),
    total: list.length,
  };
}

/* ------------------------------------------------------------------ gaps ---
 * docs/hair-type-research.md closes on the formats the range does not contain.
 * Saying so on the tile that feels the gap is the only honest way to present a
 * seven-tile finder: the tile still gets the best answer that exists, and the
 * customer is told it is the best that exists rather than the thing built for
 * them.
 *
 * All three notes have been rewritten because all three stopped being true as
 * written. The fine-hair note said the range had no clay, which was the honest
 * answer while it did not — the clay wax exists now, so the tile leads with it
 * and the note explains that the jar shown underneath is a stand-in until the
 * clay is listed. The curly note said there was no cream, which the cream gel
 * ended.
 *
 * What is left is named as coming rather than as missing, because that is what
 * it is: the clay is made and unlisted, and the leave-in, the curl cream and
 * the curl foam are in production. The distinction matters to the reader in
 * exactly one way, and it is the way that decides what they do next — a hole
 * means buy the compromise, pending means it may be worth waiting. */

const GAPS = {
  fine: {
    ar: 'ملحوظة بصراحة: الكلاي واكس اتعمل بس لسه منزلش على الموقع، فالجرّة اللي فوق مش هي. لحد ما ينزل، أقل واكس لامع بكمية صغيرة على شعر ناشف هو أقرب حاجة — وهي أقرب حاجة، مش الحاجة المتعملة للحالة دي.',
    en: 'Said plainly: the clay wax is made but not on the shop yet, so the jar above is not it. Until it lands, the least shiny wax we sell, used sparingly on dry hair, is the closest you can get — and closest is all it is.',
  },
  curly: {
    ar: 'ملحوظة بصراحة: كريم الكيرلي وفوم الكيرلي لسه تحت التنفيذ. اللي موجود دلوقتي — الواكس والكريم جل — بيعرّف الكيرلة ويمشّي الحال، بس المنتج المتعمل للكيرلي مخصوص لسه في الطريق.',
    en: 'Said plainly: the curl cream and the curl foam are still in production. What exists now — the wax and the cream gel — defines curl and does the job, but the product built specifically for curly hair is still on its way.',
  },
  coily: {
    ar: 'ملحوظة بصراحة: الليڤ-إن لسه تحت التنفيذ، وده المنتج اللي بيتحط قبل التصفيف وبيفرق أكتر حاجة مع الشعر الأفرو. اللي عندنا دلوقتي بيقفل الرطوبة اللي في شعرك جوه — هو مش بيضيفها.',
    en: 'Said plainly: the leave-in is still in production, and that is the pre-styler that matters most for coily hair. What we make now seals the moisture already in your hair in — it does not add any.',
  },
};

/** The honest range note for a tile, or null when there is nothing to admit. */
export function gapNote(slug, lang) {
  const g = GAPS[slug];
  if (!g) return null;
  return lang === 'en' ? g.en : g.ar;
}

/* ------------------------------------------------------------- metadata --- */

/** Title, description and hreflang shape for one type page. */
export function typeMeta(tile, lang) {
  const ar = lang !== 'en';
  const c = ar ? tile.ar : tile.en;
  const path = `/hair-types/${tile.slug}`;
  return {
    title: ar
      ? `شعر ${c.name} — أنهي واكس أو جل يناسبه`
      : `${c.name} hair — which wax or gel suits it`,
    description: clamp(`${c.problem} ${c.answer}`, 165),
    alternates: alternatesForLang(path, lang),
  };
}

/** Title, description and hreflang shape for the index page. */
export function indexMeta(lang) {
  const ar = lang !== 'en';
  return {
    title: ar ? 'أنواع الشعر — اعرف نوع شعرك ومنتجه' : 'Hair types — find yours, and its product',
    description: ar
      ? 'سبع حالات شعر، وأنهي منتج من نيو ستار سفن يناسب كل واحدة فيهم — والمشكلة اللي بيحلها، واللي لازم تبعد عنه.'
      : 'Seven hair cases, and which New Star Seven product suits each one — the problem it solves, and what to avoid.',
    alternates: alternatesForLang('/hair-types', lang),
  };
}

/* ------------------------------------------------------------- JSON-LD --- */

/**
 * Three questions per type page, built from the tile's own copy.
 *
 * Nothing is generated: each answer is a field a human wrote in
 * lib/hairtypes.js, so the structured data and the visible page cannot drift.
 */
export function typeFaq(tile, lang, product = null) {
  const ar = lang !== 'en';
  const c = ar ? tile.ar : tile.en;
  const name = c.name;

  const pick = product
    ? ar
      ? ` من التشكيلة: ${product.name}.`
      : ` From the range: ${product.name}.`
    : '';

  return ar
    ? [
        { q: `شعري ${name} — المشكلة معاه بالظبط إيه؟`, a: c.problem },
        { q: `أنهي منتج يناسب شعر ${name}؟`, a: `${c.answer}${pick}` },
        { q: `أبعد عن إيه لو شعري ${name}؟`, a: c.avoid },
      ]
    : [
        { q: `What is the actual problem with ${name.toLowerCase()} hair?`, a: c.problem },
        { q: `Which product suits ${name.toLowerCase()} hair?`, a: `${c.answer}${pick}` },
        { q: `What should I avoid with ${name.toLowerCase()} hair?`, a: c.avoid },
      ];
}

/**
 * Article structured data for a type page.
 *
 * No author, no date, no rating: none of those are facts we hold. The brand is
 * the publisher, which is simply true, and that is where it stops.
 */
export function articleLd({ tile, lang, url, siteUrl, siteName }) {
  const ar = lang !== 'en';
  const c = ar ? tile.ar : tile.en;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: typeMeta(tile, lang).title,
    description: clamp(`${c.problem} ${c.answer}`, 300),
    inLanguage: ar ? 'ar-EG' : 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: `${siteUrl}/${tile.icon}`,
    publisher: { '@type': 'Organization', name: siteName, url: siteUrl },
    about: { '@type': 'Thing', name: c.name },
  };
}

/** BreadcrumbList for a type page, or for the index when `tile` is null. */
export function breadcrumbLd({ tile, lang, siteUrl }) {
  const ar = lang !== 'en';
  const items = [
    { '@type': 'ListItem', position: 1, name: ar ? 'الرئيسية' : 'Home', item: siteUrl },
    {
      '@type': 'ListItem',
      position: 2,
      name: ar ? 'أنواع الشعر' : 'Hair types',
      item: `${siteUrl}/hair-types`,
    },
  ];
  if (tile) {
    items.push({
      '@type': 'ListItem',
      position: 3,
      name: (ar ? tile.ar : tile.en).name,
      item: `${siteUrl}/hair-types/${tile.slug}`,
    });
  }
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

/** CollectionPage + ItemList for the index. */
export function indexLd({ lang, siteUrl }) {
  const ar = lang !== 'en';
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: indexMeta(lang).title,
    description: indexMeta(lang).description,
    inLanguage: ar ? 'ar-EG' : 'en',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: HAIR_TYPES.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${siteUrl}/hair-types/${t.slug}`,
        name: (ar ? t.ar : t.en).name,
      })),
    },
  };
}
