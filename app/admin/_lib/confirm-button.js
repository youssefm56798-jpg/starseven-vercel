'use client';
import {useAdminLanguage} from './locale.js';
import {adminTranslate} from '../../../lib/admin-copy.mjs';

/**
 * A submit button that asks first. The only reason this is a client component:
 * a server component cannot carry an onClick, and destructive rows (delete a
 * subscriber, delete an offer) must not fire on a stray click.
 */
export default function ConfirmButton({ message, className = 'btn sm ghost', name, value, children }) {
  const lang=useAdminLanguage();
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      onClick={e => { if (!window.confirm(adminTranslate(lang,message))) e.preventDefault(); }}
    >
      {children}
    </button>
  );
}
