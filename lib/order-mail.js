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
 * On the link
 *
 * These used to carry the order reference and nothing to click, and that was a
 * limitation rather than a decision: the token that opens an order was never
 * stored — only its SHA-256 — so at the moment a status changed there was no
 * way to reconstruct the URL, and minting a fresh one would have broken the
 * link in the confirmation email the customer already had.
 *
 * db/schema.sql now holds a row per link, so an order can have several live at
 * once and a new one costs the old one nothing. lib/order-notify.js mints one
 * per notice and passes it in as `trackUrl` — the argument every template here
 * already took, and the reason none of this copy had to be rewritten.
 *
 * tplOrderLink() at the bottom is the fifth message and the only one that is
 * not about a status: the link on its own, sent when a customer asks for it
 * again at /order/find.
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
 * The way to reach a human, at the foot of every one of these.
 *
 * The thing a customer wants after "your order is on its way" is to ask a
 * question about it, and the alternative to giving them WhatsApp here is that
 * they reply to a no-reply address.
 *
 * `linked` drops the sentence telling them where to find the tracking link,
 * because when it is true the button saying exactly that is two lines above.
 * The sentence stays for the case it was written for — a message going out
 * with no link on it, which is what happens when the mint failed.
 */
const help = (ar, ref, linked) => {
  const wa = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
    ar ? `عندي سؤال عن الأوردر ${ref}` : `A question about order ${ref}`)}`;
  const whatsapp = ar
    ? `<a href="${wa}" style="color:#D7291D;font-weight:700;">كلّمنا على واتساب</a>`
    : `<a href="${wa}" style="color:#D7291D;font-weight:700;">message us on WhatsApp</a>`;

  if (linked) {
    return ar
      ? `<p style="margin:24px 0 0;color:#6E6A60;font-size:13px;">
           محتاج أي حاجة تانية؟ ${whatsapp}.</p>`
      : `<p style="margin:24px 0 0;color:#6E6A60;font-size:13px;">
           Need anything else? ${whatsapp}.</p>`;
  }

  return ar
    ? `<p style="margin:24px 0 0;color:#6E6A60;font-size:13px;">
         عايز تتابع تفاصيل الأوردر؟ افتح لينك المتابعة من إيميل تأكيد الأوردر.
         أو ${whatsapp}.</p>`
    : `<p style="margin:24px 0 0;color:#6E6A60;font-size:13px;">
         Want the full details? Open the tracking link in your order confirmation email,
         or ${whatsapp}.</p>`;
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
    shell(
      `${refPill(order.ref)}${body}${track(trackUrl, ar)}${help(ar, order.ref, Boolean(trackUrl))}`,
      ar ? 'ar' : 'en',
    ),
  ];
}

/**
 * The order as it now stands, after the shop changed it.
 *
 * The sixth message, and the only one that is about the contents rather than
 * the status. It goes out when lib/order-edit.js changes something the
 * customer would recognise — the lines, the money, the address, the number the
 * courier will ring — and it exists for two reasons, both specific to taking
 * cash at the door.
 *
 * The amount is collected in cash by a driver who expects it exactly. An order
 * whose total changed after the confirmation email is an order where the
 * customer has the wrong money in their hand, and the first person to find that
 * out is a stranger on their doorstep. So the new total is stated the same way
 * the shipping notice states it, in a box, in the largest type on the page.
 *
 * And the change was agreed on a phone call, which leaves no record. Six weeks
 * later "I never asked for two" is a conversation nobody can win. This email is
 * the receipt for it, which is also why the last line invites the customer to
 * say so if it is wrong: a notice they can object to is worth more than a
 * notice they can only receive.
 *
 * Deliberately not written as "as agreed on the phone". The shop can edit an
 * order without having spoken to anybody, and copy that assumes the call
 * happened is copy that lies on the day it did not.
 */
export function tplOrderEdited(order, items, lang, trackUrl = '') {
  const ar = lang !== 'en';

  const rows = (items || []).map(i =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(18,16,11,.1);">${esc(i.name)}
       <span style="color:#6E6A60;">&times; ${esc(i.qty)}</span></td>
     <td style="padding:8px 0;border-bottom:1px solid rgba(18,16,11,.1);text-align:end;white-space:nowrap;">
       ${money(Number(i.price) * Number(i.qty))}</td></tr>`).join('');

  const line = (label, v, bold) => {
    const style = bold ? 'font-weight:900;font-size:17px;' : 'font-weight:600;color:#6E6A60;';
    return `<tr><td style="padding:6px 0;${style}">${label}</td>
            <td style="padding:6px 0;text-align:end;${style}">${money(v)}</td></tr>`;
  };

  let totals = line(ar ? 'المجموع' : 'Subtotal', order.subtotal);
  if (Number(order.discount) > 0) totals += line(ar ? 'الخصم' : 'Discount', -Number(order.discount));
  totals += line(ar ? 'التوصيل' : 'Delivery', order.shipping);
  totals += line(ar ? 'الإجمالي' : 'Total', order.total, true);

  const where = [order.address, order.city].filter(Boolean).join(' — ');

  const body = ar
    ? `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">عدّلنا أوردرك</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">ده أوردر <b dir="ltr">${esc(order.ref)}</b> بعد التعديل. لو فيه أي حاجة هنا مش زي ما اتفقنا، قولنا فوراً.</p>`
    : `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">We have updated your order</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">This is order <b dir="ltr">${esc(order.ref)}</b> as it now stands. If anything here is not what you expected, tell us straight away.</p>`;

  const table = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="margin:18px 0 0;font-size:14px;">${rows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="margin:10px 0 0;font-size:14px;">${totals}</table>`;

  const cash = `
    <div style="margin:18px 0;border:2px dashed #D7291D;border-radius:12px;padding:16px;text-align:center;">
      <div style="color:#6E6A60;font-size:12px;font-weight:700;margin-bottom:4px;">
        ${ar ? 'المبلغ اللي هتدفعه عند الاستلام' : 'What you pay at the door'}</div>
      <div style="font-size:26px;font-weight:900;color:#D7291D;"><bdi>${money(order.total)}</bdi></div>
    </div>`;

  const to = where
    ? `<p style="margin:14px 0 0;color:#6E6A60;font-size:13px;">
         ${ar ? 'هنوصله لـ' : 'Going to'} <b>${esc(where)}</b>${
      order.phone ? ` · <b dir="ltr">${esc(order.phone)}</b>` : ''}</p>`
    : '';

  return [
    ar ? `أوردرك ${order.ref} اتعدّل ★ نيو ستار سفن` : `Order ${order.ref} updated ★ New Star Seven`,
    shell(
      `${refPill(order.ref)}${body}${table}${cash}${to}${track(trackUrl, ar)}${help(ar, order.ref, Boolean(trackUrl))}`,
      ar ? 'ar' : 'en',
    ),
  ];
}

/**
 * The link on its own, sent when a customer asks for it again.
 *
 * The message has one job and says one thing, because the person reading it
 * has already told us what they want. No order contents and no totals: this
 * goes out to whoever asked, and while the address is checked against the
 * order before a single one of these is sent, the page that sends it will
 * answer the same way to a stranger who guessed wrong. Putting an address and
 * a basket in it would make a wrong guess worth making.
 *
 * The last line matters as much as the button. A customer who did not ask for
 * this needs to know that somebody typed their address into a form, and that
 * ignoring the mail is the whole of the response required — nothing has been
 * changed on their order by the request.
 */
export function tplOrderLink(order, lang, trackUrl) {
  const ar = lang !== 'en';

  const body = ar
    ? `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">لينك متابعة أوردرك</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">ده لينك جديد لأوردر <b dir="ltr">${esc(order.ref)}</b> — بيفتح الأوردر ده بس.</p>
       <p style="margin:0;color:#6E6A60;">اللينك شغال ٣٠ يوم. لو ضاع منك تاني اطلبه من نفس الصفحة.</p>`
    : `<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">Your order tracking link</h1>
       <p style="margin:0 0 8px;color:#6E6A60;">A new link for order <b dir="ltr">${esc(order.ref)}</b> — it opens that order and nothing else.</p>
       <p style="margin:0;color:#6E6A60;">It works for 30 days. If you lose it again, ask for another from the same page.</p>`;

  const note = ar
    ? `<p style="margin:22px 0 0;color:#6E6A60;font-size:12.5px;">
         لو مش إنت اللي طلبت اللينك ده، اتجاهل الرسالة — الأوردر بتاعك زي ما هو ومحدش وصله.</p>`
    : `<p style="margin:22px 0 0;color:#6E6A60;font-size:12.5px;">
         If you did not ask for this link, ignore this email — nothing about your order has
         changed and nobody else has been given access to it.</p>`;

  return [
    ar ? `لينك أوردرك ${order.ref} ★ نيو ستار سفن` : `Your link for order ${order.ref} ★ New Star Seven`,
    shell(
      `${refPill(order.ref)}${body}${track(trackUrl, ar)}${note}${help(ar, order.ref, Boolean(trackUrl))}`,
      ar ? 'ar' : 'en',
    ),
  ];
}
