'use server';

import { redirect } from 'next/navigation';
import { csrfOk, destroySession } from '../../../lib/auth.js';

/** Clears the session cookie and sends the admin back to the login screen. */
export async function logout(formData) {
  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin?m=csrf');
  await destroySession();
  redirect('/admin/login?m=bye');
}
