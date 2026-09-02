import { Resend } from 'resend';
import { sql } from './db.js';
import { mail as cfg, site } from './config.js';
import { formatRef } from './order-number.js';
import { emailImageUrl } from './product-image.js';

/**
 * Email via Resend's HTTP API rather than SMTP: a serverless function cannot
 * reliably hold an SMTP socket open, and an HTTP call fits the request model.
 *
 * Every send is recorded in email_log, success or failure, so the team can see
 * what actually went out.
 */
const resend = cfg.key ? new Resend(cfg.key) : null;

/**
 * The headers that make an unsubscribe link a button in the mail client.
 *
 * Two headers, and both are needed. `List-Unsubscribe` is the old one and has
 * been understood for twenty years; on its own a mailbox provider will not act
 * on it automatically, because following a GET link is something spam filters
 * and link scanners do by accident. `List-Unsubscribe-Post: List=One-Click` is
 * RFC 8058, and it is the half that says "there is a POST endpoint here, and a
 * POST to it is a deliberate act" - which is why app/api/unsubscribe/route.js
 * now answers POST as well as GET.
 *
 * This is not decoration. Gmail and Yahoo have required one-click unsubscribe
 * from bulk senders since February 2024, and mail that does not carry it is
 * rate limited and then binned - so the practical effect of leaving these off
 * is that the offers stop arriving and nobody can tell you why.
 *
 * Only mail that IS a subscription carries them. A transactional message - an
 * order confirmation, a password reset - is not something the recipient may
 * unsubscribe from, and offering a list header on one tells the provider it
 * belongs to a bulk stream it does not belong to.
 */
