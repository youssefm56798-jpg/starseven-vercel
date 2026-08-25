import Link from 'next/link';
import { sql } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import AddButton from '../_components/AddButton.js';

// Prices and stock change, so don't serve a stale page for long.
export const revalidate = 60;

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  return {
    title: ar ? 'المنتجات — واكس وجل شعر' : 'Shop — hair wax & gel',
    description: ar
      ? 'كل تشكيلة نيو ستار سفن: واكس وجل شعر بريميوم للرجالة، تثبيت ميجا، بسعر مظبوط. توصيل ودفع عند الاستلام.'
      : 'The full New Star Seven line: premium men’s hair wax and gel, mega hold, priced right. Delivery and cash on receipt.',
    alternates: {
      canonical: '/shop',
      languages: { ar: '/shop', en: '/shop?lang=en' },
    },
  };
}

export default async function ShopPage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const q = ar ? '' : '?lang=en';

  const kinds = ['all', 'wax', 'gel'];
  const kind = kinds.includes(sp?.kind) ? sp.kind : 'all';

  // Two complete queries rather than a concatenated WHERE clause.
  const products = kind === 'all'
    ? await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`
    : await sql`SELECT * FROM products WHERE active = true AND kind = ${kind} ORDER BY sort, id`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: ar ? 'المنتجات — نيو ستار سفن' : 'Shop — New Star Seven',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${site.url}/product/${p.slug}`,
        name: ar ? p.name_ar : p.name_en,
      })),
    },
  };

  const chipHref = k =>
    `/shop${k === 'all' ? '' : `?kind=${k}`}${
      !ar ? (k === 'all' ? '?lang=en' : '&lang=en') : ''
    }`;

  return (
    <Dir lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList).replace(/</g, '\\u003c') }}
      />
      <Nav lang={lang} path="shop" />

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'المنتجات' : 'Shop' }]} />
          <h1>{ar ? 'كل التشكيلة' : 'The full line'}</h1>
          <p>
            {ar
              ? 'كل لون تركيبة مختلفة. نفس التثبيت الميجا. اختار منتجك أو دوس عليه تشوف تفاصيله.'
              : 'Every colour is a different formula, same mega hold. Pick a product or open it for the full detail.'}
          </p>
        </div>
      </div>

      <div className="wrap">
        <div className="chips">
          {[['all', ar ? 'الكل' : 'All'], ['wax', ar ? 'واكس' : 'Wax'], ['gel', ar ? 'جل' : 'Gel']].map(
            ([k, label]) => (
              <Link key={k} href={chipHref(k)} className={kind === k ? 'on' : ''}>
                {label}
              </Link>
            )
          )}
        </div>

        {products.length === 0 ? (
          <div className="empty-note">
            {ar ? 'مفيش منتجات في القسم ده حالياً.' : 'No products in this category yet.'}
          </div>
        ) : (
          <div className="grid">
            {products.map(p => {
              const name = ar ? p.name_ar : p.name_en;
              const sub = ar ? p.sub_ar : p.sub_en;
              const chip = ar ? p.chip_ar : p.chip_en;
              return (
                <div className="card" key={p.sku} style={{ '--c': p.color }}>
                  <Link className="card-hit" href={`/product/${p.slug}${q}`}>
                    {chip && <span className="chip">{chip}</span>}
                    <img src={`/${p.image}`} alt={name} loading="lazy" width="300" height="300" />
                    <h3>{name}</h3>
                    <div className="sub">{sub}</div>
                  </Link>
                  <div className="foot">
                    <div className="price">
                      {Math.round(Number(p.price))} <small>{site.currency}</small>
                      {p.compare_at != null && (
                        <span className="was">{Math.round(Number(p.compare_at))}</span>
                      )}
                    </div>
                    <AddButton sku={p.sku} label={ar ? 'ضيف للسلة' : 'Add'} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
