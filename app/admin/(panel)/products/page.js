import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { blobEnabled, putProductImage } from '../../../../lib/blob.js';
import { sql } from '../../../../lib/db.js';
import { bySlug, HAIR_TYPES } from '../../../../lib/hairtypes.js';
import { blobKey, checkImageBytes, MAX_IMAGE_BYTES, MAX_IMAGE_DIM, MIN_IMAGE_DIM } from '../../../../lib/image-file.js';
import {
  archiveProduct, createProduct, discardProduct, restoreProduct,
  toggleActive, toggleFeatured, updateProduct,
} from '../../../../lib/product-admin.js';
import {
  HAIR_SLOTS, hairTypesFromCsv, KIND_LABELS, KINDS, parseProductForm, resolveImage,
} from '../../../../lib/product-form.js';
import { imageUrl } from '../../../../lib/product-image.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import { requireAdmin } from '../../_lib/guard.js';
import { Flash } from '../../_lib/ui.js';

export const dynamic = 'force-dynamic';
// An upload is a multipart POST of up to three megabytes plus twenty text
// fields, and it is followed by a round trip to blob storage. The default
// fifteen seconds is enough on a good connection and not on a phone tethered
// in a shop.
export const maxDuration = 60;
export const metadata = { title: 'Products — Star Seven admin' };

const BACK = '/admin/products';
const to = code => redirect(`${BACK}?m=${code}`);

/**
 * What a create form starts with.
 *
 * price 0 and active false are the deliberate pair: the storefront reads a
 * zero price as "ask us" and shows a WhatsApp button, and a product nobody has
 * priced should not be on the shop at all until its owner says so. Since
 * db/seed.sql now scopes its publish-the-unpriced statements to seeded rows,
 * a draft left in this state stays a draft across deploys.
 */
const BLANK = {
  sku: '', slug: '', kind: 'wax',
  name_ar: '', name_en: '', sub_ar: '', sub_en: '', chip_ar: '', chip_en: '',
  price: 0, compare_at: null, color: '#D7291D', image: '', size_ml: '',
  hold_level: 3, hair_types: '', stock: 0, sort: 0,
  long_ar: '', long_en: '', howto_ar: '', howto_en: '', highlights_ar: '', highlights_en: '',
  ingredients: '',
};

/** checkImageBytes reasons, as flash codes. One wording per real cause. */
const IMAGE_ERRORS = {
  empty: 'image_empty',
  'too-big': 'image_too_big',
  'not-an-image': 'image_not_image',
  'too-small': 'image_too_small',
  'too-large': 'image_too_large',
  'odd-shape': 'image_odd_shape',
};

/**
 * Take the uploaded file, if there is one, and put it in blob storage.
 *
 * Returns { url } with a null url when no file was chosen — which is the
 * ordinary case on a save that only edits the price — or { error } with a
 * flash code.
 *
 * Nothing the browser said about the file is used. The size is checked against
 * the real byte length rather than against the reported one, the media type
 * and the extension come out of lib/image-file.js after it has read the
 * signature, and the stored name is built from the SKU and eight random bytes.
 * A file called `../../index.html` uploaded as image/webp lands as
 * `products/s7-wax-red-<random>.webp` if it really is a WebP, and is refused
 * if it is not.
 */
