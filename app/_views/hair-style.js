import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { notFound } from 'next/navigation';
import { sql, hasDb } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { HAIR_STYLES, bySlug, rankForStyle } from '../../lib/hairstyles.js';
import { sellable } from '../../lib/hairtypes.js';
import { faqJsonLd } from '../../lib/faq.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import AddButton from '../_components/AddButton.js';
import {
  ld, styleLabel, styleGap, styleMeta, styleFaq, howToLd, styleBreadcrumbLd,
} from '../hair-styles/lib.js';
import '../hair-styles/hairstyles.css';
import { imageUrl } from '../../lib/product-image.js';

/**
 * One hair style, rendered once and mounted at both addresses.
 *
 * Two route files hand this view its language as a compile-time constant, the
 * way app/_views/hair-type.js is mounted at /hair-types/[slug] and
 * /en/hair-types/[slug]. Nothing here reads the request: `searchParams`,
 * `headers()` and `cookies()` are dynamic APIs and awaiting any of them opts
 * the route out of static generation, which would also make the
 * generateStaticParams in both route files pointless work.
 *
 * hairstyles.css is imported here rather than in either route file so both
 * addresses pull it from one place and neither can be left without it.
 */

/**
 * Title, description and hreflang alternates for one language of one style page.
 *
 * Both route files' `generateMetadata` come through here so the unknown-slug
 * fallback is written once. A slug outside the six is reachable — the six are
 * prerendered but the route still answers anything else on demand — and such a
 * page must not invite indexing.
 */
export function hairStyleMeta(slug, lang) {
  const tile = bySlug(slug);
  if (!tile) {
    return {
      title: lang === 'en' ? 'Hair style not found' : 'الاستايل مش موجود',
      robots: { index: false },
    };
  }
  return styleMeta(tile, lang);
}

/** Same degradation as the index: a guide with no jars beats a 500. */
async function loadProducts() {
  if (!hasDb()) return [];
  try {
    return await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;
  } catch {
    return [];
  }
}

/**
 * The latest three published articles in this language, unfiltered.
 *
 * app/_views/hair-type.js orders its strip by (hair_type = $1) DESC, because
 * articles carry a hair_type column. There is no style column and there should
 * not be one yet: articles.hair_type is unconstrained TEXT and would accept a
 * style slug with no migration, but that conflates two taxonomies, and an
 * article tagged with a style would then match no hair type at all. Until the
 * client is actually writing style-tagged articles, the latest three are an
 * honest strip and a filtered one would be an empty promise.
 */
async function loadReads(lang) {
  if (!hasDb()) return [];
  try {
    return await sql`
      SELECT slug, title, excerpt
        FROM articles
       WHERE status = 'published' AND lang = ${lang}
       ORDER BY published_at DESC NULLS LAST, id DESC
       LIMIT 3`;
  } catch {
    return [];
  }
}

