import { alternatesForLang } from '../../../lib/urls.js';
import { Dir, Nav, Footer } from '../../_components/Chrome.js';
import AuthForm from '../AuthForm.js';

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  return {
    title: ar ? 'ادخل على حسابك' : 'Sign in',
    description: ar
      ? 'ادخل على حساب نيو ستار سفن عشان سلتك تفضل معاك وتتابع أوردراتك.'
      : 'Sign in to your New Star Seven account to keep your basket and track your orders.',
    // A sign-in form has nothing to rank for and should not compete with the
    // shop for crawl budget.
    robots: { index: false, follow: true },
    alternates: alternatesForLang('/account/login', ar ? 'ar' : 'en'),
  };
}

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="account/login" />
      <div className="wrap authwrap"><AuthForm lang={lang} mode="login" /></div>
      <Footer lang={lang} />
    </Dir>
  );
}
