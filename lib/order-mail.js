import { shell, button, C, eyebrow, title, lead, summary, cashBox } from './mail.js';
import { site } from './config.js';
import { formatRef } from './order-number.js';

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
 *
 * ---------------------------------------------------------------------------
 * On the look
 *
 * Every piece of furniture here — the ink card carrying the order number, the
 * eyebrow, the heading, the dashed box around an amount — is imported from
 * lib/mail.js rather than written again. These six messages and the
 * confirmation are one conversation about one order, arriving over about a
 * week, and a customer who sees the fourth of them should recognise it as
 * coming from the same shop as the first. Every one of these used to build its
 * own reference pill, and they had already drifted.
 */

const money = v => `${Math.round(Number(v) || 0).toLocaleString('en-US')} ${site.currency}`;

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The statuses that are worth an email. Anything else moves quietly. */
export const MAILED = ['confirmed', 'shipped', 'delivered', 'cancelled'];

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
const help = (ar, raw, linked) => {
  const ref = formatRef(raw);
  const wa = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
    ar ? `عندي سؤال عن الأوردر ${ref}` : `A question about order ${ref}`)}`;
  const whatsapp = ar
    ? `<a href="${wa}" style="color:${C.red};font-weight:700;">كلّمنا على واتساب</a>`
    : `<a href="${wa}" style="color:${C.red};font-weight:700;">message us on WhatsApp</a>`;

  const wrap = body =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:24px 0 0;border-top:1px solid ${C.line};">
     <tr><td style="padding:16px 0 0;color:${C.grey};font-size:13px;">${body}</td></tr></table>`;

  if (linked) {
    return wrap(ar ? `محتاج أي حاجة تانية؟ ${whatsapp}.` : `Need anything else? ${whatsapp}.`);
  }

  return wrap(ar
    ? `عايز تتابع تفاصيل الأوردر؟ افتح لينك المتابعة من إيميل تأكيد الأوردر. أو ${whatsapp}.`
    : `Want the full details? Open the tracking link in your order confirmation email, or ${whatsapp}.`);
};

const track = (trackUrl, ar) =>
  trackUrl
    ? `<div style="margin:26px 0 0;">${button(esc(trackUrl), ar ? 'تابع أوردرك' : 'Track your order')}</div>`
    : '';

/**
 * The four notices.
 *
 * Each returns [subject, body, aside, preheader]. `aside` is the second column
 * of the ink card — the status this message is announcing, rather than the
 * confirmation's "cash on delivery", which would be a promise to collect money
 * on the email that says an order was cancelled. `preheader` is the line the
 * inbox shows next to the subject; without one the client scrapes the top of
 * the body, and the top of the body is a logo.
 */
