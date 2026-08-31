/**
 * The rules the admin product form enforces, and the file sniffing behind the
 * upload.
 *
 * No database, like the rest of tests/. Everything here is a pure function on
 * purpose, precisely so the cases that matter can be exercised: a form field
 * holding 1e12, a hair-type list with a repeat in it, a PNG whose header says
 * forty thousand pixels, an HTML document named .webp. None of those are
 * things anybody will produce by hand against a live panel, and all of them are
 * things that reach a live panel eventually.
 *
 * The statements these values end up inside are proved against a real Postgres
 * by scripts/verify-product-admin.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HAIR_SLOTS, KIND_LABELS, KINDS, MONEY_MAX,
  cleanHairTypes, hairTypesFromCsv, normaliseSku, parseProductForm, resolveImage, slugify,
} from '../lib/product-form.js';
import {
  MAX_IMAGE_BYTES, MAX_IMAGE_DIM, MIN_IMAGE_DIM,
  blobKey, checkImageBytes, sniffImage,
} from '../lib/image-file.js';
import { absoluteImageUrl, imageUrl, isAssetPath, isBlobImage, validateImageRef } from '../lib/product-image.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

/** A form carrying enough to be valid, plus whatever the test overrides. */
function form(extra = {}) {
  const fd = new FormData();
  const base = {
    sku: 'S7-TEST-1', slug: 'test-product',
    kind: 'wax', name_ar: 'واكس تجريبي', name_en: 'Test Wax',
    price: '45', color: '#D7291D', hold_level: '3', stock: '10', sort: '5',
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) {
    if (v === undefined) continue;
    fd.set(k, String(v));
  }
  for (const k of Object.keys(extra)) if (extra[k] === undefined) fd.delete(k);
  return fd;
}

const created = extra => parseProductForm(form(extra), { mode: 'create' });

/* --------------------------------------------------------------- the kinds */

test('the kind list is exactly what the CHECK constraint allows', () => {
  // A select offering a value the database refuses is a 500 the owner reaches
  // by picking the wrong item from a menu we drew for them.
  const schema = read('db/schema.sql');
  const block = schema.match(/ADD CONSTRAINT products_kind_check\s*CHECK \(kind IN \(([^)]*)\)\)/);
  assert.ok(block, 'no products_kind_check in the schema');
  const allowed = [...block[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]);
  assert.deepEqual([...KINDS].sort(), [...allowed].sort());
});

test('every kind has a label, and nothing else does', () => {
  assert.deepEqual(Object.keys(KIND_LABELS).sort(), [...KINDS].sort());
});

/* ------------------------------------------------------------ what refuses */

test('both names are required', () => {
  assert.equal(created({ name_ar: '' }).error, 'product_needs_name');
  assert.equal(created({ name_en: '   ' }).error, 'product_needs_name');
});

test('an unknown kind is refused rather than silently defaulted', () => {
  // Defaulting would put a product in a category the owner did not pick, and
  // the shop pages would then quietly not show it.
  for (const bad of ['paste', 'WAX', '', 'wax; drop', undefined]) {
    assert.equal(created({ kind: bad }).error, 'product_bad_kind', String(bad));
  }
});

test('a colour that is not six hex digits is refused', () => {
  // products.color is interpolated into the --c custom property on the
  // storefront. Anything that is not a colour has no business reaching it.
  for (const bad of ['red', '#fff', '#D7291DD', 'rgb(0,0,0)', 'red; background:url(//x)', '']) {
    assert.equal(created({ color: bad }).error, 'product_bad_colour', bad);
  }
  assert.equal(created({ color: '#d7291d' }).values.color, '#D7291D', 'stored uppercase');
});

