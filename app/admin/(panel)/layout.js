import { redirect } from 'next/navigation';
import { csrfToken, currentAdmin } from '../../../lib/auth.js';
import { PERMISSIONS } from '../../../lib/admin-roles.js';
import { logout } from '../_lib/session-actions.js';
import Tabs from './tabs.js';

/**
 * The signed-in half of the admin. Every page in this route group is behind
 * this one check; /admin/login, /admin/setup, /admin/forgot and /admin/reset
 * sit in the (auth) group and are deliberately outside it.
 *
 * The permission list is handed to the tab strip so it can leave out what this
 * role cannot use. That is presentation: the screens and their actions each
 * check for themselves, because a hidden link is not an access control.
 */
export default async function PanelLayout({ children }) {
  const admin = await currentAdmin();
  if (!admin) redirect('/admin/login');

  const token = await csrfToken();
  const allowed = PERMISSIONS[admin.role] ?? PERMISSIONS.staff;

  return (
    <>
      <header className="bar">
        <div className="brand"><i>★</i> STAR SEVEN</div>
        <nav className="tabs">
          <Tabs allowed={allowed} />
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
