import LegalPage, { legalMetadata } from '../_components/LegalPage.js';

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  return legalMetadata('terms', sp?.lang === 'en' ? 'en' : 'ar');
}

export default async function Page({ searchParams }) {
  const sp = await searchParams;
  return <LegalPage doc="terms" lang={sp?.lang === 'en' ? 'en' : 'ar'} />;
}