function listHeaders(unsubToken) {
  const url = `${site.url}/api/unsubscribe?t=${unsubToken}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List=One-Click',
  };
}

export async function sendMail({ to, subject, html, kind = '', replyTo, unsubToken = '' }) {
  let sent = true;
  let err = '';

  try {
    if (!resend) throw new Error('RESEND_API_KEY not configured');
    const { error } = await resend.emails.send({
      from: `${cfg.fromName} <${cfg.from}>`,
      to: [to],
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
      ...(unsubToken ? { headers: listHeaders(unsubToken) } : {}),
    });
    if (error) throw new Error(error.message || 'send failed');
  } catch (e) {
    sent = false;
    err = String(e?.message || e).slice(0, 250);
  }

  try {
    await sql`INSERT INTO email_log (to_email, subject, kind, status, error)
              VALUES (${to}, ${subject.slice(0, 250)}, ${kind}, ${sent ? 'sent' : 'failed'}, ${err})`;
  } catch {
    /* logging must never break the request */
  }

  return sent;
}

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The email palette, as flat hex.
 *
 * The same colours as app/globals.css, with one difference that matters: the
 * hairline is a solid #E6E1D6 rather than the site's rgba(18,16,11,.13).
 * Outlook renders mail through Word, Word does not understand rgba, and a
 * border it cannot parse is a border it does not draw — so the item table lost
 * every rule it had on the one client most likely to be asked to print a
 * receipt. #E6E1D6 is that same 13% ink composited onto paper, once, here.
 */
export const C = {
  ink: '#12100B',
  paper: '#FFFDF8',
  paper2: '#F5F2EA',
  grey: '#6E6A60',
  red: '#D7291D',
  line: '#E6E1D6',
  onInk: '#B5B0A4',
};

const FONT = "'Segoe UI',Tahoma,Arial,Helvetica,sans-serif";

/**
 * Money, as the shop actually charges it.
 *
 * This was toFixed(2), which printed "90.00 EGP" on every line of every
 * receipt. The shop prices in whole pounds and collects them in cash at a
 * doorstep, so the two decimals were never anything but noise on the number the
 * customer has to count out. Rounded and separated exactly as lib/order-mail.js
 * does it, so a confirmation and the notices that follow it cannot state one
 * total in two different shapes.
 */
const money = v => `${Math.round(Number(v) || 0).toLocaleString('en-US')} ${site.currency}`;

/**
 * The same amount, safe to drop into an Arabic message.
 *
 * "190 EGP" is a digit run followed by a Latin word, and in a right-to-left
 * paragraph the bidi algorithm treats those as two separate left-to-right runs
 * with a neutral space between them — so it lays them out in paragraph order
 * and the customer reads "EGP 190". Every price in the Arabic confirmation was
 * printed backwards, and it is the kind of wrong that a reader notices and
 * cannot name.
 *
 * dir="ltr" rather than <bdi>, which is what the storefront uses: <bdi> is
 * HTML5 and Word has no idea what it is, while the dir attribute predates all
 * of this and is the one thing every mail client honours.
 *
 * money() stays as it is and is still the right call for a subject line and a
 * preheader, where the markup would be printed as characters rather than
 * obeyed.
 */
const amt = v => `<span dir="ltr">${money(v)}</span>`;

/**
 * The line the inbox shows beside the subject, before anything is opened.
 *
 * With nothing here a mail client scrapes the top of the body instead, and the
 * top of the body is now a logo — so the preview line became the alt text of an
 * image, or nothing at all. The trailing run of zero-width characters is the
 * standard trick: it fills out the client's preview budget with nothing, so the
 * opening words of the message itself are not appended to the line we wrote.
 */
const peek = text =>
  text
    ? `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;
         font-size:1px;line-height:1px;color:${C.paper2};">${esc(text)}${
      '&#8199;&#65279;&#847;'.repeat(60)}</div>`
    : '';

/**
 * Brand shell shared by every message. RTL-aware.
 *
 * ---------------------------------------------------------------------------
 * Why the header is the logo and not the words
 *
 * It used to be the string "★ NEW STAR SEVEN", set in whatever bold sans the
 * client happened to have — which is to say the brand appeared in the inbox in
 * a typeface the brand does not own. The wordmark is the artwork now:
 * assets/logo-s7-light.png, the white copy scripts/gen-email-images.mjs derives
 * from the black original, on the ink bar it was always meant to sit on.
 *
 * Both dimensions are on the tag as attributes as well as in the style, because
 * Word sizes an image from the attributes and ignores the CSS. Without them a
 * 2125px wordmark arrives 2125px wide and takes the card with it.
 *
 * Images can also be switched off, and plenty of people leave them off. So the
 * logo carries the brand name as alt text and the alt is styled — a client
 * drawing the alt instead of the image gets white bold letterspaced text on the
 * ink bar, which is very nearly the header this replaced.
 *
 * ---------------------------------------------------------------------------
 * On the paths
 *
 * Every image is absolute on site.url, which is the only kind of src an inbox
 * can resolve, and every one lands under /assets — the one prefix middleware.js
 * leaves out of its matcher. That is deliberate rather than lucky: while
 * SITE_PASSWORD is set every other route answers 401, and an <img> in a mail
 * client cannot answer a Basic auth challenge. Serving the logo from anywhere
 * else would mean a broken header on every email for as long as the shop stays
 * shut.
 */
export function shell(inner, lang = 'ar', footNote = '', preheader = '') {
  const rtl = lang === 'ar';
  /*
   * The tag is derived from rtl rather than printed from the argument.
   *
   * `lang` lands inside a quoted HTML attribute. Every caller today hands over
   * the literal 'ar' or 'en' - through langOf(), or a ternary, or a constant -
   * so nothing can reach it. That is a fact about eleven call sites rather than
   * a property of this function, and it stops being true the first time someone
   * passes a value straight off a request. Two possible outputs, decided here,
   * costs nothing and does not depend on anybody upstream.
   */
  const tag = rtl ? 'ar' : 'en';
  const start = rtl ? 'right' : 'left';
  const rights = rtl
    ? `© ${new Date().getFullYear()} نيو ستار سفن. كل الحقوق محفوظة.`
    : `© ${new Date().getFullYear()} New Star Seven. All rights reserved.`;

  const links = [
    [`${site.url}${rtl ? '/shop' : '/en/shop'}`, rtl ? 'المتجر' : 'Shop'],
    [`https://wa.me/${site.whatsapp}`, rtl ? 'واتساب' : 'WhatsApp'],
    [site.url, site.url.replace(/^https?:\/\//, '')],
  ]
    .map(([href, label]) => `<a href="${href}" style="color:${C.grey};">${label}</a>`)
    .join(`<span style="color:#C9C3B6;"> &nbsp;·&nbsp; </span>`);

  return `<!DOCTYPE html><html lang="${tag}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:${C.paper2};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${peek(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper2};">
<tr><td align="center" style="padding:30px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
 style="width:100%;max-width:600px;background:${C.paper};border:1.5px solid ${C.ink};border-radius:18px;
 overflow:hidden;font-family:${FONT};direction:${rtl ? 'rtl' : 'ltr'};text-align:${start};">
<tr><td align="center" style="background:${C.ink};padding:26px 26px 24px;">
  <a href="${site.url}" style="text-decoration:none;"><img src="${site.url}/assets/logo-s7-light.png"
    width="148" height="36" alt="NEW STAR SEVEN"
    style="display:block;width:148px;height:36px;border:0;outline:none;color:${C.paper};
    font-family:${FONT};font-size:17px;font-weight:900;letter-spacing:.06em;"></a></td></tr>
<tr><td height="4" style="height:4px;line-height:4px;font-size:0;background:${C.red};">&nbsp;</td></tr>
<tr><td style="padding:32px 28px;color:${C.ink};font-size:15px;line-height:1.7;">${inner}</td></tr>
<tr><td style="border-top:1px solid ${C.line};background:${C.paper2};padding:20px 28px;
 color:${C.grey};font-size:11.5px;line-height:1.8;">
  ${footNote ? `<div style="margin-bottom:8px;">${footNote}</div>` : ''}
  <div>${links}</div>
  <div style="margin-top:6px;">${rights}</div></td></tr>
</table>
</td></tr></table></body></html>`;
}

