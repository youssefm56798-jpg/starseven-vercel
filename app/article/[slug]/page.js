import Link from 'next/link';
import { localeUrl, localePath } from '../../../lib/urls.js';
import { notFound } from 'next/navigation';
import { sql } from '../../../lib/db.js';
import { site } from '../../../lib/config.js';
import { currencyLabel, whole } from '../../../lib/money.js';
import { renderMarkdown } from '../../../lib/markdown.js';
import { Dir, Nav, Footer, Crumb } from '../../_components/Chrome.js';

export const revalidate = 300;

async function getArticle(slug) {
  const rows = await sql`
    SELECT * FROM articles WHERE slug = ${slug} AND status = 'published' LIMIT 1`;
  return rows[0] || null;
}

export async function generateStaticParams() {
  try {
    const rows = await sql`SELECT slug FROM articles WHERE status = 'published'`;
    return rows.map(r => ({ slug: r.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) return { title: 'Article not found', robots: { index: false } };

  return {
    title: a.meta_title || a.title,
    description: a.meta_desc || a.excerpt,
    // An article exists in one language per row, so it self-canonicals at its
    // own language's URL rather than claiming a twin it cannot name. Pairing
    // AR and EN needs the twin's slug; the schema tracks that in group_key and
    // nothing reads it yet.
    alternates: { canonical: localeUrl(`/article/${a.slug}`, a.lang === 'en' ? 'en' : 'ar') },
    openGraph: {
      type: 'article',
      title: a.title,
      description: a.excerpt,
      images: [a.cover ? `/${a.cover}` : '/assets/wax-red.png'],
    },
  };
}

export default async function ArticlePage({ params }) {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) notFound();

  // The article's own language wins over any ?lang on the URL.
  const lang = a.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';

  // A recommended product to close on, when the article names one.
  const prod = a.sku
    ? (await sql`SELECT * FROM products WHERE sku = ${a.sku} AND active = true LIMIT 1`)[0]
    : null;

  const published = a.published_at || a.created_at;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.excerpt,
    image: `${site.url}/${a.cover || 'assets/wax-red.png'}`,
    datePublished: new Date(published).toISOString(),
    dateModified: new Date(a.updated_at || published).toISOString(),
    author: { '@type': 'Organization', name: a.author || 'New Star Seven' },
    publisher: {
      '@type': 'Organization',
      name: 'New Star Seven',
      logo: { '@type': 'ImageObject', url: `${site.url}/assets/logo-s7.png` },
    },
    mainEntityOfPage: `${site.url}/article/${a.slug}`,
  };

  return (
    <Dir lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <Nav lang={lang} path={`article/${a.slug}`} />

      <div className="wrap">
        <article className="article">
          <div style={{ marginTop: '34px' }}>
            <Crumb
              lang={lang}
              trail={[{ label: ar ? 'مقالات' : 'Articles', href: '/blog' }, { label: a.title }]}
            />
          </div>

          <div className="meta">
            {new Date(published).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}{' '}
            · {a.author || 'New Star Seven'}
          </div>

          <h1 className="phead" style={{ padding: 0, fontSize: 'clamp(28px,5vw,44px)' }}>
            {a.title}
          </h1>

          {a.cover ? (
            <div className="cov">
              <img src={`/${a.cover}`} alt={a.cover_alt || a.title} width="900" height="500" />
            </div>
          ) : (
            <div style={{ height: 20 }} />
          )}

          {/* Body is Markdown rendered through an escape-first whitelist —
              see lib/markdown.js. Raw HTML in an article is shown, not run. */}
          <div
            className="prose"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body) }}
          />

          {prod && (
            <div className="article-cta">
              <img src={`/${prod.image}`} alt={ar ? prod.name_ar : prod.name_en}
                width="96" height="96" />
              <div className="t">
                <h4>{ar ? prod.name_ar : prod.name_en}</h4>
                <p>
                  {ar ? prod.sub_ar : prod.sub_en} · {whole(prod.price)} {currencyLabel(lang)}
                </p>
              </div>
              <Link className="btn btn-red" href={L(`/product/${prod.slug}`)}>
                {ar ? 'شوف المنتج' : 'View product'}
              </Link>
            </div>
          )}
        </article>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
