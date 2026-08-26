import Link from 'next/link';
import { alternatesForLang, localePath } from '../../lib/urls.js';
import { sql } from '../../lib/db.js';
import { bySlug } from '../../lib/hairtypes.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';

export const revalidate = 300;

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  const lang = ar ? 'ar' : 'en';
  return {
    title: ar ? 'مقالات العناية بالشعر' : 'Hair care guides',
    description: ar
      ? 'نصايح تصفيف وعناية شعر الرجال: أنهي منتج لنوع شعرك، إزاي تحطه صح، وإزاي يقعد طول اليوم.'
      : 'Men’s hair styling and care guides: which product suits your hair, how to apply it, and how to make it last.',
    alternates: alternatesForLang('/blog', lang),
  };
}

export default async function BlogPage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  // Unknown or empty values render no chip at all rather than a raw slug.
  const tagLabel = slug => {
    const t = slug ? bySlug(slug) : null;
    return t ? (ar ? t.ar.name : t.en.name) : null;
  };

  const posts = await sql`
    SELECT slug, title, excerpt, cover, cover_alt, hair_type, published_at
      FROM articles
     WHERE status = 'published' AND lang = ${lang}
     ORDER BY published_at DESC NULLS LAST, id DESC
     LIMIT 60`;

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="blog" />

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'مقالات' : 'Articles' }]} />
          <h1>{ar ? 'مقالات العناية بالشعر' : 'Hair care guides'}</h1>
          <p>
            {ar
              ? 'كل اللي محتاج تعرفه عن شعرك — من اختيار المنتج لحد الروتين اليومي.'
              : 'Everything you need to know about your hair — from picking a product to the daily routine.'}
          </p>
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
                  <h3>{a.title}</h3>
                  <p>{a.excerpt}</p>
                  <span className="more">{ar ? 'اقرأ ←' : 'Read →'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