/**
 * The one call to action a message is allowed.
 *
 * Left as an inline-block anchor rather than the usual bulletproof table,
 * because half of this mail is Arabic: an anchor follows the text-align of the
 * cell it sits in and so lands on the correct side in both directions, while a
 * table would need an align attribute this function has no way to know.
 * mso-padding-alt is what keeps the label off the edges in Word, which honours
 * neither the padding nor the radius.
 */
export const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:${C.red};color:#ffffff;font-weight:900;` +
  `font-size:15px;line-height:1.2;text-decoration:none;padding:15px 32px;border-radius:99px;` +
  `mso-padding-alt:15px 32px;">${label}</a>`;

/** The small letterspaced label that opens a message. */
export const eyebrow = text =>
  `<div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
    color:${C.red};margin:0 0 10px;">${text}</div>`;

/** The h1 every message opens with, so they cannot drift apart in size. */
export const title = text =>
  `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;font-weight:900;
    letter-spacing:-.01em;color:${C.ink};">${text}</h1>`;

export const lead = text => `<p style="margin:0 0 8px;color:${C.grey};">${text}</p>`;

/**
 * The two facts a customer looks for first, on the ink card at the top.
 *
 * The order number, because it is what they will read down a phone, and how
 * they will be paying, because this shop takes cash at the door and a customer
 * who thinks they have already paid is a doorstep argument. Both are set on ink
 * rather than in the flow of the copy so that a glance finds them.
 */
