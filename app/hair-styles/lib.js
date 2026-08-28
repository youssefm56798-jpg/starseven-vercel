/**
 * Pure helpers for the /hair-styles pages.
 *
 * Everything here is plain data-in / data-out so it can be tested without a
 * database, a renderer or a browser — the pages themselves stay thin. This is
 * the direct analogue of app/hair-types/lib.js, and the four helpers the two
 * genuinely share (ld, isLatinRun, runDir, clamp) are imported from there
 * rather than copied: app/_components/Landing.js already imports runDir across
 * that boundary, so cross-importing is the established pattern here and a
 * second copy of a bidi rule is a second place for it to be wrong.
 *
 * Nothing in this file invents a claim. Copy comes from lib/hairstyles.js, and
 * the editorial blocks written here trace line by line to
 * docs/hair-style-research.md §3 and §4.
 */
import { HAIR_STYLES, FINISH } from '../../lib/hairstyles.js';
import { alternatesForLang } from '../../lib/urls.js';
import { ld, isLatinRun, runDir, clamp } from '../hair-types/lib.js';

// Re-exported so a reader of this file, and the tests for it, can reach the
// whole surface of /hair-styles from one import without having to know which
// of the two finders first needed a given helper.
export { ld, isLatinRun, runDir, clamp };

/** The six slugs, in tile order. The route's static params come from here. */
export const STYLE_SLUGS = HAIR_STYLES.map(s => s.slug);

/**
 * The hold-and-finish label for a tile, with the direction it needs.
 *
 * This is the style analogue of typeRange: it carries the two axes the finder
 * actually decides on, the way the type tiles carry the Walker range. The
 * English labels are Latin runs and must be forced LTR inside a line; the
 * Arabic ones are written with Arabic-Indic numerals precisely so they are not,
 * because "تثبيت 5" with a Latin five would reorder and read wrong.
 */
export function styleLabel(tile, lang) {
  const text = lang === 'en' ? tile.labelEn : tile.label;
  return { text, dir: runDir(text) };
}

/**
 * What finishes the live catalogue actually holds.
 *
 * The two honest claims on the index — that nothing here is matte, and that
 * there is no finisher to hold a quiff or a slick back overnight — are
 * generated from these numbers rather than typed. A hard-coded "we make nothing
 * matte" would be true today and would become a lie on the day a clay is
 * stocked, and a claim that quietly rots is worse than no claim at all. This is
 * the same reason formatCounts counts cream on /hair-types.
 *
 * `matte` counts products the manufacturer rates at the bottom of the shine
 * scale. It is structurally zero right now — see the FINISH comment in
 * lib/hairstyles.js — and that is exactly the point of counting it.
 */
export function finishCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const shineOf = p => (FINISH[p.sku] || {}).shine;
  return {
    total: list.length,
    matte: list.filter(p => shineOf(p) === 1).length,
    medium: list.filter(p => shineOf(p) === 2).length,
    high: list.filter(p => shineOf(p) === 3).length,
    spray: list.filter(p => String(p.kind) === 'spray').length,
  };
}

/* ------------------------------------------------------------------ gaps ---
 * docs/hair-style-research.md §4 closes on the products the range does not
 * contain: a clay or matte paste (the textured crop), a curl cream or leave-in
 * (defined curls), a mousse or pre-styling primer (the quiff), and a light
 * cream or sea-salt spray (curtains). Four of the six tiles feel one of these.
 * Saying so on the tile that feels it is the only honest way to present a style
 * finder backed by five waxes and three gels — the tile still gets the best
 * answer that exists, and the customer is told it is the best that exists
 * rather than the thing built for them.
 *
 * This is the same admission /hair-types already makes on its fine tile, about
 * the same missing product. The two finders have to agree, and if these notes
 * are ever softened they will not. */

const GAPS = {
  'textured-crop': {
    ar: 'ده أوضح نقص في التشكيلة، وهو نفس النقص اللي بنقوله في صفحة أنواع الشعر عن الشعر الخفيف: مفيش كلاي ومفيش حاجة مطفية. لو الكروب هو استايلك، المنتج اللي إنت عايزه لسه مش عندنا.',
    en: 'This is the biggest hole in the range, and it is the same one the hair-types page names for fine hair: no clay, nothing matte. If the crop is your look, we do not make your product yet.',
  },
  curtains: {
    ar: 'الكيرتن الأصح ليه كريم خفيف أو سبراي ملح بحر، وإحنا مش بنعمل لا ده ولا ده. واكس الشيا أقرب حاجة عندنا — خفيف وأقل واحد لامع في التشكيلة — بس هو واكس، مش الكريم الخفيف اللي الاستايل ده محتاجه فعلاً.',
    en: 'A centre part is really built for a light cream or a sea-salt spray, and we do not make either. The Shea is the closest thing here — light, and the least shiny in the range — but it is a wax, not the light cream this look actually wants.',
  },
  'defined-curls': {
    ar: 'مفيش عندنا كريم كيرلي ولا ليڤ-إن، ودول اللي بيعملوا الترطيب الحقيقي. الواكس ده بيقفل الرطوبة اللي في شعرك جوه — هو مش بيضيف رطوبة. عشان كده لازم يتحط والشعر لسه مبلول، وإلا مفيش حاجة يقفل عليها.',
    en: 'We do not make a curl cream or a leave-in, and those are what actually add moisture. This wax seals in the water already in your hair. It does not add any. So it goes on while the hair is still wet, or there is nothing for it to seal.',
  },
  quiff: {
    ar: 'مفيش عندنا موس ولا منتج بيتحط قبل الاستشوار، ودي الحاجة اللي بتدي الارتفاع نفسه. يعني الاستايل ده معتمد على الاستشوار عندك أكتر ما هو معتمد على اللي في العلبة.',
    en: 'We do not make a mousse or a pre-styling primer, and that is the product that builds the height. This look leans on your dryer more than on anything in the jar.',
  },
};

