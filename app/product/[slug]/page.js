import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '../../../lib/db.js';
import { site } from '../../../lib/config.js';
import { currencyLabel, whole, discountPercent } from '../../../lib/money.js';
import { bySlug } from '../../../lib/hairtypes.js';
import { renderMarkdown } from '../../../lib/markdown.js';
import { productFaq, faqJsonLd } from '../../../lib/faq.js';
import { Dir, Nav, Footer, Crumb } from '../../_components/Chrome.js';
import AddButton from '../../_components/AddButton.js';

export const revalidate = 60;

async function getProduct(slug) {
  const rows = await sql`SELECT * FROM products WHERE slug = ${slug} AND active = true LIMIT 1`;
  return rows[0] || null;
}

/** Pre-render every product at build time; new ones fall back to on-demand. */
export async function generateStaticParams() {
  try {
    const rows = await sql`SELECT slug FROM products WHERE active = true`;
    return rows.map(r => ({ slug: r.slug }));
  } catch {
    return [];   // no database at build time — pages render on request instead
  }
}

export async function generateMetadata({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  const p = await getProduct(slug);
  if (!p) return { title: ar ? 'المنتج مش موجود' : 'Product not found', robots: { index: false } };

  const name = ar ? p.name_ar : p.name_en;
  const sub = ar ? p.sub_ar : p.sub_en;
  const desc = ar
    ? `${name} من نيو ستار سفن. ${sub}. تثبيت درجة ${p.hold_level}/5، توصيل ودفع عند الاستلام.`
    : `${name} by New Star Seven. ${sub}. Hold ${p.hold_level}/5, delivery and cash on receipt.`;

  return {
    title: name,
    description: desc,
    alternates: {
      canonical: `/product/${p.slug}`,
      languages: { ar: `/product/${p.slug}`, en: `/product/${p.slug}?lang=en` },
    },
    openGraph: { title: name, description: desc, images: [`/${p.image}`] },
  };
}

export default async function ProductPage({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const q = ar ? '' : '?lang=en';

  const p = await getProduct(slug);
  if (!p) notFound();

  // Same format first, then anything else, so the row is never short. Four is
  // what the grid holds at desktop width. The "same kind first" ordering is
  // done here rather than as an ORDER BY expression: the catalogue is small
  // enough that it costs nothing, and a plain sort is easier to be sure of
  // than a boolean ordering key.
  const others = await sql`
    SELECT * FROM products WHERE active = true ORDER BY sort, id`;
  const related = others
    .filter(r => String(r.sku) !== String(p.sku))
    .sort((a, b) => (b.kind === p.kind) - (a.kind === p.kind))
    .slice(0, 4);

  const name = ar ? p.name_ar : p.name_en;
  const sub = ar ? p.sub_ar : p.sub_en;
  const chip = ar ? p.chip_ar : p.chip_en;
  const inStock = Number(p.stock) > 0;

  // First slug in the CSV is the primary recommendation for this jar.
  const hairSlugs = String(p.hair_types || '').split(',').map(s => s.trim()).filter(Boolean);
  const hair = hairSlugs[0] ? bySlug(hairSlugs[0]) : null;
  const alsoFor = hairSlugs.slice(1).map(bySlug).filter(Boolean);

  // Long-form copy is optional: a product with empty fields simply renders a
  // shorter page rather than an empty heading.
  const lines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
  const long = ar ? p.long_ar : p.long_en;
  const howto = lines(ar ? p.howto_ar : p.howto_en);
  const highlights = lines(ar ? p.highlights_ar : p.highlights_en);
  const faq = productFaq(lang);

  // The long copy makes a far better search snippet than the one-line
  // sub-heading, so prefer it and fall back only when it is empty.
  const metaDesc = long
    ? String(long).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
    : sub;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    image: `${site.url}/${p.image}`,
    description: metaDesc,
    sku: p.sku,
    brand: { '@type': 'Brand', name: 'New Star Seven' },
    offers: {
      '@type': 'Offer',
      price: String(Number(p.price)),
      priceCurrency: site.currency,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${site.url}/product/${p.slug}`,
    },
    ...(p.size_ml
      ? { additionalProperty: [{ '@type': 'PropertyValue', name: 'Volume', value: `${p.size_ml} ml` }] }
      : {}),
  };

  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: ar ? 'الرئيسية' : 'Home', item: site.url },
      { '@type': 'ListItem', position: 2, name: ar ? 'المنتجات' : 'Shop', item: `${site.url}/shop` },
      { '@type': 'ListItem', position: 3, name, item: `${site.url}/product/${p.slug}` },
    ],
  };

  // One escaper for all three blocks: a "</script>" inside any string value
  // would otherwise close the tag early.
  const ld = j => JSON.stringify(j).replace(/</g, '\\u003c');

  return (
    <Dir lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(crumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(faqJsonLd(faq)) }} />
      <Nav lang={lang} path={`product/${p.slug}`} />

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'المنتجات' : 'Shop', href: '/shop' }, { label: name }]} />
        </div>
      </div>

      <div className="wrap">
        <div className="pdp">
          <div className="pdp-media" style={{ '--c': p.color }}>
            <img src={`/${p.image}`} alt={name} width="600" height="600" />
          </div>

          <div className="pdp-info">
            {chip && <span className="chip">{chip}</span>}
            <h1>{name}</h1>
            <div className="sub">{sub}</div>

            <div className="pdp-price">
              <bdi className="p">
                {whole(p.price)} <small>{currencyLabel(lang)}</small>
              </bdi>
              {p.compare_at != null && (
                <>
                  <bdi className="was">{whole(p.compare_at)}</bdi>
                  {/* dir="ltr": the minus sign is bidi-neutral and would drift
                      to the end of an Arabic line, reading "18%-". */}
                  <span className="save" dir="ltr">−{discountPercent(p.price, p.compare_at)}%</span>
                </>
              )}
            </div>

            <div className="pdp-buy">
              {inStock ? (
                <>
                  <AddButton
                    sku={p.sku}
                    className="btn btn-red"
                    label={ar ? 'ضيفه للسلة' : 'Add to cart'}
                    addedLabel={ar ? 'اتضاف للسلة ✓' : 'Added to cart ✓'}
                  />
                  <Link className="btn btn-line" href={`/checkout${q}`}>
                    {ar ? 'إتمام الطلب ←' : 'Checkout →'}
                  </Link>
                </>
              ) : (
                <span className="btn btn-line" style={{ opacity: 0.6, cursor: 'default' }}>
                  {ar ? 'خلص من المخزن' : 'Out of stock'}
                </span>
              )}
            </div>

            <div className="spec">
              <div>
                <b dir="ltr">{p.hold_level}/5</b>
                <span>{ar ? 'قوة التثبيت' : 'Hold strength'}</span>
              </div>
              {p.size_ml && (
                <div>
                  <b dir="ltr">{p.size_ml}ml</b>
                  <span>{ar ? 'الحجم' : 'Size'}</span>
                </div>
              )}
              <div>
                <b>{String(p.kind).toUpperCase()}</b>
                <span>{ar ? 'النوع' : 'Type'}</span>
              </div>
            </div>

            {hair && (
              <div className="pdp-note hairnote">
                <span className="hairnote-icon" style={{ '--c': hair.color }}>
                  <img src={`/${hair.icon}`} alt="" width="56" height="56" loading="lazy" />
                </span>
                <span className="hairnote-txt">
                  <b>{ar ? `الأنسب لشعر ${hair.ar.name}` : `Best for ${hair.en.name}`}</b>
                  <span className="hairnote-sub">{ar ? hair.ar.short : hair.en.short}</span>
                  <Link href={ar ? '/#hair' : '/?lang=en#hair'}>
                    {ar ? 'اعرف نوع شعرك ←' : 'Find your hair type →'}
                  </Link>
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="pdp-body">
          <div className="pdp-cols">
            {long && (
              <section className="pdp-sec">
                <h2>{ar ? 'عن المنتج ده' : 'About this one'}</h2>
                <div
                  className="prose"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(long) }}
                />

                {alsoFor.length > 0 && (
                  <p className="pdp-alsofor">
                    <b>{ar ? 'كمان يناسب:' : 'Also suits:'}</b>{' '}
                    {alsoFor.map((h, i) => (
                      <span key={h.slug}>
                        {i > 0 && '، '}
                        {ar ? h.ar.name : h.en.name}
                      </span>
                    ))}
                  </p>
                )}
              </section>
            )}

            <div>
              {howto.length > 0 && (
                <section className="pdp-sec">
                  <h2>{ar ? 'طريقة الاستخدام' : 'How to use it'}</h2>
                  <ol className="pdp-steps">
                    {howto.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                </section>
              )}

              {highlights.length > 0 && (
                <section className="pdp-sec">
                  <h2>{ar ? 'باختصار' : 'In short'}</h2>
                  <ul className="pdp-highlights">
                    {highlights.map((h, i) => <li key={i}>{h}</li>)}
                  </ul>
                </section>
              )}
            </div>
          </div>

          <div className="pdp-trust">
            <div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" strokeLinejoin="round" />
                <circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" />
              </svg>
              <span>
                <b>{ar ? 'توصيل لحد باب البيت' : 'Delivered to your door'}</b>
                {ar
                  ? `رسوم التوصيل ${site.shipping} جنيه${site.freeOver > 0 ? `، ومجاني فوق ${site.freeOver} جنيه` : ''}`
                  : `${site.shipping} EGP${site.freeOver > 0 ? `, free over ${site.freeOver} EGP` : ''}`}
              </span>
            </div>
            <div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <rect x="2.5" y="6" width="19" height="12" rx="2" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
              <span>
                <b>{ar ? 'الدفع عند الاستلام' : 'Cash on delivery'}</b>
                {ar ? 'مفيش بيانات بطاقة خالص' : 'No card details, ever'}
              </span>
            </div>
            <div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 12a8 8 0 1 1 2.6 5.9" strokeLinecap="round" />
                <path d="M4 7v5h5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>
                <b>{ar ? 'وصلك غلط؟' : 'Arrived wrong?'}</b>
                {ar ? 'كلّمنا خلال ٤٨ ساعة ونحلّها' : 'Tell us within 48 hours'}
              </span>
            </div>
          </div>

          <section className="pdp-sec pdp-faq-sec">
            <h2>{ar ? 'أسئلة بتتسأل كتير' : 'Common questions'}</h2>
            <div className="pdp-faq">
              {faq.map((f, i) => (
                <details key={i} open={i === 0}>
                  <summary>{f.q}</summary>
                  <div>{f.a}</div>
                </details>
              ))}
            </div>
          </section>

          {related.length > 0 && (
            <section className="pdp-related">
              <h2>{ar ? 'كمان من التشكيلة' : 'More from the line'}</h2>
              <div className="grid">
                {related.map(r => {
                  const rName = ar ? r.name_ar : r.name_en;
                  return (
                    <div className="card" key={r.sku} style={{ '--c': r.color }}>
                      <Link className="card-hit" href={`/product/${r.slug}${q}`}>
                        <img src={`/${r.image}`} alt={rName} loading="lazy" width="300" height="300" />
                        <h3>{rName}</h3>
                        <div className="sub">{ar ? r.sub_ar : r.sub_en}</div>
                      </Link>
                      <div className="foot">
                        <div className="price">
                          <bdi>{whole(r.price)} <small>{currencyLabel(lang)}</small></bdi>
                          {r.compare_at != null && <bdi className="was">{whole(r.compare_at)}</bdi>}
                        </div>
                        <AddButton sku={r.sku} label={ar ? 'ضيف للسلة' : 'Add'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
