import { sql } from './db.js';

/**
 * The only thing in this codebase that writes the products table.
 *
 * Same rule lib/order-status.js has for orders.status and lib/session-epoch.js
 * has for admins.session_epoch, and it is here for the same reason: the panel
 * grew from three operations to seven, and a table that seven screens each
 * write in their own way is a table where the seventh forgets that removing a
 * product is not the same thing as deleting a row.
 *
 * Every function returns a result rather than throwing on a refusal, because
 * "that SKU is already taken" is something the owner has to be shown, not a
 * fault. A genuine database failure still throws.
 *
 * =========================================================================
 *  Removing a product: why there is an archive and (almost) no delete
 * =========================================================================
 *
 * The obvious implementation of a Delete button is DELETE FROM products. It is
 * wrong here, in four separate ways, and each one of them is silent.
 *
 * 1. It breaks the restock of every past order containing the product.
 *
 *    order_items.product_id has no foreign key — deliberately, so a product
 *    can be reorganised without rewriting order history — which means a delete
 *    does not cascade and does not fail. It leaves order lines pointing at an
 *    id that is not there any more. lib/order-status.js credits stock back on
 *    a cancellation with
 *
 *        UPDATE products p SET stock = p.stock + i.qty
 *          FROM order_items i WHERE i.product_id = p.id AND i.order_id = ...
 *
 *    and a line whose product is gone simply does not join. No error, no
 *    warning, no row. Cancel a six-week-old order containing a deleted product
 *    and the units never come back to the shelf. On a cash-on-delivery shop in
 *    Egypt, where a good share of orders are cancelled at the door, that is
 *    inventory quietly draining away with nothing anywhere to say why.
 *
 * 2. The next deploy undoes it, and does not put it back the way it was.
 *
 *    db/seed.sql runs on every build and inserts the catalogue with ON
 *    CONFLICT (sku) DO NOTHING. A row that is still there conflicts, so
 *    nothing happens. A row that was deleted does not conflict, so it is
 *    inserted again — at price 0 and hidden, which is how the seed writes it —
 *    and then the pricing statements further down that file set it to 45 EGP,
 *    stock 200 and active. The product the owner deleted on Tuesday is back on
 *    the shop on Wednesday at a price nobody chose. Deleting is not merely
 *    lossy for a seeded SKU; it does not even hold.
 *
 * 3. It loses the sales history the shop reads.
 *
 *    order_items copies sku, name and price at the time of sale, so the
 *    dashboard's best-sellers table survives — but the product page the
 *    customer looked at, the hair-type mapping that recommended it, and the
 *    image are all in the row, and none of that comes back.
 *
 * 4. It is not what the owner means.
 *
 *    "Delete this product" means "stop selling it". Nobody stocking 63 SKUs
 *    wants the record of a discontinued line destroyed; they want it off the
 *    shop and out of the list they scroll every day.
 *
 * So the delete is an archive: `active` goes false, which every storefront
 * query already respects — each one of them says WHERE active = true — and
 * `archived_at` records when, so the panel can file it under a heading instead
 * of leaving it in the working list. Restock still works, because the row is
 * still there. The seed still finds its conflict, because the row is still
 * there. And it is reversible, which a delete is not.
 *
 * ---------------------------------------------------------------------------
 * The one real delete, and what it is for
 *
 * discardProduct() below does DELETE, and it exists because archiving alone
 * has a cost worth paying attention to: sku and slug are UNIQUE, so a product
 * created with a typo in either holds that value for ever. Archive a
 * `premuim-wax-argan` and the correctly spelled slug is still free, but the
 * misspelling is not, and neither is the SKU if the mistake was there.
 *
 * The delete is therefore allowed only where none of the four objections
 * apply, and the conditions are checked inside the statement rather than
 * around it:
 *
 *   origin = 'admin'        it was never seeded, so no deploy can bring it
 *                           back. Anything the seed owns is off limits.
 *   no order_items rows     nothing to orphan, so no restock to break.
 *   archived already        it is off the shop before it goes, which is what
 *                           makes the previous condition hold: checkout only
 *                           ever reads active = true products, so an inactive
 *                           product cannot acquire its first order line while
 *                           this statement runs.
 *
 * That last point is the honest limit of it. Neon over HTTP has no interactive
 * transaction, so the NOT EXISTS and the DELETE are one statement and cannot
 * be held against a concurrent checkout that read the product as active a
 * moment before it was archived. The window is the length of one checkout
 * request, it can only be reached by archiving and discarding a product while
 * an order for it is mid-flight, and the worst outcome is one order line that
 * does not restock — which is exactly the outcome the whole archive design
 * exists to avoid, so it is named here rather than left for someone to find.
 */

