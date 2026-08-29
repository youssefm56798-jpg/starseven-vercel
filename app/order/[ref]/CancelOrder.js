'use client';

import { useState } from 'react';

/**
 * Stopping an order, from the customer's side.
 *
 * There are two different things behind this one panel, and which one a
 * customer gets depends on where their parcel is:
 *
 *   before it ships   the order is cancelled outright, here and now. Nothing
 *                     has left the building, so there is nothing for a human to
 *                     weigh up, and making someone wait for a phone call to
 *                     undo an order they placed twenty minutes ago is friction
 *                     with no purpose.
 *
 *   once it ships     a request, exactly as before. A driver is carrying the
 *                     parcel and whether it can still be stopped is a question
 *                     about the world, not about the database.
 *
 * The page decides which by passing `selfCancellable`, computed server-side
 * from lib/order-status.js, so this component never has to hold its own opinion
 * about the rule — and cannot drift from the API, which checks the same thing
 * again before writing anything.
 *
 * The token from the URL is posted back, because it is the only credential
 * there is. Both endpoints re-check it against the reference exactly as the
 * page did, so neither can be pointed at somebody else's order.
 */

const COPY = {
  ar: {
    h: 'إلغاء الأوردر',
    // before it ships
    lead: 'لسه تقدر تلغي الأوردر ده بنفسك، من غير ما تستنى حد.',
    placeholder: 'ليه بتلغي؟ (اختياري)',
    cancel: 'ألغي الأوردر',
    sure: 'متأكد؟ الإلغاء نهائي ومش هينفع ترجع فيه.',
    sureYes: 'أيوة، ألغي',
    sureNo: 'استنى، رجوع',
    busy: 'بنلغي…',
    goneH: 'الأوردر اتلغى',
    goneP: 'خلاص، مش هيتبعت ومفيش أي مبلغ عليك. بعتنالك إيميل بالتأكيد.',
    // once it shipped
    reqLead: 'الأوردر خرج مع المندوب بالفعل، فمش هينفع يتلغى من هنا. اطلب الإلغاء وهنكلمك نظبطها.',
    reqSend: 'اطلب الإلغاء',
    reqPlaceholder: 'سبب الطلب (اختياري)',
    reqDoneH: 'طلبك وصلنا',
    reqDoneP: 'سجّلنا طلب الإلغاء وهنكلمك على الرقم اللي في الأوردر.',
    already: 'طلبت الإلغاء بالفعل في',
    // terminal
    cancelled: 'الأوردر ده اتلغى.',
    delivered: 'الأوردر اتسلّم بالفعل. لو فيه مشكلة في المنتج كلّمنا على واتساب.',
    // the race
    tooLate: 'الأوردر خرج مع المندوب دلوقتي حالاً، فمابقاش ينفع يتلغى من هنا. اطلب الإلغاء وهنتواصل معاك.',
    err: 'فيه حاجة وقعت. جرّب تاني أو كلّمنا على واتساب.',
  },
  en: {
    h: 'Cancel this order',
    lead: 'You can still cancel this order yourself, without waiting for anyone.',
    placeholder: 'Why are you cancelling? (optional)',
    cancel: 'Cancel my order',
    sure: 'Are you sure? Cancelling is final and cannot be undone.',
    sureYes: 'Yes, cancel it',
    sureNo: 'No, go back',
    busy: 'Cancelling…',
    goneH: 'Your order is cancelled',
    goneP: 'It will not be sent and you owe nothing. We have emailed you a confirmation.',
    reqLead: 'This order is already with the courier, so it cannot be cancelled from here. Ask and we will call you to sort it out.',
    reqSend: 'Request cancellation',
    reqPlaceholder: 'Reason (optional)',
    reqDoneH: 'We have your request',
    reqDoneP: 'The cancellation request is on your order and we will call the number on it.',
    already: 'You already requested this on',
    cancelled: 'This order has been cancelled.',
    delivered: 'This order was delivered. If something is wrong with the product, message us on WhatsApp.',
    tooLate: 'This order went out with the courier just now, so it can no longer be cancelled from here. Ask and we will get in touch.',
    err: 'Something went wrong. Try again, or message us on WhatsApp.',
  },
};

