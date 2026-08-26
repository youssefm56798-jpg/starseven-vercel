'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { localePath } from '../../lib/urls.js';
import { logout, logoutEverywhere } from '../../lib/session-client.js';

/**
 * Sign out, here or everywhere.
 *
 * "Everywhere" is the one a customer reaches for after losing a phone, so it
 * says what it actually does — including that it takes up to fifteen minutes
 * to bite on a session that is mid-flight. Promising instant revocation while
 * running a stateless access token would be a lie told by the interface.
 */
export default function AccountActions({ lang }) {
  const ar = lang === 'ar';
  const router = useRouter();
  const L = p => localePath(p, lang);
  const [busy, setBusy] = useState('');

  async function run(which) {
    if (busy) return;
    setBusy(which);
    try {
      if (which === 'all') await logoutEverywhere();
      await logout();
      router.push(L('/'));
      router.refresh();
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="acct-sec">
      <h2>{ar ? 'الخروج' : 'Signing out'}</h2>
      <div className="acct-actions">
        <button className="btn btn-line" onClick={() => run('one')} disabled={!!busy}>
          {busy === 'one' ? '…' : ar ? 'اخرج من الجهاز ده' : 'Sign out here'}
        </button>
        <button className="btn btn-ink" onClick={() => run('all')} disabled={!!busy}>
          {busy === 'all' ? '…' : ar ? 'اخرج من كل الأجهزة' : 'Sign out everywhere'}
        </button>
      </div>
      <p className="acct-note">
        {ar
          ? 'الخروج من كل الأجهزة بيلغي كل الجلسات. الجلسة اللي شغالة دلوقتي على جهاز تاني ممكن تفضل شغالة لحد ربع ساعة قبل ما تقفل.'
          : 'Signing out everywhere revokes every session. One that is mid-request on another device can keep working for up to fifteen minutes before it stops.'}
      </p>
    </section>
  );
}
