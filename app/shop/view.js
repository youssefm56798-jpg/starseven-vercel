import Link from 'next/link';
import { notFound } from 'next/navigation';
import { localePath, localeUrl } from '../../lib/urls.js';
import { CATEGORIES, KINDS, shopPath, shopCopy, kindColumn } from './lib.js';
import { sql, hasDb } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { Dir, Nav, Footer, Crumb, shopCategories } from '../_components/Chrome.js';
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
  //
  // Started together rather than awaited one after the other. Neither needs the
  // other's answer, so serialising them made every shop render wait out two
  // round trips to Neon where one would do.
  // Degrade rather than throw when no database is configured. Every other view
  // that prerenders already does this, and this one did not - which stopped
  // being harmless the day these routes went static: `next build` renders them
  // for real now, so an unguarded query fails the whole build rather than one
  // request. The route files state the invariant plainly, that a build without
  // DATABASE_URL has to succeed, and this file was one of two breaking it.
  const [products, live] = hasDb() ? await Promise.all([
    active === 'all'
      ? sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`
      : sql`SELECT * FROM products WHERE active = true AND kind = ${kindColumn(active)} ORDER BY sort, id`,
    // Which categories are live is the question the nav and the footer already
    // ask, and shopCategories() is cache()d for the request — this render is
    // paying for that answer whether or not the chips use it, so asking again
    // here costs nothing. The GROUP BY that used to sit in this file was a
    // third round trip computing something already in memory.
    shopCategories(),
  ]) : [[], []];

  // An unpriced category has to 404 rather than serve a thin indexable page
  // claiming the shop sells something it currently cannot sell — and the
  // sitemap agrees, listing only the categories that hold a live product. That
  // used to be its own SELECT in app/shop/[kind]/page.js, run to completion
  // before this render was allowed to start; the product list is the same
  // answer and it is already here. Only a category page 404s this way: an
  // empty /shop is a broken catalogue rather than a missing page, and the grid
  // below says so instead.
  if (active !== 'all' && products.length === 0) notFound();

  // The category being viewed keeps its chip either way, so the row can never
  // lose the item it is highlighting.
  const liveSlugs = new Set(live.map(cat => cat.slug));
  const shown = CATEGORIES.filter(cat => liveSlugs.has(cat.slug) || cat.slug === active);

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
      {/* The path has to carry the category, not the bare word. Nav builds the
          language toggle from it, so a hardcoded "shop" sent someone reading
          /shop/gel to /en/shop - switching language quietly threw away the
          category they were looking at. */}
      <Nav lang={lang} path={active === 'all' ? 'shop' : `shop/${active}`} />

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
        {/* The chips ask for a full prefetch rather than the default one.
            These routes render on demand — app/shop/[kind]/page.js explains
            why — and Next's default prefetch on a dynamic route with no
            loading boundary caches nothing it can navigate with, so the click
            waits out a whole server render before anything moves. A full
            prefetch pulls the entire payload at low priority while the chips
            sit in view and keeps it for five minutes, so the click swaps the
            grid straight out of the client router cache. It costs one
            background request per live category per shop page load, which a
            catalogue of seven can afford and a catalogue of hundreds could
            not. */}
        {/* Every chip carries data-no-transition, which is how
            app/_components/PageWipe.js is told that this row filters the page
            rather than leaving it. Pressing a chip must swap the grid and
            nothing else; a 420ms cover and a 620ms reveal on each one is the
            complaint that got the whole transition deleted once already.

            It is redundant today — PageWipe also skips any navigation that
            starts and ends on a shop path, and these links only ever render on
            one. It is here anyway because that path rule is about where the
            visitor happens to be, and this attribute is about what the control
            is: the row stays a filter even if the rule is ever narrowed. */}
        <div className="chips">
          <Link href={L('/shop')} prefetch data-no-transition=""
            className={active === 'all' ? 'on' : ''}>
            {ar ? 'الكل' : 'All'}
          </Link>
          {shown.map(c => (
            <Link key={c.slug} href={L(shopPath(c.slug))} prefetch data-no-transition=""
              className={active === c.slug ? 'on' : ''}>
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
