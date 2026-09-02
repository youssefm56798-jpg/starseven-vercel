import Link from 'next/link';
import { sql } from '../../../lib/db.js';
import { bySlug } from '../../../lib/hairtypes.js';
import { requireAdmin } from '../_lib/guard.js';
import { dt, Flash, money, num } from '../_lib/ui.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard — Star Seven admin' };

export default async function Dashboard({ searchParams }) {
  const admin = await requireAdmin();
  const sp = await searchParams;

  /*
   * One round trip for all six KPIs — Neon charges a request per statement.
   * 'Africa/Cairo' is written inline because "today" has to mean today in the
   * shop's timezone, and the rows are stored as UTC.
   *
   * The two date-bounded counts used to compare a converted value on the left:
   *
   *     WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date = <today>
   *
   * which reads correctly and cannot use an index, because the thing being
   * compared has to be computed for every row first. Nor can it be rescued
   * with an expression index: converting a timestamptz into a named zone is
   * STABLE, not IMMUTABLE — the answer depends on the timezone database, which
   * is allowed to change — and Postgres will not index a function that may
   * change its mind. So both KPIs were a sequential scan of the whole orders
   * table, twice, every time this screen was opened.
   *
   * Rewritten as a half-open range against the raw column. The boundary is
   * still computed in Cairo time, so the answer is the same to the second, but
   * it is computed once for the whole query and then the index on created_at
   * is seeked to it. date_trunc lands on local midnight as a naive timestamp;
   * the second AT TIME ZONE reads that back as the instant it names.
   */
  const [kpi] = await sql`
    WITH bounds AS (
      SELECT
        date_trunc('day',   now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo' AS day0,
        date_trunc('month', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo' AS mon0
    )
    SELECT
      (SELECT COUNT(*) FROM orders WHERE status = 'new') AS orders_new,
      (SELECT COUNT(*) FROM orders, bounds
        WHERE orders.created_at >= bounds.day0) AS orders_today,
      (SELECT COALESCE(SUM(total), 0) FROM orders, bounds
        WHERE orders.created_at >= bounds.mon0
          AND orders.status <> 'cancelled') AS rev_month,
      (SELECT COALESCE(AVG(total), 0) FROM orders WHERE status <> 'cancelled') AS aov,
      (SELECT COUNT(*) FROM subscribers WHERE status = 'active') AS subs_active,
      (SELECT COUNT(*) FROM subscribers WHERE status = 'pending') AS subs_pending`;

  const recent = await sql`
    SELECT o.id, o.ref, o.name, o.phone, o.total, o.status, o.created_at,
           (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS n_items
      FROM orders o
     ORDER BY o.id DESC
     LIMIT 8`;

  // Which hair types the audience actually has -> which SKU to make next.
  const quiz = await sql`
    SELECT hair_type, COUNT(*) AS c
      FROM quiz_results
     WHERE created_at > now() - interval '90 days'
     GROUP BY hair_type
     ORDER BY c DESC`;
  const quizTotal = quiz.reduce((s, q) => s + Number(q.c), 0) || 1;

  const top = await sql`
    SELECT i.sku, i.name, SUM(i.qty) AS q, SUM(i.qty * i.price) AS rev
      FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.status <> 'cancelled'
     GROUP BY i.sku, i.name
     ORDER BY q DESC
     LIMIT 6`;

  /*
   * Running low, meaning products that are actually being sold.
   *
   * This asked for active products at stock 20 or under, which sounds right and
   * was not: half the catalogue is priced at zero on purpose - the storefront
   * reads that as "ask us" and shows a WhatsApp button instead of Add to cart -
   * and those rows are deliberately held at stock 0 as a second lock. So the
   * most prominent table on the dashboard was thirty-odd permanent red zeros
   * that no amount of restocking would ever clear, and a genuine shortage would
   * have appeared somewhere in the middle of them.
   *
   * A warning that is always on is not a warning. Priced products only.
   */
  const lowStock = await sql`
    SELECT sku, name_ar, name_en, stock
      FROM products
     WHERE active = true
       AND archived_at IS NULL
       AND price > 0
       AND stock <= 20
     ORDER BY stock ASC`;

  const ordersNew = Number(kpi.orders_new);

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">Welcome back, {admin.name}.</p>

      <Flash code={sp?.m} />

      <div className="cards">
        <div className={ordersNew ? 'kpi hot' : 'kpi'}>
          <b>{num(ordersNew)}</b><span>Orders to action</span>
        </div>
        <div className="kpi"><b>{num(kpi.orders_today)}</b><span>Orders today</span></div>
        <div className="kpi"><b>{num(kpi.rev_month)}</b><span>Revenue this month (EGP)</span></div>
        <div className="kpi"><b>{num(kpi.aov)}</b><span>Average order (EGP)</span></div>
        <div className="kpi"><b>{num(kpi.subs_active)}</b><span>Subscribers</span></div>
        <div className="kpi"><b>{num(kpi.subs_pending)}</b><span>Awaiting confirmation</span></div>
      </div>

      {lowStock.length > 0 && (
        <div className="panel">
          <h2>Running low</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Product</th><th>SKU</th><th>Stock left</th></tr>
              </thead>
              <tbody>
                {lowStock.map(p => (
                  <tr key={p.sku}>
                    <td>{p.name_en}<div className="muted" dir="rtl">{p.name_ar}</div></td>
                    <td className="muted">{p.sku}</td>
                    <td><span className={Number(p.stock) === 0 ? 'pill new' : 'pill pending'}>{Number(p.stock)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>
          Latest orders
          <span className="right"><Link className="btn sm ghost" href="/admin/orders">All orders</Link></span>
        </h2>
        {recent.length === 0 ? (
          <div className="empty">No orders yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Ref</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>When</th></tr>
              </thead>
              <tbody>
                {recent.map(o => (
                  <tr key={o.id}>
                    <td><Link href={`/admin/orders?q=${encodeURIComponent(o.ref)}`}><b>{formatRef(o.ref)}</b></Link></td>
                    <td>{o.name}<div className="muted" dir="ltr">{o.phone}</div></td>
                    <td>{Number(o.n_items)}</td>
                    <td><b>{money(o.total)}</b></td>
                    <td><span className={`pill ${o.status}`}>{o.status}</span></td>
                    <td className="muted">{dt(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>
          Hair types your customers report
          <span className="right muted" style={{ fontWeight: 600 }}>last 90 days</span>
        </h2>
        <div className="pad">
          {quiz.length === 0 ? (
            <div className="muted">
              Nothing yet — the numbers fill in as people use the hair-type finder on the site.
              This is the signal that tells you which product to make next.
            </div>
          ) : (
            <div className="barchart">
              {quiz.map(q => {
                const tile = bySlug(q.hair_type);
                const count = Number(q.c);
                const pct = Math.round((count / quizTotal) * 100);
                return (
                  <div className="row" key={q.hair_type}>
                    <div style={{ fontWeight: 800 }}>{tile ? tile.en.name : q.hair_type}</div>
                    <div className="track">
                      <div className="fill" style={{ width: `${pct}%`, background: tile ? tile.color : '#D7291D' }} />
                    </div>
                    <div className="muted">{count} · {pct}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Best sellers</h2>
        {top.length === 0 ? (
          <div className="empty">No sales yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Product</th><th>Units</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {top.map(t => (
                  <tr key={`${t.sku}-${t.name}`}>
                    <td>{t.name}<div className="muted">{t.sku}</div></td>
                    <td><b>{Number(t.q)}</b></td>
                    <td>{money(t.rev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
