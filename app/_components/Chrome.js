import Link from 'next/link';
import { site } from '../../lib/config.js';
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
  const q = ar ? '' : '?lang=en';
  const other = ar ? 'en' : 'ar';
  const sep = path.includes('?') ? '&' : '?';

  return (
    <nav className="s7nav">
      <div className="wrap inner">
        <Link className="logo" href={ar ? '/' : '/?lang=en'}>
          <img src="/assets/logo-s7.png" alt="New Star Seven" width="120" height="30" />
        </Link>

        <div className="nav-links">
          <Link href={`/shop${q}`}>{ar ? 'المنتجات' : 'Shop'}</Link>
          <Link href={`/blog${q}`}>{ar ? 'مقالات' : 'Articles'}</Link>
        </div>

        <div className="nav-right">
          <Link className="lang-btn" href={`/${path}${sep}lang=${other}`}>
            {ar ? 'EN' : 'عربي'}
          </Link>
          <Link className="cart-link" href={`/checkout${q}`} aria-label={ar ? 'السلة' : 'Cart'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M3 4h2.2l2 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.55L20.7 8H6.2"
                strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="10" cy="20" r="1.4" /><circle cx="17.5" cy="20" r="1.4" />
            </svg>
            <CartBadge />
          </Link>
          <Link className="nav-order" href={`/shop${q}`}>{ar ? 'اطلب دلوقتي' : 'Shop now'}</Link>
        </div>
      </div>
    </nav>
  );
}

export function Footer({ lang = 'ar' }) {
  const ar = lang === 'ar';
  const q = ar ? '' : '?lang=en';

  return (
    <>
      <footer className="s7foot">
        <div className="wrap">
          <div className="fgrid">
            <div className="fbrand">
              <img src="/assets/logo-s7.png" alt="New Star Seven" width="120" height="32" />
              <p>
                {ar
                  ? 'نيو ستار سفن — منتجات تصفيف شعر الرجال. جودة عالمية، مصنوعة في مصر.'
                  : 'New Star Seven — men’s hair styling, made in Egypt to a world-class standard.'}
              </p>
            </div>

            <div>
              <h5>{ar ? 'روابط' : 'Links'}</h5>
              <ul>
                <li><Link href={`/shop${q}`}>{ar ? 'المنتجات' : 'Shop'}</Link></li>
                <li><Link href={`/blog${q}`}>{ar ? 'مقالات' : 'Articles'}</Link></li>
                <li><Link href={`/privacy${q}`}>{ar ? 'سياسة الخصوصية' : 'Privacy'}</Link></li>
                <li><Link href={`/terms${q}`}>{ar ? 'الشروط والأحكام' : 'Terms'}</Link></li>
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
  const q = ar ? '' : '?lang=en';
  return (
    <div className="crumb">
      <Link href={ar ? '/' : '/?lang=en'}>{ar ? 'الرئيسية' : 'Home'}</Link>
      {trail.map((t, i) => (
        <span key={i}>
          <span>›</span>
          {t.href ? <Link href={`${t.href}${q}`}>{t.label}</Link> : t.label}
        </span>
      ))}
    </div>
  );
}