/** The honest range note for a tile, or null when there is nothing to admit. */
export function styleGap(slug, lang) {
  const g = GAPS[slug];
  if (!g) return null;
  return lang === 'en' ? g.en : g.ar;
}

/* ------------------------------------------------------------- metadata --- */

/** Title, description and hreflang shape for one style page. */
export function styleMeta(tile, lang) {
  const ar = lang !== 'en';
  const c = ar ? tile.ar : tile.en;
  const path = `/hair-styles/${tile.slug}`;
  return {
    title: ar
      ? `${c.name} — إزاي تعمله وبأنهي منتج`
      : `${c.name} — how to style it, and with what`,
    description: clamp(`${c.short} ${c.why}`, 165),
    alternates: alternatesForLang(path, lang),
  };
}

/** Title, description and hreflang shape for the index page. */
export function styleIndexMeta(lang) {
  const ar = lang !== 'en';
  return {
    title: ar ? 'ستايلات الشعر — اختار الشكل واعرف منتجه' : 'Hair styles — pick the look, get the product',
    description: ar
      ? 'ستة استايلات لشعر الرجالة، وأنهي واكس أو جل من نيو ستار سفن بيوصلك لكل واحد فيهم — بالخطوات، ومن إيه تبعد.'
      : 'Six men’s hair styles, and which New Star Seven wax or gel gets you each one — step by step, and what to avoid.',
    alternates: alternatesForLang('/hair-styles', lang),
  };
}

/* ------------------------------------------------------------- JSON-LD --- */

/**
 * Three questions per style page, built from the tile's own copy.
 *
 * Nothing is generated: each answer is a field a human wrote in
 * lib/hairstyles.js, so the structured data and the visible page cannot drift.
 */
export function styleFaq(tile, lang, product = null) {
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
        { q: `الـ${name} شكله إيه بالظبط؟`, a: c.look },
        { q: `أعمل الـ${name} بأنهي منتج؟`, a: `${c.why}${pick}` },
        { q: `أبعد عن إيه وأنا بعمل الـ${name}؟`, a: c.avoid },
      ]
    : [
        { q: `What does a ${name.toLowerCase()} actually look like?`, a: c.look },
        { q: `Which product gets me a ${name.toLowerCase()}?`, a: `${c.why}${pick}` },
        { q: `What should I avoid with a ${name.toLowerCase()}?`, a: c.avoid },
      ];
}

/**
 * HowTo structured data for a style page.
 *
 * A style page is a set of steps, so HowTo is the type that actually describes
 * it — and it is the one place on this site where the steps are the content
 * rather than a summary of it. No author, no date, no rating, no yield and no
 * cost: none of those are facts we hold, and a totalTime on "comb it back and
 * let it dry" would be an invention.
 */
export function howToLd({ tile, lang, url, siteUrl, siteName }) {
  const ar = lang !== 'en';
  const c = ar ? tile.ar : tile.en;
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: styleMeta(tile, lang).title,
    description: clamp(`${c.look} ${c.why}`, 300),
    inLanguage: ar ? 'ar-EG' : 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: `${siteUrl}/${tile.icon}`,
    publisher: { '@type': 'Organization', name: siteName, url: siteUrl },
    step: c.steps.map((text, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      text,
    })),
  };
}

/** BreadcrumbList for a style page, or for the index when `tile` is null. */
export function styleBreadcrumbLd({ tile, lang, siteUrl }) {
  const ar = lang !== 'en';
  const items = [
    { '@type': 'ListItem', position: 1, name: ar ? 'الرئيسية' : 'Home', item: siteUrl },
    {
      '@type': 'ListItem',
      position: 2,
      name: ar ? 'ستايلات الشعر' : 'Hair styles',
      item: `${siteUrl}/hair-styles`,
    },
  ];
  if (tile) {
    items.push({
      '@type': 'ListItem',
      position: 3,
      name: (ar ? tile.ar : tile.en).name,
      item: `${siteUrl}/hair-styles/${tile.slug}`,
    });
  }
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

/** CollectionPage + ItemList for the index. */
export function styleIndexLd({ lang, siteUrl }) {
  const ar = lang !== 'en';
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: styleIndexMeta(lang).title,
    description: styleIndexMeta(lang).description,
    inLanguage: ar ? 'ar-EG' : 'en',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: HAIR_STYLES.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${siteUrl}/hair-styles/${s.slug}`,
        name: (ar ? s.ar : s.en).name,
      })),
    },
  };
}