test('a SKU is letters, digits, hyphens and underscores, and it is shouted', () => {
  assert.equal(created({ sku: 's7-wax-mint' }).values.sku, 'S7-WAX-MINT');
  assert.equal(created({ sku: 'S7 WAX MINT' }).values.sku, 'S7-WAX-MINT');
  for (const bad of ['', 'A', '-', '   ']) {
    assert.equal(created({ sku: bad }).error, 'product_bad_sku', JSON.stringify(bad));
  }
  // Forty characters is the ceiling, and the cut happens before the check so a
  // long value is refused rather than quietly truncated into a different SKU.
  assert.equal(normaliseSku('X'.repeat(60)).length, 40);
});

test('a blank web address is derived from the English name', () => {
  assert.equal(created({ slug: '' }).values.slug, 'test-wax');
  assert.equal(created({ slug: '  Premium Wax — Mint!  ' }).values.slug, 'premium-wax-mint');
});

test('a web address that cannot be built out of Latin characters is refused', () => {
  // A percent-encoded Arabic slug is forty characters of noise in a WhatsApp
  // link, so the honest answer is to ask for one rather than to invent it.
  assert.equal(created({ slug: '', name_en: 'واكس' }).error, 'product_bad_slug');
  assert.equal(created({ slug: '!!!' , name_en: '؟؟' }).error, 'product_bad_slug');
});

test('slugify cannot produce a path, a query or a traversal', () => {
  for (const raw of ['../../admin', 'a/b', 'x?y=1', 'a b', '..']) {
    const out = slugify(raw);
    assert.ok(!out.includes('/') && !out.includes('.') && !out.includes('?'), `${raw} -> ${out}`);
  }
});

/* ------------------------------------------------------------ what clamps */

test('every number is clamped to what its column can hold', () => {
  // sort is SMALLINT, price is NUMERIC(10,2), hold_level has a CHECK of 1..5.
  // An out-of-range value is not a crash the owner should meet; it is the
  // nearest legal number.
  const v = created({
    price: '1e12', compare_at: '', stock: '-5', hold_level: '9', sort: '99999', size_ml: '',
  }).values;
  assert.equal(v.price, MONEY_MAX);
  assert.equal(v.stock, 0);
  assert.equal(v.hold_level, 5);
  assert.equal(v.sort, 32767);
  assert.equal(created({ sort: '-99999' }).values.sort, -32768);
  assert.equal(created({ hold_level: '0' }).values.hold_level, 1);
});

test('rubbish in a number field is a default, never a NaN', () => {
  // NaN reaches Postgres as the string NaN and takes the whole statement with
  // it, which is a blank screen and twenty other fields of typing lost.
  const v = created({ price: 'abc', stock: 'abc', hold_level: 'abc', sort: 'abc' }).values;
  assert.equal(v.price, 0);
  assert.equal(v.stock, 0);
  assert.equal(v.hold_level, 3);
  assert.equal(v.sort, 0);
});

test('a blank optional number is null, not zero', () => {
  // size_ml and compare_at are nullable and mean "not applicable". Zero would
  // print a 0ml pack and a struck-through price of nothing.
  const v = created({ size_ml: '', compare_at: '' }).values;
  assert.equal(v.size_ml, null);
  assert.equal(v.compare_at, null);
  assert.equal(created({ size_ml: '120' }).values.size_ml, 120);
});

test('a was-price at or below the price is dropped', () => {
  assert.equal(created({ price: '45', compare_at: '45' }).values.compare_at, null);
  assert.equal(created({ price: '45', compare_at: '30' }).values.compare_at, null);
  assert.equal(created({ price: '45', compare_at: '55' }).values.compare_at, 55);
});

test('a price of zero is a real value, not a missing one', () => {
  // The storefront reads it as "ask us" and shows a WhatsApp button. Thirty-one
  // seeded products are in exactly that state.
  const out = created({ price: '0' });
  assert.equal(out.ok, true);
  assert.equal(out.values.price, 0);
});

/* -------------------------------------------------------------- hair types */

