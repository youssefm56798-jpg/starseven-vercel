/**
 * What a product image is allowed to be, and how it becomes a URL.
 *
 * products.image used to hold exactly one shape: a repository-relative path
 * like `assets/catalog/wax-135-argan.webp`, committed to public/ and rendered
 * everywhere as `/${p.image}`. That shape is why adding a product was a
 * developer job — the picture had to go through git.
 *
 * There are two shapes now. The old one still works and still means a file in
 * public/; the new one is an absolute https URL on Vercel Blob, written by the
 * admin panel when the owner uploads a photograph. So the storefront can no
 * longer build the src by hand: `/${p.image}` turns an uploaded image into
 * `/https://...`, which is a request to this site for a path that does not
 * exist. Every call site goes through imageUrl() instead, which is the only
 * place that knows there are two shapes.
 *
 * This module is deliberately free of imports. The cart drawer is a client
 * component and renders the image of every line, so this has to be safe to
 * pull into the browser bundle.
 *
 * ---------------------------------------------------------------------------
 * Why the stored value is validated rather than trusted
 *
 * `image` reaches the browser as the src of an <img> and, on the product page,
 * as the `image` field of the JSON-LD. It is written by an admin, so this is
 * not the first line of defence — but a stored value that has never been
 * checked is one bug away from being the payload, and "it is only an admin" is
 * how a panel with a stolen session becomes a defaced storefront. So there are
 * exactly two accepted shapes and everything else is refused at the point of
 * writing, by validateImageRef() below.
 *
 * imageUrl() is the belt to that braces: anything it does not recognise as a
 * blob URL is prefixed with a slash, which turns a hostile value into a
 * same-origin path that resolves to nothing rather than into a scheme the
 * browser will act on. `javascript:alert(1)` becomes `/javascript:alert(1)`.
 */

/**
 * The public host Vercel Blob serves from: one subdomain per store.
 *
 * Anchored at both ends and with no dots allowed inside the store id, so
 * `evil.com/x.public.blob.vercel-storage.com` and
 * `public.blob.vercel-storage.com.evil.com` both fail. Matching a host by
 * substring is how an allow-list becomes a suggestion.
 */
const BLOB_HOST = /^[a-z0-9][a-z0-9-]*\.public\.blob\.vercel-storage\.com$/;

/**
 * A file in public/. Lower case, no leading slash, no `..`, no `//`, and a
 * real image extension. Kept narrow on purpose: every value this matches is
 * one the shop already ships, and there is no reason for the admin to be able
 * to point the column anywhere else in the tree.
 */
const ASSET_PATH = /^assets\/[a-z0-9][a-z0-9._/-]*\.(?:webp|png|jpe?g|avif|gif)$/;

/** True for a well-formed https URL on the Vercel Blob public host. */
export function isBlobImage(value) {
  const s = String(value ?? '');
  if (!s.startsWith('https://')) return false;
  let u;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && BLOB_HOST.test(u.hostname) && u.pathname.length > 1;
}

/** True for a path under public/assets that cannot walk out of it. */
export function isAssetPath(value) {
  const s = String(value ?? '');
  if (s.includes('..') || s.includes('//')) return false;
  return ASSET_PATH.test(s);
}

/**
 * The value to store for a submitted image reference, or null if it is neither
 * shape. Callers treat null as a validation failure — never as "store it
 * anyway and let the browser sort it out".
 */
export function validateImageRef(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (isBlobImage(s)) return s;
  // A leading slash is what someone types when they are thinking in URLs
  // rather than in repository paths. Accept it and normalise it away, so the
  // column keeps one spelling of one file.
  const path = s.replace(/^\/+/, '').toLowerCase();
  return isAssetPath(path) ? path : null;
}

/** The src for an <img>: an uploaded image as-is, anything else site-rooted. */
export function imageUrl(value) {
  const s = String(value ?? '');
  if (isBlobImage(s)) return s;
  return '/' + s.replace(/^\/+/, '');
}

