import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql, hasDb } from '../../../lib/db.js';
import { site } from '../../../lib/config.js';
import { currencyLabel, whole } from '../../../lib/money.js';
import { bySlug, rankProducts } from '../../../lib/hairtypes.js';
import { faqJsonLd } from '../../../lib/faq.js';
import { Dir, Nav, Footer, Crumb } from '../../_components/Chrome.js';
import AddButton from '../../_components/AddButton.js';
import {
  ld, HAIR_SLUGS, typeRange, gapNote, typeMeta, typeFaq, articleLd, breadcrumbLd,
} from '../lib.js';
import '../hairtypes.css';

export const revalidate = 60;

/** Six pages, and only six. The slugs are data, not a hand-typed list. */
export function generateStaticParams() {
  return HAIR_SLUGS.map(slug => ({ slug }));
}

export async function generateMetadata({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
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

export default async function HairTypePage({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const q = ar ? '' : '?lang=en';

  const tile = bySlug(slug);
  if (!tile) notFound();

  const c = ar ? tile.ar : tile.en;
  const range = typeRange(tile, lang);
  const gap = gapNote(tile.slug, lang);

  const products = await loadProducts();
  const matches = rankProducts(products, tile.slug, 3);
  const best = matches[0] || null;
  const alts = matches.slice(1);

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
                  <details key={i} open={i === 0}>
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
                <Link href={`/product/${best.slug}${q}`}>
                  <img src={`/${best.image}`} alt={ar ? best.name_ar : best.name_en}
                    width="200" height="200" />
                </Link>
                <h3>
                  <Link href={`/product/${best.slug}${q}`}>{ar ? best.name_ar : best.name_en}</Link>
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

                <Link className="ht-rec-link" href={`/product/${best.slug}${q}`}>
                  {ar ? 'تفاصيل المنتج ←' : 'Full product detail →'}
                </Link>

                {alts.length > 0 && (
                  <div className="ht-rec-alts">
                    <span>{ar ? 'بدائل كمان تناسبك:' : 'Alternates that also suit you:'}</span>
                    {alts.map(a => (
                      <Link key={a.sku} href={`/product/${a.slug}${q}`}>
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
                <Link className="btn btn-ink btn-full" href={`/shop${q}`}>
                  {ar ? 'صفحة المنتجات ←' : 'Go to the shop →'}
                </Link>
              </div>
            )}

            <div className="ht-back">
              <Link href={`/hair-types${q}`}>{ar ? 'كل أنواع الشعر ←' : 'All hair types →'}</Link>
              <Link href={`/shop${q}`}>{ar ? 'كل التشكيلة ←' : 'The full line →'}</Link>
            </div>
          </aside>
        </div>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
