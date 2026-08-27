import Link from 'next/link';
import { localePath, localeUrl } from '../../lib/urls.js';
import { CATEGORIES, KINDS, shopPath, shopCopy, kindColumn } from './lib.js';
import { sql } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import AddButton from '../_components/AddButton.js';

/**
 * The shop, rendered once and mounted at three addresses.
 *
 * Wax and gel used to be `?kind=` filters on /shop, which meant the two things
 * this brand actually sells — "hair wax" and "hair gel" — had no page of their
 * own to rank. A query parameter that canonicals back to /shop is invisible to
 * search; a path is a page. /shop/wax and /shop/gel are real, indexable,
 * separately-titled pages now, and the old query form redirects into them.
 */

export default async function ShopView({ kind, lang }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);
  const c = shopCopy(kind, lang);
  const active = KINDS.includes(kind) ? kind : 'all';

  // Two complete queries rather than a concatenated WHERE clause. The category
  // filters on its `kind` column, which is not the same string as its URL slug
  // — /shop/cream-gel selects kind = 'cream'.
  const products = active === 'all'
    ? await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`
    : await sql`SELECT * FROM products WHERE active = true AND kind = ${kindColumn(active)} ORDER BY sort, id`;

  // A category with nothing priced yet would be an empty page inviting a
  // crawl. Only categories that actually hold something get a chip.
  const stocked = await sql`
    SELECT kind, count(*)::int AS n FROM products WHERE active = true GROUP BY kind`;
  const have = new Set(stocked.map(r => r.kind));
  const shown = CATEGORIES.filter(c => have.has(c.kind) || c.slug === active);

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: c.h1,
    description: c.desc,
    url: localeUrl(shopPath(kind), lang),
    inLanguage: ar ? 'ar-EG' : 'en',
    isPartOf: { '@type': 'WebSite', name: site.name, url: site.url },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: products.length,
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: localeUrl(`/product/${p.slug}`, lang),
        name: ar ? p.name_ar : p.name_en,
      })),
    },
  };

  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: ar ? 'الرئيسية' : 'Home', item: localeUrl('/', lang) },
      { '@type': 'ListItem', position: 2, name: ar ? 'المنتجات' : 'Shop', item: localeUrl('/shop', lang) },
      ...(active === 'all'
        ? []
        : [{ '@type': 'ListItem', position: 3, name: c.crumb, item: localeUrl(shopPath(active), lang) }]),
    ],
  };

  const ld = j => JSON.stringify(j).replace(/</g, '\\u003c');

  return (
    <Dir lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(itemList) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(crumbLd) }} />
      <Nav lang={lang} path="shop" />

      <div className="phead">
        <div className="wrap">
          <Crumb
            lang={lang}
            trail={
              active === 'all'
                ? [{ label: ar ? 'المنتجات' : 'Shop' }]
                : [{ label: ar ? 'المنتجات' : 'Shop', href: '/shop' }, { label: c.crumb }]
            }
          />
          <h1>{c.h1}</h1>
          <p>{c.lead}</p>
        </div>
      </div>

      <div className="wrap">
        <div className="chips">
          <Link href={L('/shop')} className={active === 'all' ? 'on' : ''}>
            {ar ? 'الكل' : 'All'}
          </Link>
          {shown.map(c => (
            <Link key={c.slug} href={L(shopPath(c.slug))} className={active === c.slug ? 'on' : ''}>
              {ar ? c.crumb.ar : c.crumb.en}
            </Link>
          ))}
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
                  <Link className="card-hit" href={L(`/product/${p.slug}`)}>
                    {chip && <span className="chip">{chip}</span>}
                    <img src={`/${p.image}`} alt={name} loading="lazy" width="300" height="300" />
                    <h3>{name}</h3>
                    <div className="sub">{sub}</div>
                  </Link>
                  <div className="foot">
                    {/* A price of zero is not free — it is a product the client
                        has not priced yet. The catalogue still shows it, but
                        with a way to ask rather than a way to buy. */}
                    {Number(p.price) > 0 ? (
                      <>
                        <div className="price">
                          <bdi className="now">{whole(p.price)} <small>{currencyLabel(lang)}</small></bdi>
                          {p.compare_at != null && <bdi className="was">{whole(p.compare_at)}</bdi>}
                        </div>
                        <AddButton sku={p.sku} label={ar ? 'ضيف للسلة' : 'Add'} />
                      </>
                    ) : (
                      <>
                        <div className="price ask">{ar ? 'اسأل عن السعر' : 'Ask for price'}</div>
                        <a className="buy" target="_blank" rel="noopener"
                          href={`https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
                            ar ? `عايز أعرف سعر ${p.name_ar}` : `What is the price of ${p.name_en}?`)}`}>
                          {ar ? 'واتساب' : 'WhatsApp'}
                        </a>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Every category page hands the crawler — and the customer who landed
            on the wrong one — a way to the sibling and to the guide. */}
        <nav className="shop-more">
          <Link href={L('/hair-types')}>
            {ar ? 'مش عارف تختار؟ اعرف نوع شعرك ←' : 'Not sure? Find your hair type →'}
          </Link>
          {shown.filter(c => c.slug !== active).slice(0, 3).map(c => (
            <Link key={c.slug} href={L(shopPath(c.slug))}>
              {ar ? `${c.h1.ar} ←` : `${c.h1.en} →`}
            </Link>
          ))}
          {active !== 'all' && <Link href={L('/shop')}>{ar ? 'كل التشكيلة ←' : 'The full line →'}</Link>}
        </nav>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
