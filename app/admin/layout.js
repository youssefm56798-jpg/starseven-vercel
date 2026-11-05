import { localizedAdminMetadata } from "./_lib/locale-server.js";
import './admin.css';
import { cookies } from 'next/headers';
import { ADMIN_LANGUAGE_COOKIE,adminLanguage } from '../../lib/admin-copy.mjs';
import { AdminLocaleProvider } from './_lib/locale.js';

/**
 * Outer admin shell. Deliberately does NOT check the session: /admin/login and
 * /admin/setup live underneath it and have to stay reachable when signed out.
 * The guard sits in the (panel) group layout instead.
 *
 * No <html>/<body> here — the root layout owns those. The wrapper forces LTR
 * because the storefront around it is Arabic and right-to-left.
 */
export async function generateMetadata(){return localizedAdminMetadata({
  title: 'Star Seven admin',
  robots: { index: false, follow: false },
});}

export default async function AdminLayout({ children }) {
  const lang=adminLanguage((await cookies()).get(ADMIN_LANGUAGE_COOKIE)?.value);
  return (
    <AdminLocaleProvider lang={lang}>{children}</AdminLocaleProvider>
  );
}
