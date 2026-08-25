import './admin.css';

/**
 * Outer admin shell. Deliberately does NOT check the session: /admin/login and
 * /admin/setup live underneath it and have to stay reachable when signed out.
 * The guard sits in the (panel) group layout instead.
 *
 * No <html>/<body> here — the root layout owns those. The wrapper forces LTR
 * because the storefront around it is Arabic and right-to-left.
 */
export const metadata = {
  title: 'Star Seven admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }) {
  return (
    <div className="s7admin" dir="ltr" lang="en">
      {children}
    </div>
  );
}
