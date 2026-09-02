/**
 * The order confirmation draws the jars, and an inbox is unforgiving about it.
 *
 * lib/product-image.js builds the mail src by NAME — it swaps the catalogue
 * stem into `/assets/catalog/email/<stem>-192.png` and trusts the file to be
 * there, because emailImageUrl() also ships in the browser bundle and cannot
 * look at a disk. So the moment somebody commits a new jar without running
 * scripts/gen-email-images.mjs, the confirmation email points at a file that
 * 404s.
 *
 * On a web page that failure is quiet; in an inbox it is not. A missing image
 * on a page is a gap. A missing image in an email is a broken-image icon with a
 * border and a filename, on the one message a customer is most likely to keep
 * and most likely to show somebody. Hence this file.
 *
 * The other half of what is asserted here is the format, and it is the half
 * that would otherwise be found by a customer rather than by us. Outlook on
 * Windows renders mail through Word, and Word has never decoded a WebP — so a
 * mail copy that was quietly written as .webp because it was faster would look
 * perfect in every client we happen to test in and be broken in the one nobody
 * here uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  originals, missing, emailName, EMAIL_WIDTH, CATALOG, OUT_DIR, LOGO_OUT,
} from '../scripts/gen-email-images.mjs';
import { emailImageUrl } from '../lib/product-image.js';
import { tplOrder } from '../lib/mail.js';

const BASE = 'https://newstarseven.com';

test('the catalogue is found at all', () => {
  // A scan that matches nothing passes for ever.
  assert.ok(originals().length >= 40, `only ${originals().length} catalogue images found`);
});

test('every catalogue image has a mail copy on disk', () => {
  const gaps = missing().map(emailName);
  assert.deepEqual(gaps, [],
    `missing mail images - run: node scripts/gen-email-images.mjs\n${gaps.join('\n')}`);
});

test('the white wordmark the shell asks for is there', () => {
  // shell() hardcodes /assets/logo-s7-light.png. It is generated rather than
  // drawn, so it is exactly the kind of file a clean checkout can be missing.
  assert.ok(existsSync(LOGO_OUT), 'assets/logo-s7-light.png is missing - run scripts/gen-email-images.mjs');
});

test('the URL the helper builds names a file that exists', () => {
  /*
   * The name is built in lib/ and the file is written by scripts/, and lib
   * cannot import the script - it would drag node:fs into the browser bundle.
   * Two independent spellings of one filename is the arrangement that drifts,
   * so the URL is resolved back to a path and looked for.
   */
  for (const file of originals()) {
    const url = emailImageUrl(`assets/catalog/${file}`, BASE);
    assert.ok(url.startsWith(`${BASE}/assets/catalog/email/`), `unexpected mail URL: ${url}`);
    const rel = url.slice(`${BASE}/assets/catalog/email/`.length);
    assert.ok(existsSync(join(OUT_DIR, rel)), `the mail URL points at a file that is not there: ${url}`);
  }
});

