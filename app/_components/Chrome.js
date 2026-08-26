import Link from 'next/link';
import { site } from '../../lib/config.js';
import { localePath } from '../../lib/urls.js';
import CartBadge from './CartBadge.js';

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
      {children}
    </div>
  );
}

export function waLink(text = '') {
  return `https://wa.me/${site.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function Nav({ lang = 'ar', path = '' }) {
  const ar = lang === 'ar';
  // Every href goes through localePath so the nav can never disagree with the
  // canonical and hreflang tags about what a page's URL is.
  const L = p => localePath(p, lang);
  const other = ar ? 'en' : 'ar';

  return (
    <nav className="s7nav">
      <div className="wrap inner">
        <Link className="logo" href={L('/')}>
          <img src="/assets/logo-s7.png" alt="New Star Seven" width="123" height="30" />
        </Link>

        {/* Shop carries a submenu because the two formats are the split
            customers actually shop by. CSS-only: :hover for pointers,
            :focus-within so it opens from the keyboard too. */}
        <div className="nav-links">
          <div className="nav-item has-sub">
            <Link href={L('/shop')} className={path.startsWith('shop') ? 'on' : ''}>
              {ar ? 'المنتجات' : 'Shop'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <div className="nav-sub">
              <Link href={L('/shop')}>{ar ? 'كل التشكيلة' : 'The full line'}</Link>
              <Link href={L('/shop/wax')}>{ar ? 'واكس' : 'Wax'}</Link>
              <Link href={L('/shop/gel')}>{ar ? 'جل' : 'Gel'}</Link>
            </div>
          </div>

          <div className="nav-item">
            <Link href={L('/hair-types')} className={path.startsWith('hair-types') ? 'on' : ''}>
              {ar ? 'نوع شعرك' : 'Hair types'}
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
          <Link className="cart-link" href={L('/checkout')} aria-label={ar ? 'السلة' : 'Cart'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M3 4h2.2l2 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.55L20.7 8H6.2"
                strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="10" cy="20" r="1.4" /><circle cx="17.5" cy="20" r="1.4" />
            </svg>
            <CartBadge />
          </Link>
          {/* Points at /account either way. The page itself decides whether
              that means the profile or the sign-in form, because only the
              server can verify the session cookie — guessing here would show a
              signed-out link to a signed-in customer on a cached page. */}
          <Link className="acct-link" href={L('/account')}
            aria-label={ar ? 'حسابي' : 'My account'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="8" r="3.6" />
              <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" strokeLinecap="round" />
            </svg>
          </Link>
          <Link className="nav-order" href={L('/shop')}>{ar ? 'اطلب دلوقتي' : 'Shop now'}</Link>
        </div>
      </div>
    </nav>
  );
}

export function Footer({ lang = 'ar' }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

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

            <div>
              <h5>{ar ? 'روابط' : 'Links'}</h5>
              <ul>
                <li><Link href={L('/shop')}>{ar ? 'المنتجات' : 'Shop'}</Link></li>
                <li><Link href={L('/shop/wax')}>{ar ? 'واكس الشعر' : 'Hair wax'}</Link></li>
                <li><Link href={L('/shop/gel')}>{ar ? 'جل الشعر' : 'Hair gel'}</Link></li>
                <li><Link href={L('/hair-types')}>{ar ? 'أنواع الشعر' : 'Hair types'}</Link></li>
                <li><Link href={L('/blog')}>{ar ? 'مقالات' : 'Articles'}</Link></li>
                <li><Link href={L('/brand')}>{ar ? 'عن البراند' : 'About us'}</Link></li>
                <li><Link href={L('/account')}>{ar ? 'حسابي' : 'My account'}</Link></li>
                <li><Link href={L('/privacy')}>{ar ? 'سياسة الخصوصية' : 'Privacy'}</Link></li>
                <li><Link href={L('/terms')}>{ar ? 'الشروط والأحكام' : 'Terms'}</Link></li>
              </ul>
            </div>

            <div>
              <h5>{ar ? 'تواصل' : 'Contact'}</h5>
              <ul>
                <li>
                  <a href={waLink()} dir="ltr" target="_blank" rel="noopener">
                    WhatsApp: 01028282216
                  </a>
                </li>
                <li><a href="tel:+201028282216">{ar ? 'اتصل بينا' : 'Call us'}</a></li>
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