test('the hair-type slots keep their order and drop the nonsense', () => {
  const fd = form();
  fd.set('hair_1', 'thick');
  fd.set('hair_2', '');
  fd.set('hair_3', 'wavy');
  fd.set('hair_4', 'thick');      // repeat
  fd.set('hair_5', 'purple');     // not a tile
  assert.equal(parseProductForm(fd, { mode: 'create' }).values.hair_types, 'thick,wavy');
});

test('a form with no slots falls back to the comma-separated field', () => {
  const fd = form({ hair_types: 'wavy, thick , wavy, nonsense' });
  assert.equal(parseProductForm(fd, { mode: 'create' }).values.hair_types, 'wavy,thick');
});

test('order is the meaning, so it is preserved exactly', () => {
  assert.deepEqual(cleanHairTypes(['coily', 'curly', 'wavy']), ['coily', 'curly', 'wavy']);
  assert.deepEqual(hairTypesFromCsv('curly,coily'), ['curly', 'coily']);
  assert.deepEqual(hairTypesFromCsv(''), []);
  assert.deepEqual(hairTypesFromCsv(null), []);
});

test('there is one slot per tile and no more', () => {
  assert.equal(HAIR_SLOTS, 7);
});

/* ------------------------------------------------------------ edit vs create */

test('an edit form does not carry the two permanent keys', () => {
  // sku and slug are set once. See lib/product-admin.js: renaming a SKU can
  // fail the next deploy, and renaming a slug breaks every link to the page.
  const out = parseProductForm(form({ sku: 'WHATEVER', slug: 'whatever' }), { mode: 'edit' });
  assert.equal(out.ok, true);
  assert.equal(out.values.sku, undefined);
  assert.equal(out.values.slug, undefined);
});

test('an edit is refused for the same reasons a create is', () => {
  assert.equal(parseProductForm(form({ name_en: '' }), { mode: 'edit' }).error, 'product_needs_name');
  assert.equal(parseProductForm(form({ color: 'x' }), { mode: 'edit' }).error, 'product_bad_colour');
});

/* --------------------------------------------------------- the image column */

test('an uploaded URL is accepted only on the blob host', () => {
  assert.ok(isBlobImage('https://abc123.public.blob.vercel-storage.com/products/x-1.webp'));
  for (const bad of [
    'http://abc.public.blob.vercel-storage.com/x.webp',            // not https
    'https://evil.com/x.public.blob.vercel-storage.com/x.webp',    // host is evil.com
    'https://public.blob.vercel-storage.com.evil.com/x.webp',      // suffix trick
    'https://abc.public.blob.vercel-storage.com',                  // no object
    'https://abc.private.blob.vercel-storage.com/x.webp',
    'javascript:alert(1)',
    '',
  ]) {
    assert.equal(isBlobImage(bad), false, bad);
  }
});

test('a path in public/ cannot walk out of assets/', () => {
  assert.ok(isAssetPath('assets/catalog/wax-135-argan.webp'));
  for (const bad of [
    'assets/../../etc/passwd', '../assets/x.webp', '/etc/passwd', 'assets//x.webp',
    'assets/x.svg', 'assets/x.html', 'assets/x', 'public/assets/x.webp', 'assets/x.webp?a=b',
  ]) {
    assert.equal(isAssetPath(bad), false, bad);
  }
});

test('validateImageRef normalises the one shape and refuses the rest', () => {
  assert.equal(validateImageRef('/assets/catalog/x.webp'), 'assets/catalog/x.webp');
  assert.equal(validateImageRef('ASSETS/CATALOG/X.WEBP'), 'assets/catalog/x.webp');
  for (const bad of ['', '   ', 'data:image/png;base64,AAAA', 'https://example.com/x.webp',
                     'assets/../secret.webp', 'javascript:alert(1)']) {
    assert.equal(validateImageRef(bad), null, JSON.stringify(bad));
  }
});