export default async function HairStyleView({ slug, lang }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const tile = bySlug(slug);
  if (!tile) notFound();

  const c = ar ? tile.ar : tile.en;
  const label = styleLabel(tile, lang);
  const gap = styleGap(tile.slug, lang);

  const [products, reads] = await Promise.all([loadProducts(), loadReads(lang)]);
  const siblings = HAIR_STYLES.filter(s => s.slug !== tile.slug);
  const matches = rankForStyle(sellable(products), tile, 3);
  const best = matches[0] || null;
  const alts = matches.slice(1);

  // The unprefixed URL in both languages, which is the convention every other
  // structured-data block on these pages already follows: styleBreadcrumbLd and
  // styleIndexLd in app/hair-styles/lib.js build their items from siteUrl with
  // no locale segment, exactly as the hair-type pages do. Making this one
  // address the English page while its own breadcrumb still named the Arabic
  // one would be worse than the single inconsistency there is now.
  const url = `${site.url}/hair-styles/${tile.slug}`;
  const faq = styleFaq(tile, lang, best ? { name: ar ? best.name_ar : best.name_en } : null);

  return (
    <Dir lang={lang}>
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ld(howToLd({ tile, lang, url, siteUrl: site.url, siteName: site.name })),
        }} />
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(styleBreadcrumbLd({ tile, lang, siteUrl: site.url })) }} />
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(faqJsonLd(faq)) }} />
      <Nav lang={lang} path={`hair-styles/${tile.slug}`} />
      <main id="content">

      <div className="phead">
        <div className="wrap">
          <Crumb
            lang={lang}
            trail={[
              { label: ar ? 'ستايلات الشعر' : 'Hair styles', href: '/hair-styles' },
              { label: c.name },
            ]}
          />
        </div>
      </div>

      <div className="wrap hs hs-one" style={{ '--c': tile.color, '--m': `url(/${tile.icon})` }}>
        <header className="hs-hero">
          {/* The render rather than the line drawing: this is the one place on
              the site with room to show the cut at a size worth looking at, and
              a visitor who arrived to find out what this style IS is served by
              a picture of it and not by a glyph. */}
          <img className="hs-hero-shot" src={`/${tile.photo}`} alt=""
            width="720" height="720" />
          <div>
            <span className="hs-label" dir={label.dir}>{label.text}</span>
            <h1>{c.name}</h1>
            <p className="hs-short">{c.short}</p>
          </div>
        </header>

        <div className="hs-cols">
          <div className="hs-main">
            <section className="hs-sec">
              <h2>{ar ? 'الشكل نفسه' : 'The look'}</h2>
              <p>{c.look}</p>
            </section>

            <section className="hs-sec">
              <h2>{ar ? 'ليه المنتج ده بالذات' : 'Why this product'}</h2>
              <p className="hs-why-line hs-why-big">{c.why}</p>
            </section>

            <section className="hs-sec">
              <h2>{ar ? 'الخطوات' : 'Step by step'}</h2>
              <ol className="hs-steps">
                {c.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </section>

            <section className="hs-sec">
              <h2>{ar ? 'ابعد عن' : 'What to avoid'}</h2>
              <p className="hs-avoid">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5v5.5" strokeLinecap="round" />
                  <path d="M12 16.4v.2" strokeLinecap="round" />
                </svg>
                <span>{c.avoid}</span>
              </p>
            </section>

            {gap && (
              <section className="hs-sec">
                <h2>{ar ? 'اللي مش عندنا' : 'What we do not have'}</h2>
                <p className="hs-gapnote">{gap}</p>
              </section>
            )}

            <section className="hs-sec">
              <h2>{ar ? 'أسئلة بتتسأل كتير' : 'Common questions'}</h2>
              <div className="hs-faq">
                {faq.map((f, i) => (
                  <details key={i} name="faq" open={i === 0}>
                    <summary>{f.q}</summary>
                    <div>{f.a}</div>
                  </details>
                ))}
              </div>
            </section>
          </div>

          {/* ------------------------------------------------ the pick rail */}
          <aside className="hs-rail">
            {best ? (
              <div className="hs-rec">
                <span className="hs-rec-badge">
                  {/* A look the shop cannot serve properly is never sold a
                      right answer, because there is not one on it. It gets the
                      closest thing that exists, under a label that says so, and
                      the alternates block below is suppressed for the same
                      reason: a tile that has just graded itself down has no
                      business listing a runner-up.
                      Keyed on "not yes" rather than on "no", so a tile whose
                      real product is made but unlisted — the crop, waiting on
                      the clay — is held to the same standard as one the range
                      cannot reach at all. Those two are the same thing from the
                      customer's side: the jar in front of them is not the jar
                      the page just described. */}
                  {tile.served !== 'yes'
                    ? (ar ? 'أقرب حاجة' : 'The closest')
                    : (ar ? 'اللي هيوصلك له' : 'What gets you there')}
                </span>
                <Link href={L(`/product/${best.slug}`)}>
                  <img src={imageUrl(best.image)} alt={ar ? best.name_ar : best.name_en}
                    width="200" height="200" />
                </Link>
                <h3>
                  <Link href={L(`/product/${best.slug}`)}>{ar ? best.name_ar : best.name_en}</Link>
                </h3>
                <p className="hs-rec-sub">{ar ? best.sub_ar : best.sub_en}</p>

                <bdi className="hs-rec-price">
                  {whole(best.price)} <small>{currencyLabel(lang)}</small>
                </bdi>

                <div className="hs-rec-spec">
                  <span>
                    {/* dir="ltr": "5/5" and "120ml" are Latin runs and reverse
                        inside an Arabic line without it. */}
                    <b dir="ltr">{best.hold_level}/5</b>
                    {ar ? 'التثبيت' : 'Hold'}
                  </span>
                  {best.size_ml && (
                    <span>
                      <b dir="ltr">{best.size_ml}ml</b>
                      {ar ? 'الحجم' : 'Size'}
                    </span>
                  )}
                </div>

                {Number(best.stock) > 0 ? (
                  <AddButton
                    sku={best.sku}
                    className="btn btn-red btn-full"
                    label={ar ? 'ضيفه للسلة' : 'Add to cart'}
                    addedLabel={ar ? 'اتضاف للسلة ✓' : 'Added to cart ✓'}
                  />
                ) : (
                  <span className="btn btn-line btn-full" style={{ opacity: 0.6, cursor: 'default' }}>
                    {ar ? 'خلص من المخزن' : 'Out of stock'}
                  </span>
                )}

                <Link className="hs-rec-link" href={L(`/product/${best.slug}`)}>
                  {ar ? 'تفاصيل المنتج ←' : 'Full product detail →'}
                </Link>

                {tile.served === 'yes' && alts.length > 0 && (
                  <div className="hs-rec-alts">
                    <span>{ar ? 'ينفع كمان مع الاستايل ده:' : 'Also works for this look:'}</span>
                    {alts.map(a => (
                      <Link key={a.sku} href={L(`/product/${a.slug}`)}>
                        <b>{ar ? a.name_ar : a.name_en}</b>
                        <bdi>{whole(a.price)} <small>{currencyLabel(lang)}</small></bdi>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="hs-rec hs-rec-empty">
                <p>
                  {ar
                    ? 'المنتجات مش ظاهرة دلوقتي. الخطوات اللي فوق ثابتة مهما كان — وتقدر تشوف التشكيلة كلها من صفحة المنتجات.'
                    : 'Products are not loading right now. The steps above still stand — and the full line is on the shop page.'}
                </p>
                <Link className="btn btn-ink btn-full" href={L(`/shop`)}>
                  {ar ? 'صفحة المنتجات ←' : 'Go to the shop →'}
                </Link>
              </div>
            )}

            <div className="hs-back">
              <Link href={L(`/hair-styles`)}>{ar ? 'كل الاستايلات ←' : 'All hair styles →'}</Link>
              <Link href={L(`/hair-types`)}>{ar ? 'اعرف نوع شعرك ←' : 'Find your hair type →'}</Link>
              <Link href={L(`/shop`)}>{ar ? 'كل التشكيلة ←' : 'The full line →'}</Link>
            </div>
          </aside>
        </div>

        {reads.length > 0 && (
          <section className="hs-reads">
            <h2>{ar ? 'اقرأ كمان' : 'Read next'}</h2>
            <ul>
              {reads.map(a => (
                <li key={a.slug}>
                  <Link href={L(`/article/${a.slug}`)}>
                    {a.title}
                    {a.excerpt && <small>{a.excerpt}</small>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="hs-siblings">
          <h2>{ar ? 'الاستايلات التانية' : 'The other styles'}</h2>
          <div className="hs-sibgrid">
            {siblings.map(s => {
              const sc = ar ? s.ar : s.en;
              return (
                <Link key={s.slug} href={L(`/hair-styles/${s.slug}`)}
                  style={{ '--c': s.color, '--m': `url(/${s.icon})` }}>
                  <span className="hs-mark" aria-hidden="true" />
                  <span>{sc.name}</span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      </main>
      <Footer lang={lang} />
    </Dir>
  );
}
