#!/usr/bin/env node
/**
 * The pictures an email client is allowed to draw.
 *
 *   node scripts/gen-email-images.mjs          write anything missing
 *   node scripts/gen-email-images.mjs --check  report, write nothing
 *   node scripts/gen-email-images.mjs --force  rewrite every file
 *
 * The order confirmation now shows the jars the customer bought, and it cannot
 * point at the catalogue files to do it. Two reasons, and both are about the
 * inbox rather than about the shop.
 *
 * The catalogue is WebP. Every browser has read WebP for years, which is why
 * the storefront is built on it — but Outlook on Windows renders mail through
 * Word, and Word has never decoded a WebP in its life. A customer on desktop
 * Outlook would get the red X, on the one email that matters most. So the mail
 * copies are PNG: the only lossless format with an alpha channel that every
 * mail client in use understands.
 *
 * And the catalogue originals are 900x900 with the jar floating in the middle
 * of a lot of empty space — right for a product page that draws it large, wrong
 * for a 96px row where a third of the width would be nothing at all. Each copy
 * is therefore trimmed to the jar and re-centred, so every line of the order
 * table gets a jar of the same visual weight no matter how the photograph was
 * framed.
 *
 * ---------------------------------------------------------------------------
 * Why these are committed rather than generated on the fly
 *
 * Same reason as scripts/gen-image-variants.mjs, which this deliberately
 * mirrors: there is no image CDN in front of this site and no next/image, and
 * standing one up to resize 55 photographs that change a few times a year would
 * cost more than it saves. tests/email-images.test.mjs fails if a catalogue
 * image is added without running this.
 *
 * ---------------------------------------------------------------------------
 * The white wordmark
 *
 * public/assets/logo-s7.png is black artwork on transparency, which is correct
 * for the site — the header there is paper. The email header is ink, and a
 * black logo on it is an invisible logo. The light copy is generated from the
 * black one rather than drawn by hand so the two can never drift: it is the
 * same alpha channel, filled white.
 *
 * ---------------------------------------------------------------------------
 * Why the mail images are not gated
 *
 * They are served from /assets, which middleware.js excludes from its matcher.
 * That matters while SITE_PASSWORD is set: every other route answers 401, and
 * an <img> in an inbox cannot answer a Basic auth challenge. Moving these
 * anywhere else would leave the confirmation email with broken pictures for as
 * long as the shop stays closed.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const CATALOG = join(ROOT, 'public', 'assets', 'catalog');
export const OUT_DIR = join(CATALOG, 'email');

/** The wordmark, and the white copy generated from it. */
export const LOGO_SRC = join(ROOT, 'public', 'assets', 'logo-s7.png');
export const LOGO_OUT = join(ROOT, 'public', 'assets', 'logo-s7-light.png');

/**
 * 192 for a 96px row: mail is read on phones, and every phone is at least 2x.
 * One width rather than a srcset, because srcset is one more thing Word does
 * not implement — a mail client is handed exactly one URL per image.
 */
export const EMAIL_WIDTH = 192;

/** The widths gen-image-variants.mjs writes, which are not originals. */
const VARIANTS = [300, 600];

/** `wax-135-argan.webp` -> `wax-135-argan-192.png` */
export const emailName = file => file.replace(/\.webp$/i, `-${EMAIL_WIDTH}.png`);

/** Catalogue originals: the 900px files, never the variants themselves. */
export function originals(dir = CATALOG) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.webp'))
    .filter(f => !VARIANTS.some(w => f.endsWith(`-${w}.webp`)))
    .sort();
}

/** Which mail copies are missing, as file names of the originals. */
export function missing(dir = CATALOG, out = OUT_DIR) {
  return originals(dir).filter(f => !existsSync(join(out, emailName(f))));
}

/* ------------------------------------------------------------------ cli */

if (process.argv[1]?.endsWith('gen-email-images.mjs')) {
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');
  const gaps = force ? originals() : missing();
  const needLogo = force || !existsSync(LOGO_OUT);

  if (check) {
    const notes = [];
    if (gaps.length) notes.push(`${gaps.length} mail image(s) missing:\n${gaps.map(f => `    ${emailName(f)}`).join('\n')}`);
    if (needLogo) notes.push('the white wordmark is missing: assets/logo-s7-light.png');
    console.log(notes.length
      ? `\n  ${notes.join('\n  ')}\n`
      : `\n  all ${originals().length} catalogue images have a mail copy, and the wordmark is there\n`);
    process.exit(notes.length ? 1 : 0);
  }

  if (!gaps.length && !needLogo) {
    console.log(`\n  nothing to do - ${originals().length} images already have a mail copy\n`);
    process.exit(0);
  }

  const { default: sharp } = await import('sharp');
  mkdirSync(OUT_DIR, { recursive: true });

  if (needLogo) {
    /*
     * White pixels wearing the black logo's alpha.
     *
     * Negating the colour would work on artwork that is pure black and would
     * quietly invert anything that is not, so the colour channels are thrown
     * away entirely and replaced with a flat white of the same size. What
     * survives is the shape, which is the only part worth keeping.
     */
    const { width, height } = await sharp(LOGO_SRC).metadata();
    const alpha = await sharp(LOGO_SRC).ensureAlpha().extractChannel('alpha').toBuffer();
    await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
      .joinChannel(alpha)
      .png({ compressionLevel: 9 })
      .toFile(LOGO_OUT);
    console.log(`  wrote assets/logo-s7-light.png (${width}x${height})`);
  }

  let before = 0;
  let after = 0;
  for (const file of gaps) {
    const src = join(CATALOG, file);
    const dest = join(OUT_DIR, emailName(file));
    await sharp(src)
      // Cut the transparent margin off, then letterbox back to a square on
      // transparency. `contain` never crops and never distorts, so a jar that
      // is taller than it is wide keeps its proportions and simply gets
      // narrower bands of nothing at its sides.
      .trim()
      .resize(EMAIL_WIDTH, EMAIL_WIDTH, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      // 8-bit palette: these are flat studio shots of a single object, so the
      // colour loss is invisible and the file is a third of the size. Mail is
      // opened on mobile data.
      .png({ palette: true, quality: 90, compressionLevel: 9 })
      .toFile(dest);
    before += statSync(src).size;
    after += statSync(dest).size;
  }

  if (gaps.length) {
    console.log(`\n  wrote ${gaps.length} mail image(s)`);
    console.log(`  originals ${(before / 1024).toFixed(0)}KB -> mail copies ${(after / 1024).toFixed(0)}KB\n`);
  } else {
    console.log('');
  }
}
