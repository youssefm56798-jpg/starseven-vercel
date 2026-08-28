import { shell, button } from './mail.js';
import { site } from './config.js';

/**
 * What the customer is told when their order moves.
 *
 * The shop calls, confirms, hands the parcel to a courier and it arrives. Until
 * now none of that reached the customer: the confirmation email went out at
 * checkout and then nothing, so the only way to learn an order had shipped was
 * to open the tracking link and look. These are the four messages that fill
 * that silence.
 *
 * `new` has no template on purpose. That is the checkout confirmation, which
 * lib/mail.js already sends with the order contents and the tracking link, and
 * a second message saying the same thing is how an order confirmation email
 * turns into two.
 *
 * ---------------------------------------------------------------------------
 * On the missing link
 *
 * These carry the order reference and no tracking link, and that is a
 * limitation rather than a decision. The token that opens an order is never
 * stored — only its SHA-256 is, see lib/order-access.js — so at the moment a
 * status changes there is no way to reconstruct the link. Minting a fresh token
 * would work but would silently break the link in the confirmation email the
 * customer already has, which is worse than not linking at all.
 *
 * The fix is a token table, so an order can have several live links at once.
 * When that lands, every template here takes the URL through the `trackUrl`
 * argument it already accepts and renders the button — the same shape
 * tplOrder() in lib/mail.js already uses, so it is one argument at each call
 * site and no rewriting of the copy.
 */

const money = v => `${Math.round(Number(v) || 0).toLocaleString('en-US')} ${site.currency}`;

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The statuses that are worth an email. Anything else moves quietly. */
export const MAILED = ['confirmed', 'shipped', 'delivered', 'cancelled'];

/** The reference, as the pill the confirmation email already uses. */
const refPill = ref =>
  `<div style="display:inline-block;background:#12100B;color:#FFFDF8;font-weight:900;
    padding:8px 16px;border-radius:99px;font-size:14px;margin-bottom:16px;">${esc(ref)}</div>`;

/**
 * Where to go when there is no link in the message.
 *
 * Every one of these ends with a way to reach a human, because the thing a
 * customer wants after "your order is on its way" is to ask a question about
 * it, and the alternative to giving them WhatsApp here is that they reply to a
 * no-reply address.
 */
