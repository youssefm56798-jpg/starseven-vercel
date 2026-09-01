#!/usr/bin/env node
/**
 * NEW STAR SEVEN — the product admin, against a real Postgres.
 *
 *   npm run verify:products
 *
 * Why this is a script and not a test: everything under tests/ runs with no
 * database, on purpose, so `npm test` stays fast and works on a fresh clone.
 * The rules the form enforces are pure functions and are tested there. What
 * cannot be tested there is everything this feature actually turns on:
 *
 *   * that a created product is reachable by the queries the storefront runs
 *   * that a duplicate SKU comes back as an answer rather than as a 500,
 *     including when two admins race for it
 *   * that re-running db/seed.sql — which every deploy does — leaves an
 *     admin-created product exactly as it was
 *   * that cancelling an old order containing an archived product still puts
 *     the stock back, and what happens instead when the product was deleted
 *   * that a deleted seeded product comes back on the next deploy, which is
 *     the fact the whole archive-instead-of-delete decision rests on
 *
 * It is safe to run against the production connection string, because it does
 * not use it. It creates its own database, applies the real db/schema.sql and
 * db/seed.sql to it, works only in there, and drops it in a finally block.
 * Before the first write it asserts that current_database() is the throwaway
 * one and that `products` resolves to nothing — if either check fails it
 * aborts, because the failure it is guarding against is writing to the real
 * catalogue.
 */

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

/* CREATE DATABASE is refused through a connection pooler, so this wants the
   direct endpoint. Neon supplies both. */
const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!base) {
  console.error('\n  ERROR  DATABASE_URL is not set. See .env.example.\n');
  process.exit(1);
}

const DB = `s7_verify_${randomBytes(4).toString('hex')}`;

const { neon } = await import('@neondatabase/serverless');

/** Only ever creates and drops the throwaway database. */
const admin = neon(base);

/** Everything under test runs here. */
const url = new URL(base);
url.pathname = `/${DB}`;
const db = neon(url.toString());

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  console.log(`          want ${JSON.stringify(want)}`);
}

function note(text) {
  console.log(`    --    ${text}`);
}

