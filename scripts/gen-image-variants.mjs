#!/usr/bin/env node
/**
 * Narrow copies of the catalogue photographs, so a phone stops downloading a
 * 900px jar to draw it 300px wide.
 *
 *   node scripts/gen-image-variants.mjs          write anything missing
 *   node scripts/gen-image-variants.mjs --check  report, write nothing
 *
 * Every product photograph in public/assets/catalog is 900x900 and about 51KB.
 * The shop grid draws them at 300 and the product page at 600, so on a 2x phone
 * the grid needs 600 device pixels and gets 900 - and it does that 63 times.
 *
 * Two widths rather than a ladder of six. 300 and 600 are the two sizes the
 * markup actually asks for; anything between them would be a size no <img> on
 * this site requests, and the browser picks by device pixel ratio rather than
 * by taste. The 900 original stays as the last entry in every srcset, for a
 * desktop at 2x.
 *
 * Variants are committed rather than generated at request time on purpose. This
 * site has no image CDN and does not use next/image - the whole catalogue is
 * static files served from the edge, and adding a resize service to save a few
 * hundred kilobytes would cost more than it saves. tests/image-variants.test.mjs
 * fails if a catalogue image is added without running this.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CATALOG = join(ROOT, 'public', 'assets', 'catalog');

/** The widths the markup asks for. Keep in step with lib/product-image.js. */
export const WIDTHS = [300, 600];

/** `wax-135-argan.webp` -> `wax-135-argan-300.webp` */
export const variantName = (file, width) => file.replace(/\.webp$/i, `-${width}.webp`);

/** Catalogue originals: the 900px files, never the variants themselves. */
export function originals(dir = CATALOG) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.webp'))
    .filter(f => !WIDTHS.some(w => f.endsWith(`-${w}.webp`)))
    .sort();
}

/** Which variants are missing, as [file, width] pairs. */
export function missing(dir = CATALOG) {
  const out = [];
  for (const f of originals(dir)) {
    for (const w of WIDTHS) {
      if (!existsSync(join(dir, variantName(f, w)))) out.push([f, w]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ cli */

if (process.argv[1]?.endsWith('gen-image-variants.mjs')) {
  const check = process.argv.includes('--check');
  const gaps = missing();

  if (check) {
    console.log(gaps.length
      ? `\n  ${gaps.length} variant(s) missing:\n${gaps.map(([f, w]) => `    ${variantName(f, w)}`).join('\n')}\n`
      : `\n  all ${originals().length} catalogue images have their ${WIDTHS.join(' and ')} variants\n`);
    process.exit(gaps.length ? 1 : 0);
  }

  if (!gaps.length) {
    console.log(`\n  nothing to do - ${originals().length} images already have every variant\n`);
    process.exit(0);
  }

  const { default: sharp } = await import('sharp');
  let before = 0;
  let after = 0;
  for (const [file, width] of gaps) {
    const src = join(CATALOG, file);
    const dest = join(CATALOG, variantName(file, width));
    // fit: 'inside' so a non-square original is never distorted; these are all
    // square today and that is not a thing to depend on.
    await sharp(src).resize(width, width, { fit: 'inside' }).webp({ quality: 80 }).toFile(dest);
    before += statSync(src).size;
    after += statSync(dest).size;
  }
  console.log(`\n  wrote ${gaps.length} variant(s)`);
  console.log(`  originals ${(before / 1024).toFixed(0)}KB -> variants ${(after / 1024).toFixed(0)}KB\n`);
}
