import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { notFound } from 'next/navigation';
import { sql, hasDb } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { HAIR_TYPES, bySlug, rankProducts } from '../../lib/hairtypes.js';
import { faqJsonLd } from '../../lib/faq.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import AddButton from '../_components/AddButton.js';
import {
  ld, typeRange, gapNote, typeMeta, typeFaq, articleLd, breadcrumbLd,
} from '../hair-types/lib.js';
import '../hair-types/hairtypes.css';
import { imageUrl } from '../../lib/product-image.js';

/**
 * One hair type, rendered once and mounted at both addresses.
 *
 * This body used to sit in app/hair-types/[slug]/page.js and take its language
 * from `searchParams`, because middleware rewrote /en/hair-types/fine onto
 * /hair-types/fine?lang=en and that query string was the only channel carrying
 * the locale into the page. Reading it cost the page its prerender:
 * `searchParams` is a dynamic API, so awaiting it opted the route out of static
 * generation and zeroed the `revalidate` window on the way out — which also
 * made the `generateStaticParams` in the route file pointless work. Now that
 * /en is a real path segment there are two route files, each handing this view
 * its own language as a constant, and nothing here learns anything about the
 * request.
 *
 * hairtypes.css is imported here rather than in either route file so both
 * addresses pull it from one place and neither can be left without it.
 */

/**
 * Title, description and hreflang alternates for one language of one type page.
 *
 * Both route files' `generateMetadata` come through here so the unknown-slug
 * fallback is written once. A slug outside the six is reachable — the six are
 * prerendered but the route still answers anything else on demand — and such a
 * page must not invite indexing.
 */
