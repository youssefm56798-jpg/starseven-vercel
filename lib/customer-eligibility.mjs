import { normalizePhone } from './phone.js';

// Guest checkout cannot prove a unique human. These are contact identifiers,
// not device fingerprints, IP addresses or a substitute for phone verification.
export function customerKeys(phone, email) {
  const p = normalizePhone(phone);
  const e = String(email ?? '').trim().toLowerCase();
  if (!p || e.length > 190) throw new Error('Invalid customer identity');
  return [`s7:customer:phone:${p}`, ...(e ? [`s7:customer:email:${e}`] : [])].sort();
}

/** Every checkout takes the same locks, including checkouts without a coupon.
 * Separate statements ensure the following READ COMMITTED history check gets
 * a fresh snapshot after a concurrent order commits. A same-statement lock
 * plus NOT EXISTS would retain a stale snapshot and admit two first orders.
 */
export function customerLockStatements(sql, phone, email, oldPhone = null) {
  const keys = customerKeys(phone, email);
  if (normalizePhone(oldPhone)) keys.push(...customerKeys(oldPhone, email));
  return [...new Set(keys)].sort().map(key => sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`);
}

// Includes cancelled orders: a successfully placed order consumes eligibility;
// cancelling or refunding it does not turn the contact into a new customer.
export async function hasPriorOrder(sql, phone, email, exceptOrderId = 0) {
  const p = normalizePhone(phone);
  const e = String(email ?? '').trim().toLowerCase();
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM orders o
       WHERE o.id <> ${exceptOrderId}::int
         AND (o.phone = ${p}::text OR (${e}::text<>'' AND lower(btrim(o.email)) = ${e}::text))
    ) AS seen`;
  return row?.seen === true;
}

/** Transaction guard, after customer locks and before inserting the order. */
export function firstOrderGuard(sql, phone, email, exceptOrderId = 0) {
  const p = normalizePhone(phone), e = String(email ?? '').trim().toLowerCase();
  return sql`
    SELECT 1 / (NOT EXISTS (
      SELECT 1 FROM orders o
       WHERE o.id <> ${exceptOrderId}::int
         AND (o.phone = ${p}::text OR (${e}::text<>'' AND lower(btrim(o.email)) = ${e}::text))
    ))::int AS first_order_guard`;
}
