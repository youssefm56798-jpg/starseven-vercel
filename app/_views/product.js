import Link from 'next/link';
import { alternatesForLang, localePath, localeUrl } from '../../lib/urls.js';
import { notFound } from 'next/navigation';
import { sql } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole, discountPercent } from '../../lib/money.js';
import { bySlug } from '../../lib/hairtypes.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { productFaq, faqJsonLd } from '../../lib/faq.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import AddButton from '../_components/AddButton.js';
import { CATEGORIES, shopPath } from '../shop/lib.js';

/**
 * The product detail page, rendered once and mounted at two addresses.
 *
 * /product/<slug> is the Arabic page and /en/product/<slug> the English one.
 * Both are real route files now — the language used to arrive as a query
 * parameter that middleware rewrote onto the Arabic route, which forced every
 * product page to read a request-scoped API and so to render on demand. The
 * two route files pass the language in as a plain prop instead, and everything
 * below is identical between them.
 *
 * The underscore in _views is what keeps this file out of the route tree: Next
 * ignores an underscore-prefixed folder when it builds routes, the same
 * convention app/_components uses.
 */

async function getProduct(slug) {
  const rows = await sql`SELECT * FROM products WHERE slug = ${slug} AND active = true LIMIT 1`;
  return rows[0] || null;
}

/**
 * The slugs to pre-render, shared by both language trees.
 *
 * Each route file exports its own `generateStaticParams` — Next only reads the
 * export, never an import — but the query and, more importantly, its `catch`
 * belong in one place. A build with no DATABASE_URL has to succeed: it returns
 * an empty list and the pages render on request instead, which is the local
 * condition and the condition on any CI run without database credentials.
 */
export async function productParams() {
  try {
    const rows = await sql`SELECT slug FROM products WHERE active = true`;
    return rows.map(r => r.slug).filter(s => typeof s === 'string' && s)
      .map(slug => ({ slug }));
  } catch {
    return [];   // no database at build time — pages render on request instead
  }
}

/** The <head> for one product in one language. */
export async function productMetadata(slug, lang) {
  const ar = lang !== 'en';
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
    alternates: alternatesForLang(`/product/${p.slug}`, ar ? 'ar' : 'en'),
    openGraph: { title: name, description: desc, images: [`/${p.image}`] },
  };
}

export default async function ProductView({ slug, lang }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

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
  // A price of zero is a product the client has not priced yet, not a free
  // one. It is listed so the range is complete, but it cannot be bought.
  const priced = Number(p.price) > 0;

  // The way back out of the page, and deliberately a real href rather than a
  // history.back(): most visitors arrive here cold from a search result or a
  // shared link, where there is no shop page behind them to go back to and the
  // control would either do nothing or throw them off the site. Pointing at
  // the category this jar belongs to always lands somewhere useful, and it is
  // a link a crawler can follow back into the shop. The `kind` column is an
  // internal enum, so the category owns the translation from it to a URL.
  const category = CATEGORIES.find(c => c.kind === p.kind) || null;
  const backHref = category ? shopPath(category.slug) : '/shop';
  const backLabel = category
    ? (ar ? category.crumb.ar : category.crumb.en)
    : (ar ? 'المنتجات' : 'Shop');

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

  // Every URL in the graph has to be the URL of the page it is on. The offer
  // used to point at the Arabic address from the English page, which is an
  // offer for a different document than the one carrying it — and the product
  // itself declared no URL and no language at all.
  const canonical = localeUrl(`/product/${p.slug}`, lang);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${canonical}#product`,
    name,
    url: canonical,
    inLanguage: ar ? 'ar-EG' : 'en',
    image: `${site.url}/${p.image}`,
    description: metaDesc,
    sku: p.sku,
    mpn: p.sku,
    category: p.kind === 'gel' ? 'Hair Gel' : 'Hair Wax',
    brand: { '@type': 'Brand', '@id': `${site.url}/#brand`, name: site.name },
    // No offer at all when there is no price. Declaring `price: "0"` would
    // tell Google the product is free, and a rich result advertising a free
    // hair wax is worse than no rich result.
    ...(priced ? {
      offers: {
        '@type': 'Offer',
        price: String(Number(p.price)),
        priceCurrency: site.currency,
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        url: canonical,
        seller: { '@type': 'Organization', '@id': `${site.url}/#organization`, name: site.name },
        areaServed: { '@type': 'Country', name: 'Egypt' },
      },
    } : {}),
    ...(p.size_ml
      ? { additionalProperty: [{ '@type': 'PropertyValue', name: 'Volume', value: `${p.size_ml} ml` }] }
      : {}),
  };

  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: ar ? 'الرئيسية' : 'Home', item: localeUrl('/', lang) },
      { '@type': 'ListItem', position: 2, name: ar ? 'المنتجات' : 'Shop', item: localeUrl('/shop', lang) },
      { '@type': 'ListItem', position: 3, name, item: canonical },
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
          {/* The arrow lives in CSS, not in this string: it has to point the
              way the page reads, and that is a property of the direction
              rather than of the translation. */}
          <Link className="pdp-back" href={L(backHref)}>
            {ar ? `رجوع لـ ${backLabel}` : `Back to ${backLabel}`}
          </Link>
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
              {priced ? (
                <bdi className="p">
                  {whole(p.price)} <small>{currencyLabel(lang)}</small>
                </bdi>
              ) : (
                <span className="p ask">{ar ? 'اسأل عن السعر' : 'Ask for the price'}</span>
              )}
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
              {!priced ? (
                <a className="btn btn-red" target="_blank" rel="noopener"
                  href={`https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
                    ar ? `عايز أعرف سعر ${name}` : `What is the price of ${name}?`)}`}>
                  {ar ? 'اسأل على واتساب' : 'Ask on WhatsApp'}
                </a>
              ) : inStock ? (
                <>
                  <AddButton
                    sku={p.sku}
                    className="btn btn-red"
                    label={ar ? 'ضيفه للسلة' : 'Add to cart'}
                    addedLabel={ar ? 'اتضاف للسلة ✓' : 'Added to cart ✓'}
                  />
                  <Link className="btn btn-line" href={L(`/checkout`)}>
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
                  {/* Was '/#hair', a scroll position on another page. There
                      is a real page for this type now. */}
                  <Link href={L(`/hair-types/${hair.slug}`)}>
                    {ar ? `كل حاجة عن الشعر ال${hair.ar.name} ←` : `More on ${hair.en.name.toLowerCase()} hair →`}
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
                    {/* Links, not prose. These were the only mentions of a
                        hair type anywhere on a product page, and they pointed
                        nowhere — so eight product pages sent nothing to the
                        six guides that explain why this jar suits that hair. */}
                    {alsoFor.map((h, i) => (
                      <span key={h.slug}>
                        {i > 0 && (ar ? '، ' : ', ')}
                        <Link href={L(`/hair-types/${h.slug}`)}>
                          {ar ? h.ar.name : h.en.name}
                        </Link>
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
                      <Link className="card-hit" href={L(`/product/${r.slug}`)}>
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
