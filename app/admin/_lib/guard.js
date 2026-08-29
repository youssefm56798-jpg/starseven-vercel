import { redirect } from 'next/navigation';
import { currentAdmin } from '../../../lib/auth.js';
import { can } from '../../../lib/admin-roles.js';

/**
 * Page-level session check. The (panel) layout already guards the group; this
 * repeats it inside each page so a route added outside the group, or a layout
 * that stops rendering, can never leave a screen open.
 */
export async function requireAdmin() {
  const admin = await currentAdmin();
  if (!admin) redirect('/admin/login');
  return admin;
}

/**
 * The same, plus a permission.
 *
 * Every screen and every Server Action that does something staff may not do
 * starts with one of these, and it is a SERVER-side refusal rather than a
 * hidden button. The tab strip does hide what a role cannot use, because a
 * screen full of controls that all fail is a bad screen — but hiding is a
 * courtesy and this is the control. A Server Action is a POST endpoint that
 * anybody holding a session can call directly with a hand-built request; the
 * fact that only one page renders a form for it is not a permission model.
 *
 * The role comes from currentAdmin(), which reads it from the admin row rather
 * than from the session token — so an admin demoted a minute ago is refused
 * here even though the cookie in their browser was minted while they still had
 * the power. See lib/auth.js.
 *
 * Refusal is a redirect to the dashboard with a flash, not a 403 page. Both are
 * defensible; this one is chosen because every other failure in this panel
 * lands the same way, and because the person hitting it is almost always a
 * staff member who followed a stale link rather than an attacker.
 */
export async function requirePermission(permission) {
  const admin = await requireAdmin();
  if (!can(admin.role, permission)) redirect('/admin?m=forbidden');
  return admin;
}

/** Shorthand for the screens and actions that are the owner and nobody else. */
export async function requireOwner() {
  return requirePermission('accounts:manage');
}
