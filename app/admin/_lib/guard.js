import { redirect } from 'next/navigation';
import { currentAdmin } from '../../../lib/auth.js';

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