async function uploadedImage(formData, sku) {
  const file = formData.get('image_file');
  if (!file || typeof file.arrayBuffer !== 'function' || Number(file.size) === 0) {
    return { url: null };
  }
  if (!blobEnabled()) return { error: 'image_no_store' };
  // Cheap refusal before the bytes are read into memory at all.
  if (Number(file.size) > MAX_IMAGE_BYTES) return { error: 'image_too_big' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const seen = checkImageBytes(bytes);
  if (!seen.ok) return { error: IMAGE_ERRORS[seen.reason] ?? 'image_not_image' };

  const put = await putProductImage({
    key: blobKey(sku, seen.ext),
    bytes,
    contentType: seen.mime,
  });
  return put.ok ? { url: put.url } : { error: 'image_failed' };
}

/** parseProductForm and createProduct refusals, as flash codes. */
const REASONS = {
  'duplicate-sku': 'product_dupe_sku',
  'duplicate-slug': 'product_dupe_slug',
  duplicate: 'product_dupe',
  'not-found': 'product_missing',
  archived: 'product_locked',
  seeded: 'discard_seeded',
  ordered: 'discard_ordered',
  'not-archived': 'discard_not_archived',
  'bad-input': 'bad_input',
};

async function newProduct(formData) {
  'use server';
  await requireAdmin();
  if (!(await csrfOk(formData.get('_csrf')))) to('csrf');

  const parsed = parseProductForm(formData, { mode: 'create' });
  if (!parsed.ok) to(parsed.error);
  const values = parsed.values;

  /*
   * The upload happens before the SKU is known to be free, so a create refused
   * for a duplicate key leaves one stored object nobody references. That is the
   * cheaper of the two mistakes: the alternative is to check the keys here,
   * which puts a second opinion about uniqueness outside lib/product-admin.js,
   * and it would still be a read-then-write that two admins can both pass. A
   * few kilobytes of orphan on a typo is a better trade than a duplicated rule.
   */
  const upload = await uploadedImage(formData, values.sku);
  if (upload.error) to(upload.error);

  // A product with no picture is a card with a broken image on it, so the
  // column is required at creation. The typed path is the way in when there is
  // no blob store attached; the upload is the way in when there is.
  const image = resolveImage({ uploadedUrl: upload.url, typed: formData.get('image'), current: null });
  if (!image) to('product_bad_image');
  values.image = image;

  const made = await createProduct(values);
  if (!made.ok) to(REASONS[made.reason] ?? 'bad_input');
  to('product_created');
}

async function saveProduct(formData) {
  'use server';
  await requireAdmin();
  if (!(await csrfOk(formData.get('_csrf')))) to('csrf');

  const id = Number(formData.get('id'));
  const act = String(formData.get('act') || 'save');
  if (!Number.isInteger(id) || id <= 0) to('bad_input');

  if (act === 'toggle') {
    const res = await toggleActive(id);
    to(res.ok ? 'product_toggled' : (REASONS[res.reason] ?? 'bad_input'));
  }

  // The home page shows a shortlist, not the catalogue. This is what picks it.
  if (act === 'feature') {
    const res = await toggleFeatured(id);
    to(res.ok ? 'product_featured' : (REASONS[res.reason] ?? 'bad_input'));
  }

  if (act === 'archive') {
    const res = await archiveProduct(id);
    to(res.ok ? 'product_archived' : (REASONS[res.reason] ?? 'bad_input'));
  }

  if (act === 'restore') {
    const res = await restoreProduct(id);
    to(res.ok ? 'product_restored' : (REASONS[res.reason] ?? 'bad_input'));
  }

  if (act === 'discard') {
    const res = await discardProduct(id);
    to(res.ok ? 'product_discarded' : (REASONS[res.reason] ?? 'bad_input'));
  }

  // Anything else is refused rather than falling through to the save. A POST
  // carrying act=whatever would otherwise be parsed as a full edit, and a
  // toggle form — which sends an id and nothing else — would then look like an
  // edit that blanked every field.
  if (act !== 'save') to('bad_input');

  const parsed = parseProductForm(formData, { mode: 'edit' });
  if (!parsed.ok) to(parsed.error);
  const values = parsed.values;

  const [current] = await sql`SELECT sku, image FROM products WHERE id = ${id}`;
  if (!current) to('product_missing');

  const upload = await uploadedImage(formData, current.sku);
  if (upload.error) to(upload.error);

  // The row keeps the image it has unless this save carries a new one. A blank
  // file input and an untouched path field must never blank the column.
  const image = resolveImage({
    uploadedUrl: upload.url,
    typed: formData.get('image'),
    current: current.image,
  });
  if (!image) to('product_bad_image');
  values.image = image;

  const saved = await updateProduct(id, values);
  if (!saved.ok) to(REASONS[saved.reason] ?? 'bad_input');
  to('product_saved');
}

/* ------------------------------------------------------------------ the UI */

/**
 * The hair-type control.
 *
 * It was a text box holding a comma-separated list, which asked the owner to
 * remember six slugs, spell them, and know that the order is the meaning. What
 * it produced most often was a silently empty field, because anything the page
 * did not recognise was dropped without a word.
 *
 * It is one select per priority slot now: the first select is the primary
 * recommendation, the second is the first backup, and so on. Order is
 * positional, so it cannot be got wrong, and every option is a real slug, so
 * nothing can be misspelled. One empty slot is always offered at the end so
 * another type can be added; blanks in the middle are dropped and the rest
 * keep their order, which is how a type is removed.
 *
 * Plain selects, no client component: this page is one of about eighty forms
 * on a screen the owner opens on a phone, and a drag-to-reorder widget would
 * be a lot of JavaScript for a field that changes twice a year.
 */
function HairSlots({ prefix, picked }) {
  const slots = Math.min(HAIR_SLOTS, Math.max(2, picked.length + 1));
  return (
    <div className="field">
      <label htmlFor={`${prefix}-hair-1`}>Recommended for hair types — first is the primary match</label>
      <div className="hair-slots">
        {Array.from({ length: slots }, (_, i) => (
          <select key={i} id={`${prefix}-hair-${i + 1}`} name={`hair_${i + 1}`}
                  defaultValue={picked[i] ?? ''}
                  aria-label={i === 0 ? 'Primary hair type' : `Backup hair type ${i}`}>
            <option value="">{i === 0 ? '— none —' : '— add —'}</option>
            {HAIR_TYPES.map(t => (
              <option key={t.slug} value={t.slug}>{t.en.name}</option>
            ))}
          </select>
        ))}
      </div>
      {picked.length > 0 && (
        <div style={{ marginTop: '9px' }} className="bar-row">
          {picked.map((slug, i) => (
            <span className={i === 0 ? 'pill new' : 'pill'} key={slug}>
              {i === 0 ? '1st · ' : ''}{bySlug(slug)?.en.name || slug}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Every column the storefront reads, minus the two keys.
 *
 * Shared by the create panel and the edit panels so the two forms cannot drift
 * apart — which they would, because they are twenty-three fields each and the
 * second one is always the one that gets forgotten.
 */
function ProductFields({ prefix, p, uploads }) {
  const picked = hairTypesFromCsv(p.hair_types);
  const id = name => `${prefix}-${name}`;

  return (
    <>
      <div className="grid2">
        <div className="field">
          <label htmlFor={id('name_ar')}>Name (Arabic) *</label>
          <input id={id('name_ar')} name="name_ar" dir="rtl" required defaultValue={p.name_ar} />
        </div>
        <div className="field">
          <label htmlFor={id('name_en')}>Name (English) *</label>
          <input id={id('name_en')} name="name_en" required defaultValue={p.name_en} />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('sub_ar')}>Subtitle (Arabic)</label>
          <input id={id('sub_ar')} name="sub_ar" dir="rtl" defaultValue={p.sub_ar} />
        </div>
        <div className="field">
          <label htmlFor={id('sub_en')}>Subtitle (English)</label>
          <input id={id('sub_en')} name="sub_en" defaultValue={p.sub_en} />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('chip_ar')}>Badge (Arabic)</label>
          <input id={id('chip_ar')} name="chip_ar" dir="rtl" defaultValue={p.chip_ar} />
        </div>
        <div className="field">
          <label htmlFor={id('chip_en')}>Badge (English)</label>
          <input id={id('chip_en')} name="chip_en" defaultValue={p.chip_en} />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('kind')}>Category</label>
          <select id={id('kind')} name="kind" defaultValue={p.kind}>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id('color')}>Accent colour</label>
          <input id={id('color')} type="color" name="color" defaultValue={String(p.color || '#D7291D').toLowerCase()} />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('price')}>Price (EGP) — 0 shows a WhatsApp button instead of Add to cart</label>
          <input id={id('price')} type="number" name="price" step="0.01" min="0"
                 defaultValue={String(p.price)} />
        </div>
        <div className="field">
          <label htmlFor={id('compare_at')}>Was-price (blank = none)</label>
          <input id={id('compare_at')} type="number" name="compare_at" step="0.01" min="0"
                 defaultValue={p.compare_at === null || p.compare_at === undefined ? '' : String(p.compare_at)} />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('stock')}>Stock</label>
          <input id={id('stock')} type="number" name="stock" min="0" defaultValue={Number(p.stock)} />
        </div>
        <div className="field">
          <label htmlFor={id('hold_level')}>Hold level</label>
          <select id={id('hold_level')} name="hold_level" defaultValue={String(p.hold_level)}>
            <option value="1">1 — light</option>
            <option value="2">2</option>
            <option value="3">3 — medium</option>
            <option value="4">4 — strong</option>
            <option value="5">5 — ultra strong</option>
          </select>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('size_ml')}>Size in ml or g (blank = none)</label>
          <input id={id('size_ml')} type="number" name="size_ml" min="1"
                 defaultValue={p.size_ml === null || p.size_ml === undefined ? '' : String(p.size_ml)} />
        </div>
        <div className="field">
          <label htmlFor={id('sort')}>Sort order</label>
          <input id={id('sort')} type="number" name="sort" defaultValue={Number(p.sort)} />
        </div>
      </div>

      <HairSlots prefix={prefix} picked={picked} />

      <div className="field">
        <label htmlFor={id('image_file')}>Product photograph</label>
        {uploads ? (
          <>
            <input id={id('image_file')} type="file" name="image_file"
                   accept="image/webp,image/png,image/jpeg,image/gif" />
            <div className="muted" style={{ marginTop: '7px', fontSize: '12.5px' }}>
              WebP, PNG, JPEG or GIF. Up to {Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB,
              between {MIN_IMAGE_DIM} and {MAX_IMAGE_DIM} pixels on each side, roughly square.
              Leave empty to keep the current picture.
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: '12.5px' }}>
            Uploads are off because no image store is attached. Add a Blob store in
            Vercel → Storage and set <code>BLOB_READ_WRITE_TOKEN</code>, or type the path
            of a file committed under <code>public/</code> below.
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor={id('image')}>…or the path of a file in <code>public/</code></label>
        <input id={id('image')} name="image" spellCheck={false} dir="ltr"
               placeholder="assets/catalog/wax-135-argan.webp"
               defaultValue={String(p.image || '').startsWith('https://') ? '' : (p.image || '')} />
      </div>

      <h3 style={{ fontSize: '14px', fontWeight: 900, margin: '22px 0 12px' }}>
        Product page copy
      </h3>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('long_ar')}>Full description (Arabic)</label>
          <textarea id={id('long_ar')} name="long_ar" rows={5} dir="rtl" defaultValue={p.long_ar} />
        </div>
        <div className="field">
          <label htmlFor={id('long_en')}>Full description (English)</label>
          <textarea id={id('long_en')} name="long_en" rows={5} defaultValue={p.long_en} />
        </div>
      </div>
      <div className="muted" style={{ margin: '-8px 0 15px', fontSize: '12.5px' }}>
        Leave a blank line between paragraphs. <code>**bold**</code>, <code>## heading</code>{' '}
        and <code>- bullet</code> work. Up to 4000 characters each.
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('howto_ar')}>How to use (Arabic)</label>
          <textarea id={id('howto_ar')} name="howto_ar" rows={3} dir="rtl" defaultValue={p.howto_ar} />
        </div>
        <div className="field">
          <label htmlFor={id('howto_en')}>How to use (English)</label>
          <textarea id={id('howto_en')} name="howto_en" rows={3} defaultValue={p.howto_en} />
        </div>
      </div>
      <div className="muted" style={{ margin: '-8px 0 15px', fontSize: '12.5px' }}>
        One step per line — the page numbers them, so do not type numbers or dashes.
        Up to 1200 characters each.
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor={id('highlights_ar')}>Highlights (Arabic)</label>
          <textarea id={id('highlights_ar')} name="highlights_ar" rows={3} dir="rtl"
                    defaultValue={p.highlights_ar} />
        </div>
        <div className="field">
          <label htmlFor={id('highlights_en')}>Highlights (English)</label>
          <textarea id={id('highlights_en')} name="highlights_en" rows={3} defaultValue={p.highlights_en} />
        </div>
      </div>
      <div className="muted" style={{ margin: '-8px 0 15px', fontSize: '12.5px' }}>
        One point per line — the page draws the tick, so do not type bullets.
        Up to 1200 characters each.
      </div>

      <div className="field">
        <label htmlFor={id('ingredients')}>Ingredients, exactly as printed on the pack</label>
        <textarea id={id('ingredients')} name="ingredients" rows={3} dir="ltr"
                  defaultValue={p.ingredients} />
        <div className="muted" style={{ marginTop: '7px', fontSize: '12.5px' }}>
          One field, not two: INCI names are Latin and read the same in both languages.
          Leave it empty rather than guessing — the page says so honestly.
        </div>
      </div>
    </>
  );
}