/**
 * Which unique index a 23505 was raised on.
 *
 * The driver surfaces the Postgres `constraint` field, and that is the answer
 * when it is there. When it is not — a driver version that drops it, a
 * constraint someone renamed — the message is read instead, and the fallback
 * is 'duplicate' rather than a guess, because telling the owner the SKU is
 * taken when it was actually the slug sends them to fix the wrong field.
 */
function duplicateReason(e) {
  const from = `${e?.constraint ?? ''} ${e?.detail ?? ''} ${e?.message ?? ''}`.toLowerCase();
  if (from.includes('sku')) return 'duplicate-sku';
  if (from.includes('slug')) return 'duplicate-slug';
  return 'duplicate';
}

const isUniqueViolation = e => e?.code === '23505';

/**
 * Create a product.
 *
 *   { ok: true, id, slug }
 *   { ok: false, reason: 'duplicate-sku' | 'duplicate-slug' | 'duplicate' }
 *
 * The collision is answered twice over. The SELECT first, because it can say
 * which of the two keys is taken and by which product, and that is the message
 * worth reading. The catch second, because the SELECT is a read followed by a
 * write and two admins adding the same SKU in the same second would both pass
 * it — the unique index is what actually decides, and its refusal has to come
 * back as an answer rather than as a 500 on a screen holding twenty fields of
 * typing.
 */
export async function createProduct(values) {
  const clash = await sql`
    SELECT sku, slug FROM products
     WHERE sku = ${values.sku} OR slug = ${values.slug}
     LIMIT 1`;

  if (clash.length) {
    return { ok: false, reason: clash[0].sku === values.sku ? 'duplicate-sku' : 'duplicate-slug' };
  }

  try {
    const [row] = await sql`
      INSERT INTO products
        (sku, slug, kind, name_ar, name_en, sub_ar, sub_en, chip_ar, chip_en,
         price, compare_at, color, image, size_ml, hold_level, hair_types,
         stock, active, featured, sort,
         long_ar, long_en, howto_ar, howto_en, highlights_ar, highlights_en,
         ingredients, origin)
      VALUES
        (${values.sku}, ${values.slug}, ${values.kind}, ${values.name_ar}, ${values.name_en},
         ${values.sub_ar}, ${values.sub_en}, ${values.chip_ar}, ${values.chip_en},
         ${values.price}, ${values.compare_at}, ${values.color}, ${values.image},
         ${values.size_ml}, ${values.hold_level}, ${values.hair_types},
         ${values.stock}, ${values.active}, ${values.featured}, ${values.sort},
         ${values.long_ar}, ${values.long_en}, ${values.howto_ar}, ${values.howto_en},
         ${values.highlights_ar}, ${values.highlights_en}, ${values.ingredients},
         'admin')
      RETURNING id, slug`;
    return { ok: true, id: Number(row.id), slug: row.slug };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: duplicateReason(e) };
    throw e;
  }
}

/**
 * Update everything about a product except its two keys.
 *
 * sku and slug are not in the list, and that is a decision rather than an
 * omission:
 *
 *   sku   is the natural key db/seed.sql upserts on, and roughly thirty
 *         statements in that file name specific SKUs. Rename one and the seed
 *         stops recognising it, which is survivable — but it also stops
 *         conflicting, so the next deploy inserts the original again, and the
 *         insert carries the original slug, which the renamed row still holds.
 *         That is a unique violation inside db:setup, and db:setup runs before
 *         next build in vercel-build. Renaming a SKU in the admin can fail the
 *         entire deploy.
 *
 *   slug  is a public URL. It is in Google, in WhatsApp threads and on the
 *         printed material the shop hands out. Changing it breaks all three
 *         silently, and this codebase has no redirect table to catch them.
 *
 * Both are set once, at creation, where a mistake costs a discard and a
 * retype. The panel renders them read-only and says why.
 */
export async function updateProduct(id, values) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, reason: 'bad-input' };

  const [row] = await sql`
    UPDATE products SET
        kind = ${values.kind},
        name_ar = ${values.name_ar}, name_en = ${values.name_en},
        sub_ar = ${values.sub_ar}, sub_en = ${values.sub_en},
        chip_ar = ${values.chip_ar}, chip_en = ${values.chip_en},
        price = ${values.price}, compare_at = ${values.compare_at},
        color = ${values.color}, image = ${values.image},
        size_ml = ${values.size_ml}, hold_level = ${values.hold_level},
        hair_types = ${values.hair_types}, stock = ${values.stock},
        sort = ${values.sort},
        long_ar = ${values.long_ar}, long_en = ${values.long_en},
        howto_ar = ${values.howto_ar}, howto_en = ${values.howto_en},
        highlights_ar = ${values.highlights_ar}, highlights_en = ${values.highlights_en},
        ingredients = ${values.ingredients}
      WHERE id = ${productId}
      RETURNING id`;

  return row ? { ok: true, id: Number(row.id) } : { ok: false, reason: 'not-found' };
}