export const summary = (ref, rtl, aside) => {
  const start = rtl ? 'right' : 'left';
  const end = rtl ? 'left' : 'right';
  const cap = `font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${C.onInk};`;

  /*
   * The second column defaults to how the order will be paid, because on the
   * confirmation that is the fact most worth putting where a glance lands: this
   * shop takes cash at the door, and a customer who believes they have already
   * paid is an argument on a doorstep.
   *
   * A status notice passes its own instead. "Cash on delivery" on the email
   * saying an order was cancelled would be a promise to collect money for a
   * parcel nobody is sending, and on the one saying it arrived it is a bill
   * that has already been settled. Passing null drops the column entirely, for
   * the messages that are about nothing but the number.
   */
  const right = aside === null
    ? ''
    : `<td align="${end}" style="padding:16px 20px;">
      <div style="${cap}">${(aside || [])[0] ?? (rtl ? 'الدفع' : 'Payment')}</div>
      <div style="margin-top:3px;font-size:14px;font-weight:800;color:${C.paper};">${
      (aside || [])[1] ?? (rtl ? 'كاش عند الاستلام' : 'Cash on delivery')}</div></td>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
   style="margin:0 0 24px;background:${C.ink};border-radius:14px;">
  <tr>
    <td align="${start}" style="padding:16px 20px;">
      <div style="${cap}">${rtl ? 'رقم الأوردر' : 'Order number'}</div>
      <div dir="ltr" style="margin-top:3px;font-size:19px;font-weight:900;letter-spacing:.03em;
        color:${C.paper};text-align:${start};">${esc(formatRef(ref))}</div></td>
    ${right}
  </tr></table>`;
};

/**
 * One line of the basket, with the jar next to it.
 *
 * The picture is the whole point of this row and it is also the part allowed to
 * fail. emailImageUrl() answers with the empty string for anything that has no
 * committed mail copy, and then the thumbnail cell is not rendered at all
 * rather than rendered around a src that 404s — in an inbox a missing file is
 * not a blank space, it is a broken-image icon on the email a customer is most
 * likely to keep.
 *
 * The tile is a fixed 60px square whatever the photograph is, and the jar is
 * letterboxed into it by scripts/gen-email-images.mjs, so a tall bottle and a
 * squat tub carry the same visual weight down the column. The alt text is empty
 * on purpose: the product name is the very next cell, and a screen reader
 * announcing it twice is worse than not announcing it once.
 */
const itemRow = (item, rtl, withThumbs) => {
  const rule = `border-bottom:1px solid ${C.line};`;
  const src = emailImageUrl(item.image, site.url);
  const qty = Number(item.qty) || 0;
  const price = Number(item.price) || 0;

  // top right bottom left, and which of right and left is the far side depends
  // on the direction. Logical properties would say this once; Word implements
  // none of them.
  const thumbPad = rtl ? '14px 0 14px 14px' : '14px 14px 14px 0';

  /*
   * The column is decided for the whole table, not per line.
   *
   * A row that skipped its first cell because that one product had no
   * photograph did not lose a picture - it lost a COLUMN, and an HTML table
   * settles its column widths across every row it has. One unillustrated line
   * in an otherwise illustrated order dragged the name column out from under
   * the three above it and wrapped "A product with no photograph yet" into a
   * four-line stack. So `withThumbs` is computed once by the caller: either
   * every row carries the cell, or none does, and a line with nothing to show
   * carries it empty.
   */
  const tile = src
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:60px;">
          <tr><td width="60" height="60" align="center" valign="middle"
            style="width:60px;height:60px;background:${C.paper2};border:1px solid ${C.line};
            border-radius:14px;">
            <img src="${esc(src)}" width="48" height="48" alt=""
              style="display:block;width:48px;height:48px;border:0;outline:none;"></td></tr>
        </table>`
    : '&nbsp;';

  const thumb = withThumbs
    ? `<td width="74" valign="middle" style="width:74px;padding:${thumbPad};${rule}">${tile}</td>`
    : '';

  return `<tr>${thumb}
    <td valign="middle" style="padding:14px 0;${rule}">
      <div style="font-weight:800;line-height:1.4;">${esc(item.name)}</div>
      <div style="margin-top:2px;color:${C.grey};font-size:12.5px;">${qty} × ${amt(price)}</div></td>
    <td valign="middle" align="${rtl ? 'left' : 'right'}"
      style="padding:14px 0;${rule}white-space:nowrap;font-weight:800;">${amt(price * qty)}</td>
  </tr>`;
};

/** Subtotal, discount, delivery and total, in the tinted panel under the basket. */
const totalsPanel = (order, rtl) => {
  const end = rtl ? 'left' : 'right';
  const row = (label, v, bold) => {
    const style = bold
      ? `font-weight:900;font-size:18px;color:${C.ink};padding-top:12px;`
      : `font-weight:600;color:${C.grey};`;
    return `<tr><td style="padding:5px 0;${style}">${label}</td>
      <td align="${end}" style="padding:5px 0;${style}white-space:nowrap;">${amt(v)}</td></tr>`;
  };

  let rows = row(rtl ? 'المجموع' : 'Subtotal', order.subtotal);
  if (Number(order.discount) > 0) rows += row(rtl ? 'الخصم' : 'Discount', -Number(order.discount));
  rows += row(rtl ? 'التوصيل' : 'Delivery', order.shipping);
  rows += row(rtl ? 'الإجمالي' : 'Total', order.total, true);

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
   style="margin:18px 0 0;background:${C.paper2};border:1px solid ${C.line};border-radius:14px;">
  <tr><td style="padding:14px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
     style="font-size:14px;">${rows}</table></td></tr></table>`;
};

