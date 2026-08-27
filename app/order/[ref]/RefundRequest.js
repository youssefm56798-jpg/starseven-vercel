'use client';

import { useState } from 'react';

/**
 * Asking to cancel or be refunded.
 *
 * It does not cancel anything, and the copy says so. This is cash on delivery:
 * whether an order can still be stopped depends on where the parcel is, and
 * that is a human decision. What this does is put the request on the order and
 * timestamp it, so the shop sees it and the customer has a record.
 *
 * The token from the URL is posted back, because it is the only credential
 * there is — the API re-checks it against the reference exactly as the page
 * did, so this cannot be pointed at somebody else's order.
 */

const COPY = {
  ar: {
    h: 'إلغاء أو استرجاع',
    lead: 'لو غيرت رأيك أو فيه مشكلة، اطلب الإلغاء من هنا وهنكلمك.',
    note: 'ده طلب مش إلغاء فوري — لو الأوردر خرج مع المندوب بالفعل هنتواصل معاك نظبطها.',
    placeholder: 'سبب الطلب (اختياري)',
    send: 'اطلب الإلغاء',
    busy: 'ثانية…',
    doneH: 'طلبك وصلنا',
    doneP: 'سجّلنا طلب الإلغاء وهنكلمك على الرقم اللي في الأوردر.',
    already: 'طلبت الإلغاء بالفعل في',
    cancelled: 'الأوردر ده اتلغى.',
    delivered: 'الأوردر اتسلّم بالفعل. لو فيه مشكلة في المنتج كلّمنا على واتساب.',
    err: 'فيه حاجة وقعت. جرّب تاني أو كلّمنا على واتساب.',
  },
  en: {
    h: 'Cancel or refund',
    lead: 'Changed your mind, or something is wrong? Ask here and we will call you.',
    note: 'This is a request, not an instant cancellation — if the parcel is already with the courier we will sort it out with you.',
    placeholder: 'Reason (optional)',
    send: 'Request cancellation',
    busy: 'One moment…',
    doneH: 'We have your request',
    doneP: 'The cancellation request is on your order and we will call the number on it.',
    already: 'You already requested this on',
    cancelled: 'This order has been cancelled.',
    delivered: 'This order was delivered. If something is wrong with the product, message us on WhatsApp.',
    err: 'Something went wrong. Try again, or message us on WhatsApp.',
  },
};

export default function RefundRequest({ lang, refValue, token, status, requestedAt, reason }) {
  const t = COPY[lang === 'en' ? 'en' : 'ar'];
  const [sent, setSent] = useState(Boolean(requestedAt));
  const [when, setWhen] = useState(requestedAt);
  const [text, setText] = useState(reason || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (status === 'cancelled') {
    return (
      <section className="ord-sec">
        <h2>{t.h}</h2>
        <p className="ord-note">{t.cancelled}</p>
      </section>
    );
  }

  const date = when
    ? new Date(when).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG',
      { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/order/refund', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: refValue, t: token, reason: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setSent(true);
      setWhen(data.requestedAt || new Date().toISOString());
    } catch {
      setErr(t.err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ord-sec">
      <h2>{t.h}</h2>

      {sent ? (
        <div className="ord-done">
          <b>{t.doneH}</b>
          <p>{t.doneP}</p>
          {date && <p className="ord-note">{t.already} {date}</p>}
        </div>
      ) : status === 'delivered' ? (
        <p className="ord-note">{t.delivered}</p>
      ) : (
        <form className="ord-refund" onSubmit={submit}>
          <p className="ord-lead">{t.lead}</p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t.placeholder}
            maxLength={500}
            rows={3}
          />
          {err && <p className="ord-err" role="alert">{err}</p>}
          <button className="btn btn-line" type="submit" disabled={busy}>
            {busy ? t.busy : t.send}
          </button>
          <p className="ord-note">{t.note}</p>
        </form>
      )}
    </section>
  );
}
