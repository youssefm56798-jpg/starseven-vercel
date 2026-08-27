import Link from 'next/link';
import { alternatesForLang, localePath, localeUrl } from '../../lib/urls.js';
import { sql, hasDb } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { productFaq, faqJsonLd } from '../../lib/faq.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';

/**
 * The brand page.
 *
 * Every other page on this site sells a jar. This one answers "who are these
 * people" — the query a customer types before a first order from a name they
 * have not bought from, and the page a search engine reads to decide the site
 * has an organisation behind it rather than a catalogue floating in space.
 *
 * It is also where the Organization and Brand entities belong. They were only
 * on the home page, minimally, with no manufacturer, no contact and nothing
 * tying the products to the brand that makes them.
 *
 * Every claim here is one the client can stand behind: made in Egypt, wax and
 * gel only, cash on delivery, and the delivery figures come from configuration
 * rather than prose. There are no ingredient, safety or results claims — those
 * belong to the manufacturer, not to a website.
 */

export const revalidate = 300;

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  const lang = ar ? 'ar' : 'en';
  return {
    title: ar ? 'عن نيو ستار سفن — واكس وجل شعر مصري' : 'About New Star Seven — Egyptian men’s hair care',
    description: ar
      ? 'نيو ستار سفن براند مصري لواكس وجل شعر الرجالة، من إنتاج أوفانزا كوزمتكس. تشكيلة كاملة من تثبيت متوسط لحد أولترا سترونج، توصيل لكل مصر والدفع عند الاستلام.'
      : 'New Star Seven is an Egyptian men’s hair wax and gel brand, produced by Ovanza Cosmetics. A full range from medium hold to ultra strong, delivered across Egypt, cash on receipt.',
    alternates: alternatesForLang('/brand', lang),
  };
}

async function loadProducts() {
  if (!hasDb()) return [];
  try {
    return await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;
  } catch {
    return [];
  }
}