test('imageUrl never hands a browser a scheme it can act on', () => {
  assert.equal(imageUrl('assets/x.webp'), '/assets/x.webp');
  assert.equal(imageUrl('/assets/x.webp'), '/assets/x.webp');
  assert.equal(imageUrl('https://s.public.blob.vercel-storage.com/p/x.webp'),
    'https://s.public.blob.vercel-storage.com/p/x.webp');
  // Belt to the braces of validateImageRef: even a row that predates the
  // validation cannot turn into an active scheme on the page.
  assert.equal(imageUrl('javascript:alert(1)'), '/javascript:alert(1)');
  assert.equal(imageUrl('//evil.com/x.webp'), '/evil.com/x.webp');
});

test('absoluteImageUrl is absolute for both shapes', () => {
  assert.equal(absoluteImageUrl('assets/x.webp', 'https://shop.example/'), 'https://shop.example/assets/x.webp');
  assert.equal(absoluteImageUrl('https://s.public.blob.vercel-storage.com/p/x.webp', 'https://shop.example'),
    'https://s.public.blob.vercel-storage.com/p/x.webp');
});

test('resolveImage prefers the upload, then the typed path, then what is there', () => {
  const blob = 'https://s.public.blob.vercel-storage.com/p/x.webp';
  assert.equal(resolveImage({ uploadedUrl: blob, typed: 'assets/a.webp', current: 'assets/b.webp' }), blob);
  assert.equal(resolveImage({ uploadedUrl: null, typed: 'assets/a.webp', current: 'assets/b.webp' }), 'assets/a.webp');
  assert.equal(resolveImage({ uploadedUrl: null, typed: '', current: 'assets/b.webp' }), 'assets/b.webp');
  assert.equal(resolveImage({ uploadedUrl: null, typed: '', current: '' }), null);
  // A bad typed value is refused rather than falling through to the old image,
  // because falling through would quietly ignore what the owner typed.
  assert.equal(resolveImage({ uploadedUrl: null, typed: '../x', current: 'assets/b.webp' }), null);
});

/* ------------------------------------------------------ what an image is */

const bytes = (...parts) => {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return new Uint8Array(out);
};
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = n => [(n >>> 8) & 255, n & 255];
const le16 = n => [n & 255, (n >>> 8) & 255];

const png = (w, h) => bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h),
  [8, 6, 0, 0, 0]);
const gif = (w, h) => bytes('GIF89a', le16(w), le16(h), [0, 0, 0]);
const webpLossy = (w, h) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0],
  [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h));
const webpLossless = (w, h) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8L', [0, 0, 0, 0], [0x2f],
    [bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255], [0, 0, 0, 0]);
};
const webpExtended = (w, h) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0],
  [0x10, 0, 0, 0],
  [(w - 1) & 255, ((w - 1) >>> 8) & 255, ((w - 1) >>> 16) & 255],
  [(h - 1) & 255, ((h - 1) >>> 8) & 255, ((h - 1) >>> 16) & 255]);
