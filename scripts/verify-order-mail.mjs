#!/usr/bin/env node
/**
 * NEW STAR SEVEN — proof that an order email actually leaves the building.
 *
 *   npm run verify:mail              -- check the configuration, render, send nothing
 *   npm run verify:mail -- --send    -- actually send both emails
 *   npm run verify:mail -- --send --to=someone@example.com
 *
 * Order mail has never been tested here for a boring reason: the only way to
 * trigger it was to place an order, and placing an order on production creates
 * a real row, decrements real stock and puts a real line on the shop's list.
 * That was done once, by me, and had to be cleaned up by hand afterwards. This
 * exists so it never has to be done again.
 *
 * It renders the two real templates from lib/mail.js against a fake order and
 * pushes them through the real sendMail(), which is the part actually worth
 * testing: the API key, the from address, the domain verification behind it,
 * and the shape Resend accepts. Nothing here reimplements any of that, because
 * a test that reimplements the thing it is testing proves only that the copy
 * works.
 *
 * ---------------------------------------------------------------------------
 * What it does NOT touch
 *
 * No order is created and no stock moves. The only row it can write is in
 * email_log, and that is written by sendMail() itself, on purpose — a send
 * attempt is exactly what that table is for, and a test send that left no
 * trace would be a worse test. The rows are marked kind 'verify' so they are
 * distinguishable from real order mail at a glance.
 *
 * ---------------------------------------------------------------------------
 * Reading the result
 *
 * The failure that matters is not "it did not send" but WHY, and the two live
 * causes look nothing alike:
 *
 *   RESEND_API_KEY not configured  -- no key on this environment at all.
 *   The <domain> domain is not verified  -- key is fine, MAIL_FROM is on a
 *   domain Resend has not been shown the DNS for. This is the one that bites,
 *   because everything looks configured and nothing arrives.
 *
 * Resend's own onboarding@resend.dev sends without any DNS at all, but only to
 * the address that owns the Resend account. It is a way to prove the key works
 * before the domain is ready; it is not a way to email a customer.
 */

import { applyEnv } from './env-file.mjs';

applyEnv();

const args = process.argv.slice(2);
const doSend = args.includes('--send');
const toArg = (args.find(a => a.startsWith('--to=')) || '').slice(5).trim();

const { mail } = await import('../lib/config.js');
const { tplOrder, tplOrderAdmin, sendMail } = await import('../lib/mail.js');

const ok = s => `  \x1b[32m✓\x1b[0m ${s}`;
const no = s => `  \x1b[31m✗\x1b[0m ${s}`;
const info = s => `    ${s}`;

console.log('\n  NEW STAR SEVEN — order mail\n');

/* ------------------------------------------------------------ configuration */

let fatal = false;

if (mail.key) {
  console.log(ok(`RESEND_API_KEY is set (${mail.key.length} chars, starts "${mail.key.slice(0, 3)}…")`));
} else {
  console.log(no('RESEND_API_KEY is not set — nothing can send'));
  fatal = true;
}

console.log(mail.from
  ? ok(`MAIL_FROM        ${mail.fromName} <${mail.from}>`)
  : no('MAIL_FROM is empty'));

if (mail.notifyTo) {
  console.log(ok(`ORDER_NOTIFY_TO  ${mail.notifyTo}   (the shop's copy of every order)`));
} else {
  console.log(no('ORDER_NOTIFY_TO is not set — the shop gets NO copy of any order'));
  console.log(info('the route skips that send entirely; only the customer is mailed'));
}

const fromDomain = (mail.from.split('@')[1] || '').toLowerCase();
const notifyDomain = (mail.notifyTo.split('@')[1] || '').toLowerCase();
if (fromDomain && notifyDomain && fromDomain !== notifyDomain) {
  console.log(info(`note: sending from ${fromDomain}, notifying ${notifyDomain} — that is fine.`));
  console.log(info(`      Only ${fromDomain} needs to be verified in Resend. Any mailbox can receive.`));
}

/* ------------------------------------------------------------------ render */

const order = {
  ref: 'S7-0000-00000',
  name: 'اختبار — Verify Script',
  phone: '01000000000',
  address: 'This is a test from scripts/verify-order-mail.mjs. No such order exists.',
  city: 'القاهرة',
  notes: 'Test send — ignore.',
  subtotal: 90,
  shipping: 0,
  discount: 0,
  total: 90,
};
const items = [
  { name: 'Premium Wax Pro X', qty: 1, price: 45 },
  { name: 'Premium Wax Black', qty: 1, price: 45 },
];

let adminMail;
let custMail;
try {
  adminMail = tplOrderAdmin(order, items);
  custMail = tplOrder(order, items, 'ar', 'https://starseven-vercel.vercel.app/order/S7-0000-00000?t=test');
  console.log(ok(`both templates render (${adminMail[1].length} and ${custMail[1].length} bytes of HTML)`));
} catch (e) {
  console.log(no(`a template threw: ${e?.message || e}`));
  process.exit(1);
}

/* -------------------------------------------------------------------- send */

if (!doSend) {
  console.log('\n  Rendered only. Add --send to actually deliver.\n');
  process.exit(fatal ? 1 : 0);
}

if (fatal) {
  console.log('\n  Not sending: there is no API key to send with.\n');
  process.exit(1);
}

const shopTo = toArg || mail.notifyTo;
if (!shopTo) {
  console.log(no('nowhere to send — set ORDER_NOTIFY_TO or pass --to='));
  process.exit(1);
}

console.log(`\n  Sending to ${shopTo} …\n`);

const sentAdmin = await sendMail({
  to: shopTo, subject: `[TEST] ${adminMail[0]}`, html: adminMail[1], kind: 'verify',
});
console.log(sentAdmin
  ? ok("the shop's copy was accepted by Resend")
  : no("the shop's copy failed — see the reason in email_log below"));

const sentCust = await sendMail({
  to: shopTo, subject: `[TEST] ${custMail[0]}`, html: custMail[1], kind: 'verify',
});
console.log(sentCust
  ? ok("the customer's copy was accepted by Resend")
  : no("the customer's copy failed"));

/* --------------------------------------------------- what the log now says */

try {
  const { sql } = await import('../lib/db.js');
  const rows = await sql`SELECT status, error, to_email FROM email_log
                          WHERE kind = 'verify' ORDER BY id DESC LIMIT 2`;
  console.log('\n  email_log:');
  for (const r of rows) {
    console.log(info(`${r.status.padEnd(7)} ${r.to_email}${r.error ? `  — ${r.error}` : ''}`));
  }
} catch (e) {
  console.log(info(`could not read email_log: ${e?.message || e}`));
}

const good = sentAdmin && sentCust;
console.log(good
  ? '\n  Accepted by Resend. Check the inbox — accepted is not the same as delivered.\n'
  : '\n  Not sent. The error above is the whole story; fix that and run again.\n');

process.exit(good ? 0 : 1);
