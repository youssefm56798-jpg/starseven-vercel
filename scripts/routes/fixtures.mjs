/**
 * The catalogue the route suite runs against.
 *
 * Deliberately not db/seed.sql. The seed is the real shop — 30-odd products
 * whose prices and stock levels change whenever the client changes them — and a
 * test that asserts "the total is 245.50" against it is a test that breaks the
 * next time someone edits a price. These rows exist to make one property
 * checkable each: a product with stock 1 so overselling has something to fail
 * on, a product priced 0 with stock on hand so the "not priced yet" rule can
 * fire without the stock rule catching it first, an offer already at its cap.
 *
 * Every SKU and code carries an RT- prefix and the run id. Nothing in the real
 * catalogue looks like that, which is what makes the canary probe in
 * verify-routes.mjs able to tell a throwaway database from the production one.
 */

/** Prices are exact and small so the arithmetic in an assertion is readable. */
export const SKU = {
  wax: 'RT-WAX-A',            // 100.00, plenty of stock, matches straight+wavy
  gel: 'RT-GEL-B',            //  55.50, matches wavy+curly
  outOfStock: 'RT-OOS-C',     //  80.00, stock 0
  unpriced: 'RT-NOPRICE-D',   //   0.00, stock 5 — the rule the comment spells out
  inactive: 'RT-OFF-E',       // active = false
  scarce: 'RT-SCARCE-F',      // 200.00, stock 1 — the oversell race
  stocky: 'RT-STOCKY-G',      //  10.00, stock 137 — the exact-count leak
  bulk: 'RT-BULK-H',          // 500.00, stock 500 — coupon race and burst orders
};

export const CODE = {
  tenPercent: 'RT10',         // 10%, no minimum, no cap
  fixed: 'RTFIXED',           // 100 EGP off
  minimum: 'RTMIN',           // 20%, only over 500
  exhausted: 'RTMAXED',       // max_uses 3, used_count 3
  capOne: 'RTCAP1',           // max_uses 1 — the coupon race
  expired: 'RTOLD',
  future: 'RTSOON',
  disabled: 'RTOFF',
  noDiscount: 'RTNONE',       // discount_type 'none'
  fraction: 'RTHALF',         // 12.5% — the label must keep the .5
  newest: 'RTBANNER',         // last live offer by id, so /api/products shows it
};

/**
 * Writes the fixture catalogue. Returns the canary SKU, which only exists in a
 * database this function has run against.
 */