export default async function ProductsPage({ searchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const token = await csrfToken();
  const uploads = blobEnabled();

  const products = await sql`SELECT * FROM products ORDER BY sort ASC, id ASC`;
  const live = products.filter(p => !p.archived_at);
  const archived = products.filter(p => p.archived_at);

  /*
   * Which archived products have ever been ordered.
   *
   * Only the archived ones can be discarded, so this is only asked when there
   * is at least one — and it is one scan of order_items rather than a
   * correlated EXISTS per row, because order_items is indexed on order_id and
   * not on product_id, and eighty subqueries each scanning it is the shape
   * that gets slow first as the shop grows.
   */
  const ordered = new Set();
  if (archived.length) {
    const rows = await sql`SELECT DISTINCT product_id FROM order_items WHERE product_id IS NOT NULL`;
    for (const r of rows) ordered.add(Number(r.product_id));
  }

  // Reopen the create panel when the last attempt failed, so the owner can see
  // the message next to the form it belongs to rather than above a closed box.
  const createFailed = typeof sp?.m === 'string'
    && (sp.m.startsWith('product_bad') || sp.m.startsWith('product_dupe')
        || sp.m.startsWith('image_') || sp.m === 'product_needs_name');

  return (
    <>
      <h1>Products</h1>
      <p className="sub">
        Hair types drive the finder on the site. <b>Order matters</b> — the first hair type listed is
        the primary recommendation, the rest are backups. The reasoning behind the current mapping is
        in <code>/docs/hair-type-research.md</code>.
      </p>

      <Flash code={sp?.m} />

      <div className="panel">
        <h2>Add a product</h2>
        <div className="pad">
          <details open={createFailed}>
            <summary style={{ cursor: 'pointer', fontWeight: 800, marginBottom: '14px' }}>
              New product
            </summary>
            {/* No encType here. React sets multipart/form-data itself on a
                form whose action is a Server Action, and spelling it out gets
                a console warning saying it will be overridden. The file input
                below still arrives as a File in the FormData. */}
            <form action={newProduct}>
              <input type="hidden" name="_csrf" value={token} />

              <div className="grid2">
                <div className="field">
                  <label htmlFor="new-sku">SKU *</label>
                  <input id="new-sku" name="sku" required spellCheck={false} dir="ltr"
                         placeholder="S7-WAX-MINT" style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="field">
                  <label htmlFor="new-slug">Web address (blank = from the English name)</label>
                  <input id="new-slug" name="slug" spellCheck={false} dir="ltr"
                         placeholder="premium-wax-mint" />
                </div>
              </div>
              <div className="muted" style={{ margin: '-8px 0 15px', fontSize: '12.5px' }}>
                Both are permanent. The SKU is the key every past order line and the deploy seed
                quote; the web address is the public link. Neither can be changed afterwards —
                if one is wrong, archive the product and add it again.
              </div>

              <ProductFields prefix="new" p={BLANK} uploads={uploads} />

              <div className="bar-row" style={{ margin: '18px 0', gap: '20px' }}>
                <label className="check" htmlFor="new-active">
                  <input id="new-active" type="checkbox" name="active" /> Put it on the shop now
                </label>
                <label className="check" htmlFor="new-featured">
                  <input id="new-featured" type="checkbox" name="featured" /> Show it on the home page
                </label>
              </div>

              <button className="btn" type="submit">Create product</button>
            </form>
          </details>
        </div>
      </div>

      {live.length === 0 ? (
        <div className="panel"><div className="empty">No products yet — add one above, or run the database seed.</div></div>
      ) : live.map(p => (
        <div className="panel" key={p.id}>
          <h2>
            <span dir="rtl">{p.name_ar}</span>
            <span className="muted" style={{ fontWeight: 600 }}>· {p.name_en} · {p.sku}</span>
            <span className={p.active ? 'pill active' : 'pill cancelled'}>{p.active ? 'live' : 'hidden'}</span>
            {p.featured && <span className="pill active" title="Shown on the home page">home</span>}
            <span className="right">
              <form action={saveProduct}>
                <input type="hidden" name="_csrf" value={token} />
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="act" value="toggle" />
                <button className="btn sm ghost" type="submit">{p.active ? 'Hide' : 'Show'}</button>
              </form>
              {/* saveProduct, not save - `save` is undefined and threw a
                  ReferenceError that took the whole product editor down. And
                  the _csrf input its two sibling forms carry was missing, so
                  even once it rendered, saveProduct would reject it on the
                  CSRF check. Both were needed. */}
              <form action={saveProduct}>
                <input type="hidden" name="_csrf" value={token} />
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="act" value="feature" />
                <button className="btn sm ghost" type="submit"
                        title="Show this product on the home page">
                  {p.featured ? 'Unfeature' : 'Feature'}
                </button>
              </form>
              <form action={saveProduct}>
                <input type="hidden" name="_csrf" value={token} />
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="act" value="archive" />
                <ConfirmButton
                  message={`Archive ${p.name_en}? It comes off the shop and moves to the archive at the bottom of this page. Nothing is deleted and you can restore it.`}>
                  Archive
                </ConfirmButton>
              </form>
            </span>
          </h2>

          <div className="pad">
            <form action={saveProduct}>
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="id" value={p.id} />

              <div className="prod-grid">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(p.image)} alt="" />
                <div>
                  <ProductFields prefix={`p${p.id}`} p={p} uploads={uploads} />
                  <button className="btn" type="submit">Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ))}

      {archived.length > 0 && (
        <>
          <h2 style={{ marginTop: '34px' }}>Archived</h2>
          <p className="sub">
            Off the shop and out of the list above, but still here — so cancelling an old order that
            contains one of these still puts its stock back, and so a redeploy cannot bring it back
            to life. Restore returns it to the list above, still hidden.
          </p>
          {archived.map(p => {
            const canDiscard = p.origin === 'admin' && !ordered.has(Number(p.id));
            return (
              <div className="panel" key={p.id}>
                <h2>
                  <span dir="rtl">{p.name_ar}</span>
                  <span className="muted" style={{ fontWeight: 600 }}>· {p.name_en} · {p.sku}</span>
                  <span className="pill cancelled">archived</span>
                  <span className="right">
                    <form action={saveProduct}>
                      <input type="hidden" name="_csrf" value={token} />
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="act" value="restore" />
                      <button className="btn sm ghost" type="submit">Restore</button>
                    </form>
                    {canDiscard && (
                      <form action={saveProduct}>
                        <input type="hidden" name="_csrf" value={token} />
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="act" value="discard" />
                        <ConfirmButton
                          message={`Delete ${p.name_en} for good? This one has never been ordered and was added here rather than seeded, so nothing depends on it — but it cannot be undone, and the SKU and web address become free again.`}>
                          Delete for good
                        </ConfirmButton>
                      </form>
                    )}
                  </span>
                </h2>
                <div className="pad">
                  <div className="muted" style={{ fontSize: '12.5px' }}>
                    {p.origin === 'admin'
                      ? (ordered.has(Number(p.id))
                        ? 'Kept because it appears on past orders — deleting it would stop those orders restocking if they are ever cancelled.'
                        : 'Never ordered, and added here rather than seeded, so it can be deleted outright.')
                      : 'Kept because db/seed.sql owns this SKU — deleting the row would only make the next deploy insert it again, live, at a price nobody chose.'}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
