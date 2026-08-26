import { alternatesForLang } from '../../../lib/urls.js';
import { Dir, Nav, Footer } from '../../_components/Chrome.js';
import AuthForm from '../AuthForm.js';

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const ar = sp?.lang !== 'en';
  return {
    title: ar ? 'اعمل حساب' : 'Create an account',
    description: ar
      ? 'اعمل حساب نيو ستار سفن: سلة واحدة على كل أجهزتك، ومتابعة لأوردراتك.'
      : 'Create a New Star Seven account: one basket across your devices, and your order history.',
    robots: { index: false, follow: true },
    alternates: alternatesForLang('/account/register', ar ? 'ar' : 'en'),
  };
}

export default async function RegisterPage({ searchParams }) {
  const sp = await searchParams;
  const lang = sp?.lang === 'en' ? 'en' : 'ar';
  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="account/register" />
      <div className="wrap authwrap"><AuthForm lang={lang} mode="register" /></div>
      <Footer lang={lang} />
    </Dir>
  );
}