const jpeg = (w, h) => bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), 'JFIF', [0],
  [1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0], be16(17), [8], be16(h), be16(w), [3],
  [1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

test('every format the panel accepts is read out of its own header', () => {
  assert.deepEqual(sniffImage(png(600, 600)), { mime: 'image/png', ext: 'png', width: 600, height: 600 });
  assert.deepEqual(sniffImage(gif(300, 200)), { mime: 'image/gif', ext: 'gif', width: 300, height: 200 });
  assert.deepEqual(sniffImage(webpLossy(800, 640)), { mime: 'image/webp', ext: 'webp', width: 800, height: 640 });
  assert.deepEqual(sniffImage(webpLossless(512, 512)), { mime: 'image/webp', ext: 'webp', width: 512, height: 512 });
  assert.deepEqual(sniffImage(webpExtended(1024, 768)), { mime: 'image/webp', ext: 'webp', width: 1024, height: 768 });
  assert.deepEqual(sniffImage(jpeg(1200, 900)), { mime: 'image/jpeg', ext: 'jpg', width: 1200, height: 900 });
});

test('the real product photographs in this repository are recognised', () => {
  // The sniffer is written against specifications; this is written against the
  // files the shop actually ships, which is the other half of the same claim.
  const file = read('public/assets/catalog/wax-135-argan.webp');
  const buf = readFileSync(join(ROOT, 'public/assets/catalog/wax-135-argan.webp'));
  assert.ok(file.length > 0);
  const seen = sniffImage(new Uint8Array(buf));
  assert.ok(seen, 'a catalogue image was not recognised as an image');
  assert.equal(seen.mime, 'image/webp');
  assert.ok(seen.width >= MIN_IMAGE_DIM && seen.width <= MAX_IMAGE_DIM, `width ${seen.width}`);
  assert.equal(checkImageBytes(new Uint8Array(buf)).ok, true);
});

test('a file that is not an image is refused however it is dressed up', () => {
  // The three things the browser tells us about an upload - the name, the
  // Content-Type and the extension - are all chosen by whoever is uploading.
  // These are what is left when none of them is believed.
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
  const zip = bytes('PK', [3, 4], new Array(40).fill(0));
  const pdf = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n');
  for (const [what, data] of [['html', html], ['svg', svg], ['zip', zip], ['pdf', pdf]]) {
    assert.equal(sniffImage(data), null, what);
    assert.equal(checkImageBytes(data).reason, 'not-an-image', what);
  }
});

test('a truncated or empty file is a refusal, never a throw', () => {
  assert.equal(checkImageBytes(new Uint8Array(0)).reason, 'empty');
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50])), null);
  assert.equal(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'WEBP')), null);
  assert.equal(sniffImage(bytes([0xff, 0xd8, 0xff])), null);
  assert.equal(sniffImage(null), null);
  assert.equal(sniffImage(undefined), null);
});

test('a header claiming an absurd size is refused before anything decodes it', () => {
  // The point of reading the dimensions out of the header rather than decoding
  // is that this costs nothing: a 40-byte file that claims 40000 x 40000 never
  // becomes six gigabytes of pixels anywhere.
  assert.equal(checkImageBytes(png(40000, 40000)).reason, 'too-large');
  assert.equal(checkImageBytes(png(16, 16)).reason, 'too-small');
  assert.equal(checkImageBytes(png(2000, 300)).reason, 'odd-shape');
  assert.equal(checkImageBytes(png(600, 600)).ok, true);
});

test('the size cap is enforced on the bytes, not on what was declared', () => {
  const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
  huge.set(png(600, 600), 0);
  assert.equal(checkImageBytes(huge).reason, 'too-big');
});

/* ---------------------------------------------------------- the stored name */

test('the stored name is built here and cannot escape its prefix', () => {
  for (const hostile of ['../../index', 'a/b/c', '..', './x', 'S7 WAX/../..', '']) {
    const key = blobKey(hostile, 'webp');
    assert.ok(key.startsWith('products/'), key);
    assert.equal(key.split('/').length, 2, `${hostile} -> ${key}`);
    assert.ok(!key.includes('..'), key);
    assert.match(key, /^products\/[a-z0-9-]+\.webp$/, key);
  }
});

test('two uploads of the same product are two objects', () => {
  // A replacement image must never overwrite the object a rendered page is
  // already pointing at, so the name carries eight random bytes.
  const keys = new Set(Array.from({ length: 50 }, () => blobKey('S7-WAX-RED', 'webp')));
  assert.equal(keys.size, 50);
});

test('the extension comes from the sniff, and a rogue one is not used', () => {
  assert.match(blobKey('x', 'jpg'), /\.jpg$/);
  assert.match(blobKey('x', '../evil'), /\.bin$/);
  assert.match(blobKey('x', 'phtml'), /\.bin$/);
});
