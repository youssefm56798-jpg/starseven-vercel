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

/** Client IP, trusting Vercel's forwarding headers. */
export function clientIp(req) {
  const h = req?.headers;
  const fwd = h?.get?.('x-forwarded-for') || '';
  return (fwd.split(',')[0] || h?.get?.('x-real-ip') || '0.0.0.0').trim();
}

/**
 * Fixed-window rate limiter. Returns true while the caller is under the limit.
 * A single statement, so two concurrent invocations cannot race between a read
 * and a write.
 */
export async function rateOk(bucket, ip, max, windowSec) {
  const rows = await sql`
    INSERT INTO rate_limits (bucket, ip, hits, window_start)
    VALUES (${bucket}, ${ip}, 1, now())
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