/**
 * The widths scripts/gen-image-variants.mjs writes next to every catalogue
 * photograph. Kept in step with WIDTHS there; tests/image-variants.test.mjs
 * fails if the two lists disagree.
 */
const VARIANT_WIDTHS = [300, 600];

/** Only the committed catalogue has variants. An upload is one file. */
const HAS_VARIANTS = /^assets\/catalog\/[a-z0-9][a-z0-9._-]*\.webp$/;

/**
 * The srcset for a catalogue photograph, or undefined.
 *
 * Every jar in public/assets/catalog is 900x900 and around 51KB, and the shop
 * grid draws sixty-three of them at 300. A phone was fetching the full 900px
 * file to paint a third of it - about 43KB wasted per jar, and the grid is the
 * page people arrive on. The 300px copy is 8 to 14KB.
 *
 * undefined rather than an empty string for anything else, because React omits
 * an undefined attribute and renders `srcset=""` for the empty one - and an
 * empty srcset is not ignored by every browser, it is a candidate list with
 * nothing in it.
 *
 * Two cases get undefined and both are correct. An uploaded image is a single
 * file on Vercel Blob with no variants to offer, and there is no resize service
 * in front of it. And anything that is not a catalogue webp - the logo, the
 * hero shots, a hostile value - is left exactly as imageUrl() left it.
 *
 * The 900px original is the last candidate rather than being dropped: a desktop
 * at 2x drawing the product page's 600px hero genuinely wants it.
 */
export function imageSrcSet(value) {
  const s = String(value ?? '').replace(/^\/+/, '');
  if (!HAS_VARIANTS.test(s)) return undefined;
  const stem = s.replace(/\.webp$/, '');
  return [
    ...VARIANT_WIDTHS.map(w => `/${stem}-${w}.webp ${w}w`),
    `/${s} 900w`,
  ].join(', ');
}

/**
 * The same thing absolute, for the JSON-LD and the OpenGraph tags — where a
 * crawler is reading the value out of context and a relative path is either
 * ignored or resolved against the wrong base.
 */
export function absoluteImageUrl(value, base) {
  const s = String(value ?? '');
  if (isBlobImage(s)) return s;
  return String(base ?? '').replace(/\/$/, '') + imageUrl(s);
}

/**
 * The same photograph as an email client can actually draw it, absolute.
 *
 * Three shapes go in and three different things come out, and the middle case
 * is the one this exists for.
 *
 * A catalogue photograph is a 900x900 WebP, and neither half of that is usable
 * in an inbox: Outlook on Windows renders mail through Word, which has never
 * decoded a WebP, and no order table wants a 900px image in a 96px row. So a
 * catalogue path is redirected to the trimmed PNG copy that
 * scripts/gen-email-images.mjs commits next to it.
 *
 * An uploaded image is returned as it is. It already lives on the blob host at
 * whatever size and format the shop uploaded, there is no resize service in
 * front of it, and there is nothing this function could usefully do — an
 * uploaded WebP is a picture Outlook will not draw, and the answer to that is
 * to upload a JPEG, not to invent a variant that was never generated.
 *
 * Anything else returns the empty string, and the templates treat that as "this
 * line has no picture" and lay the row out without one. That is deliberate: the
 * alternative is an <img> pointing at a file that was never written, which in
 * an inbox is not a blank space but a broken-image icon on the one email a
 * customer is most likely to keep.
 */
export function emailImageUrl(value, base) {
  const s = String(value ?? '');
  if (isBlobImage(s)) return s;

  const path = s.replace(/^\/+/, '').toLowerCase();
  if (!HAS_VARIANTS.test(path)) return '';

  const stem = path.replace(/^assets\/catalog\//, '').replace(/\.webp$/, '');
  return `${String(base ?? '').replace(/\/$/, '')}/assets/catalog/email/${stem}-192.png`;
}