/**
 * The amount to have in hand when the driver knocks.
 *
 * Stated once, in the largest type on the page, and stated separately from the
 * totals it repeats — because the totals are an explanation of a price and this
 * is an instruction to go and find some cash.
 */
export const cashBox = (total, rtl) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="margin:18px 0 0;border:2px dashed ${C.red};border-radius:14px;">
   <tr><td align="center" style="padding:16px;">
     <div style="color:${C.grey};font-size:12px;font-weight:800;letter-spacing:.08em;
       text-transform:uppercase;">${rtl ? 'جهّز المبلغ ده عند الباب' : 'Have this ready at the door'}</div>
     <div style="margin-top:4px;font-size:28px;font-weight:900;color:${C.red};line-height:1.2;">
       ${amt(total)}</div></td></tr></table>`;

/** Where it is going and who the courier will ring. */
const deliveryBlock = (order, rtl) => {
  const where = [order.address, order.city].filter(Boolean).join(' — ');
  if (!where && !order.phone) return '';
  const cap = `font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${C.grey};`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="margin:22px 0 0;border-top:1px solid ${C.line};">
   <tr><td style="padding:18px 0 0;">
     <div style="${cap}">${rtl ? 'التوصيل' : 'Delivery'}</div>
     ${order.name ? `<div style="margin-top:5px;font-weight:800;">${esc(order.name)}</div>` : ''}
     ${where ? `<div style="margin-top:2px;font-weight:700;">${esc(where)}</div>` : ''}
     ${order.phone
    ? `<div dir="ltr" style="margin-top:2px;color:${C.grey};font-size:13.5px;text-align:${
      rtl ? 'right' : 'left'};">${esc(order.phone)}</div>`
    : ''}</td></tr></table>`;
};

/** Double opt-in confirmation. */
export function tplConfirm(token, lang) {
  const url = `${site.url}/api/confirm?t=${token}`;
  if (lang === 'ar') {
    return ['أكّد اشتراكك في نيو ستار سفن', shell(
      `${eyebrow('نيو ستار سفن')}${title('أكّد اشتراكك')}
       <p style="margin:0 0 22px;color:${C.grey};">دوسة واحدة وتبقى في القايمة — العروض هتوصلك قبل ما تنزل للناس، وكود خصم أول أوردر معاها.</p>
       ${button(url, 'أكّد الاشتراك')}
       <p style="margin:22px 0 0;color:${C.grey};font-size:12.5px;">لو مش إنت اللي طلبت ده، اتجاهل الرسالة.</p>`,
      'ar', '', 'دوسة واحدة وتبقى في القايمة.')];
  }
  return ['Confirm your New Star Seven subscription', shell(
    `${eyebrow('New Star Seven')}${title('Confirm your subscription')}
     <p style="margin:0 0 22px;color:${C.grey};">One tap and you are on the list — every sale reaches you before it goes public, with your first-order discount code.</p>
     ${button(url, 'Confirm subscription')}
     <p style="margin:22px 0 0;color:${C.grey};font-size:12.5px;">If this was not you, ignore this email.</p>`,
    'en', '', 'One tap and you are on the list.')];
}

/** Welcome + coupon, sent right after confirmation. */
export function tplWelcome(code, lang, unsubToken) {
  const unsub = `${site.url}/api/unsubscribe?t=${unsubToken}`;
  const box = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="margin:18px 0 22px;border:2px dashed ${C.red};border-radius:14px;">
   <tr><td align="center" style="padding:18px;">
     <div style="font-size:28px;font-weight:900;letter-spacing:.10em;color:${C.red};">${esc(code)}</div>
   </td></tr></table>`;

  if (lang === 'ar') {
    return ['كود خصمك جوه ★ نيو ستار سفن', shell(
      `${eyebrow('أهلاً بيك')}${title('إنت في القايمة ★')}
       <p style="margin:0 0 4px;color:${C.grey};">خد كود الخصم ده على أول أوردر:</p>${box}
       ${button(site.url + '/shop', 'اتفرج على المنتجات')}`, 'ar',
      `<a href="${unsub}" style="color:${C.grey};">إلغاء الاشتراك</a>`,
      `كود خصمك: ${code}`)];
  }
  return ['Your discount code is inside ★ New Star Seven', shell(
    `${eyebrow('Welcome')}${title('You are on the list ★')}
     <p style="margin:0 0 4px;color:${C.grey};">Here is your first-order discount code:</p>${box}
     ${button(site.url + '/en/shop', 'Shop the line')}`, 'en',
    `<a href="${unsub}" style="color:${C.grey};">Unsubscribe</a>`,
    `Your discount code: ${code}`)];
}

