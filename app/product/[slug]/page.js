import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '../../../lib/db.js';
import { site } from '../../../lib/config.js';
import { currencyLabel, whole, discountPercent } from '../../../lib/money.js';
import { bySlug } from '../../../lib/hairtypes.js';
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

  const name = ar ? p.name_ar : p.name_en;
  const sub = ar ? p.sub_ar : p.sub_en;
  const chip = ar ? p.chip_ar : p.chip_en;
  const inStock = Number(p.stock) > 0;

  // First slug in the CSV is the primary recommendation for this jar.
  const primary = String(p.hair_types || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  const hair = primary ? bySlug(primary) : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    image: `${site.url}/${p.image}`,
    description: sub,
    sku: p.sku,
    brand: { '@type': 'Brand', name: 'New Star Seven' },
    offers: {
      '@type': 'Offer',
      price: String(Number(p.price)),
      priceCurrency: site.currency,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${site.url}/product/${p.slug}`,
    },
  };

  return (
    <Dir lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
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
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