test('every mail copy is a PNG, because Word cannot read WebP', () => {
  // Sniffed rather than trusted from the extension: a .png that is really a
  // webp is exactly the mistake this is guarding against, and it would not
  // change the filename.
  for (const file of originals()) {
    const p = join(OUT_DIR, emailName(file));
    const head = readFileSync(p).subarray(0, 8);
    assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${emailName(file)} is not a PNG`);
  }
});

test('a mail copy is small enough to send', () => {
  /*
   * These go out over mobile data, several to a message. The originals are
   * around 51KB each; anything here that is not comfortably under that is a
   * resize that did not happen.
   */
  for (const file of originals()) {
    const size = statSync(join(OUT_DIR, emailName(file))).size;
    assert.ok(size < 30 * 1024, `${emailName(file)} is ${(size / 1024).toFixed(0)}KB`);
    assert.ok(size < statSync(join(CATALOG, file)).size * 1.5,
      `${emailName(file)} is not meaningfully smaller than the 900px original`);
  }
});

test('the width in the name is the width the template draws', () => {
  // The <img> is drawn at 48 CSS pixels inside a 60px tile; the file is 192 so
  // a 4x phone still has pixels to spare. If the generator's width changes and
  // the name does not, every src in every past email keeps working and every
  // new one silently points at nothing.
  assert.match(emailImageUrl('assets/catalog/wax-135-argan.webp', BASE),
    new RegExp(`-${EMAIL_WIDTH}\\.png$`));
});

test('anything without a committed mail copy gets no URL at all', () => {
  /*
   * The empty string is the contract: itemRow() renders the line with no
   * thumbnail cell rather than with an <img> pointing at a file that was never
   * written. Returning a plausible-looking URL for these would put a broken
   * image in an inbox, which is strictly worse than putting none.
   */
  assert.equal(emailImageUrl('assets/logo-s7.png', BASE), '');
  assert.equal(emailImageUrl('assets/catalog/x.jpg', BASE), '', 'only webp has a mail copy');
  assert.equal(emailImageUrl('assets/gel-blue.webp', BASE), '', 'only the catalogue has mail copies');
  assert.equal(emailImageUrl('', BASE), '');
  assert.equal(emailImageUrl(null, BASE), '');
  assert.equal(emailImageUrl('javascript:alert(1)', BASE), '');
  assert.equal(emailImageUrl('assets/catalog/../../../etc/passwd.webp', BASE), '');
});

test('an uploaded image is passed through as it stands', () => {
  // There is no resize service in front of Vercel Blob and no variant was ever
  // generated, so the only honest answer is the URL the shop uploaded.
  const url = 'https://abc123.public.blob.vercel-storage.com/products/x.jpg';
  assert.equal(emailImageUrl(url, BASE), url);
});

const order = {
  ref: '100001',
  name: 'Alice Farouk',
  phone: '01000000000',
  address: '1 Nile St',
  city: 'Cairo',
  subtotal: 199,
  shipping: 30,
  discount: 0,
  total: 229,
};

test('the confirmation draws the jar the customer ordered', () => {
  const [, html] = tplOrder(
    order,
    [{ name: 'Cream Gel Argan', qty: 1, price: 199, image: 'assets/catalog/cream-gel-250-argan.webp' }],
    'en',
  );
  assert.match(html, /assets\/catalog\/email\/cream-gel-250-argan-192\.png/);
  // Word sizes an image from the attributes and ignores the CSS. Without both
  // of these a 192px file is drawn at 192px inside a 60px tile.
  assert.match(html, /<img src="[^"]*cream-gel-250-argan-192\.png" width="48" height="48"/);
});

test('a line with no picture still renders, and renders no <img>', () => {
  /*
   * Two ways to arrive here and both are ordinary: a product seeded without an
   * image, and an order placed before app/api/order/route.js started carrying
   * the column at all. Neither may cost the customer their receipt.
   */
  for (const image of ['', undefined, 'assets/logo-s7.png']) {
    const [, html] = tplOrder(order, [{ name: 'Cream Gel Argan', qty: 1, price: 199, image }], 'en');
    assert.match(html, /Cream Gel Argan/, 'the line vanished with its picture');
    assert.ok(!/<img[^>]+catalog/.test(html), `an image was rendered for ${JSON.stringify(image)}`);
  }
});

test('the mail is built on the real site, never on a relative path', () => {
  /*
   * A mail client has no base URL to resolve against, so a relative src is a
   * broken image everywhere. Every <img> in the rendered confirmation must
   * therefore be absolute - the logo in the shell as much as the jars.
   */
  const [, html] = tplOrder(
    order,
    [{ name: 'Cream Gel Argan', qty: 1, price: 199, image: 'assets/catalog/cream-gel-250-argan.webp' }],
    'en',
  );
  const srcs = [...html.matchAll(/<img[^>]+src="([^"]*)"/g)].map(m => m[1]);
  assert.ok(srcs.length >= 2, 'the confirmation drew neither a logo nor a jar');
  for (const src of srcs) {
    assert.match(src, /^https?:\/\/|^http:\/\/localhost/, `relative image src in an email: ${src}`);
  }
});
