'use client';

import { useState } from 'react';

/**
 * Asking for an order link again.
 *
 * The form is two fields and the answer is always the same sentence. That is
 * not a shortcut — app/api/order/find/route.js refuses to say whether the pair
 * matched anything, because saying so would turn this page into a way to test
 * whether an order reference is real, and a reference is four random digits
 * inside a day. So the success panel below is what a customer sees whether
 * they typed their own details or somebody else guessed at them.
 *
 * Which makes the copy do real work. "We have sent it" would be a lie half the
 * time and would leave a customer who mistyped their address waiting for an
 * email that is not coming. "If that matches an order" is the honest form, and
 * the panel says what to do when nothing arrives.
 *
 * The two errors that ARE shown are about the shape of what was typed — an
 * address with no @, a reference that is not one. Those say nothing about any
 * order, and swallowing them would leave someone who fat-fingered the form
 * staring at a success message forever.
 */

const COPY = {
  ar: {
    email: 'الإيميل اللي طلبت بيه',
    ref: 'رقم الأوردر',
    send: 'ابعتلي اللينك',
    busy: 'ثانية…',
    doneH: 'بصّ في الإيميل',
    again: 'اطلب اللينك تاني',
    err: 'فيه حاجة وقعت. جرّب تاني أو كلّمنا على واتساب.',
    note: 'اللينك بيفتح الأوردر ده بس، وشغال ٣٠ يوم.',
  },
  en: {
    email: 'The email you ordered with',
    ref: 'Order number',
    send: 'Email me the link',
    busy: 'One moment…',
    doneH: 'Check your inbox',
    again: 'Ask for the link again',
    err: 'Something went wrong. Try again, or message us on WhatsApp.',
    note: 'The link opens that one order, and works for 30 days.',
  },
};

export default function FindForm({ lang }) {
  const ar = lang !== 'en';
  const t = COPY[ar ? 'ar' : 'en'];

  const [email, setEmail] = useState('');
  const [ref, setRef] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/order/find', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ref, lang: ar ? 'ar' : 'en', hp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || t.err);
      setSent(data.message || t.doneH);
    } catch (e2) {
      setErr(e2.message || t.err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="ord-done">
        <b>{t.doneH}</b>
        <p>{sent}</p>
        <p className="ord-note">
          <button type="button" className="ord-again" onClick={() => { setSent(''); setRef(''); }}>
            {t.again}
          </button>
        </p>
      </div>
    );
  }

  return (
    <form className="ord-find" onSubmit={submit} noValidate>
      {err && <p className="ord-err" role="alert">{err}</p>}

      <label className="fld">
        <span>{t.email}</span>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          dir="ltr"
          required
        />
      </label>

      <label className="fld">
        <span>{t.ref}</span>
        <input
          type="text"
          value={ref}
          onChange={e => setRef(e.target.value)}
          placeholder="#100001"
          autoComplete="off"
          inputMode="text"
          dir="ltr"
          required
        />
      </label>

      {/* Spam trap. .hp-field in globals.css takes it off screen with
          clip-path. Anything typed in here makes the endpoint answer exactly
          as it would on success and send nothing. */}
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true"
        name="company_website" value={hp} onChange={e => setHp(e.target.value)}
        className="hp-field" />

      <button className="btn btn-red" type="submit" disabled={busy}>
        {busy ? t.busy : t.send}
      </button>

      <p className="ord-note">{t.note}</p>
    </form>
  );
}
