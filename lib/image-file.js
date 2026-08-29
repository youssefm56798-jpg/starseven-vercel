/**
 * Deciding whether an uploaded file is a product photograph.
 *
 * The admin panel takes a file straight from the owner's laptop and puts it on
 * a public URL that the storefront then renders. Three things about that upload
 * arrive from the browser and none of them are evidence:
 *
 *   the filename          chosen by whoever is uploading. It is never used —
 *                         see blobKey() at the bottom, which builds the stored
 *                         name from the SKU and eight random bytes. A name
 *                         from the client is how `../../index.html` and
 *                         `logo.webp.html` get written.
 *   the Content-Type      chosen by whoever is uploading. A .webp header on an
 *                         HTML document is one line of curl.
 *   the extension         a substring of the filename, so the same thing twice.
 *
 * What is left is the bytes, which is what this module reads. sniffImage()
 * recognises the four raster formats a browser will render, takes the real
 * media type from the file signature, and reads the dimensions out of the
 * header — so a "1 KB" image that decodes to 40000 x 40000 is refused before it
 * reaches anybody.
 *
 * SVG is deliberately not on the list, and that is a security decision rather
 * than an oversight. An SVG is a document: it can carry <script>, and it is
 * served from the blob host as image/svg+xml, which a browser will happily
 * execute if it is ever opened directly rather than through an <img>. A shop
 * has no need to upload one.
 *
 * Everything here is pure and synchronous so tests/ can exercise it with no
 * database, no network and no Vercel account — which is where the interesting
 * cases live, because they are the ones nobody will produce by hand.
 */

/**
 * Three megabytes.
 *
 * A 1000px product photograph is 60-150 KB as WebP and under a megabyte as an
 * unoptimised phone JPEG, so this is generous rather than tight. It has to stay
 * comfortably under the Server Action body limit set in next.config.mjs, which
 * is what actually rejects an oversized POST — this constant is the message the
 * owner reads instead of a stack trace.
 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Below this a picture is a thumbnail or a tracking pixel, not a pack shot. */
export const MIN_IMAGE_DIM = 120;

/** Above this it is a camera original nobody meant to publish. */
export const MAX_IMAGE_DIM = 4096;

/**
 * Sanity, not art direction. The cards are square and the product page shows
 * the image at 600x600, so anything past five to one is a banner, a screenshot
 * of a spreadsheet, or a decompression bomb wearing a thin disguise.
 */
export const MAX_IMAGE_ASPECT = 5;