/**
 * Order confirmation for the customer.
 *
 * The most-kept email the shop sends, and until now the plainest: a heading, a
 * two-column table of names and numbers, and a button. It now opens with the
 * order number and the payment method on an ink card, lists every line with the
 * jar beside it, and states the cash amount once, on its own, in the largest
 * type on the page.
 *
 * The pictures are the reason lib/product-image.js grew emailImageUrl() and the
 * reason app/api/order/route.js now carries `image` on every item it builds.
 * They are worth the trouble on this message specifically: a customer who
 * ordered three tubs of hair wax from a catalogue of fifty-five is checking
 * that the right three are coming, and names alone make that a reading task.
 */
export function tplOrder(order, items, lang, trackUrl = '') {
  const ar = lang === 'ar';
  const list = items || [];
  // One decision for the whole table - see itemRow(). An order where nothing
  // has a photograph gets no thumbnail column at all rather than a column of
  // empty tiles.
  const withThumbs = list.some(i => emailImageUrl(i.image, site.url));
  const rows = list.map(i => itemRow(i, ar, withThumbs)).join('');

  // The only copy of the access token that will ever exist. It is not stored,
  // so if this email is lost the customer has to ring the shop — which is why
  // the button is prominent and the sentence next to it says to keep the mail.
  const track = trackUrl
    ? `<div style="margin:26px 0 0;">${button(esc(trackUrl), ar ? 'تابع أوردرك' : 'Track your order')}
       <p style="margin:10px 0 0;color:${C.grey};font-size:12.5px;">${ar
      ? 'من اللينك ده تشوف حالة الأوردر وتقدر تطلب إلغاء أو استرجاع. احتفظ بالإيميل ده — اللينك ده هو الوحيد.'
      : 'This link shows the status and lets you request a cancellation or refund. Keep this email — it is the only copy of the link.'}</p></div>`
    : '';

  // First name only. "Thanks, Mohamed" reads like a person wrote it and
  // "Thanks, Mohamed Ahmed Abdelrahman" reads like a database did.
  const first = esc(String(order.name ?? '').trim().split(/\s+/)[0] || '');

  const inner = ar
    ? `${eyebrow('استلمنا طلبك ✓')}
       ${title(first ? `شكراً يا ${first} ★` : 'استلمنا طلبك ★')}
       ${lead(`هنكلمك على <b dir="ltr">${esc(order.phone)}</b> نأكد العنوان والتوصيل، وبعدها يخرج مع المندوب. الدفع كاش عند الاستلام.`)}
       ${summary(order.ref, true)}
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="font-size:14px;">${rows}</table>
       ${totalsPanel(order, true)}${cashBox(order.total, true)}${track}${deliveryBlock(order, true)}`
    : `${eyebrow('Order received ✓')}
       ${title(first ? `Thanks, ${first} ★` : 'Order received ★')}
       ${lead(`We will call you on <b dir="ltr">${esc(order.phone)}</b> to confirm the address and delivery, then it goes out with the courier. Payment is cash on receipt.`)}
       ${summary(order.ref, false)}
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="font-size:14px;">${rows}</table>
       ${totalsPanel(order, false)}${cashBox(order.total, false)}${track}${deliveryBlock(order, false)}`;

  return [
    ar ? `طلبك ${formatRef(order.ref)} وصلنا ★ نيو ستار سفن` : `Order ${formatRef(order.ref)} received ★ New Star Seven`,
    shell(inner, lang, '', ar
      ? `${money(order.total)} كاش عند الاستلام. هنكلمك نأكد العنوان.`
      : `${money(order.total)} cash on delivery. We will call to confirm the address.`),
  ];
}

