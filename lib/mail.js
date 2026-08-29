import { Resend } from 'resend';
import { sql } from './db.js';
import { mail as cfg, site } from './config.js';

/**
 * Email via Resend's HTTP API rather than SMTP: a serverless function cannot
 * reliably hold an SMTP socket open, and an HTTP call fits the request model.
 *
 * Every send is recorded in email_log, success or failure, so the team can see
 * what actually went out.
 */
const resend = cfg.key ? new Resend(cfg.key) : null;

export async function sendMail({ to, subject, html, kind = '', replyTo }) {
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

const money = v => `${Number(v).toFixed(2)} ${site.currency}`;

/** Brand shell shared by every message. RTL-aware. */
export function shell(inner, lang = 'ar', footNote = '') {
  const rtl = lang === 'ar';
  const rights = rtl
    ? `© ${new Date().getFullYear()} نيو ستار سفن. كل الحقوق محفوظة.`
    : `© ${new Date().getFullYear()} New Star Seven. All rights reserved.`;

  return `<!DOCTYPE html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F5F2EA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EA;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:560px;background:#FFFDF8;border:1.5px solid #12100B;border-radius:16px;overflow:hidden;
 font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:${rtl ? 'rtl' : 'ltr'};text-align:${rtl ? 'right' : 'left'};">
<tr><td style="background:#12100B;padding:18px 26px;">
  <span style="color:#FFFDF8;font-size:20px;font-weight:900;">★ NEW STAR SEVEN</span></td></tr>
<tr><td style="padding:30px 26px;color:#12100B;font-size:15px;line-height:1.75;">${inner}</td></tr>
<tr><td style="border-top:1px solid rgba(18,16,11,.13);padding:18px 26px;background:#F5F2EA;color:#6E6A60;font-size:11.5px;">
  ${footNote}<div style="margin-top:8px;">${rights}</div>
  <div><a href="${site.url}" style="color:#6E6A60;">${site.url}</a></div></td></tr>
</table></td></tr></table></body></html>`;
}

export const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:#D7291D;color:#ffffff;font-weight:900;` +
  `font-size:15px;text-decoration:none;padding:14px 30px;border-radius:99px;">${label}</a>`;

/** Double opt-in confirmation. */
export function tplConfirm(token, lang) {
  const url = `${site.url}/api/confirm?t=${token}`;
  if (lang === 'ar') {
    return ['أكّد اشتراكك في نيو ستار سفن', shell(
      `<h1 style="font-size:24px;margin:0 0 14px;font-weight:900;">أكّد اشتراكك</h1>
       <p style="margin:0 0 22px;color:#6E6A60;">دوسة واحدة وتبقى في القايمة — العروض هتوصلك قبل ما تنزل للناس، وكود خصم أول أوردر معاها.</p>
       ${button(url, 'أكّد الاشتراك')}
       <p style="margin:22px 0 0;color:#6E6A60;font-size:12.5px;">لو مش إنت اللي طلبت ده، اتجاهل الرسالة.</p>`, 'ar')];
  }
  return ['Confirm your New Star Seven subscription', shell(
    `<h1 style="font-size:24px;margin:0 0 14px;font-weight:900;">Confirm your subscription</h1>
     <p style="margin:0 0 22px;color:#6E6A60;">One tap and you are on the list — every sale reaches you before it goes public, with your first-order discount code.</p>
     ${button(url, 'Confirm subscription')}
     <p style="margin:22px 0 0;color:#6E6A60;font-size:12.5px;">If this was not you, ignore this email.</p>`, 'en')];
}

/** Welcome + coupon, sent right after confirmation. */
export function tplWelcome(code, lang, unsubToken) {
  const unsub = `${site.url}/api/unsubscribe?t=${unsubToken}`;
  const box = `<div style="margin:18px 0 22px;border:2px dashed #D7291D;border-radius:12px;padding:16px;text-align:center;">
    <div style="font-size:28px;font-weight:900;letter-spacing:.08em;color:#D7291D;">${esc(code)}</div></div>`;

  if (lang === 'ar') {
    return ['كود خصمك جوه ★ نيو ستار سفن', shell(
      `<h1 style="font-size:24px;margin:0 0 14px;font-weight:900;">أهلاً بيك في القايمة ★</h1>
       <p style="margin:0 0 4px;color:#6E6A60;">خد كود الخصم ده على أول أوردر:</p>${box}
       ${button(site.url + '/shop', 'اتفرج على المنتجات')}`, 'ar',
      `<a href="${unsub}" style="color:#6E6A60;">إلغاء الاشتراك</a>`)];
  }
  return ['Your discount code is inside ★ New Star Seven', shell(
    `<h1 style="font-size:24px;margin:0 0 14px;font-weight:900;">You are on the list ★</h1>
     <p style="margin:0 0 4px;color:#6E6A60;">Here is your first-order discount code:</p>${box}
     ${button(site.url + '/shop', 'Shop the line')}`, 'en',
    `<a href="${unsub}" style="color:#6E6A60;">Unsubscribe</a>`)];
}

/** Order confirmation for the customer. */
export function tplOrder(order, items, lang, trackUrl = '') {
  const ar = lang === 'ar';

  const rows = items.map(i =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(18,16,11,.1);">${esc(i.name)}
       <span style="color:#6E6A60;">× ${i.qty}</span></td>
     <td style="padding:8px 0;border-bottom:1px solid rgba(18,16,11,.1);text-align:end;white-space:nowrap;">
       ${money(i.price * i.qty)}</td></tr>`).join('');

  const line = (label, v, bold) => {
    const style = bold ? 'font-weight:900;font-size:17px;' : 'font-weight:600;color:#6E6A60;';
    return `<tr><td style="padding:6px 0;${style}">${label}</td>
            <td style="padding:6px 0;text-align:end;${style}">${money(v)}</td></tr>`;
  };

  let totals = line(ar ? 'المجموع' : 'Subtotal', order.subtotal);
  if (order.discount > 0) totals += line(ar ? 'الخصم' : 'Discount', -order.discount);
  totals += line(ar ? 'التوصيل' : 'Delivery', order.shipping);
  totals += line(ar ? 'الإجمالي' : 'Total', order.total, true);

  const ref = `<div style="display:inline-block;background:#12100B;color:#FFFDF8;font-weight:900;
    padding:8px 16px;border-radius:99px;font-size:14px;margin-bottom:16px;">${esc(order.ref)}</div>`;

  // The only copy of the access token that will ever exist. It is not stored,
  // so if this email is lost the customer has to ring the shop — which is why
  // the button is prominent and the sentence next to it says to keep the mail.
  const track = trackUrl
    ? (ar
      ? `<div style="margin:24px 0 0;">
           <a href="${esc(trackUrl)}" style="display:inline-block;background:#D7291D;color:#fff;
              font-weight:900;padding:14px 26px;border-radius:99px;text-decoration:none;font-size:15px;">
              تابع أوردرك</a>
           <p style="margin:10px 0 0;color:#6E6A60;font-size:12.5px;">
             من اللينك ده تشوف حالة الأوردر وتقدر تطلب إلغاء أو استرجاع.
             احتفظ بالإيميل ده — اللينك ده هو الوحيد.</p>
         </div>`
      : `<div style="margin:24px 0 0;">
           <a href="${esc(trackUrl)}" style="display:inline-block;background:#D7291D;color:#fff;
              font-weight:900;padding:14px 26px;border-radius:99px;text-decoration:none;font-size:15px;">
              Track your order</a>
           <p style="margin:10px 0 0;color:#6E6A60;font-size:12.5px;">
             This link shows the status and lets you request a cancellation or refund.
             Keep this email — it is the only copy of the link.</p>
         </div>`)
    : '';

  const inner = ar
    ? `${ref}<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">استلمنا طلبك ✓</h1>
       <p style="margin:0 0 20px;color:#6E6A60;">هنكلمك على <b>${esc(order.phone)}</b> نأكد العنوان والتوصيل. الدفع عند الاستلام.</p>
       <table width="100%" style="font-size:14px;">${rows}${totals}</table>
       <p style="margin:22px 0 0;color:#6E6A60;font-size:13px;">العنوان: ${esc(order.address)} — ${esc(order.city)}</p>${track}`
    : `${ref}<h1 style="font-size:23px;margin:0 0 10px;font-weight:900;">Order received ✓</h1>
       <p style="margin:0 0 20px;color:#6E6A60;">We will call you on <b>${esc(order.phone)}</b> to confirm the address and delivery. Payment is cash on receipt.</p>
       <table width="100%" style="font-size:14px;">${rows}${totals}</table>
       <p style="margin:22px 0 0;color:#6E6A60;font-size:13px;">Address: ${esc(order.address)} — ${esc(order.city)}</p>${track}`;

  return [
    ar ? `طلبك ${order.ref} وصلنا ★ نيو ستار سفن` : `Order ${order.ref} received ★ New Star Seven`,
    shell(inner, lang),
  ];
}

/** Internal new-order alert for the team. */
export function tplOrderAdmin(order, items) {
  const rows = items.map(i => `<li>${esc(i.name)} × ${i.qty} — ${money(i.price * i.qty)}</li>`).join('');
  const wa = `https://wa.me/2${String(order.phone).replace(/^0/, '')}`;

  const inner = `<h1 style="font-size:22px;margin:0 0 12px;font-weight:900;">أوردر جديد — ${esc(order.ref)}</h1>
    <p style="margin:0 0 6px;"><b>${esc(order.name)}</b> — <a href="${wa}">${esc(order.phone)}</a></p>
    <p style="margin:0 0 6px;color:#6E6A60;">${esc(order.address)} — ${esc(order.city)}</p>
    ${order.notes ? `<p style="margin:0 0 6px;color:#6E6A60;">ملاحظات: ${esc(order.notes)}</p>` : ''}
    <ul style="margin:14px 0;padding-inline-start:18px;">${rows}</ul>
    <p style="font-size:19px;font-weight:900;">الإجمالي: ${money(order.total)}</p>`;

  return [`أوردر جديد ${order.ref} — ${Math.round(order.total)} ${site.currency}`, shell(inner, 'ar')];
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
    `<h1 style="font-size:23px;margin:0 0 12px;font-weight:900;">Reset your admin password</h1>
     <p style="margin:0 0 20px;color:#6E6A60;">${who}someone asked to reset the password on your
       New Star Seven admin account. Use the button below to choose a new one.</p>
     ${button(esc(url), 'Choose a new password')}
     <p style="margin:22px 0 0;color:#6E6A60;font-size:12.5px;">
       This link works once and expires in ${Number(minutes)} minutes. Setting a new password
       signs out every browser that is currently signed in to this account.</p>
     <p style="margin:10px 0 0;color:#6E6A60;font-size:12.5px;">
       If this was not you, ignore this email — your current password still works and nothing
       has changed. If it keeps happening, tell the shop owner.</p>`, 'en')];
}

