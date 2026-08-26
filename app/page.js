import { sql, hasDb } from '../lib/db.js';
import { alternatesForLang } from '../lib/urls.js';
import { site } from '../lib/config.js';
import { HAIR_TYPES, productPublic } from '../lib/hairtypes.js';
import { Dir, Nav, Footer } from './_components/Chrome.js';
import Landing from './_components/Landing.js';
import './landing.css';

export const revalidate = 60;

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  const lang = ar ? 'ar' : 'en';
  return {
    title: ar ? 'نيو ستار سفن — امسك ستايلك' : 'New Star Seven — Hold your style',
    // Without its own description this page inherited the Arabic default in
    // app/layout.js, so the English home served an Arabic snippet.
    description: ar
      ? 'واكس وجل شعر بريميوم للرجالة، مصنوع في مصر. تثبيت ميجا من الصبح لآخر اليوم، من غير قشرة ومن غير دهون. اطلب أونلاين والدفع عند الاستلام.'
      : 'Premium men’s hair wax and gel, made in Egypt. Mega hold from morning to night, no flakes and no grease. Order online, cash on delivery.',
    alternates: alternatesForLang('/', lang),
  };
}

export default async function HomePage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';

  // No DATABASE_URL means someone is working on layout without a database, so
  // render an empty grid rather than crash. A query that genuinely fails is a
  // different matter and is left to throw: the page is revalidated on a timer,
  // so Next serves the last good copy instead of an empty catalogue.
  let products = [];
  if (hasDb()) {
    const rows = await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;
    products = rows.map(productPublic);
  }

  const organisation = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    url: site.url,
    logo: `${site.url}/assets/logo-s7.png`,
  };

  return (
    <Dir lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organisation).replace(/</g, '\\u003c') }}
      />
      <Nav lang={lang} path="" />
      <Landing
        lang={lang}
        products={products}
        hairTypes={HAIR_TYPES}
        shipping={site.shipping}
        freeOver={site.freeOver}
      />
      <Footer lang={lang} />
    </Dir>
  );
}