export function hairTypeMeta(slug, lang) {
  const tile = bySlug(slug);
  if (!tile) {
    return {
      title: lang === 'en' ? 'Hair type not found' : 'نوع الشعر مش موجود',
      robots: { index: false },
    };
  }
  return typeMeta(tile, lang);
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
 * Articles written for this hair type, plus general ones to fill the strip.
 *
 * These six pages linked to products and to nothing else — not to each other,
 * not to a single article. That left every guide the shop publishes orphaned
 * from the pages whose readers most want them, and gave the type pages no
 * outbound topical context at all.
 */
async function loadReads(hairType, lang) {
  if (!hasDb()) return [];
  try {
    return await sql`
      SELECT slug, title, excerpt, hair_type
        FROM articles
       WHERE status = 'published' AND lang = ${lang}
       ORDER BY (hair_type = ${hairType}) DESC, published_at DESC NULLS LAST, id DESC
       LIMIT 3`;
  } catch {
    return [];
  }
}

export default async function HairTypeView({ slug, lang }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const tile = bySlug(slug);
  if (!tile) notFound();

  const c = ar ? tile.ar : tile.en;
  const range = typeRange(tile, lang);
  const gap = gapNote(tile.slug, lang);

  const [products, reads] = await Promise.all([
    loadProducts(),
    loadReads(tile.slug, lang),
  ]);
  const siblings = HAIR_TYPES.filter(t => t.slug !== tile.slug);
  const matches = rankProducts(products, tile.slug, 3);
  const best = matches[0] || null;
  const alts = matches.slice(1);

  // The unprefixed URL in both languages, which is the convention every other
  // structured-data block on these pages already follows: breadcrumbLd and
  // indexLd in app/hair-types/lib.js build their items from siteUrl with no
  // locale segment. Making this one address the English page while its own
  // breadcrumb still named the Arabic one would be worse than the single
  // inconsistency there is now.
  const url = `${site.url}/hair-types/${tile.slug}`;
  const faq = typeFaq(tile, lang, best ? { name: ar ? best.name_ar : best.name_en } : null);

  return (
    <Dir lang={lang}>
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ld(articleLd({ tile, lang, url, siteUrl: site.url, siteName: site.name })),
        }} />
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(breadcrumbLd({ tile, lang, siteUrl: site.url })) }} />
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(faqJsonLd(faq)) }} />
      <Nav lang={lang} path={`hair-types/${tile.slug}`} />
      <main id="content">

      <div className="phead">
        <div className="wrap">
          <Crumb
            lang={lang}
            trail={[
              { label: ar ? 'أنواع الشعر' : 'Hair types', href: '/hair-types' },
              { label: c.name },
            ]}
          />
        </div>
      </div>

      <div className="wrap ht ht-one" style={{ '--c': tile.color }}>
        <header className="ht-hero">
          <span className="ht-medal ht-medal-lg">
            <img src={`/${tile.icon}`} alt="" width="120" height="120" />
          </span>
          <div>
            <span className="ht-range" dir={range.dir}>{range.text}</span>
            <h1>{ar ? `شعر ${c.name}` : `${c.name} hair`}</h1>
            <p className="ht-short">{c.short}</p>
          </div>
        </header>

        <div className="ht-cols">
          <div className="ht-main">
            <section className="ht-sec">
              <h2>{ar ? 'المشكلة' : 'The problem'}</h2>
              <p>{c.problem}</p>
            </section>

            <section className="ht-sec">
              <h2>{ar ? 'اللي بيشتغل' : 'What works'}</h2>
              <p className="ht-ans ht-ans-big">{c.answer}</p>
            </section>

            <section className="ht-sec">
              <h2>{ar ? 'ابعد عن' : 'What to avoid'}</h2>
              <p className="ht-avoid">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5v5.5" strokeLinecap="round" />
                  <path d="M12 16.4v.2" strokeLinecap="round" />
                </svg>
                <span>{c.avoid}</span>
              </p>
            </section>

            {gap && (
              <section className="ht-sec">
                <h2>{ar ? 'وحاجة بنقولها بصراحة' : 'One honest note'}</h2>
                <p className="ht-gapnote">{gap}</p>
              </section>
            )}

            <section className="ht-sec">
              <h2>{ar ? 'أسئلة بتتسأل كتير' : 'Common questions'}</h2>
              <div className="ht-faq">
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
          <aside className="ht-rail">
            {best ? (
              <div className="ht-rec">
                <span className="ht-rec-badge">{ar ? 'الترشيح' : 'Our pick'}</span>
                <Link href={L(`/product/${best.slug}`)}>
                  <img src={imageUrl(best.image)} alt={ar ? best.name_ar : best.name_en}
                    width="200" height="200" />
                </Link>
                <h3>
                  <Link href={L(`/product/${best.slug}`)}>{ar ? best.name_ar : best.name_en}</Link>
                </h3>
                <p className="ht-rec-sub">{ar ? best.sub_ar : best.sub_en}</p>

                <bdi className="ht-rec-price">
                  {whole(best.price)} <small>{currencyLabel(lang)}</small>
                </bdi>

                <div className="ht-rec-spec">
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

                <Link className="ht-rec-link" href={L(`/product/${best.slug}`)}>
                  {ar ? 'تفاصيل المنتج ←' : 'Full product detail →'}
                </Link>

                {alts.length > 0 && (
                  <div className="ht-rec-alts">
                    <span>{ar ? 'بدائل كمان تناسبك:' : 'Alternates that also suit you:'}</span>
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
              <div className="ht-rec ht-rec-empty">
                <p>
                  {ar
                    ? 'المنتجات مش ظاهرة دلوقتي. الكلام اللي فوق ثابت مهما كان — وتقدر تشوف التشكيلة كلها من صفحة المنتجات.'
                    : 'Products are not loading right now. The guidance above still stands — and the full line is on the shop page.'}
                </p>
                <Link className="btn btn-ink btn-full" href={L(`/shop`)}>
                  {ar ? 'صفحة المنتجات ←' : 'Go to the shop →'}
                </Link>
              </div>
            )}

            <div className="ht-back">
              <Link href={L(`/hair-types`)}>{ar ? 'كل أنواع الشعر ←' : 'All hair types →'}</Link>
              <Link href={L(`/shop`)}>{ar ? 'كل التشكيلة ←' : 'The full line →'}</Link>
            </div>
          </aside>
        </div>

        {reads.length > 0 && (
          <section className="ht-reads">
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

        <section className="ht-siblings">
          <h2>{ar ? 'أنواع الشعر التانية' : 'The other hair types'}</h2>
          <div className="ht-sibgrid">
            {siblings.map(t => {
              const sc = ar ? t.ar : t.en;
              return (
                <Link key={t.slug} href={L(`/hair-types/${t.slug}`)} style={{ '--c': t.color }}>
                  <img src={`/${t.icon}`} alt="" width="30" height="30" loading="lazy" />
                  <span>{ar ? `شعر ${sc.name}` : `${sc.name} hair`}</span>
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
