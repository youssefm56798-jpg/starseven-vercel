import Link from 'next/link';
import { alternatesForLang, localePath } from '../../lib/urls.js';
import { sql, hasDb } from '../../lib/db.js';
import { bySlug } from '../../lib/hairtypes.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';

/**
 * The article index, rendered once and mounted at both addresses.
 *
 * This body used to sit in app/blog/page.js and take its language from
 * `searchParams`, because middleware rewrote /en/blog onto /blog?lang=en and
 * that query string was the only channel carrying the locale into the page.
 * Reading it cost the page its prerender: `searchParams` is a dynamic API, so
 * awaiting it opted the route out of static generation and zeroed the
 * `revalidate` window on the way out. Now that /en is a real path segment there
 * are two route files, each handing this view its own language as a constant.
 *
 * The language is not only chrome here — it is a WHERE clause. Articles are
 * stored one row per language, so the constant the route file passes decides
 * which set of posts this page lists at all.
 */

/** Title, description and hreflang alternates for one language of the index. */
export function blogMeta(lang) {
  const ar = lang !== 'en';
  return {
    title: ar ? 'مقالات ونصايح العناية بشعر الرجالة' : 'Hair Care Guides & Styling Tips for Men',
    description: ar
      ? 'نصايح تصفيف وعناية شعر الرجال: أنهي منتج لنوع شعرك، إزاي تحطه صح، وإزاي يقعد طول اليوم.'
      : 'Men’s hair styling and care guides: which product suits your hair, how to apply it, and how to make it last.',
    alternates: alternatesForLang('/blog', ar ? 'ar' : 'en'),
  };
}

export default async function BlogView({ lang }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  // Unknown or empty values render no chip at all rather than a raw slug.
  const tagLabel = slug => {
    const t = slug ? bySlug(slug) : null;
    return t ? (ar ? t.ar.name : t.en.name) : null;
  };

  // Same reason as app/shop/view.js: this page prerenders now, so an unguarded
  // query is a failed build rather than a failed request.
  const posts = hasDb()
    ? await sql`
        SELECT slug, title, excerpt, cover, cover_alt, hair_type, published_at
          FROM articles
         WHERE status = 'published' AND lang = ${lang}
         ORDER BY published_at DESC NULLS LAST, id DESC
         LIMIT 60`
    : [];

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="blog" />
      <main id="content">

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} schema trail={[{ label: ar ? 'مقالات' : 'Articles' }]} />
          <h1>{ar ? 'مقالات العناية بالشعر' : 'Hair care guides'}</h1>
          <p>
            {ar
              ? 'كل اللي محتاج تعرفه عن شعرك — من اختيار المنتج لحد الروتين اليومي.'
              : 'Everything you need to know about your hair — from picking a product to the daily routine.'}
          </p>
          <div className="phead-cta">
            <Link className="btn btn-red" href={L('/shop')}>
              {ar ? 'اتفرج على المنتجات' : 'Shop the range'}
            </Link>
          </div>
        </div>
      </div>

      <div className="wrap">
        {posts.length === 0 ? (
          <div className="empty-note">
            {ar ? 'المقالات في الطريق قريب.' : 'Articles are on the way.'}
          </div>
        ) : (
          <div className="bloglist">
            {posts.map(a => (
              <Link className="acard" key={a.slug} href={L(`/article/${a.slug}`)}>
                {a.cover && (
                  <div className="cov">
                    <img src={`/${a.cover}`} alt={a.cover_alt || a.title} loading="lazy"
                      width="480" height="300" />
                  </div>
                )}
                <div className="body">
                  {/* The column stores a slug. Rendering it raw put "THICK"
                      and "WAVY" — Latin, uppercased by the stylesheet — on
                      Arabic cards. It is a hair type, so it has a name in
                      both languages already. */}
                  {tagLabel(a.hair_type) && <span className="tag">{tagLabel(a.hair_type)}</span>}
                  <h2>{a.title}</h2>
                  <p>{a.excerpt}</p>
                  <span className="more">{ar ? 'اقرأ ←' : 'Read →'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      </main>
      <Footer lang={lang} />
    </Dir>
  );
}