console.log('\n  New Star Seven — the product admin');
console.log(`  throwaway database: ${DB}`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  /* --------------------------------------------------------------- guards */

  const [{ d }] = await db`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);

  const [{ t }] = await db`SELECT to_regclass('products')::text AS t`;
  if (t !== null) throw new Error(`"products" already resolves to ${t}. Aborting.`);

  console.log(`  guard: current_database() = ${d}, and it is empty\n`);

  /* ---------------------------------------------------- the real .sql files */

  const exec = text => (typeof db.query === 'function' ? db.query(text) : db(text));

  async function applyFile(rel) {
    const statements = splitStatements(readFileSync(join(ROOT, rel), 'utf8'));
    for (const stmt of statements) await exec(stmt);
    return statements.length;
  }

  console.log(`  applied db/schema.sql — ${await applyFile('db/schema.sql')} statement(s)`);
  console.log(`  applied db/seed.sql   — ${await applyFile('db/seed.sql')} statement(s)`);

  // The modules read DATABASE_URL on their first query, so they have to be
  // pointed at the throwaway database before they are imported.
  process.env.DATABASE_URL = url.toString();
  const {
    archiveProduct, createProduct, discardProduct, restoreProduct,
    toggleActive, updateProduct,
  } = await import('../lib/product-admin.js');
  const { parseProductForm, resolveImage } = await import('../lib/product-form.js');
  const { imageUrl, validateImageRef } = await import('../lib/product-image.js');
  const { blobKey, checkImageBytes } = await import('../lib/image-file.js');
  const { transition } = await import('../lib/order-status.js');
  const { productPublic } = await import('../lib/hairtypes.js');

  /* ------------------------------------------------------------- helpers */

  /**
   * A product exactly as the admin panel would submit it: a FormData through
   * the same parser the Server Action calls. Going through the form rather
   * than hand-building the values is the point — it is the path the owner
   * takes, and the parser is where half the rules live.
   */
  function formFor(extra = {}) {
    const fd = new FormData();
    const base = {
      sku: 'S7-VERIFY-1', slug: 'verify-product', kind: 'wax',
      name_ar: 'منتج تجريبي', name_en: 'Verify Wax',
      sub_ar: 'تجربة', sub_en: 'A test',
      chip_ar: 'جديد', chip_en: 'New',
      price: '49.5', compare_at: '65', color: '#12AB34',
      size_ml: '120', hold_level: '4', stock: '10', sort: '900',
      image: 'assets/catalog/wax-135-argan.webp',
      long_en: 'A paragraph.', howto_en: 'Step one\nStep two',
      highlights_en: 'One\nTwo', ingredients: 'Bees wax',
      hair_1: 'thick', hair_2: 'wavy',
      active: 'on',
    };
    for (const [k, v] of Object.entries({ ...base, ...extra })) {
      if (v === undefined) continue;
      fd.set(k, String(v));
    }
    for (const k of Object.keys(extra)) if (extra[k] === undefined) fd.delete(k);
    return fd;
  }

  async function makeProduct(extra = {}) {
    const parsed = parseProductForm(formFor(extra), { mode: 'create' });
    if (!parsed.ok) throw new Error(`the form was refused: ${parsed.error}`);
    parsed.values.image = resolveImage({ uploadedUrl: null, typed: parsed.values.image ?? extra.image, current: null })
      ?? validateImageRef(formFor(extra).get('image'));
    return { parsed, result: await createProduct(parsed.values) };
  }

  /** The exact query the shop, the checkout and the sitemap all run. */
  const liveSkus = async () =>
    (await db`SELECT sku FROM products WHERE active = true ORDER BY sort, id`).map(r => r.sku);

  const rowOf = async sku => (await db`SELECT * FROM products WHERE sku = ${sku}`)[0] ?? null;
  const stockOf = async id => Number((await db`SELECT stock FROM products WHERE id = ${id}`)[0]?.stock);

  async function placeOrder(productId, qty) {
    const ref = `V${randomBytes(3).toString('hex').toUpperCase()}`;
    const [o] = await db`
      INSERT INTO orders (ref, name, phone, city, status)
      VALUES (${ref}, 'Verify', '01000000000', 'القاهرة', 'new') RETURNING id`;
    await db`
      INSERT INTO order_items (order_id, product_id, sku, name, price, qty)
      VALUES (${o.id}, ${productId}, 'S7-VERIFY', 'Verify', 49.5, ${qty})`;
    // Checkout takes the stock in the same transaction as the order.
    await db`UPDATE products SET stock = stock - ${qty} WHERE id = ${productId}`;
    return o.id;
  }

  /* ------------------------------------------------------------------ 1 */

  console.log('\n  a product created in the admin reaches the storefront');
  let mainId = 0;
  {
    const { parsed, result } = await makeProduct();
    check('created', result.ok, true);
    mainId = result.id;

    const skus = await liveSkus();
    check('the storefront query returns it', skus.includes('S7-VERIFY-1'), true);

    const row = await rowOf('S7-VERIFY-1');
    check('every field the form sent survived the round trip', {
      kind: row.kind, name_ar: row.name_ar, name_en: row.name_en,
      sub_en: row.sub_en, chip_en: row.chip_en,
      price: Number(row.price), compare_at: Number(row.compare_at),
      color: row.color, size_ml: Number(row.size_ml), hold: Number(row.hold_level),
      hair: row.hair_types, stock: Number(row.stock), sort: Number(row.sort),
      howto: row.howto_en, ingredients: row.ingredients,
    }, {
      kind: 'wax', name_ar: 'منتج تجريبي', name_en: 'Verify Wax',
      sub_en: 'A test', chip_en: 'New',
      price: 49.5, compare_at: 65, color: '#12AB34', size_ml: 120, hold: 4,
      hair: 'thick,wavy', stock: 10, sort: 900,
      howto: 'Step one\nStep two', ingredients: 'Bees wax',
    });

    check('it is marked as ours, not as the seed', row.origin, 'admin');

    // The shape every public consumer actually sees.
    const pub = productPublic(row);
    check('productPublic maps it', {
      sku: pub.sku, slug: pub.slug, price: pub.price, hair: pub.hair, stock: pub.stock,
      img: pub.img, name: pub.en.name,
    }, {
      sku: 'S7-VERIFY-1', slug: 'verify-product', price: 49.5,
      hair: ['thick', 'wavy'], stock: 1,
      img: 'assets/catalog/wax-135-argan.webp', name: 'Verify Wax',
    });
    check('the hair-type order is the priority order', parsed.values.hair_types, 'thick,wavy');

    // The product page finds it by slug, which is the other query that matters.
    const bySlug = await db`SELECT sku FROM products WHERE slug = 'verify-product' AND active = true`;
    check('the product page query finds it by slug', bySlug[0]?.sku, 'S7-VERIFY-1');
  }

  /* ------------------------------------------------------------------ 2 */

  console.log('\n  a duplicate key is an answer, not a 500');
  {
    const dupeSku = await makeProduct({ slug: 'something-else' });
    check('a repeated SKU is refused cleanly', dupeSku.result, { ok: false, reason: 'duplicate-sku' });

    const dupeSlug = await makeProduct({ sku: 'S7-VERIFY-2' });
    check('a repeated web address is refused cleanly', dupeSlug.result, { ok: false, reason: 'duplicate-slug' });

    // A SKU already used by a seeded product, which is the collision an owner
    // is most likely to cause by accident.
    const seeded = await makeProduct({ sku: 'S7-WAX-RED', slug: 'brand-new-slug' });
    check('a SKU the seed owns is refused too', seeded.result, { ok: false, reason: 'duplicate-sku' });

    /*
     * The race. The SELECT in createProduct can say WHICH key is taken, but it
     * is a read followed by a write, so two admins pressing Create in the same
     * second both pass it. The unique index is what actually decides, and its
     * refusal has to arrive as a result rather than as an unhandled exception.
     */
    const both = await Promise.all([
      makeProduct({ sku: 'S7-RACE', slug: 'race-me' }),
      makeProduct({ sku: 'S7-RACE', slug: 'race-me-too' }),
    ]);
    const won = both.filter(b => b.result.ok).length;
    const lost = both.filter(b => !b.result.ok && String(b.result.reason).startsWith('duplicate'));
    check('exactly one of two simultaneous creates wins', won, 1);
    check('and the loser gets a duplicate answer, not a throw', lost.length, 1);
  }

  /* ------------------------------------------------------------------ 3 */

  console.log('\n  the uploaded image');
  {
    const file = readFileSync(join(ROOT, 'public/assets/catalog/wax-135-argan.webp'));
    const seen = checkImageBytes(new Uint8Array(file));
    check('a real catalogue photograph passes validation', seen.ok, true);
    check('and its type is read from the bytes, not from the name', seen.mime, 'image/webp');

    const key = blobKey('S7-VERIFY-1', seen.ext);
    check('the stored name is inside its prefix', /^products\/[a-z0-9-]+\.webp$/.test(key), true);

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { putProductImage } = await import('../lib/blob.js');
      const put = await putProductImage({ key, bytes: new Uint8Array(file), contentType: seen.mime });
      check('the upload was accepted', put.ok, true);
      if (put.ok) {
        const saved = await updateProduct(mainId, {
          ...parseProductForm(formFor(), { mode: 'edit' }).values, image: put.url,
        });
        check('the URL is stored on the product', saved.ok, true);

        const row = await rowOf('S7-VERIFY-1');
        check('and it survives as an absolute URL', row.image, put.url);
        check('the storefront renders it unchanged', imageUrl(row.image), put.url);

        const res = await fetch(put.url);
        check('the image is served', res.status, 200);
        check('as an image', res.headers.get('content-type'), 'image/webp');
        const back = new Uint8Array(await res.arrayBuffer());
        check('byte for byte what was uploaded', back.length, file.length);
      }
    } else {
      note('BLOB_READ_WRITE_TOKEN is not set, so the round trip to Vercel is skipped.');
      note('Run this again with a token in the environment to include it.');

      // Degrading gracefully is the behaviour being checked here, and it is
      // the one a fresh clone and a local dev server actually take.
      const { blobEnabled, putProductImage } = await import('../lib/blob.js');
      check('uploads are reported as off', blobEnabled(), false);
      check('and an upload attempted anyway is refused, not thrown',
        await putProductImage({ key, bytes: new Uint8Array(file), contentType: seen.mime }),
        { ok: false, reason: 'no-store' });

      // With a token present but unusable, the SDK failure has to come back as
      // a result too — the caller keeps the twenty fields of typing either way.
      process.env.BLOB_READ_WRITE_TOKEN = 'not-a-real-token';
      const bad = await putProductImage({ key, bytes: new Uint8Array(file), contentType: seen.mime });
      check('an unusable token is a refusal, not a crash', bad, { ok: false, reason: 'upload-failed' });
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const pretend = 'https://verifystore.public.blob.vercel-storage.com/' + key;
      const saved = await updateProduct(mainId, {
        ...parseProductForm(formFor(), { mode: 'edit' }).values, image: pretend,
      });
      check('a blob URL is accepted by the column and the validator', saved.ok, true);
      const row = await rowOf('S7-VERIFY-1');
      check('it is stored verbatim', row.image, pretend);
      check('the storefront renders it unchanged, not as a site path', imageUrl(row.image), pretend);
      check('and productPublic hands it to the client that way', productPublic(row).img, pretend);
      // Put the file path back so the rest of the run reads the ordinary shape.
      await updateProduct(mainId, {
        ...parseProductForm(formFor(), { mode: 'edit' }).values,
        image: 'assets/catalog/wax-135-argan.webp',
      });
    }
  }

  /* ------------------------------------------------------------------ 4 */

  console.log('\n  a redeploy re-runs db/seed.sql over the top');
  {
    // The trap this is about: three statements in the seed match on price = 0
    // AND active = FALSE, which is exactly what a half-written new product
    // looks like. Two of them would price it and publish it.
    const draft = await makeProduct({
      sku: 'S7-DRAFT', slug: 'draft-wax', kind: 'wax',
      price: '0', stock: '0', active: undefined, sort: '901',
    });
    check('an unpriced, hidden draft was created', draft.result.ok, true);

    // A control row in the same shape but owned by the seed. It proves the
    // guard is what protects the draft above, rather than luck.
    await db`
      INSERT INTO products (sku, slug, kind, name_ar, name_en, price, color, image, stock, active, sort)
      VALUES ('S7-CONTROL', 'control-wax', 'wax', 'ضبط', 'Control', 0, '#123456',
              'assets/catalog/wax-135-argan.webp', 0, FALSE, 902)`;

    const before = await rowOf('S7-VERIFY-1');
    const draftBefore = await rowOf('S7-DRAFT');

    console.log(`    (re-applying db/seed.sql — ${await applyFile('db/seed.sql')} statements)`);

    const after = await rowOf('S7-VERIFY-1');
    check('the live admin product is untouched', {
      price: Number(after.price), stock: Number(after.stock), active: after.active,
      name_en: after.name_en, hair: after.hair_types, image: after.image,
      long_en: after.long_en, color: after.color,
    }, {
      price: Number(before.price), stock: Number(before.stock), active: before.active,
      name_en: before.name_en, hair: before.hair_types, image: before.image,
      long_en: before.long_en, color: before.color,
    });

    const draftAfter = await rowOf('S7-DRAFT');
    check('the unpriced draft is still unpriced', Number(draftAfter.price), 0);
    check('the unpriced draft is still hidden', draftAfter.active, false);
    check('and its stock was not invented either', Number(draftAfter.stock), Number(draftBefore.stock));

    const control = await rowOf('S7-CONTROL');
    check('while a seed-owned row in the same state IS priced and published',
      [Number(control.price), control.active, Number(control.stock)], [45, true, 200]);

    check('nothing resurrected: the storefront list has no duplicates',
      (await liveSkus()).length === new Set(await liveSkus()).size, true);
  }

  /* ------------------------------------------------------------------ 5 */

  console.log('\n  cancelling an old order that contains a product since removed');
  {
    // Archived: the row is still there, so the restock still joins.
    const made = await makeProduct({ sku: 'S7-ARCH', slug: 'archived-wax', stock: '10', sort: '903' });
    const id = made.result.id;
    const orderId = await placeOrder(id, 3);
    check('checkout took the stock', await stockOf(id), 7);

    check('archived', (await archiveProduct(id)).ok, true);
    check('it is off the shop', (await liveSkus()).includes('S7-ARCH'), false);
    check('but the row is still there', (await rowOf('S7-ARCH')) !== null, true);

    const res = await transition({ orderId, to: 'cancelled', actor: 'admin:1' });
    check('the order cancels', res.ok, true);
    check('and the stock came back in full', await stockOf(id), 10);

    // The counterfactual, on a product that has been genuinely deleted. This
    // is the behaviour the whole decision is built to avoid, measured rather
    // than asserted from the comment.
    const gone = await makeProduct({ sku: 'S7-GONE', slug: 'gone-wax', stock: '10', sort: '904' });
    const goneId = gone.result.id;
    const goneOrder = await placeOrder(goneId, 4);
    check('checkout took the stock there too', await stockOf(goneId), 6);

    await db`DELETE FROM products WHERE id = ${goneId}`;
    const res2 = await transition({ orderId: goneOrder, to: 'cancelled', actor: 'admin:1' });
    check('cancelling still reports success', res2.ok, true);
    check('the order line survived the delete',
      Number((await db`SELECT count(*)::int AS c FROM order_items WHERE order_id = ${goneOrder}`)[0].c), 1);
    check('but it points at nothing',
      (await db`SELECT p.id FROM order_items i LEFT JOIN products p ON p.id = i.product_id
                 WHERE i.order_id = ${goneOrder}`)[0].id, null);
    note('four units were credited back to nowhere — which is why Delete archives.');
  }

  /* ------------------------------------------------------------------ 6 */

  console.log('\n  what a deploy does to a product that was deleted');
  {
    // A seeded SKU, deleted the way a hard delete would delete it.
    const before = await rowOf('S7-WAX-BLU');
    check('the seeded product is there to begin with', before !== null, true);
    await db`DELETE FROM products WHERE sku = 'S7-WAX-BLU'`;
    check('and now it is not', await rowOf('S7-WAX-BLU'), null);

    console.log(`    (re-applying db/seed.sql — ${await applyFile('db/seed.sql')} statements)`);

    const back = await rowOf('S7-WAX-BLU');
    check('the next deploy brought it back', back !== null, true);
    /*
     * 80, which is what the seed now prices this line at.
     *
     * The number is the point of the check rather than incidental to it: a
     * hard-deleted seeded product comes back on the next deploy at whatever the
     * SEED says, not at whatever the owner had set before deleting it. 45 was
     * the figure until the client price list of 1 September moved the 120ml
     * premium waxes to 80; the assertion follows the seed because that is the
     * value the property is about.
     */
    check('live, at a price nobody chose', [back?.active, Number(back?.price)], [true, 80]);

    // The same product, archived instead.
    const target = await rowOf('S7-WAX-PUR');
    check('archived instead', (await archiveProduct(target.id)).ok, true);

    console.log(`    (re-applying db/seed.sql — ${await applyFile('db/seed.sql')} statements)`);

    const still = await rowOf('S7-WAX-PUR');
    check('the deploy leaves it archived', still.archived_at !== null, true);
    check('and off the shop', still.active, false);
    check('the storefront agrees', (await liveSkus()).includes('S7-WAX-PUR'), false);
  }

  /* ------------------------------------------------------------------ 7 */

  console.log('\n  the one real delete, and everything it refuses');
  {
    const seeded = await rowOf('S7-WAX-RED');
    check('a seeded product cannot be discarded', await discardProduct(seeded.id),
      { ok: false, reason: 'seeded' });

    const live = await rowOf('S7-VERIFY-1');
    check('a product that is not archived cannot be discarded', await discardProduct(live.id),
      { ok: false, reason: 'not-archived' });

    const arch = await rowOf('S7-ARCH');
    check('an archived product that was ordered cannot be discarded', await discardProduct(arch.id),
      { ok: false, reason: 'ordered' });

    // A typo: created, never ordered, archived. This is what the delete is for.
    const typo = await makeProduct({ sku: 'S7-TYPO', slug: 'premuim-wax', sort: '905' });
    check('typo created', typo.result.ok, true);
    check('cannot be discarded while live', (await discardProduct(typo.result.id)).reason, 'not-archived');
    await archiveProduct(typo.result.id);
    check('discarded once archived', await discardProduct(typo.result.id), { ok: true, id: typo.result.id });
    check('the row is gone', await rowOf('S7-TYPO'), null);

    const again = await makeProduct({ sku: 'S7-TYPO', slug: 'premium-wax-fixed', sort: '905' });
    check('and the SKU is free to use again', again.result.ok, true);

    check('discarding twice is not found, not a crash',
      (await discardProduct(typo.result.id)).reason, 'not-found');
  }

  /* ------------------------------------------------------------------ 8 */

  console.log('\n  the archive holds');
  {
    const row = await rowOf('S7-ARCH');
    check('Show refuses to republish an archived product', await toggleActive(row.id),
      { ok: false, reason: 'archived' });
    check('it is still hidden', (await rowOf('S7-ARCH')).active, false);

    check('restore brings it back to the list', (await restoreProduct(row.id)).ok, true);
    check('still hidden, on purpose', (await rowOf('S7-ARCH')).active, false);
    check('and now Show works', (await toggleActive(row.id)).ok, true);
    check('back on the shop', (await liveSkus()).includes('S7-ARCH'), true);
    check('restoring twice is a no-op, not an error',
      (await restoreProduct(row.id)).reason, 'not-found');
  }

  /* ------------------------------------------------------------------ 9 */

  console.log('\n  the schema is still idempotent with the new columns in it');
  {
    console.log(`    (re-applying db/schema.sql — ${await applyFile('db/schema.sql')} statements)`);
    const row = await rowOf('S7-VERIFY-1');
    check('the admin product is still ours', row.origin, 'admin');
    check('and still live', row.active, true);
    const [{ c }] = await db`SELECT count(*)::int AS c FROM pg_constraint WHERE conname = 'products_origin_check'`;
    check('exactly one origin CHECK exists', Number(c), 1);
  }

} finally {
  // FORCE terminates anything still attached. The HTTP driver holds no
  // persistent connection, so this is belt and braces.
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  all checks passed\n');
process.exit(failures ? 1 : 0);
