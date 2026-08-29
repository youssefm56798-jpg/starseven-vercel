import Link from 'next/link';
import { localeUrl, localePath } from '../../lib/urls.js';
import { notFound } from 'next/navigation';
import { sql } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { bySlug } from '../../lib/hairtypes.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import { imageUrl } from '../../lib/product-image.js';

/**
 * One article, rendered once and mounted at two addresses.
 *
 * /article/<slug> is the Arabic page and /en/article/<slug> the English one.
 * Both are real route files now — the language used to arrive as a query
 * parameter that middleware rewrote onto the Arabic route, which forced every
 * article to read a request-scoped API and so to render on demand.
 *
 * REQUESTED IS NOT RENDERED. The `lang` a route file pins is the language the
 * URL asked for, and this view may legitimately render the other one: an
 * English URL for a piece that only exists in Arabic serves the Arabic row
 * rather than 404-ing. So the language of the page chrome is taken from the row
 * that was actually found, never from the prop. The two names are kept apart
 * below — `want` is what the URL asked for, `lang` is what is being rendered —
 * and every canonical, hreflang, date format and nav label follows `lang`.
 *
 * The underscore in _views is what keeps this file out of the route tree: Next
 * ignores an underscore-prefixed folder when it builds routes, the same
 * convention app/_components uses.
 */

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

/**
 * The slugs to pre-render, shared by both language trees.
 *
 * Each route file exports its own `generateStaticParams` — Next only reads the
 * export, never an import — but the query and, more importantly, its `catch`
 * belong in one place. A build with no DATABASE_URL has to succeed: it returns
 * an empty list and the pages render on request instead. DISTINCT because a
 * slug that exists in both languages is still one route parameter.
 */
export async function articleParams() {
  try {
    const rows = await sql`SELECT DISTINCT slug FROM articles WHERE status = 'published'`;
    return rows.map(r => r.slug).filter(s => typeof s === 'string' && s)
      .map(slug => ({ slug }));
  } catch {
    return [];
  }
}

/**
 * The <head> for one article.
 *
 * `want` is the language the URL asked for; the canonical below follows the row
 * that was found instead, because an English URL serving an Arabic-only article
 * must not canonical itself to an address that does not exist.
 */
export async function articleMetadata(slug, want) {
  const a = await getArticle(slug, want === 'en' ? 'en' : 'ar');
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

/** The jar an article recommends, if it names one and it is still stocked. */
async function loadProduct(sku) {
  if (!sku) return null;
  try {
    const rows = await sql`SELECT * FROM products WHERE sku = ${sku} AND active = true LIMIT 1`;
    return rows[0] || null;
  } catch {
    return null;
  }
}

/** Three more articles in the same language — the way out of a leaf page. */
async function loadMore(slug, lang) {
  try {
    return await sql`
      SELECT slug, title FROM articles
       WHERE status = 'published' AND lang = ${lang} AND slug <> ${slug}
       ORDER BY published_at DESC NULLS LAST, id DESC
       LIMIT 3`;
  } catch {
    return [];
  }
}

/**
 * @param {object} props
 * @param {string} props.slug  the article slug from the route
 * @param {string} props.lang  the language the URL asked for, taken in as
 *   `want` because it is not necessarily the language that gets rendered —
 *   see the fallback described at the top of this file.
 */
export default async function ArticleView({ slug, lang: want }) {
  const a = await getArticle(slug, want === 'en' ? 'en' : 'ar');
  if (!a) notFound();

  // The row that was served decides the language of the page chrome — if only
  // an Arabic version exists, an English URL still renders Arabic content and
  // the nav must say so rather than claim otherwise.
  const lang = a.lang === 'en' ? 'en' : 'ar';
  const L = p => localePath(p, lang);
  const ar = lang === 'ar';

  // A recommended product to close on, when the article names one — and three
  // more to go to next. An article used to end in a single product link or in
  // nothing at all, which made every guide a leaf: traffic that landed on one
  // had one place to go, and the rest of the blog was invisible from it.
  const [prod, more] = await Promise.all([
    loadProduct(a.sku),
    loadMore(a.slug, lang),
  ]);

  // The hair type an article was written for is a page on this site, not a
  // label. Linking it is the only thing tying the blog to the guides.
  const tile = a.hair_type ? bySlug(a.hair_type) : null;

  const published = a.published_at || a.created_at;
  const canonical = localeUrl(`/article/${a.slug}`, lang);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.excerpt,
    image: `${site.url}/${a.cover || 'assets/wax-red.png'}`,
    inLanguage: ar ? 'ar-EG' : 'en',
    datePublished: new Date(published).toISOString(),
    dateModified: new Date(a.updated_at || published).toISOString(),
    author: { '@type': 'Organization', name: a.author || 'New Star Seven' },
    publisher: {
      '@type': 'Organization',
      '@id': `${site.url}/#organization`,
      name: site.name,
      logo: { '@type': 'ImageObject', url: `${site.url}/assets/logo-s7.png` },
    },
    // Was the Arabic URL on both language versions, which told Google the
    // English article was a second copy of the Arabic page.
    mainEntityOfPage: canonical,
  };

  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: ar ? 'الرئيسية' : 'Home', item: localeUrl('/', lang) },
      { '@type': 'ListItem', position: 2, name: ar ? 'مقالات' : 'Articles', item: localeUrl('/blog', lang) },
      { '@type': 'ListItem', position: 3, name: a.title, item: canonical },
    ],
  };

  return (
    <Dir lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbLd).replace(/</g, '\\u003c') }}
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
              <img src={imageUrl(prod.image)} alt={ar ? prod.name_ar : prod.name_en}
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

          {tile && (
            <p className="article-type">
              <Link href={L(`/hair-types/${tile.slug}`)} style={{ '--c': tile.color }}>
                <img src={`/${tile.icon}`} alt="" width="34" height="34" loading="lazy" />
                <span>
                  {ar
                    ? `المقال ده مكتوب للشعر ال${tile.ar.name} — كل تفاصيله هنا ←`
                    : `Written for ${tile.en.name.toLowerCase()} hair — read the full guide →`}
                </span>
              </Link>
            </p>
          )}

          {more.length > 0 && (
            <section className="ht-reads">
              <h2>{ar ? 'اقرأ كمان' : 'Read next'}</h2>
              <ul>
                {more.map(m => (
                  <li key={m.slug}>
                    <Link href={L(`/article/${m.slug}`)}>{m.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
