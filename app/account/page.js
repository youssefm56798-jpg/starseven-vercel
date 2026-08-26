import { redirect } from 'next/navigation';
import { sql } from '../../lib/db.js';
import { alternatesForLang, localePath } from '../../lib/urls.js';
import { currentUser, publicUser } from '../../lib/customer-auth.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import AccountActions from './AccountActions.js';

// The page is per-customer, so it can never be cached or statically rendered.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  return {
    title: ar ? 'حسابي' : 'My account',
    robots: { index: false, follow: false },
    alternates: alternatesForLang('/account', ar ? 'ar' : 'en'),
  };
}

export default async function AccountPage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  // Identity from the verified token, never from the URL.
  const session = await currentUser();
  if (!session) redirect(L('/account/login'));

  const rows = await sql`
    SELECT id, email, name, phone, token_version, created_at
      FROM users WHERE id = ${session.id} LIMIT 1`;

  // The account was signed out everywhere since this token was minted, or
  // deleted outright. Either way this token is stale.
  if (!rows[0] || Number(rows[0].token_version) !== Number(session.tokenVersion)) {
    redirect(L('/account/login'));
  }
  const user = publicUser(rows[0]);

  // Orders are filtered by the session user. There is no order id or customer
  // parameter on this page, so one customer cannot ask for another's history.
  const orders = await sql`
    SELECT ref, total, status, created_at
      FROM orders WHERE user_id = ${session.id}
     ORDER BY created_at DESC LIMIT 20`;

  const STATUS = {
    new: ar ? 'جديد' : 'New',
    confirmed: ar ? 'مأكد' : 'Confirmed',
    shipped: ar ? 'في الطريق' : 'Shipped',
    delivered: ar ? 'اتسلّم' : 'Delivered',
    cancelled: ar ? 'اتلغى' : 'Cancelled',
  };

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="account" />

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'حسابي' : 'My account' }]} />
          <h1>{user.name || (ar ? 'حسابي' : 'My account')}</h1>
          <p><bdi dir="ltr">{user.email}</bdi></p>
        </div>
      </div>

      <div className="wrap authwrap">
        <section className="acct-sec">
          <h2>{ar ? 'أوردراتك' : 'Your orders'}</h2>
          {orders.length === 0 ? (
            <p className="acct-empty">
              {ar
                ? 'لسه مفيش أوردرات على الحساب ده.'
                : 'No orders on this account yet.'}
            </p>
          ) : (
            <ul className="acct-orders">
              {orders.map(o => (
                <li key={o.ref}>
                  <b dir="ltr">{o.ref}</b>
                  <span>{STATUS[o.status] || o.status}</span>
                  <bdi>{whole(o.total)} <small>{currencyLabel(lang)}</small></bdi>
                  <time dateTime={new Date(o.created_at).toISOString()}>
                    {new Date(o.created_at).toLocaleDateString(ar ? 'ar-EG' : 'en-GB',
                      { day: 'numeric', month: 'short', year: 'numeric' })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <AccountActions lang={lang} />
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
