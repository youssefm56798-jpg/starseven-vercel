import Link from 'next/link';
import { localeUrl, localePath } from '../../../lib/urls.js';
import { notFound } from 'next/navigation';
import { sql } from '../../../lib/db.js';
import { site } from '../../../lib/config.js';
import { currencyLabel, whole } from '../../../lib/money.js';
import { renderMarkdown } from '../../../lib/markdown.js';
import { Dir, Nav, Footer, Crumb } from '../../_components/Chrome.js';

export const revalidate = 300;

/**
 * An article and its translation share a slug and differ by language, so the
 * URL decides which row to serve: /article/wax-or-gel is Arabic and
 * /en/article/wax-or-gel is English.
 *
 * If the requested language has no translation, fall back to whichever version
 * exists rather than 404-ing — a reader who followed an English link to an
 * Arabic-only piece should still get the piece.
 */
async function getArticle(slug, lang) {
  const rows = await sql`
    SELECT * FROM articles WHERE slug = ${slug} AND status = 'published'`;
  // Preferring the requested language is a two-row decision, so it is made
  // here rather than as an ORDER BY expression — the same call made on the
  // product page, and for the same reason: a plain pick is easier to be sure of.
  return rows.find(r => r.lang === lang) || rows[0] || null;
}

/** Every language a given slug exists in, for hreflang and the toggle. */
async function twinLangs(slug) {
  try {
    const rows = await sql`
      SELECT lang FROM articles WHERE slug = ${slug} AND status = 'published'`;
    return rows.map(r => r.lang);
  } catch {
    return [];
  }
}

export async function generateStaticParams() {
  try {
    const rows = await sql`SELECT DISTINCT slug FROM articles WHERE status = 'published'`;
    return rows.map(r => r.slug).filter(s => typeof s === 'string' && s)
      .map(slug => ({ slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const want = sp?.lang === 'en' ? 'en' : 'ar';
  const a = await getArticle(slug, want);
  if (!a) return { title: 'Article not found', robots: { index: false } };

  // Only declare an alternate for a language this article actually exists in.
  // Pointing hreflang at a translation that is not there is worse than
  // declaring nothing: it sends Google to a URL that serves the other language.
  const langs = await twinLangs(slug);
  const languages = {};
  if (langs.includes('ar')) {
    languages['ar-EG'] = localeUrl(`/article/${slug}`, 'ar');
    languages.ar = localeUrl(`/article/${slug}`, 'ar');
  }
  if (langs.includes('en')) {
    languages['en-EG'] = localeUrl(`/article/${slug}`, 'en');
    languages.en = localeUrl(`/article/${slug}`, 'en');
  }
  languages['x-default'] = localeUrl(`/article/${slug}`, langs.includes('ar') ? 'ar' : 'en');

  return {
    title: a.meta_title || a.title,
    description: a.meta_desc || a.excerpt,
    alternates: {
      canonical: localeUrl(`/article/${slug}`, a.lang === 'en' ? 'en' : 'ar'),
      languages,
    },
    openGraph: {
      type: 'article',
      title: a.title,
      description: a.excerpt,
      images: [a.cover ? `/${a.cover}` : '/assets/wax-red.png'],
    },
  };
}

export default async function ArticlePage({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const a = await getArticle(slug, sp?.lang === 'en' ? 'en' : 'ar');
  if (!a) notFound();

  // The row that was served decides the language of the page chrome — if only
  // an Arabic version exists, an English URL still renders Arabic content and
  // the nav must say so rather than claim otherwise.
  const lang = a.lang === 'en' ? 'en' : 'ar';
  const L = p => localePath(p, lang);
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