/** Sale / offer broadcast. */
export function tplOffer(offer, lang, unsubToken) {
  const ar = lang === 'ar';
  const unsub = `${site.url}/api/unsubscribe?t=${unsubToken}`;
  const title = ar ? offer.title_ar : (offer.title_en || offer.title_ar);
  const body = ar ? offer.body_ar : (offer.body_en || offer.body_ar);

  const codeBox = offer.code
    ? `<div style="margin:20px 0;border:2px dashed #D7291D;border-radius:12px;padding:16px;text-align:center;">
        <div style="color:#6E6A60;font-size:12px;font-weight:700;margin-bottom:4px;">${ar ? 'كود الخصم' : 'Discount code'}</div>
        <div style="font-size:26px;font-weight:900;letter-spacing:.08em;color:#D7291D;">${esc(offer.code)}</div></div>`
    : '';

  const inner = `<h1 style="font-size:25px;margin:0 0 12px;font-weight:900;">${esc(title)}</h1>
    <div style="color:#6E6A60;margin:0 0 6px;">${esc(body).replace(/\n/g, '<br>')}</div>
    ${codeBox}${button(site.url + '/shop', ar ? 'اطلب دلوقتي' : 'Shop now')}`;

  return [
    `${title} ★ ${ar ? 'نيو ستار سفن' : 'New Star Seven'}`,
    shell(inner, lang, `<a href="${unsub}" style="color:#6E6A60;">${ar ? 'إلغاء الاشتراك' : 'Unsubscribe'}</a>`),
  ];
}