export default function CancelOrder({
  lang, refValue, token, status, selfCancellable, requestedAt, reason,
}) {
  const t = COPY[lang === 'en' ? 'en' : 'ar'];

  // `status` is what the page rendered with. Everything below tracks what has
  // happened since, so the panel can answer without a reload.
  const [gone, setGone] = useState(status === 'cancelled');
  const [sent, setSent] = useState(Boolean(requestedAt));
  const [when, setWhen] = useState(requestedAt);
  const [text, setText] = useState(reason || '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Set when the API says the order shipped underneath us. From then on this
  // panel behaves as though it had rendered for a shipped order, because that
  // is what it is now looking at.
  const [tooLate, setTooLate] = useState(false);

  const canCancel = selfCancellable && !tooLate;

  const date = when
    ? new Date(when).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG',
      { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  async function post(path) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: refValue, t: token, reason: text }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function doCancel() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const { res, data } = await post('/api/order/cancel');
      if (res.ok && data.ok) {
        setGone(true);
        return;
      }
      // Raced with the shop marking it shipped. Not an error to the customer —
      // just a different question now, so show the request form instead.
      if (data.error === 'too-late') {
        setTooLate(true);
        setConfirming(false);
        setErr(t.tooLate);
        return;
      }
      if (data.error === 'already-cancelled') {
        setGone(true);
        return;
      }
      throw new Error(data.error || 'failed');
    } catch {
      setErr(t.err);
    } finally {
      setBusy(false);
    }
  }

  async function doRequest(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const { res, data } = await post('/api/order/refund');
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setSent(true);
      setWhen(data.requestedAt || new Date().toISOString());
    } catch {
      setErr(t.err);
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------- terminal */

  if (gone) {
    return (
      <section className="ord-sec">
        <h2>{t.h}</h2>
        {status === 'cancelled' ? (
          <p className="ord-note">{t.cancelled}</p>
        ) : (
          <div className="ord-done">
            <b>{t.goneH}</b>
            <p>{t.goneP}</p>
          </div>
        )}
      </section>
    );
  }

  if (sent) {
    return (
      <section className="ord-sec">
        <h2>{t.h}</h2>
        <div className="ord-done">
          <b>{t.reqDoneH}</b>
          <p>{t.reqDoneP}</p>
          {date && <p className="ord-note">{t.already} {date}</p>}
        </div>
      </section>
    );
  }

  if (status === 'delivered') {
    return (
      <section className="ord-sec">
        <h2>{t.h}</h2>
        <p className="ord-note">{t.delivered}</p>
      </section>
    );
  }

  /* ------------------------------------------------- cancel, for real */

  if (canCancel) {
    return (
      <section className="ord-sec">
        <h2>{t.h}</h2>
        <div className="ord-refund">
          <p className="ord-lead">{t.lead}</p>

          {/* The reason is asked for before the confirm step, not after, so the
              confirm step is only ever one question. */}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t.placeholder}
            maxLength={500}
            rows={3}
            disabled={busy}
          />

          {err && <p className="ord-err" role="alert">{err}</p>}

          {/* Two steps, because cancelling is terminal — there is no path back
              out of it in the state machine, so a single misplaced tap must not
              be able to end an order. */}
          {confirming ? (
            <>
              <p className="ord-note" role="alert">{t.sure}</p>
              <button className="btn btn-red" type="button" onClick={doCancel} disabled={busy}>
                {busy ? t.busy : t.sureYes}
              </button>
              {' '}
              <button className="btn btn-line" type="button"
                onClick={() => setConfirming(false)} disabled={busy}>
                {t.sureNo}
              </button>
            </>
          ) : (
            <button className="btn btn-line" type="button" onClick={() => setConfirming(true)}>
              {t.cancel}
            </button>
          )}
        </div>
      </section>
    );
  }

  /* ------------------------------------------------ too late: ask instead */

  return (
    <section className="ord-sec">
      <h2>{t.h}</h2>
      <form className="ord-refund" onSubmit={doRequest}>
        <p className="ord-lead">{tooLate ? t.tooLate : t.reqLead}</p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t.reqPlaceholder}
          maxLength={500}
          rows={3}
        />
        {err && !tooLate && <p className="ord-err" role="alert">{err}</p>}
        <button className="btn btn-line" type="submit" disabled={busy}>
          {busy ? t.busy : t.reqSend}
        </button>
      </form>
    </section>
  );
}
