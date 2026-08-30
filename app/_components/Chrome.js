import { cache } from 'react';
import Link from 'next/link';
import { site } from '../../lib/config.js';
import { localePath } from '../../lib/urls.js';
import { sql, hasDb } from '../../lib/db.js';
import { liveCategories } from '../shop/lib.js';
import CartDrawer from './CartDrawer.js';

/**
 * Storefront nav and footer, shared by every server-rendered page.
 *
 * Only real pages appear in the nav — Shop and Articles. Anchors into the
 * landing page were removed because a nav that promises a page and delivers a
 * scroll position is worse than a shorter nav.
 */

/**
 * Page wrapper that carries the language and reading direction.
 *
 * The root layout cannot see `?lang=`, because a layout receives no search
 * params — so <html> stays on the Arabic default and each page states its own
 * direction here. Every `[dir="rtl"]` rule in the stylesheets matches against
 * an ancestor, so they keep working unchanged, and English pages no longer
 * render right-to-left.
 */
export function Dir({ lang = 'ar', children }) {
  const ar = lang === 'ar';
  return (
    <div className="s7page" lang={ar ? 'ar' : 'en'} dir={ar ? 'rtl' : 'ltr'}>
      {/* Every page put its content in a bare div, so there was no main landmark
          and no way past the nav: a keyboard or screen-reader visitor tabbed the
          logo, the shop submenu, three links, the language toggle and the cart
          before reaching a word of the page, on every navigation. */}
      <a className="skip" href="#content">
        {ar ? 'تخطى إلى المحتوى' : 'Skip to content'}
      </a>
      {children}
    </div>
  );
}

