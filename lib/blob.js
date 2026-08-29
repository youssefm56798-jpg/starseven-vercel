/**
 * Image storage, on Vercel Blob.
 *
 * The one thing the admin panel could not do without object storage is take a
 * photograph. Everything else about a product is a column; the picture was a
 * file in public/assets/catalog/, which meant a commit and a deploy, which is
 * exactly the loop this work exists to break.
 *
 * ---------------------------------------------------------------------------
 * Degrading when there is no token
 *
 * BLOB_READ_WRITE_TOKEN is set by Vercel when a Blob store is attached to the
 * project. It is absent in three ordinary situations: a fresh clone, a local
 * `npm run dev` against a copy of the database, and the production build of a
 * project where nobody has attached a store yet. In none of them may the panel
 * break — an owner who cannot upload a photograph must still be able to add a
 * product, price it and put it on the shop, exactly as they could before this
 * existed. So `blobEnabled()` is asked first, the file input is replaced by a
 * note when it says no, and the image field falls back to the path-in-public
 * shape the whole existing catalogue uses.
 *
 * The import is dynamic for the same reason and one more: `@vercel/blob` reads
 * its token when it is called rather than when it is imported, but a static
 * import still puts the package in the module graph of the admin page, and a
 * dependency that a fresh clone has not installed yet would then break the
 * build of every screen rather than the one feature. `await import()` inside
 * the function keeps the failure where it belongs.
 */

/** True when a Blob store is attached and uploads can be accepted. */
export const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/**
 * Store one image and return its public URL.
 *
 * `key`, `contentType` and the bytes all come from lib/image-file.js, which
 * derived every one of them from the file itself. Nothing the browser sent
 * about the file reaches this function.
 *
 * addRandomSuffix is false because the key already carries eight random bytes
 * of our own; letting the SDK add its own would only make the stored name
 * differ from the one we can reason about. allowOverwrite is left at its
 * default, which is to refuse — so in the impossible event that those eight
 * bytes repeat, this fails loudly instead of quietly replacing a photograph
 * that another product is using. The year of cache is safe for exactly the
 * same reason: a replacement image is a new key, never an overwrite of this
 * one, so no URL ever changes what it points at.
 *
 * The body is wrapped in a Blob rather than handed over as raw bytes, because
 * that is the shape the SDK documents. A Uint8Array happens to work today;
 * relying on it would be relying on an implementation detail of how the
 * request body is built.
 *
 * Returns { ok: true, url } or { ok: false, reason }. A failure here is not
 * fatal to the request that caused it: the caller keeps the product it was
 * writing and tells the owner the image did not land, which is a better answer
 * than losing twenty fields of typing to a storage outage.
 */
export async function putProductImage({ key, bytes, contentType }) {
  if (!blobEnabled()) return { ok: false, reason: 'no-store' };

  try {
    const { put } = await import('@vercel/blob');
    const result = await put(key, new Blob([bytes], { type: contentType }), {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
    });
    return { ok: true, url: result.url };
  } catch (e) {
    // The message can carry the token in some SDK failures, so it is logged
    // and never returned to the caller for rendering.
    console.error('[s7] blob upload failed:', e?.message || e);
    return { ok: false, reason: 'upload-failed' };
  }
}
