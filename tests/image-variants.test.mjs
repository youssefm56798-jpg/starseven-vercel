/**
 * Every catalogue photograph has the narrow copies the markup asks for.
 *
 * lib/product-image.js builds a srcset by NAME - it appends `-300` and `-600`
 * to the stem and trusts the files to exist, because it also runs in the
 * browser bundle and cannot look at a disk. So the moment somebody commits a
 * new jar without running scripts/gen-image-variants.mjs, the shop grid points
 * at two files that 404.
 *
 * That failure is quiet in the worst way: a 404 on a srcset candidate does not
 * break the page, the browser falls back to `src` and draws the 900px original.
 * Nothing looks wrong, the images are simply three to five times heavier again
 * on every phone, and the only symptom is a number in an audit nobody is
 * running that week. Hence this.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { originals, missing, variantName, WIDTHS, CATALOG } from '../scripts/gen-image-variants.mjs';
import { imageSrcSet, imageUrl } from '../lib/product-image.js';

test('the catalogue is found at all', () => {
  // A scan that matches nothing passes for ever.
  assert.ok(originals().length >= 40, `only ${originals().length} catalogue images found`);
});

test('every catalogue image has all of its variants on disk', () => {
  const gaps = missing().map(([f, w]) => variantName(f, w));
  assert.deepEqual(gaps, [],
    `missing variants - run: node scripts/gen-image-variants.mjs\n${gaps.join('\n')}`);
});

test('the widths the helper emits are the widths the generator writes', () => {
  /*
   * The two lists are declared separately - one in scripts/, one in lib/, which
   * cannot import the script because it would drag node:fs into the browser
   * bundle. Two copies of a constant is exactly the arrangement that drifts, so
   * the srcset is parsed and compared against the generator's own list.
   */
  const srcset = imageSrcSet('assets/catalog/gel-wax-140-jojoba.webp');
  assert.ok(srcset, 'the helper returned no srcset for a catalogue image');
  const emitted = [...srcset.matchAll(/(\d+)w/g)].map(m => Number(m[1]));
  assert.deepEqual(emitted, [...WIDTHS, 900],
    'lib/product-image.js and scripts/gen-image-variants.mjs disagree about the widths');
});

test('every file the helper names actually exists', () => {
  const one = originals()[0];
  const srcset = imageSrcSet(`assets/catalog/${one}`);
  for (const [, url] of srcset.matchAll(/(\S+)\s+\d+w/g)) {
    const rel = url.replace(/^\//, '');
    assert.ok(existsSync(join(CATALOG, '..', '..', rel)), `srcset points at a file that is not there: ${url}`);
  }
});

test('a variant is genuinely smaller than the original it stands in for', () => {
  // The point of the exercise. A variant that is not smaller is a wasted
  // request and a wasted file in the repository.
  const one = originals()[0];
  const full = statSync(join(CATALOG, one)).size;
  for (const w of WIDTHS) {
    const v = statSync(join(CATALOG, variantName(one, w))).size;
    assert.ok(v < full, `${variantName(one, w)} is not smaller than the 900px original`);
  }
});

test('an uploaded image gets no srcset, and neither does anything else', () => {
  /*
   * Uploads live on Vercel Blob as one file with no variants and no resize
   * service in front of them, so offering a srcset for one would name two URLs
   * that do not exist. undefined rather than '' because React drops an
   * undefined attribute and renders srcset="" for the empty string.
   */
  assert.equal(imageSrcSet('https://abc123.public.blob.vercel-storage.com/x.webp'), undefined);
  assert.equal(imageSrcSet('assets/logo-s7.png'), undefined);
  assert.equal(imageSrcSet('assets/catalog/x.png'), undefined, 'only webp has variants');
  assert.equal(imageSrcSet(''), undefined);
  assert.equal(imageSrcSet(null), undefined);
  assert.equal(imageSrcSet('javascript:alert(1)'), undefined);
});

test('the pages that render many jars all pass a srcset', () => {
  /*
   * Adding the attribute to the helper does nothing until a call site uses it,
   * and the call sites are the ones carrying the bytes: the shop grid draws
   * sixty-three jars, the home grid and the product page's related row draw
   * four each.
   */
  const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  for (const file of [
    'app/shop/view.js',
    'app/_views/product.js',
    'app/_components/Landing.js',
    'app/_components/QuickView.js',
  ]) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /srcSet=\{imageSrcSet\(/, `${file} renders jars without a srcset`);
    // A srcset with no sizes makes the browser assume 100vw and pick the
    // largest candidate, which is the original - the whole saving, undone.
    assert.match(src, /sizes="/, `${file} has a srcSet but no sizes, so the browser will pick the 900px file`);
  }
});
