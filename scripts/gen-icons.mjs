/*
 * The site icons, from the star mark.
 *
 * The favicon was 64x64 on transparency. Two problems with that, and the first
 * one costs a search result:
 *
 *   Google will only draw a favicon in its results if it is square and its side
 *   is a MULTIPLE OF 48. 64 is not, so the icon beside the listing would have
 *   been dropped at exactly the moment the site started getting indexed. 192 is
 *   4x48 and is also the size Android wants for a home-screen shortcut.
 *
 *   Transparency means the black mark is drawn on whatever the client puts
 *   behind it, which in a dark browser tab or a dark search result is black on
 *   black. The paper ground is baked in for the same reason the mail logo bakes
 *   in its ink.
 *
 * Also written: an apple-touch-icon, which iOS uses for a home-screen bookmark
 * and which had no declaration at all, and a real favicon.ico, because /
 * favicon.ico was a 404 and that is still the first thing some clients ask for.
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MARK = `${ROOT}/public/assets/star-mark.png`;
const PAPER = '#FFFDF8';

/** The mark, centred on paper, with room around it so it reads when small. */
async function icon(size, pad = 0.18) {
  const inner = Math.round(size * (1 - pad * 2));
  const mark = await sharp(MARK)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const m = await sharp(mark).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: PAPER } })
    .composite([{
      input: mark,
      left: Math.round((size - m.width) / 2),
      top: Math.round((size - m.height) / 2),
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const favicon = await icon(192);
writeFileSync(`${ROOT}/public/assets/favicon.png`, favicon);

const apple = await icon(180, 0.14); // iOS crops to a rounded square, so less air
writeFileSync(`${ROOT}/public/apple-touch-icon.png`, apple);

/*
 * A real .ico. The format has allowed an embedded PNG since Vista, so the file
 * is a 6-byte header, one 16-byte directory entry, and the PNG itself - which
 * is why this is nine lines rather than a dependency.
 */
const ico48 = await icon(48, 0.14);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // 1 = icon
header.writeUInt16LE(1, 4);      // one image
const entry = Buffer.alloc(16);
entry[0] = 48;                   // width
entry[1] = 48;                   // height
entry[2] = 0;                    // colours in palette (0 = truecolour)
entry[3] = 0;                    // reserved
entry.writeUInt16LE(1, 4);       // colour planes
entry.writeUInt16LE(32, 6);      // bits per pixel
entry.writeUInt32LE(ico48.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);
writeFileSync(`${ROOT}/public/favicon.ico`, Buffer.concat([header, entry, ico48]));

for (const [label, buf, n] of [['favicon.png', favicon, 192], ['apple-touch-icon.png', apple, 180], ['favicon.ico', ico48, 48]]) {
  console.log(`  ${label.padEnd(22)} ${n}x${n}  ${(buf.length / 1024).toFixed(1)}KB` +
    (n % 48 === 0 ? '  (multiple of 48)' : ''));
}