const COPY = {
  confirmed: {
    ar: () => [
      `أوردرك {ref} اتأكد ★ نيو ستار سفن`,
      `${eyebrow('تم التأكيد ✓')}${title('أوردرك اتأكد')}
       ${lead('كلمناك وأكدنا العنوان، وبنجهّز الأوردر دلوقتي.')}
       ${lead('هنبعتهولك في أقرب وقت وهنقولك أول ما يخرج مع المندوب.')}`,
      ['الحالة', 'اتأكد'],
      'كلمناك وأكدنا العنوان — بنجهّز الأوردر دلوقتي.',
    ],
    en: () => [
      `Order {ref} confirmed ★ New Star Seven`,
      `${eyebrow('Confirmed ✓')}${title('Your order is confirmed')}
       ${lead('We have spoken to you and confirmed the address, and we are packing it now.')}
       ${lead('We will let you know the moment it leaves with the courier.')}`,
      ['Status', 'Confirmed'],
      'Address confirmed — we are packing it now.',
    ],
  },

  shipped: {
    // The amount to have ready is the single most useful line in a cash-on-
    // delivery shipping notice: the courier arrives expecting exact change and
    // the customer has had no reason to remember the total since checkout.
    ar: o => [
      `أوردرك {ref} في الطريق ★ نيو ستار سفن`,
      `${eyebrow('في الطريق')}${title('أوردرك في الطريق ليك')}
       ${lead(`الأوردر خرج مع المندوب، وهيكلمك على <b dir="ltr">${esc(o.phone)}</b> قبل ما يوصل.`)}
       ${cashBox(o.total, true)}`,
      ['الحالة', 'مع المندوب'],
      `جهّز ${money(o.total)} كاش — المندوب هيكلمك قبل ما يوصل.`,
    ],
    en: o => [
      `Order {ref} is on its way ★ New Star Seven`,
      `${eyebrow('On its way')}${title('Your order is on its way')}
       ${lead(`It is with the courier, who will call you on <b dir="ltr">${esc(o.phone)}</b> before arriving.`)}
       ${cashBox(o.total, false)}`,
      ['Status', 'With the courier'],
      `Have ${money(o.total)} in cash ready — the courier will call first.`,
    ],
  },

  delivered: {
    ar: () => [
      `وصلك أوردرك {ref} ★ نيو ستار سفن`,
      `${eyebrow('تم التسليم ★')}${title('وصلك أوردرك')}
       <p style="margin:0 0 22px;color:${C.grey};">شكراً إنك جربت نيو ستار سفن. لو عجبك المنتج، أو لو فيه أي مشكلة، قولنا — بنقرا كل رسالة.</p>
       ${button(`${site.url}/shop`, 'اتفرج على باقي التشكيلة')}`,
      ['الحالة', 'اتسلّم'],
      'شكراً إنك جربت نيو ستار سفن.',
    ],
    en: () => [
      `Your order {ref} arrived ★ New Star Seven`,
      `${eyebrow('Delivered ★')}${title('Your order arrived')}
       <p style="margin:0 0 22px;color:${C.grey};">Thank you for trying New Star Seven. If you like it — or if anything is wrong — tell us. We read every message.</p>
       ${button(`${site.url}/en/shop`, 'See the rest of the range')}`,
      ['Status', 'Delivered'],
      'Thank you for trying New Star Seven.',
    ],
  },

  cancelled: {
    // No upsell and no button. An order was just cancelled; the useful thing is
    // to say plainly that nothing is owed, not to sell something else.
    ar: o => [
      `أوردرك {ref} اتلغى`,
      `${eyebrow('اتلغى')}${title('أوردرك اتلغى')}
       ${lead(`أوردر <b dir="ltr">${esc(formatRef(o.ref))}</b> اتلغى ومش هيتبعت. مفيش أي مبلغ مستحق عليك.`)}
       ${lead('لو ده حصل بالغلط، أو لسه عايز الأوردر، كلّمنا وهنظبطها.')}`,
      ['الحالة', 'ملغي'],
      'الأوردر اتلغى ومفيش أي مبلغ مستحق عليك.',
    ],
    en: o => [
      `Order {ref} cancelled`,
      `${eyebrow('Cancelled')}${title('Your order has been cancelled')}
       ${lead(`Order <b dir="ltr">${esc(formatRef(o.ref))}</b> has been cancelled and will not be sent. You owe nothing.`)}
       ${lead('If this was a mistake, or you still want it, message us and we will sort it out.')}`,
      ['Status', 'Cancelled'],
      'It will not be sent, and you owe nothing.',
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
  const [subject, body, aside, preheader] = (ar ? entry.ar : entry.en)(order);

  return [
    // The subject carries the reference in the shape a customer can read down a
    // phone, and it is substituted here rather than in each of the eight strings
    // above so that the formatting cannot be right in seven of them.
    subject.replace('{ref}', formatRef(order.ref)),
    shell(
      `${summary(order.ref, ar, aside)}${body}${track(trackUrl, ar)}${help(ar, order.ref, Boolean(trackUrl))}`,
      ar ? 'ar' : 'en',
      '',
      preheader,
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
 *
 * The lines are drawn without pictures, unlike the confirmation. The items here
 * come back off order_items, which stores the name and the price a customer
 * agreed to and deliberately does not store a picture — so there is nothing to
 * draw that would not be a fresh guess at which product a line meant.
 */
export function tplOrderEdited(order, items, lang, trackUrl = '') {
  const ar = lang !== 'en';
  const end = ar ? 'left' : 'right';
  const rule = `border-bottom:1px solid ${C.line};`;

  const rows = (items || []).map(i =>
    `<tr><td style="padding:12px 0;${rule}">
       <div style="font-weight:800;line-height:1.4;">${esc(i.name)}</div>
       <div style="margin-top:2px;color:${C.grey};font-size:12.5px;">${esc(i.qty)} × ${money(i.price)}</div></td>
     <td align="${end}" style="padding:12px 0;${rule}white-space:nowrap;font-weight:800;">
       ${money(Number(i.price) * Number(i.qty))}</td></tr>`).join('');

  const line = (label, v, bold) => {
    const style = bold
      ? `font-weight:900;font-size:18px;color:${C.ink};padding-top:12px;`
      : `font-weight:600;color:${C.grey};`;
    return `<tr><td style="padding:5px 0;${style}">${label}</td>
            <td align="${end}" style="padding:5px 0;${style}white-space:nowrap;">${money(v)}</td></tr>`;
  };

  let totals = line(ar ? 'المجموع' : 'Subtotal', order.subtotal);
  if (Number(order.discount) > 0) totals += line(ar ? 'الخصم' : 'Discount', -Number(order.discount));
  totals += line(ar ? 'التوصيل' : 'Delivery', order.shipping);
  totals += line(ar ? 'الإجمالي' : 'Total', order.total, true);

  const where = [order.address, order.city].filter(Boolean).join(' — ');

  const body = ar
    ? `${eyebrow('اتعدّل')}${title('عدّلنا أوردرك')}
       ${lead(`ده أوردر <b dir="ltr">${esc(formatRef(order.ref))}</b> بعد التعديل. لو فيه أي حاجة هنا مش زي ما اتفقنا، قولنا فوراً.`)}`
    : `${eyebrow('Updated')}${title('We have updated your order')}
       ${lead(`This is order <b dir="ltr">${esc(formatRef(order.ref))}</b> as it now stands. If anything here is not what you expected, tell us straight away.`)}`;

  const table = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:20px 0 0;font-size:14px;">${rows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:18px 0 0;background:${C.paper2};border:1px solid ${C.line};border-radius:14px;">
      <tr><td style="padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="font-size:14px;">${totals}</table></td></tr></table>`;

  const cash = cashBox(order.total, ar);

  const to = where
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="margin:22px 0 0;border-top:1px solid ${C.line};">
       <tr><td style="padding:18px 0 0;">
         <div style="font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
           color:${C.grey};">${ar ? 'التوصيل' : 'Delivery'}</div>
         <div style="margin-top:5px;font-weight:700;">${esc(where)}</div>${
      order.phone
        ? `<div dir="ltr" style="margin-top:2px;color:${C.grey};font-size:13.5px;
             text-align:${ar ? 'right' : 'left'};">${esc(order.phone)}</div>`
        : ''}</td></tr></table>`
    : '';

  return [
    ar ? `أوردرك ${formatRef(order.ref)} اتعدّل ★ نيو ستار سفن` : `Order ${formatRef(order.ref)} updated ★ New Star Seven`,
    shell(
      `${summary(order.ref, ar, [ar ? 'الإجمالي الجديد' : 'New total', money(order.total)])}${
        body}${table}${cash}${to}${track(trackUrl, ar)}${help(ar, order.ref, Boolean(trackUrl))}`,
      ar ? 'ar' : 'en',
      '',
      ar ? `الإجمالي الجديد ${money(order.total)} كاش عند الاستلام.`
        : `The new total is ${money(order.total)}, cash on delivery.`,
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
 * The ink card's second column is dropped for the same reason — a status or a
 * total on this message would be one more fact a wrong guess is rewarded with.
 *
 * The last line matters as much as the button. A customer who did not ask for
 * this needs to know that somebody typed their address into a form, and that
 * ignoring the mail is the whole of the response required — nothing has been
 * changed on their order by the request.
 */
export function tplOrderLink(order, lang, trackUrl) {
  const ar = lang !== 'en';

  const body = ar
    ? `${eyebrow('لينك المتابعة')}${title('لينك متابعة أوردرك')}
       ${lead(`ده لينك جديد لأوردر <b dir="ltr">${esc(formatRef(order.ref))}</b> — بيفتح الأوردر ده بس.`)}
       ${lead('اللينك شغال ٣٠ يوم. لو ضاع منك تاني اطلبه من نفس الصفحة.')}`
    : `${eyebrow('Tracking link')}${title('Your order tracking link')}
       ${lead(`A new link for order <b dir="ltr">${esc(formatRef(order.ref))}</b> — it opens that order and nothing else.`)}
       ${lead('It works for 30 days. If you lose it again, ask for another from the same page.')}`;

  const note = ar
    ? `<p style="margin:22px 0 0;color:${C.grey};font-size:12.5px;">
         لو مش إنت اللي طلبت اللينك ده، اتجاهل الرسالة — الأوردر بتاعك زي ما هو ومحدش وصله.</p>`
    : `<p style="margin:22px 0 0;color:${C.grey};font-size:12.5px;">
         If you did not ask for this link, ignore this email — nothing about your order has
         changed and nobody else has been given access to it.</p>`;

  return [
    ar ? `لينك أوردرك ${formatRef(order.ref)} ★ نيو ستار سفن` : `Your link for order ${formatRef(order.ref)} ★ New Star Seven`,
    shell(
      `${summary(order.ref, ar, null)}${body}${track(trackUrl, ar)}${note}${help(ar, order.ref, Boolean(trackUrl))}`,
      ar ? 'ar' : 'en',
      '',
      ar ? 'اللينك اللي طلبته جوه. شغال ٣٠ يوم.' : 'The link you asked for is inside. It works for 30 days.',
    ),
  ];
}
