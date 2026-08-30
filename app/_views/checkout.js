import { sql } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel } from '../../lib/money.js';
import { productPublic } from '../../lib/hairtypes.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import CheckoutClient from '../checkout/CheckoutClient.js';

/**
 * The checkout, rendered once and mounted at /checkout and /en/checkout.
 *
 * This page stays dynamic, and that is not an oversight left over from the
 * locale migration. It reads `?add=` so a product page's Add button can put a
 * SKU straight into the cart, and it queries live prices and stock to show the
 * customer what they are about to pay. Neither survives being prerendered.
 * What the migration changes here is narrower than elsewhere: the LANGUAGE
 * stops coming from `?lang=` and becomes a constant in each of the two route
 * files, while `searchParams` stays exactly where it was. tests/render-mode
 * exempts both checkout routes from its no-searchParams rule for this reason.
 *
 * It exists as a view because the two route files must not drift. They are
 * four lines each and both spell out `force-dynamic`; the markup, the query
 * and the SKU validation live here so there is only ever one of them.
 */

export default async function CheckoutView({ lang, searchParams }) {
  const ar = lang === 'ar';

  // The route files hand this promise straight through rather than awaiting it
  // themselves, so there is one place that decides what this page reads out of
  // the request and no way for the two of them to disagree about it.
  const sp = await searchParams;

  // Only a well-formed SKU is honoured from the URL.
  const add = /^[A-Za-z0-9-]{1,48}$/.test(sp?.add || '') ? sp.add : '';

  const rows = await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="checkout" />
      <main id="content">

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
          currency={currencyLabel(lang)}
        />
      </div>

      </main>
      <Footer lang={lang} />
    </Dir>
  );
}
