import LegalPage, { legalMetadata } from '../_components/LegalPage.js';

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  return legalMetadata('privacy', sp?.lang === 'en' ? 'en' : 'ar');
}

export default async function Page({ searchParams }) {
  const sp = await searchParams;
  return <LegalPage doc="privacy" lang={sp?.lang === 'en' ? 'en' : 'ar'} />;
}