/**
 * Show or hide a product.
 *
 * The guard is the interesting half. Hiding is always allowed; showing is only
 * allowed while the row is not archived, because an archived product that
 * could be un-hidden by the ordinary Show button would be back on the shop
 * without anybody restoring it — two buttons disagreeing about one column is
 * how a soft delete stops being one.
 */
export async function toggleActive(id) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, reason: 'bad-input' };

  const [row] = await sql`
    UPDATE products
       SET active = NOT active
     WHERE id = ${productId}
       AND (archived_at IS NULL OR active = TRUE)
     RETURNING id, active`;

  return row ? { ok: true, active: row.active } : { ok: false, reason: 'archived' };
}

/** The home page shows a shortlist, not the catalogue. This is what picks it. */
export async function toggleFeatured(id) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, reason: 'bad-input' };

  const [row] = await sql`
    UPDATE products SET featured = NOT featured
     WHERE id = ${productId} AND archived_at IS NULL
     RETURNING id, featured`;

  return row ? { ok: true, featured: row.featured } : { ok: false, reason: 'archived' };
}

/**
 * Take a product off the shop.
 *
 * One statement, and `archived_at IS NULL` in the WHERE is what makes a second
 * press a no-op rather than a second timestamp — the same shape the recovery
 * codes use to make a code single-use. `active` is forced false in the same
 * statement, so there is never a moment where a row is archived and still
 * reachable from the storefront.
 */
export async function archiveProduct(id) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, reason: 'bad-input' };

  const [row] = await sql`
    UPDATE products
       SET active = FALSE, archived_at = now()
     WHERE id = ${productId} AND archived_at IS NULL
     RETURNING id`;

  return row ? { ok: true, id: Number(row.id) } : { ok: false, reason: 'not-archived' };
}

/**
 * Put it back in the working list.
 *
 * Deliberately does NOT set active = true. Restoring means "I want to work on
 * this again", and putting a product back on the shop is a separate decision
 * the owner makes with the Show button once they have looked at the price. A
 * restore that also republished would be one click between a filed-away
 * product and a live one.
 */
export async function restoreProduct(id) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, reason: 'bad-input' };

  const [row] = await sql`
    UPDATE products SET archived_at = NULL
     WHERE id = ${productId} AND archived_at IS NOT NULL
     RETURNING id`;

  return row ? { ok: true, id: Number(row.id) } : { ok: false, reason: 'not-found' };
}

/**
 * Destroy an archived, never-ordered, admin-created product for good.
 *
 * The three conditions are in the statement, not in JavaScript in front of it,
 * so there is no read-then-write for a concurrent request to slip through and
 * so a refusal is a row count of zero rather than a race. See the block
 * comment at the top of this file for why each condition is there and for the
 * one window this cannot close.
 *
 * The blob object behind the image is deliberately left in place. It is a few
 * kilobytes, it may already be referenced by a cached page or an email that
 * has gone out, and deleting storage on the strength of a database row that no
 * longer exists is how a picture disappears from somewhere nobody was looking.
 */
export async function discardProduct(id) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, reason: 'bad-input' };

  const rows = await sql`
    DELETE FROM products p
     WHERE p.id = ${productId}
       AND p.origin = 'admin'
       AND p.archived_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = p.id)
     RETURNING p.id`;

  if (rows.length) return { ok: true, id: Number(rows[0].id) };

  // Nothing was deleted, so say which condition failed. This read is after the
  // fact and racy, and it decides wording and nothing else — exactly as the
  // one in lib/order-status.js does.
  const [row] = await sql`
    SELECT origin, archived_at IS NOT NULL AS archived,
           EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = products.id) AS ordered
      FROM products WHERE id = ${productId}`;

  if (!row) return { ok: false, reason: 'not-found' };
  if (row.origin !== 'admin') return { ok: false, reason: 'seeded' };
  if (!row.archived) return { ok: false, reason: 'not-archived' };
  if (row.ordered) return { ok: false, reason: 'ordered' };
  return { ok: false, reason: 'not-found' };
}
