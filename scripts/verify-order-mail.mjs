#!/usr/bin/env node
/**
 * NEW STAR SEVEN — proof that an order email actually leaves the building.
 *
 *   npm run verify:mail                 -- check the configuration, render, send nothing
 *   npm run verify:mail -- --preview    -- also write the rendered HTML to disk and say where
 *   npm run verify:mail -- --send       -- actually send both emails
 *   npm run verify:mail -- --send --to=someone@example.com
 *   npm run verify:mail -- --lang=ar    -- send the Arabic confirmation instead of the English
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

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';

// applyEnv takes the file's TEXT, not its path, and only fills keys that are
// not already set - so .env.local wins over .env and a real environment wins
// over both. Same two files, same order, as every other verify script.
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = join(HERE, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

const args = process.argv.slice(2);
const doSend = args.includes('--send');
const toArg = (args.find(a => a.startsWith('--to=')) || '').slice(5).trim();

// English by default. The shop's customers are Arabic-first and the route picks
// the language off the order, but the person running this by hand is reading
// the result — and reading a rendered RTL email in a terminal and a browser to
// check a layout is harder than it needs to be. --lang=ar is one flag away.
const langArg = (args.find(a => a.startsWith('--lang=')) || '--lang=en').slice(7).trim();
const lang = langArg === 'ar' ? 'ar' : 'en';

/*
 * Where to drop the rendered HTML, when asked.
 *
 * The configuration check answers "can this send", which is what this script
 * was written for. It cannot answer "does it look right", and that question got
 * a lot more interesting once the confirmation started drawing product
 * photographs and a logo: every one of those is an absolute URL that resolves
 * against the live site, and the way to find out whether it resolves is to open
 * the thing in a browser.
 *
 * Written outside the repository by default, because these are throwaway
 * renders of a fake order and a stray order-en.html committed by accident is
 * exactly the sort of file nobody deletes for two years.
 */
const previewArg = args.find(a => a === '--preview' || a.startsWith('--preview='));
const previewDir = previewArg
  ? (previewArg.includes('=') ? previewArg.split('=').slice(1).join('=') : join(tmpdir(), 's7-mail-preview'))
  : '';

const { mail, site } = await import('../lib/config.js');
const { tplOrder, tplOrderAdmin, sendMail } = await import('../lib/mail.js');
const { orderUrl } = await import('../lib/order-access.js');

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
  /*
   * A digits-only reference, because that is the shape the shop issues now.
   *
   * This said 'S7-0000-00000', and formatRef() leaves the old shape exactly as
   * it finds it — so every preview rendered from this script showed a reference
   * of a kind no customer will ever be sent again. Digits get the '#' that
   * customers actually read down a phone.
   *
   * Six nines rather than something near 100001, because this script can send
   * for real with --send, and a test that lands looking like a live order
   * number is a test somebody goes hunting for in the orders table.
   * order_ref_seq starts at 100001 and will not reach this for a very long
   * time.
   */
  ref: '999999',
  name: 'Verify Script',
  phone: '01000000000',
  email: 'customer@example.com',
  address: 'This is a test from scripts/verify-order-mail.mjs. No such order exists.',
  city: 'Cairo',
  notes: 'Test send — ignore.',
  subtotal: 285,
  shipping: 30,
  discount: 40,
  total: 275,
};

/*
 * Real catalogue paths, not invented ones.
 *
 * The confirmation draws a photograph per line now, and the src is derived from
 * products.image by emailImageUrl(). A made-up path would render the fallback -
 * a line with no picture, which is a perfectly good layout and tells you
 * nothing about whether the pictures work. These three are files that exist,
 * chosen to be different shapes: a tub, a tall bottle and a sachet box.
 *
 * One line deliberately has no image at all, because a shop that uploads its
 * own photographs will have rows like that, and the row that degrades is the
 * one worth looking at once.
 */
const items = [
  { name: 'Cream Gel — Bees Wax & Argan Oil 250ml', qty: 2, price: 95, image: 'assets/catalog/cream-gel-250-argan.webp' },
  { name: 'Cologne — Aqua 180ml', qty: 1, price: 75, image: 'assets/catalog/cologne-180-aqua.webp' },
  { name: 'Hair Gel Sachets — 20 pack', qty: 1, price: 20, image: 'assets/catalog/gel-sachet-20-sachets.webp' },
  { name: 'A product with no photograph yet', qty: 1, price: 0, image: '' },
];

/* ------------------------------------------------------- the tracking link */

// Built by the same orderUrl() the checkout calls, from the same site.url, so
// this reports the link a real customer would actually receive rather than a
// hand-written one that is right by luck.
//
// It matters more here than anywhere else on the site. The link in a
// confirmation email is the only copy of that token that will ever exist, and
// it never expires - so a wrong base URL is not a redirect away, it is a dead
// link in somebody's inbox forever, or a permanent commitment to a hostname
// nobody meant to keep.
const trackUrl = orderUrl(order.ref, 'TOKEN-GOES-HERE', lang);

const base = String(site.url || '');
if (/localhost|127\.0\.0\.1/.test(base)) {
  console.log(no(`links would point at ${base} - NEXT_PUBLIC_SITE_URL is unset here`));
} else if (/\.vercel\.app$/i.test(new URL(base).hostname)) {
  console.log(no(`links would point at ${base}`));
  console.log(info('that is a preview hostname, and these links never expire.'));
  console.log(info('set NEXT_PUBLIC_SITE_URL to the real domain before any mail goes out.'));
} else {
  console.log(ok(`tracking links are built on ${base}`));
}
console.log(info(`a customer would receive: ${trackUrl}`));

let adminMail;
let custMail;
let otherMail;
try {
  adminMail = tplOrderAdmin(order, items);
  custMail = tplOrder(order, items, lang, trackUrl);
  // The language that is not being sent, rendered anyway. Both directions come
  // out of one template and RTL is where a table-based layout goes wrong, so a
  // preview that only ever shows one of them is half a check.
  otherMail = tplOrder(order, items, lang === 'ar' ? 'en' : 'ar', trackUrl);
  console.log(ok(`both templates render (${adminMail[1].length} and ${custMail[1].length} bytes of HTML)`));
} catch (e) {
  console.log(no(`a template threw: ${e?.message || e}`));
  process.exit(1);
}

/*
 * Count the pictures, and say so.
 *
 * Every image in these is an absolute URL on site.url under /assets, which is
 * the one prefix middleware.js leaves out of its matcher - so they keep
 * resolving while SITE_PASSWORD has the rest of the site behind a 401. That is
 * load-bearing and invisible, so it is worth a line of output rather than a
 * comment nobody reads.
 */
const images = [...custMail[1].matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]);
const relative = images.filter(u => !/^https?:\/\//.test(u));
console.log(relative.length
  ? no(`${relative.length} image(s) have a relative src and will be broken in every inbox`)
  : ok(`${images.length} image(s), all absolute on ${base.replace(/^https?:\/\//, '')}`));
for (const u of images.slice(0, 2)) console.log(info(u));

/* ----------------------------------------------------------------- preview */

if (previewDir) {
  mkdirSync(previewDir, { recursive: true });
  const files = [
    [`order-${lang}.html`, custMail[1]],
    [`order-${lang === 'ar' ? 'en' : 'ar'}.html`, otherMail[1]],
    ['order-admin.html', adminMail[1]],
  ];
  for (const [name, html] of files) writeFileSync(join(previewDir, name), html, 'utf8');
  console.log(ok(`wrote ${files.length} rendered emails`));
  for (const [name] of files) console.log(info(join(previewDir, name)));
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
