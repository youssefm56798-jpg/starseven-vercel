import { sql } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { productPublic } from '../../lib/hairtypes.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import CheckoutClient from './CheckoutClient.js';

// Always fresh: prices and stock decide what the customer is about to pay.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'إتمام الطلب',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';

  // Only a well-formed SKU is honoured from the URL.
  const add = /^[A-Za-z0-9-]{1,48}$/.test(sp?.add || '') ? sp.add : '';

  const rows = await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="checkout" />

      <div className="wrap">
        <div className="phead" style={{ padding: '34px 0 0' }}>
          <Crumb
            lang={lang}
            trail={[
              { label: ar ? 'المنتجات' : 'Shop', href: '/shop' },
              { label: ar ? 'إتمام الطلب' : 'Checkout' },
            ]}
          />
          <h1>{ar ? 'إتمام الطلب' : 'Checkout'}</h1>
        </div>

        <CheckoutClient
          lang={lang}
          add={add}
          catalog={rows.map(productPublic)}
          shipping={{ fee: site.shipping, freeOver: site.freeOver }}
          currency={site.currency}
        />
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