const ascii = (bytes, at, text) => {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function png(b) {
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return null;
  // The first chunk of a PNG must be IHDR, and the two dimensions are the
  // first eight bytes of it. A file whose first chunk is something else is not
  // a PNG a decoder would accept either.
  if (!ascii(b, 12, 'IHDR')) return null;
  return { mime: 'image/png', ext: 'png', width: be32(b, 16), height: be32(b, 20) };
}

function gif(b) {
  if (b.length < 10) return null;
  if (!ascii(b, 0, 'GIF87a') && !ascii(b, 0, 'GIF89a')) return null;
  return { mime: 'image/gif', ext: 'gif', width: le16(b, 6), height: le16(b, 8) };
}

/**
 * WebP, in all three of its shapes.
 *
 * The container is RIFF, and the fourth chunk tag says which encoding is
 * inside: lossy (VP8 ), lossless (VP8L) or extended (VP8X, which is what an
 * animated or alpha-carrying WebP uses). They store the size in three
 * different places and two different bit layouts, so all three are read rather
 * than assuming the common one.
 */
function webp(b) {
  // Enough for the container and the chunk tag. Each branch below then checks
  // that the bytes IT reads are present, because the three shapes need
  // different amounts and a single generous minimum would reject the shortest
  // legal one — which is exactly the mistake that made a real lossless WebP
  // land as "not an image".
  if (b.length < 16) return null;
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;

  if (ascii(b, 12, 'VP8 ')) {
    if (b.length < 30) return null;
    // Lossy: a three-byte frame tag, then the start code, then two 14-bit
    // dimensions. The start code is checked because without it any three bytes
    // would be read as a size.
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
    return {
      mime: 'image/webp', ext: 'webp',
      width: le16(b, 26) & 0x3fff,
      height: le16(b, 28) & 0x3fff,
    };
  }

  if (ascii(b, 12, 'VP8L')) {
    if (b.length < 25) return null;
    if (b[20] !== 0x2f) return null;             // lossless signature byte
    const bits = le32(b, 21);
    return {
      mime: 'image/webp', ext: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (ascii(b, 12, 'VP8X')) {
    if (b.length < 30) return null;
    // Extended: canvas size as two 24-bit little-endian values, each one less
    // than the real dimension.
    return {
      mime: 'image/webp', ext: 'webp',
      width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
      height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    };
  }

  return null;
}

/**
 * JPEG, which has no header to read — the size lives in a frame marker that
 * can be anywhere in the file, after any number of thumbnails, colour profiles
 * and comment segments. So the markers are walked.
 *
 * The walk is bounded by the length of the file and every segment length is
 * checked to be at least two, so a malformed file ends the loop rather than
 * spinning on a zero-length segment.
 */
function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;              // not where a marker should be
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }      // fill byte, legal padding
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;                                    // standalone, no payload
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;  // end, or entropy data
    const len = be16(b, i + 2);
    if (len < 2) return null;
    // SOF0..SOF15 carry the frame dimensions. C4 (Huffman tables), C8 (JPEG
    // extension) and CC (arithmetic coding tables) share the range and do not.
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > b.length) return null;
      return { mime: 'image/jpeg', ext: 'jpg', height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * The real media type and pixel size of a file, or null if it is not one of
 * the four formats.
 *
 * Takes a Uint8Array (a Buffer is one). Never throws: a truncated or hostile
 * file is a null, because every caller has to render that case anyway and an
 * exception would only be a second way to say the same thing.
 */
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const found = png(b) ?? gif(b) ?? webp(b) ?? jpeg(b);
  if (!found) return null;
  if (!Number.isInteger(found.width) || !Number.isInteger(found.height)) return null;
  if (found.width <= 0 || found.height <= 0) return null;
  return found;
}

/**
 * Everything the upload has to satisfy, in one answer.
 *
 *   { ok: true, mime, ext, width, height }
 *   { ok: false, reason: 'empty' | 'too-big' | 'not-an-image' | 'too-small' | 'too-large' | 'odd-shape' }
 *
 * A reason code rather than a sentence, because the panel renders the wording
 * and a message travelling through a query string is a message an attacker can
 * choose — the same rule app/admin/_lib/ui.js already follows.
 */
export function checkImageBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (b.length === 0) return { ok: false, reason: 'empty' };
  if (b.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-big' };

  const found = sniffImage(b);
  if (!found) return { ok: false, reason: 'not-an-image' };

  const { width, height } = found;
  if (width < MIN_IMAGE_DIM || height < MIN_IMAGE_DIM) return { ok: false, reason: 'too-small' };
  if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) return { ok: false, reason: 'too-large' };

  const ratio = Math.max(width / height, height / width);
  if (ratio > MAX_IMAGE_ASPECT) return { ok: false, reason: 'odd-shape' };

  return { ok: true, ...found };
}

/**
 * The name the file is stored under.
 *
 * Built here and never taken from the client, which is the whole point. Three
 * properties matter and each one is deliberate:
 *
 *   it cannot escape `products/`   the SKU is reduced to lower-case letters,
 *                                  digits and hyphens before it is used, so
 *                                  there is no slash, no dot and no `..` left
 *                                  to walk out of the prefix with.
 *   it cannot collide             eight random bytes. Two uploads of the same
 *                                  photograph for the same SKU are two objects,
 *                                  so replacing an image never mutates the URL
 *                                  an already-rendered page is pointing at.
 *   it cannot be guessed          same eight bytes. Blob objects are public,
 *                                  and a predictable key is a way to find one
 *                                  before its product is meant to be visible.
 *
 * The extension comes from the sniff, never from the upload, so the object is
 * served as what it actually is.
 */
export function blobKey(sku, ext) {
  const safe = String(sku ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'product';
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, x => x.toString(16).padStart(2, '0')).join('');
  const safeExt = /^[a-z0-9]{2,4}$/.test(String(ext)) ? String(ext) : 'bin';
  return `products/${safe}-${suffix}.${safeExt}`;
}
