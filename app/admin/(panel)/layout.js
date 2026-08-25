import { redirect } from 'next/navigation';
import { csrfToken, currentAdmin } from '../../../lib/auth.js';
import { logout } from '../_lib/session-actions.js';
import Tabs from './tabs.js';

/**
 * The signed-in half of the admin. Every page in this route group is behind
 * this one check; /admin/login and /admin/setup sit in the (auth) group and
 * are deliberately outside it.
 */
export default async function PanelLayout({ children }) {
  const admin = await currentAdmin();
  if (!admin) redirect('/admin/login');

  const token = await csrfToken();

  return (
    <>
      <header className="bar">
        <div className="brand"><i>★</i> STAR SEVEN</div>
        <nav className="tabs">
          <Tabs />
          <form action={logout}>
            <input type="hidden" name="_csrf" value={token} />
            <button type="submit" className="tablink">Log out</button>
          </form>
        </nav>
      </header>
      <div className="wrap">{children}</div>
    </>
  );
}