const help = (ar, ref) => {
  const wa = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
    ar ? `عندي سؤال عن الأوردر ${ref}` : `A question about order ${ref}`)}`;
  return ar
    ? `<p style="margin:24px 0 0;color:#6E6A60;font-size:13px;">
         عايز تتابع تفاصيل الأوردر؟ افتح لينك المتابعة من إيميل تأكيد الأوردر.
         أو <a href="${wa}" style="color:#D7291D;font-weight:700;">كلّمنا على واتساب</a>.</p>`
    : `<p style="margin:24px 0 0;color:#6E6A60;font-size:13px;">
         Want the full details? Open the tracking link in your order confirmation email,
         or <a href="${wa}" style="color:#D7291D;font-weight:700;">message us on WhatsApp</a>.</p>`;
};

const track = (trackUrl, ar) =>
  trackUrl
    ? `<div style="margin:24px 0 0;">${button(esc(trackUrl), ar ? 'تابع أوردرك' : 'Track your order')}</div>`
    : '';

const COPY = {
  confirmed: {
    ar: o => [
      `أوردرك ${o.ref} اتأكد ★ نيو ستار سفن`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">أوردرك اتأكد ✓</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">كلمناك وأكدنا العنوان، وبنجهّز الأوردر دلوقتي.</p>
       <p style="margin:0;color:#6E6A60;">هنبعتهولك في أقرب وقت وهنقولك أول ما يخرج مع المندوب.</p>`,
    ],
    en: o => [
      `Order ${o.ref} confirmed ★ New Star Seven`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">Your order is confirmed ✓</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">We have spoken to you and confirmed the address, and we are packing it now.</p>
       <p style="margin:0;color:#6E6A60;">We will let you know the moment it leaves with the courier.</p>`,
    ],
  },

  shipped: {
    // The amount to have ready is the single most useful line in a cash-on-
    // delivery shipping notice: the courier arrives expecting exact change and
    // the customer has had no reason to remember the total since checkout.
    ar: o => [
      `أوردرك ${o.ref} في الطريق ★ نيو ستار سفن`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">أوردرك في الطريق ليك</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">الأوردر خرج مع المندوب، وهيكلمك على <b dir="ltr">${esc(o.phone)}</b> قبل ما يوصل.</p>
       <div style="margin:18px 0;border:2px dashed #D7291D;border-radius:12px;padding:16px;text-align:center;">
         <div style="color:#6E6A60;font-size:12px;font-weight:700;margin-bottom:4px;">جهّز المبلغ ده</div>
         <div style="font-size:26px;font-weight:900;color:#D7291D;"><bdi>${money(o.total)}</bdi></div>
       </div>`,
    ],
    en: o => [
      `Order ${o.ref} is on its way ★ New Star Seven`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">Your order is on its way</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">It is with the courier, who will call you on <b dir="ltr">${esc(o.phone)}</b> before arriving.</p>
       <div style="margin:18px 0;border:2px dashed #D7291D;border-radius:12px;padding:16px;text-align:center;">
         <div style="color:#6E6A60;font-size:12px;font-weight:700;margin-bottom:4px;">Have this ready</div>
         <div style="font-size:26px;font-weight:900;color:#D7291D;"><bdi>${money(o.total)}</bdi></div>
       </div>`,
    ],
  },

  delivered: {
    ar: o => [
      `وصلك أوردرك ${o.ref} ★ نيو ستار سفن`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">وصلك أوردرك ★</h1>
       <p style="margin:0 0 22px;color:#6E6A60;">شكراً إنك جربت نيو ستار سفن. لو عجبك المنتج، أو لو فيه أي مشكلة، قولنا — بنقرا كل رسالة.</p>
       ${button(`${site.url}/shop`, 'اتفرج على باقي التشكيلة')}`,
    ],
    en: o => [
      `Your order ${o.ref} arrived ★ New Star Seven`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">Your order arrived ★</h1>
       <p style="margin:0 0 22px;color:#6E6A60;">Thank you for trying New Star Seven. If you like it — or if anything is wrong — tell us. We read every message.</p>
       ${button(`${site.url}/shop`, 'See the rest of the range')}`,
    ],
  },

  cancelled: {
    // No upsell and no button. An order was just cancelled; the useful thing is
    // to say plainly that nothing is owed, not to sell something else.
    ar: o => [
      `أوردرك ${o.ref} اتلغى`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">أوردرك اتلغى</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">أوردر <b dir="ltr">${esc(o.ref)}</b> اتلغى ومش هيتبعت. مفيش أي مبلغ مستحق عليك.</p>
       <p style="margin:0;color:#6E6A60;">لو ده حصل بالغلط، أو لسه عايز الأوردر، كلّمنا وهنظبطها.</p>`,
    ],
    en: o => [
      `Order ${o.ref} cancelled`,
      `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">Your order has been cancelled</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">Order <b dir="ltr">${esc(o.ref)}</b> has been cancelled and will not be sent. You owe nothing.</p>
       <p style="margin:0;color:#6E6A60;">If this was a mistake, or you still want it, message us and we will sort it out.</p>`,
    ],
  },
};

/**
 * The message for one status move, or null when that status is not one the
 * customer is written to about.
 *
 * Returns [subject, html], the same shape as every template in lib/mail.js, so
 * a caller passes it straight to sendMail().
 */
export function tplStatus(order, status, lang, trackUrl = '') {
  const entry = COPY[status];
  if (!entry) return null;

  const ar = lang !== 'en';
  const [subject, body] = (ar ? entry.ar : entry.en)(order);

  return [
    subject,
    shell(`${refPill(order.ref)}${body}${track(trackUrl, ar)}${help(ar, order.ref)}`, ar ? 'ar' : 'en'),
  ];
}
