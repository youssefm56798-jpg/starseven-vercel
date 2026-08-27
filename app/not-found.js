import Link from 'next/link';
import { localePath } from '../lib/urls.js';

/**
 * The 404 page.
 *
 * Next's default is an unbranded English-only black screen with no way back —
 * which is where every mistyped URL, every stale link and every notFound() call
 * on this site was landing, on a shop that is otherwise entirely Arabic.
 *
 * It renders in Arabic, which is the site's default language and its
 * unprefixed tree.
 */
export default function NotFound() {
  // Hardcoded, for the same reason app/layout.js hardcodes its lang: this used
  // to read the x-s7-lang header, which meant `await headers()`, and that
  // dynamic API is what stops this page — and, from the root layout, every
  // other page — from ever being prerendered. These two files were the only
  // consumers of that header; middleware still sets it, and nothing reads it.
  //
  // The cost is that a mistyped English URL now gets the Arabic 404. The
  // English copy below is kept rather than deleted because it is still the
  // right copy — it just needs a route that can select it, which arrives when
  // the English tree becomes a real path segment and can carry its own
  // not-found.js.
  const lang = 'ar';
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  return (
    <div className="s7page" lang={ar ? 'ar' : 'en'} dir={ar ? 'rtl' : 'ltr'}>
      <div className="wrap nf">
        <div className="nf-code" aria-hidden="true">404</div>
        <h1>{ar ? 'الصفحة دي مش موجودة' : 'This page does not exist'}</h1>
        <p>
          {ar
            ? 'يمكن اللينك قديم، أو فيه حرف ناقص. الحاجات اللي تحت هي اللي أغلب الناس بتدور عليها.'
            : 'The link may be old, or a character may be missing. Most people are looking for one of these.'}
        </p>

        <div className="nf-links">
          <Link className="btn btn-red" href={L('/shop')}>
            {ar ? 'كل المنتجات' : 'Shop the range'}
          </Link>
          <Link className="btn btn-line" href={L('/hair-types')}>
            {ar ? 'اعرف نوع شعرك' : 'Find your hair type'}
          </Link>
        </div>

        <p className="nf-more">
          <Link href={L('/')}>{ar ? 'الرئيسية' : 'Home'}</Link>
          <span aria-hidden="true"> · </span>
          <Link href={L('/blog')}>{ar ? 'مقالات' : 'Articles'}</Link>
        </p>
      </div>
    </div>
  );
}