export async function seed(db, runId) {
  const canary = `RT-CANARY-${runId}`;

  const product = async (sku, over) => {
    const p = {
      slug: sku.toLowerCase(),
      kind: 'wax',
      name_ar: `منتج ${sku}`,
      name_en: `Product ${sku}`,
      price: 100,
      compare_at: null,
      image: `assets/${sku}.png`,
      size_ml: 100,
      hold_level: 3,
      hair_types: '',
      stock: 50,
      active: true,
      featured: false,
      sort: 0,
      ...over,
    };
    await db`
      INSERT INTO products (sku, slug, kind, name_ar, name_en, price, compare_at, image,
                            size_ml, hold_level, hair_types, stock, active, featured, sort)
      VALUES (${sku}, ${p.slug}, ${p.kind}, ${p.name_ar}, ${p.name_en}, ${p.price},
              ${p.compare_at}, ${p.image}, ${p.size_ml}, ${p.hold_level}, ${p.hair_types},
              ${p.stock}, ${p.active}, ${p.featured}, ${p.sort})`;
  };

  await product(canary, { price: 42, stock: 9, hair_types: 'straight', sort: 0 });
  await product(SKU.wax, { price: 100, stock: 50, hair_types: 'straight,wavy', hold_level: 4, sort: 1 });
  await product(SKU.gel, { price: 55.5, stock: 50, hair_types: 'wavy,curly', kind: 'gel', hold_level: 3, sort: 2, compare_at: 70 });
  await product(SKU.outOfStock, { price: 80, stock: 0, hair_types: 'wavy', sort: 3 });
  await product(SKU.unpriced, { price: 0, stock: 5, hair_types: 'coily', sort: 4 });
  await product(SKU.inactive, { price: 60, stock: 50, hair_types: 'straight', active: false, sort: 5 });
  // hold_level breaks ranking ties, and scarce and bulk both lead on 'thick'.
  // Left equal, which of them the quiz recommends would depend on the sort
  // being stable rather than on a rule, so one of them is given the higher hold.
  await product(SKU.scarce, { price: 200, stock: 1, hair_types: 'thick', hold_level: 5, sort: 6 });
  await product(SKU.stocky, { price: 10, stock: 137, hair_types: 'fine', sort: 7 });
  await product(SKU.bulk, { price: 500, stock: 500, hair_types: 'thick', sort: 8 });

  /**
   * Offers are inserted in a fixed order because two routes read them by id
   * rather than by name: /api/confirm hands out the OLDEST live coded offer as
   * the welcome coupon, and /api/products advertises the NEWEST. So RT10 has to
   * go in first and RTBANNER last, or those two assertions are testing
   * whichever row Postgres happened to number lowest.
   */
  const offer = async (code, over = {}) => {
    const o = {
      title_ar: `عرض ${code}`, title_en: `Offer ${code}`,
      body_ar: 'نص', body_en: 'body',
      discount_type: 'percent', discount_value: 10,
      min_total: 0, starts_at: null, ends_at: null,
      active: true, max_uses: null, used_count: 0,
      ...over,
    };
    await db`
      INSERT INTO offers (title_ar, title_en, body_ar, body_en, code, discount_type,
                          discount_value, min_total, starts_at, ends_at, active,
                          max_uses, used_count)
      VALUES (${o.title_ar}, ${o.title_en}, ${o.body_ar}, ${o.body_en}, ${code},
              ${o.discount_type}, ${o.discount_value}, ${o.min_total},
              ${o.starts_at}, ${o.ends_at}, ${o.active}, ${o.max_uses}, ${o.used_count})`;
  };

  await offer(CODE.tenPercent, { discount_value: 10 });
  await offer(CODE.fixed, { discount_type: 'fixed', discount_value: 100 });
  await offer(CODE.minimum, { discount_value: 20, min_total: 500 });
  await offer(CODE.exhausted, { max_uses: 3, used_count: 3 });
  await offer(CODE.capOne, { max_uses: 1, used_count: 0 });
  await offer(CODE.expired, { ends_at: new Date(Date.now() - 86_400_000).toISOString() });
  await offer(CODE.future, { starts_at: new Date(Date.now() + 86_400_000).toISOString() });
  await offer(CODE.disabled, { active: false });
  await offer(CODE.noDiscount, { discount_type: 'none', discount_value: 0 });
  await offer(CODE.fraction, { discount_value: 12.5 });
  await offer(CODE.newest, { discount_value: 5, min_total: 250 });

  return canary;
}

/**
 * An order row with a token whose digest is already in the database.
 *
 * The refund route's only credential is the token from the confirmation email,
 * and that token is never stored — /api/order returns a reference and puts the
 * token in the mail, so there is no way to place an order over HTTP and then
 * learn the token that unlocks it. The row therefore has to be written here,
 * with the digest computed by the same helper the route reads it with, so that
 * a change to the hashing breaks this suite instead of quietly locking every
 * customer out of their own order.
 */
export function makeOrderFactory(db, sha256, newAccessToken) {
  let n = 0;

  return async function makeOrder(over = {}) {
    n++;
    const token = newAccessToken();
    const ref = over.ref || `RT-${String(Date.now()).slice(-6)}-${String(n).padStart(3, '0')}`;
    const o = {
      name: 'Fixture Customer', phone: '01012345678',
      address: '12 Test Street, Nasr City', city: 'Cairo', notes: '',
      lang: 'ar', subtotal: 200, shipping: 30, discount: 0, total: 230,
      coupon: '', status: 'new', email: 'fixture@example.test',
      ...over,
    };
    const [row] = await db`
      INSERT INTO orders (ref, name, phone, address, city, notes, lang, subtotal,
                          shipping, discount, total, coupon, status, source, ip,
                          email, access_hash)
      VALUES (${ref}, ${o.name}, ${o.phone}, ${o.address}, ${o.city}, ${o.notes},
              ${o.lang}, ${o.subtotal}, ${o.shipping}, ${o.discount}, ${o.total},
              ${o.coupon}, ${o.status}, 'web', '10.0.0.1', ${o.email},
              ${await sha256(token)})
      RETURNING id, ref`;
    return { id: Number(row.id), ref: row.ref, token };
  };
}
