import { neon } from '@neondatabase/serverless';

/**
 * Neon over HTTP — the right driver for serverless, where a pooled connection
 * would be opened and thrown away on every invocation.
 *
 * The client is created on first query rather than at import, because Next.js
 * imports every route while building the page manifest, and at that point no
 * DATABASE_URL exists. Connecting eagerly would fail the build.
 *
 * Tagged-template usage parameterises automatically:
 *     const rows = await sql`SELECT * FROM products WHERE sku = ${sku}`;
 * Never assemble SQL by string concatenation.
 */
let client = null;

function getClient() {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables, ' +
      'or to .env.local for local development.'
    );
  }
  client = neon(url);
  return client;
}

/** Tagged-template query. Also exposes .transaction() from the Neon driver. */
export const sql = (...args) => getClient()(...args);

/**
 * Runs several statements atomically. Neon's HTTP driver has no interactive
 * transaction, so the whole batch is submitted together.
 * Usage: await sql.transaction(txSql => [ txSql`...`, txSql`...` ])
 */
sql.transaction = (...args) => getClient().transaction(...args);

/** True when a database is configured — lets pages degrade instead of crashing. */
export const hasDb = () => Boolean(process.env.DATABASE_URL);

/**
 * The client IP, taken only from headers the platform sets and the client
 * cannot forge.
 *
 * This is load-bearing: every rate limiter in the app keys its bucket on this
 * value - the admin login throttle, the order and refund limits, the
 * newsletter and coupon limits - and it is written into the orders and
 * subscribers audit columns. If the client can choose it, none of those hold.
 *
 * It used to read the leftmost entry of x-forwarded-for, and that is exactly
 * the part a client controls: a proxy appends the real address to the RIGHT of
 * whatever the client sent, so the leftmost value is attacker-supplied. A fresh
 * X-Forwarded-For on every request put each one in its own bucket and no
 * fixed-window limit ever filled.
 *
 * On Vercel the trustworthy sources are x-vercel-forwarded-for and x-real-ip,
 * both set by the edge and overwritten on the way in, so a client header of the
 * same name is discarded. We take those and never trust x-forwarded-for. The
 * 0.0.0.0 fallback means one shared bucket rather than an open door when no
 * header is present (local dev, or a platform that sets none).
 */
export function clientIp(req) {
  const h = req?.headers;
  const g = k => (h?.get?.(k) || '').trim();
  return g('x-vercel-forwarded-for') || g('x-real-ip') || '0.0.0.0';
}

/**
 * Fixed-window rate limiter. Returns true while the caller is under the limit.
 * A single statement, so two concurrent invocations cannot race between a read
 * and a write.
 */
/**
 * The network the address belongs to, for rate-limit bucketing.
 *
 * Bucketing on the exact address is defeated by an attacker who owns a block of
 * them. An IPv6 client is routinely handed a whole /64 (a cheap VM comes with
 * 2**64 addresses), so one full-address bucket per request means the window
 * never fills. IPv4 is grouped to /24 for the same reason at a smaller scale.
 * The stored audit value keeps the full address - only the limiter key is
 * coarsened, so forensics still see exactly who, while the limit sees the block.
 */
export function ipBucket(ip) {
  const s = String(ip || '').split('%')[0].trim().toLowerCase();
  if (!s) return '0.0.0.0/24';

  const v4 = o => {
    // Only coarsen a genuine dotted-quad. rateOk is also called with non-IP
    // keys (the login-account limiter passes an email), and an email that
    // happens to have four dot-separated pieces must pass through untouched.
    const ok = o.length === 4 && o.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
    return ok ? `${o[0]}.${o[1]}.${o[2]}.0/24` : null;
  };

  if (!s.includes(':')) return v4(s.split('.')) ?? s;

  // An IPv4-mapped address (::ffff:1.2.3.4) is really IPv4 - group it as a /24,
  // not as a distinct /64 per host.
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4(mapped[1].split('.')) ?? s;

  // IPv6, done on the EXPANDED address rather than its text. The first version
  // sliced the string on ':' and took four pieces, so it keyed on the
  // representation: 2001:db8::1 and 2001:db8::2 share a /64 but compress to
  // different strings, and each landed in its own bucket - which reopened the
  // very rotation bypass the /64 grouping exists to close. Expand :: to eight
  // hextets first, then the first four are unambiguously the /64.
  const halves = s.split('::');
  if (halves.length > 2) return s;                       // malformed: its own bucket
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  let groups;
  if (tail === null) {
    groups = head;                                       // no ::, must already be 8
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return s;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  }
  if (groups.length !== 8) return s;
  const norm = groups.map(g => (parseInt(g || '0', 16) || 0).toString(16));
  return norm.slice(0, 4).join(':') + '::/64';
}

export async function rateOk(bucket, ip, max, windowSec) {
  // Key on the network, not the exact address.
  const key = ipBucket(ip);
  const rows = await sql`
    INSERT INTO rate_limits (bucket, ip, hits, window_start)
    VALUES (${bucket}, ${key}, 1, now())
    ON CONFLICT (bucket, ip) DO UPDATE
      SET hits = CASE
            WHEN rate_limits.window_start < now() - (${String(windowSec)} || ' seconds')::interval
            THEN 1 ELSE rate_limits.hits + 1 END,
          window_start = CASE
            WHEN rate_limits.window_start < now() - (${String(windowSec)} || ' seconds')::interval
            THEN now() ELSE rate_limits.window_start END
    RETURNING hits`;
  return Number(rows[0]?.hits ?? 1) <= max;
}