export function waLink(text = '') {
  return `https://wa.me/${site.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/**
 * The shop categories the nav and the footer are allowed to offer.
 *
 * The submenu named wax and gel because for a while that was the entire shop.
 * The range is seven categories now and four of them are live, so gel wax and
 * cream gel were reachable only by guessing the URL — the chips on /shop and
 * the sitemap both knew about them and the nav did not.
 *
 * The question asked here is the same one app/shop/view.js asks for its chips
 * and app/sitemap.js asks before listing a page: not what the catalogue holds,
 * but what the client has priced and switched on. An unpriced category is an
 * empty page.
 *
 * cache() so a page that renders both the nav and the footer asks once.
 *
 * The fallback is wax and gel rather than nothing: those two have been live
 * since launch and a transient database error should shorten the menu, not
 * empty it. It is also what a build with no DATABASE_URL renders.
 */
export const shopCategories = cache(async () => {
  if (!hasDb()) return liveCategories(['wax', 'gel']);
  try {
    const rows = await sql`SELECT DISTINCT kind FROM products WHERE active = true`;
    const live = liveCategories(rows.map(r => r.kind));
    return live.length ? live : liveCategories(['wax', 'gel']);
  } catch {
    return liveCategories(['wax', 'gel']);
  }
});

/**
 * The minimum a cart line needs to render: a name in both languages, a price, a
 * picture and somewhere to click through to.
 *
 * cache()d for the same reason shopCategories is - the nav renders on every
 * page, and this must not become one database round-trip per navigation. A
 * failure returns an empty catalogue rather than throwing: the drawer then
 * shows an empty basket, which is wrong but harmless, where a throw would take
 * the whole page down with it.
 */
export const cartCatalogue = cache(async () => {
  if (!hasDb()) return [];
  try {
    return await sql`
      SELECT sku, slug, price, image AS img, name_ar, name_en
        FROM products WHERE active = true`;
  } catch {
    return [];
  }
});

export async function Nav({ lang = 'ar', path = '' }) {
  const ar = lang === 'ar';
  // Every href goes through localePath so the nav can never disagree with the
  // canonical and hreflang tags about what a page's URL is.
  const L = p => localePath(p, lang);
  const other = ar ? 'en' : 'ar';
  const [cats, catalogue] = await Promise.all([shopCategories(), cartCatalogue()]);

  return (
    <nav className="s7nav">
      <div className="wrap inner">
        <Link className="logo" href={L('/')}>
          <img src="/assets/logo-s7.png" alt="New Star Seven" width="123" height="30" />
        </Link>

        {/* Shop carries a submenu of the live categories. CSS-only: :hover for
            pointers, :focus-within so it opens from the keyboard too. It is
            hidden below 900px, where /shop's own chips do the same job. */}
        <div className="nav-links">
          <div className="nav-item has-sub">
            <Link href={L('/shop')} className={path.startsWith('shop') ? 'on' : ''}>
              {ar ? 'المنتجات' : 'Shop'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            {/* The submenu opts out of the page transition, every item of it.
                It lists the same categories the chips on /shop list, under the
                same short labels, and lands on the same screen — so a visitor
                pressing "hair spray" here is filtering the catalogue, and it
                was this control the client named when the transition was
                reported the second time. PageWipe's own shop-to-shop rule
                cannot help: the whole point is that this menu is pressed from
                the home page, an article, a product page.

                "The full line" is included even though it goes to /shop and
                the Shop link above it goes to the same place and does still
                wipe. That looks inconsistent written down and is not in use:
                inside an open dropdown of eight category rows, "The full line"
                is the All position of the picker, and having one row of the
                eight behave differently is the exact seam this attribute
                exists to close. The Shop link itself is a nav destination, and
                keeps the transition. */}
            <div className="nav-sub">
              <Link href={L('/shop')} data-no-transition="">
                {ar ? 'كل التشكيلة' : 'The full line'}
              </Link>
              {cats.map(c => (
                <Link key={c.slug} href={L(`/shop/${c.slug}`)} data-no-transition="">
                  {ar ? c.crumb.ar : c.crumb.en}
                </Link>
              ))}
            </div>
          </div>

          <div className="nav-item">
            <Link href={L('/hair-types')} className={path.startsWith('hair-types') ? 'on' : ''}>
              {ar ? 'نوع شعرك' : 'Hair types'}
            </Link>
          </div>

          {/* The two finders sit next to each other because they are the same
              question asked from two ends: what your hair is, and what you want
              it to look like. No prefix collision to worry about — the active
              check is startsWith on the path string, and "hair-styles" does not
              start with "hair-types". */}
          <div className="nav-item">
            <Link href={L('/hair-styles')} className={path.startsWith('hair-styles') ? 'on' : ''}>
              {ar ? 'ستايلك' : 'Hair styles'}
            </Link>
          </div>

          <div className="nav-item">
            <Link href={L('/blog')} className={path.startsWith('blog') || path.startsWith('article') ? 'on' : ''}>
              {ar ? 'مقالات' : 'Articles'}
            </Link>
          </div>
        </div>

        <div className="nav-right">
          {/* Swap the locale on the page you are actually on, keeping any
              filter. It used to append ?lang= to the path, which on the article
              routes returned the language it claimed to leave. */}
          <Link className="lang-btn" href={localePath('/' + path, other)} hrefLang={other}>
            {ar ? 'EN' : 'عربي'}
          </Link>
          {/* Was a link straight to /checkout. The basket is reviewed in place
              now, so nobody has to commit to the form to find out what they are
              committing to. */}
          <CartDrawer
            catalogue={catalogue.map(p => ({
              sku: p.sku, slug: p.slug, price: Number(p.price), img: p.img,
              ar: { name: p.name_ar }, en: { name: p.name_en },
            }))}
            lang={lang}
            shipping={site.shipping}
            freeOver={site.freeOver}
          />
        </div>
      </div>
    </nav>
  );
}

export async function Footer({ lang = 'ar' }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);
  const cats = await shopCategories();

  return (
    <>
      <footer className="s7foot">
        <div className="wrap">
          <div className="fgrid">
            <div className="fbrand">
              <img src="/assets/logo-s7.png" alt="New Star Seven" width="132" height="32" />
              <p>
                {ar
                  ? 'نيو ستار سفن — منتجات تصفيف شعر الرجال. جودة عالمية، مصنوعة في مصر.'
                  : 'New Star Seven — men’s hair styling, made in Egypt to a world-class standard.'}
              </p>
            </div>

            {/* The range gets its own column rather than two hand-written
                links inside Links. Same source as the nav submenu, so a
                category the client switches on appears in both at once. */}
            <div>
              <h2>{ar ? 'التشكيلة' : 'The range'}</h2>
              {/* Same opt-out as the nav submenu, and for the same reason:
                  this column is the category picker again, just at the bottom
                  of the page and under the long h1 labels instead of the short
                  chip ones. It lands on the identical screen, so it filters.

                  The Links column below is not a picker — it is the site map,
                  and its "The full line" entry sits among Hair types, Articles
                  and the legal pages. That one keeps the transition. */}
              <ul>
                {cats.map(c => (
                  <li key={c.slug}>
                    <Link href={L(`/shop/${c.slug}`)} data-no-transition="">
                      {ar ? c.h1.ar : c.h1.en}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2>{ar ? 'روابط' : 'Links'}</h2>
              <ul>
                <li><Link href={L('/shop')}>{ar ? 'كل المنتجات' : 'The full line'}</Link></li>
                <li><Link href={L('/hair-types')}>{ar ? 'أنواع الشعر' : 'Hair types'}</Link></li>
                <li><Link href={L('/hair-styles')}>{ar ? 'ستايلات الشعر' : 'Hair styles'}</Link></li>
                <li><Link href={L('/blog')}>{ar ? 'مقالات' : 'Articles'}</Link></li>
                <li><Link href={L('/brand')}>{ar ? 'عن البراند' : 'About us'}</Link></li>
                <li><Link href={L('/privacy')}>{ar ? 'سياسة الخصوصية' : 'Privacy'}</Link></li>
                <li><Link href={L('/terms')}>{ar ? 'الشروط والأحكام' : 'Terms'}</Link></li>
              </ul>
            </div>

            <div>
              <h2>{ar ? 'تواصل' : 'Contact'}</h2>
              <ul>
                <li>
                  <a href={waLink()} dir="ltr" target="_blank" rel="noopener">
                    WhatsApp: 01028282216
                  </a>
                </li>
                <li><a href="tel:+201028282216">{ar ? 'اتصل بينا' : 'Call us'}</a></li>
                {/* There are no accounts, so an order is reached through the
                    link in its confirmation email. This is what somebody who
                    cannot find that email types into a search box or scrolls
                    to the bottom of the page looking for. It is the only entry
                    point that is not inside an email, and /order is disallowed
                    in robots.txt, so without it the page is unreachable to
                    anyone who did not land on a broken link first. */}
                <li>
                  <Link href={L('/order/find')}>
                    {ar ? 'تابع أوردرك' : 'Track your order'}
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="fbottom">
            <span>
              © {new Date().getFullYear()}{' '}
              {ar ? 'نيو ستار سفن. كل الحقوق محفوظة.' : 'New Star Seven. All rights reserved.'}
            </span>
          </div>
        </div>
      </footer>

      {/* Support only — ordering happens on the site, not in chat. */}
      <a
        className="wa-float"
        href={waLink(ar ? 'عندي سؤال عن المنتجات' : 'I have a question about your products')}
        target="_blank"
        rel="noopener"
        aria-label={ar ? 'تواصل معنا' : 'Contact us'}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.9-1.4A10 10 0 1 0 12 2Zm5.4 14.1c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.2-3.5-.7-3-1.2-4.9-4.2-5-4.4-.2-.2-1.2-1.6-1.2-3.1s.8-2.2 1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.5c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.2 2.4 1.5 2.7 1.7.3.2.5.1.7-.1l1-1.2c.2-.3.5-.2.8-.1l2 1c.3.2.5.2.6.4 0 .1 0 .7-.2 1.3Z" />
        </svg>
      </a>
    </>
  );
}

/** Breadcrumbs. `trail` is [{label, href}] with the last item usually hrefless. */
export function Crumb({ lang = 'ar', trail = [] }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);
  return (
    <div className="crumb">
      <Link href={L('/')}>{ar ? 'الرئيسية' : 'Home'}</Link>
      {trail.map((t, i) => (
        <span key={i}>
          <span>›</span>
          {t.href ? <Link href={L(t.href)}>{t.label}</Link> : t.label}
        </span>
      ))}
    </div>
  );
}