export default async function BrandPage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const products = await loadProducts();
  const waxes = products.filter(p => p.kind === 'wax').length;
  const gels = products.filter(p => p.kind === 'gel').length;
  const faq = productFaq(lang);

  const brandLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site.url}/#organization`,
    name: site.name,
    alternateName: 'نيو ستار سفن',
    url: site.url,
    logo: `${site.url}/assets/logo-s7.png`,
    description: ar
      ? 'براند مصري لواكس وجل شعر الرجالة، من إنتاج أوفانزا كوزمتكس.'
      : 'An Egyptian men’s hair wax and gel brand, produced by Ovanza Cosmetics.',
    parentOrganization: { '@type': 'Organization', name: 'Ovanza Cosmetics' },
    address: { '@type': 'PostalAddress', addressCountry: 'EG' },
    areaServed: { '@type': 'Country', name: 'Egypt' },
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'customer service',
      telephone: `+${site.whatsapp}`,
      availableLanguage: ['ar', 'en'],
      areaServed: 'EG',
    }],
    brand: {
      '@type': 'Brand',
      '@id': `${site.url}/#brand`,
      name: site.name,
      logo: `${site.url}/assets/logo-s7.png`,
      url: localeUrl('/brand', lang),
    },
  };

  const rangeLd = products.length ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: ar ? 'تشكيلة نيو ستار سفن' : 'The New Star Seven range',
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: localeUrl(`/product/${p.slug}`, lang),
      name: ar ? p.name_ar : p.name_en,
    })),
  } : null;

  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: ar ? 'الرئيسية' : 'Home', item: localeUrl('/', lang) },
      { '@type': 'ListItem', position: 2, name: ar ? 'عن البراند' : 'About', item: localeUrl('/brand', lang) },
    ],
  };

  const ld = j => JSON.stringify(j).replace(/</g, '\\u003c');

  // Only claims the catalogue itself can prove.
  const facts = [
    [ar ? 'مصنوع في' : 'Made in', ar ? 'مصر' : 'Egypt'],
    [ar ? 'الإنتاج' : 'Produced by', 'Ovanza Cosmetics'],
    [ar ? 'التشكيلة' : 'The range',
      ar ? `${waxes} واكس و${gels} جل` : `${waxes} waxes, ${gels} gels`],
    [ar ? 'الدفع' : 'Payment', ar ? 'عند الاستلام' : 'Cash on delivery'],
    [ar ? 'التوصيل' : 'Delivery', ar ? 'كل محافظات مصر' : 'All of Egypt'],
  ];

  return (
    <Dir lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(brandLd) }} />
      {rangeLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(rangeLd) }} />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(crumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(faqJsonLd(faq)) }} />
      <Nav lang={lang} path="brand" />

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'عن البراند' : 'About' }]} />
          <h1>{ar ? 'إحنا مين' : 'Who we are'}</h1>
          <p>
            {ar
              ? 'نيو ستار سفن براند مصري لواكس وجل شعر الرجالة، من إنتاج أوفانزا كوزمتكس. بنعمل حاجة واحدة بس، وبنعملها صح.'
              : 'New Star Seven is an Egyptian men’s hair wax and gel brand, produced by Ovanza Cosmetics. We make one thing, and we make it properly.'}
          </p>
        </div>
      </div>

      <div className="wrap brandpage">
        <section className="brand-sec">
          <h2>{ar ? 'الفكرة' : 'The idea'}</h2>
          <p>
            {ar
              ? 'أغلب اللي بيتباع في السوق واكس واحد لكل الناس. بس الشعر مش واحد: الشعر الناعم المفرود بيقع تحت أي منتج تقيل، والشعر الكثيف بيضحك على أي تركيبة خفيفة. عشان كده التشكيلة كلها ألوان — كل لون تركيبة مختلفة لنوع شعر مختلف، وتثبيت مختلف معاها.'
              : 'Most of what sells here is one wax for everyone. But hair is not one thing: fine straight hair collapses under anything heavy, and thick hair walks straight through a light formula. So the range is built as colours — each colour a different formula, and a different hold, for a different hair type.'}
          </p>
          <p>
            {ar
              ? 'ومش بنبيعك المنتج الغلط عشان نبيع. لو نوع شعرك محتاج حاجة إحنا مش بنعملها، هنقولك كده بالنص في صفحة أنواع الشعر.'
              : 'And we do not sell you the wrong jar to make a sale. If your hair type needs a format we do not make, the hair types page says so in as many words.'}
          </p>
        </section>

        <section className="brand-sec">
          <h2>{ar ? 'الأساسيات' : 'The basics'}</h2>
          <dl className="brand-facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd><bdi>{v}</bdi></dd>
              </div>
            ))}
          </dl>
        </section>

        {products.length > 0 && (
          <section className="brand-sec">
            <h2>{ar ? 'التشكيلة كلها' : 'The whole range'}</h2>
            <ul className="brand-range">
              {products.map(p => (
                <li key={p.sku} style={{ '--c': p.color }}>
                  <Link href={L(`/product/${p.slug}`)}>
                    <img src={`/${p.image}`} alt={ar ? p.name_ar : p.name_en}
                      width="88" height="88" loading="lazy" />
                    <span>
                      <b>{ar ? p.name_ar : p.name_en}</b>
                      <small>{ar ? p.sub_ar : p.sub_en}</small>
                    </span>
                    <bdi>{whole(p.price)} <small>{currencyLabel(lang)}</small></bdi>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="brand-cta">
              <Link className="btn btn-red" href={L('/shop')}>
                {ar ? 'كل التشكيلة ←' : 'Shop the range →'}
              </Link>
              <Link className="btn btn-line" href={L('/hair-types')}>
                {ar ? 'اعرف نوع شعرك ←' : 'Find your hair type →'}
              </Link>
            </p>
          </section>
        )}

        <section className="brand-sec">
          <h2>{ar ? 'أسئلة قبل أول أوردر' : 'Before your first order'}</h2>
          <div className="ht-faq">
            {faq.map((f, i) => (
              <details key={i} open={i === 0}>
                <summary>{f.q}</summary>
                <div>{f.a}</div>
              </details>
            ))}
          </div>
        </section>

        <section className="brand-sec">
          <h2>{ar ? 'تكلمنا إزاي' : 'Talking to us'}</h2>
          <p>
            {ar
              ? 'أسرع طريقة هي الواتساب — بنرد على نفس الرقم اللي بنأكد بيه الأوردرات.'
              : 'WhatsApp is the fastest way — the same number we confirm orders on.'}
          </p>
          <p className="brand-cta">
            <a className="btn btn-ink" href={`https://wa.me/${site.whatsapp}`} target="_blank" rel="noopener">
              <bdi dir="ltr">+{site.whatsapp}</bdi>
            </a>
          </p>
        </section>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