/**
 * The shop's own new-order alert: the order sheet.
 *
 * Read on a phone, standing up, by whoever decides whether to ring the customer
 * now or after lunch. So the customer comes first and every fact about them is
 * labelled - name, the number to ring (tap to call, tap to WhatsApp), the email
 * the confirmation went to, the address the driver needs, the notes they typed
 * - and only then the jars and the money. It used to be four unlabelled lines
 * and a bullet list; the address was there, but nothing said so, and the email
 * was not there at all.
 *
 * English and left-to-right, like the admin panel it links to. The product
 * names are English, and an RTL paragraph was printing "190 EGP — Cream Gel"
 * back to front.
 *
 * What it must never carry is the tracking link. That token is the customer's
 * credential and this inbox collects one of these for every order;
 * tests/order-mail-routing.test.mjs holds that line. The button goes to the
 * admin, which has its own login.
 */
export function tplOrderAdmin(order, items) {
  // Digits only, and stripped here rather than trusted from the row. This lands
  // unescaped inside an href, and the only thing keeping a quote out of it today
  // is normalizePhone() on the checkout path. An order reaching this template by
  // any other route - a future import, a repaired row, an admin edit - would put
  // whatever the column holds into the attribute.
  const digits = String(order.phone ?? '').replace(/\D/g, '');
  const wa = `https://wa.me/2${digits.replace(/^0/, '')}`;
  const tel = `tel:${digits}`;

  const list = items || [];
  const withThumbs = list.some(i => emailImageUrl(i.image, site.url));
  const rows = list.map(i => itemRow(i, false, withThumbs)).join('');

  const cap = `font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${C.grey};`;
  const row = (label, value) => value
    ? `<tr><td valign="top" style="padding:7px 14px 7px 0;white-space:nowrap;${cap}">${label}</td>
        <td valign="top" style="padding:7px 0;font-weight:700;overflow-wrap:anywhere;">${value}</td></tr>`
    : '';

  const customer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="margin:0 0 22px;background:${C.paper2};border:1px solid ${C.line};border-radius:14px;">
   <tr><td style="padding:14px 18px;">
     <div style="${cap}margin-bottom:6px;">Customer</div>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14.5px;">
       ${row('Name', esc(order.name))}
       ${row('Phone', `<a href="${tel}" style="color:${C.ink};">${esc(order.phone)}</a>
         &nbsp;·&nbsp; <a href="${wa}" style="color:${C.red};font-weight:800;">WhatsApp</a>`)}
       ${row('Email', order.email ? `<a href="mailto:${esc(order.email)}" style="color:${C.ink};">${esc(order.email)}</a>` : '')}
       ${row('Address', esc(order.address))}
       ${row('City', esc(order.city))}
       ${row('Notes', order.notes ? `<span style="font-weight:600;color:${C.grey};">${esc(order.notes)}</span>` : '')}
     </table></td></tr></table>`;

  const inner = `${eyebrow('New order')}${title(esc(formatRef(order.ref)))}
    ${summary(order.ref, false, ['Total', amt(order.total)])}
    ${customer}
    <div style="${cap}margin-bottom:4px;">Items</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="font-size:14px;">${rows}</table>
    ${totalsPanel(order, false)}
    <div style="margin:24px 0 0;">${button(`${site.url}/admin/orders`, 'Open in admin')}</div>`;

  return [
    `New order ${formatRef(order.ref)} — ${money(order.total)} — ${String(order.name ?? '').trim()}`,
    shell(inner, 'en', '',
      `${String(order.name ?? '').trim()} · ${money(order.total)} · ${String(order.city ?? '').trim()}`),
  ];
}

/**
 * The admin password reset link.
 *
 * English only, like the rest of the admin, and it goes to one of two or three
 * people rather than to a customer — so it is written as an instruction and not
 * as marketing.
 *
 * Three things are in here deliberately. The minutes are stated, because a link
 * that has quietly expired is the most confusing possible failure. The "if this
 * was not you" line names the consequence — the old password still works — so
 * an admin who did not ask for this knows they do not have to do anything, and
 * also knows somebody typed their address into the shop. And the URL is
 * escaped: it carries a token this module did not build, and a template that
 * pastes an unescaped value into an href is one bad caller away from being an
 * injection.
 */
export function tplAdminReset(url, minutes, name = '') {
  const who = name ? `${esc(name)}, ` : '';
  return ['Reset your Star Seven admin password', shell(
    `${eyebrow('Admin')}${title('Reset your admin password')}
     <p style="margin:0 0 20px;color:${C.grey};">${who}someone asked to reset the password on your
       New Star Seven admin account. Use the button below to choose a new one.</p>
     ${button(esc(url), 'Choose a new password')}
     <p style="margin:22px 0 0;color:${C.grey};font-size:12.5px;">
       This link works once and expires in ${Number(minutes)} minutes. Setting a new password
       signs out every browser that is currently signed in to this account.</p>
     <p style="margin:10px 0 0;color:${C.grey};font-size:12.5px;">
       If this was not you, ignore this email — your current password still works and nothing
       has changed. If it keeps happening, tell the shop owner.</p>`,
    'en', '', `The link expires in ${Number(minutes)} minutes.`)];
}

/** Sale / offer broadcast. */
export function tplOffer(offer, lang, unsubToken) {
  const ar = lang === 'ar';
  const unsub = `${site.url}/api/unsubscribe?t=${unsubToken}`;
  const title_ = ar ? offer.title_ar : (offer.title_en || offer.title_ar);
  const body = ar ? offer.body_ar : (offer.body_en || offer.body_ar);

  const codeBox = offer.code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="margin:20px 0;border:2px dashed ${C.red};border-radius:14px;">
       <tr><td align="center" style="padding:16px;">
         <div style="color:${C.grey};font-size:12px;font-weight:800;letter-spacing:.08em;
           text-transform:uppercase;">${ar ? 'كود الخصم' : 'Discount code'}</div>
         <div style="margin-top:4px;font-size:26px;font-weight:900;letter-spacing:.10em;color:${C.red};">${esc(offer.code)}</div>
       </td></tr></table>`
    : '';

  const inner = `${eyebrow(ar ? 'عرض' : 'Offer')}${title(esc(title_))}
    <div style="color:${C.grey};margin:0 0 6px;">${esc(body).replace(/\n/g, '<br>')}</div>
    ${codeBox}${button(site.url + (ar ? '/shop' : '/en/shop'), ar ? 'اطلب دلوقتي' : 'Shop now')}`;

  return [
    `${title_} ★ ${ar ? 'نيو ستار سفن' : 'New Star Seven'}`,
    shell(inner, lang, `<a href="${unsub}" style="color:${C.grey};">${ar ? 'إلغاء الاشتراك' : 'Unsubscribe'}</a>`,
      String(body).replace(/\s+/g, ' ').slice(0, 90)),
  ];
}
