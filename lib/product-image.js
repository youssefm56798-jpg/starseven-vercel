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
 * The same thing absolute, for the JSON-LD and the OpenGraph tags — where a
 * crawler is reading the value out of context and a relative path is either
 * ignored or resolved against the wrong base.
 */
export function absoluteImageUrl(value, base) {
  const s = String(value ?? '');
  if (isBlobImage(s)) return s;
  return String(base ?? '').replace(/\/$/, '') + imageUrl(s);
}
