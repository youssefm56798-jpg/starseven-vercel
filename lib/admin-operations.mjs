import { createHash } from 'node:crypto';
import { parseStockCsv } from './stock-csv.mjs';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const whole = (value, min = 0, max = 2147483647) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};
const amount = value => {
  const s = String(value ?? '').trim();
  return /^\d+(?:\.\d{1,2})?$/.test(s) && Number(s) <= 99999999.99 ? Number(s) : null;
};
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const actorOk = actor => /^admin:[1-9]\d*$/.test(actor);
const failed = error => ({ ok: false, error });
const conflict = error => ['22012', '23505', '40001', '40P01'].includes(error?.code);
export const auditContext = (sql, actor, reason) => {
  if (!actorOk(actor)) throw new Error('Authenticated actor required');
  return sql`SELECT set_config('s7.audit_actor',${actor}::text,true),
    set_config('s7.audit_reason',${reason}::text,true)`;
};

export function reportDays(value) { return [7, 30, 90, 365].includes(Number(value)) ? Number(value) : 30; }
export function percentageChange(current, previous) {
  const before = Number(previous);
  return before === 0 ? null : Math.round((Number(current) - before) / Math.abs(before) * 1000) / 10;
}
export function csvCell(value) {
  let s = String(value ?? '');
  // Spreadsheet formula injection, including leading whitespace/control chars.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function financialReport(sql, days = 30) {
  days = reportDays(days);
  return sql`
    WITH b AS (SELECT date_trunc('day',now() AT TIME ZONE 'Africa/Cairo') + interval '1 day' AS finish_local),
    windows AS (
      SELECT 'current' AS period, (finish_local - ${days}::int * interval '1 day') AT TIME ZONE 'Africa/Cairo' AS start,
        finish_local AT TIME ZONE 'Africa/Cairo' AS finish FROM b
      UNION ALL SELECT 'previous', (finish_local - ${days * 2}::int * interval '1 day') AT TIME ZONE 'Africa/Cairo',
        (finish_local - ${days}::int * interval '1 day') AT TIME ZONE 'Africa/Cairo' FROM b
    ), collections AS (
      SELECT amount_delta AS amount,occurred_at FROM collection_movements
      UNION ALL SELECT o.collected_amount,o.settled_at FROM orders o
        WHERE o.status='delivered' AND o.collected_amount IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM collection_movements m WHERE m.order_id=o.id)
    )
    SELECT w.period, w.start, w.finish,
      (SELECT count(*)::int FROM orders o WHERE o.created_at>=w.start AND o.created_at<w.finish) AS orders,
      (SELECT count(*)::int FROM orders o WHERE o.created_at>=w.start AND o.created_at<w.finish AND o.status='cancelled') AS cancelled,
      (SELECT coalesce(sum(total),0) FROM orders o WHERE o.created_at>=w.start AND o.created_at<w.finish AND o.status<>'cancelled') AS booked,
      (SELECT coalesce(sum(discount),0) FROM orders o WHERE o.created_at>=w.start AND o.created_at<w.finish AND o.status<>'cancelled') AS discount_spend,
      (SELECT coalesce(sum(amount),0) FROM collections c WHERE c.occurred_at>=w.start AND c.occurred_at<w.finish) AS collected,
      (SELECT coalesce(sum(refund_amount),0) FROM order_returns r WHERE r.refunded_at>=w.start AND r.refunded_at<w.finish AND r.state='refunded') AS refunded,
      (SELECT count(*)::int FROM order_returns r WHERE r.created_at>=w.start AND r.created_at<w.finish) AS return_cases
    FROM windows w ORDER BY w.period`;
}

export async function operationalSummary(sql) {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM orders WHERE status='new' AND created_at<now()-interval '24 hours') AS aging_new,
      (SELECT count(*)::int FROM orders WHERE status='confirmed' AND created_at<now()-interval '48 hours') AS aging_confirmed,
      (SELECT count(*)::int FROM orders WHERE status='shipped' AND expected_to<(now() AT TIME ZONE 'Africa/Cairo')::date) AS overdue_delivery,
      (SELECT count(*)::int FROM orders WHERE refund_requested_at IS NOT NULL AND status NOT IN ('cancelled','delivered')) AS cancellation_requests,
      (SELECT count(*)::int FROM order_returns WHERE state IN ('requested','approved','received')) AS open_returns,
      (SELECT coalesce(sum(greatest(total-coalesce(collected_amount,0),0)),0) FROM orders WHERE status='delivered') AS cash_outstanding,
      (SELECT count(*)::int FROM products WHERE active=true AND archived_at IS NULL AND price>0 AND stock<=20) AS low_stock`;
  return row;
}

export async function customerHistory(sql, search = '') {
  const q = '%' + text(search, 100).replace(/[\\%_]/g, '\\$&') + '%';
  return sql`
    WITH customers AS (
      SELECT phone, min(id) AS customer_id, max(name) AS name, max(email) AS email, count(*)::int AS orders,
        min(created_at) AS first_order, max(created_at) AS last_order,
        sum(CASE WHEN status='delivered' THEN coalesce(collected_amount,0) ELSE 0 END) AS collected,
        count(*) FILTER(WHERE status='cancelled')::int AS cancelled
      FROM orders WHERE phone<>'' GROUP BY phone
    )
    SELECT c.*,
      (SELECT coalesce(sum(r.refund_amount),0) FROM order_returns r JOIN orders o ON o.id=r.order_id
        WHERE o.phone=c.phone AND r.state='refunded') AS refunded,
      EXISTS(SELECT 1 FROM subscribers s WHERE s.phone=c.phone AND s.status='active') AS marketing_consent
    FROM customers c WHERE c.phone ILIKE ${q} OR c.name ILIKE ${q} OR c.email ILIKE ${q}
    ORDER BY c.last_order DESC LIMIT 100`;
}

export async function adjustStock(sql, input, actor) {
  const id = whole(input.id, 1), expected = whole(input.expected), delta = whole(input.delta, -1000000, 1000000);
  const reason = text(input.reason, 300);
  if (!id || expected === null || delta === null || delta === 0 || reason.length < 5) return failed('input');
  try {
    await sql.transaction([
      auditContext(sql, actor, reason),
      sql`WITH changed AS (
        UPDATE products SET stock=stock+${delta}::int
        WHERE id=${id}::int AND stock=${expected}::int AND stock+${delta}::int BETWEEN 0 AND 2147483647
        RETURNING id
      ) SELECT 1/count(*)::int AS guard FROM changed`,
    ]);
    return { ok: true };
  } catch (e) { if (conflict(e)) return failed('stale'); throw e; }
}

export async function importStock(sql, raw, actor) {
  let rows;try{rows=parseStockCsv(raw);}catch{return failed('input');}
  const products=await sql`SELECT id,sku FROM products WHERE sku=ANY(${rows.map(v=>v.sku)}::text[])`;
  if(products.length!==rows.length)return failed('input');
  const bySku=new Map(products.map(p=>[p.sku,Number(p.id)]));
  const ordered=rows.map(r=>({...r,id:bySku.get(r.sku)})).sort((a,b)=>a.id-b.id);
  const statements=[];
  for(const r of ordered){
    statements.push(auditContext(sql,actor,r.reason));
    statements.push(sql`WITH changed AS (UPDATE products SET stock=stock+${r.delta}::int
      WHERE id=${r.id}::int AND stock=${r.expected}::int AND stock+${r.delta}::int BETWEEN 0 AND 2147483647
      RETURNING id) SELECT 1/count(*)::int AS guard FROM changed`);
  }
  try{await sql.transaction(statements);return {ok:true};}
  catch(e){if(conflict(e))return failed('stale');throw e;}
}

export function returnInput(input) {
  const id = whole(input.order_id, 1), reason = text(input.reason);
  const key = text(input.request_key, 64);
  const rows = Array.isArray(input.items) ? input.items : [];
  const items = rows.map(v => ({ id: whole(v.id, 1), qty: whole(v.qty, 1, 1000) })).sort((a, b) => a.id-b.id);
  if (!id || reason.length < 5 || !/^[a-f0-9-]{36}$/.test(key) || !items.length || items.length > 30 ||
      items.some(v => !v.id || !v.qty) || new Set(items.map(v => v.id)).size !== items.length) return null;
  const digest = createHash('sha256').update(JSON.stringify({ id, reason, items })).digest('hex');
  return { id, reason, key, items, digest };
}

export async function createReturn(sql, input, actor) {
  if (!actorOk(actor)) throw new Error('Authenticated actor required');
  const v = returnInput(input); if (!v) return failed('input');
  const replay = async () => {
    const [r] = await sql`SELECT id,request_hash FROM order_returns WHERE request_key=${v.key} LIMIT 1`;
    return r ? r.request_hash===v.digest ? {ok:true,id:r.id} : failed('stale') : null;
  };
  const prior = await replay(); if (prior) return prior;
  try {
    const results = await sql.transaction([
      sql`SELECT id FROM orders WHERE id=${v.id}::int ORDER BY id FOR UPDATE`,
      sql`WITH accepted AS (
        INSERT INTO order_returns(order_id,reason,actor,request_key,request_hash)
        SELECT o.id,${v.reason},${actor},${v.key},${v.digest} FROM orders o
        WHERE o.id=${v.id}::int AND o.status='delivered' AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(v.items)}::jsonb) AS x(id int,qty int)
          LEFT JOIN order_items i ON i.id=x.id AND i.order_id=o.id
          WHERE i.id IS NULL OR x.qty>i.qty-coalesce((
            SELECT sum(ri.qty) FROM return_items ri JOIN order_returns r ON r.id=ri.return_id
            WHERE ri.order_item_id=i.id AND r.state<>'rejected'
          ),0)
        ) RETURNING id
      ) SELECT 1/count(*)::int AS guard FROM accepted`,
      sql`INSERT INTO return_items(return_id,order_item_id,qty)
        SELECT r.id,x.id,x.qty FROM order_returns r,
          jsonb_to_recordset(${JSON.stringify(v.items)}::jsonb) AS x(id int,qty int)
        WHERE r.request_key=${v.key} RETURNING return_id`,
      sql`INSERT INTO admin_audit(area,record_id,actor,action)
        SELECT 'returns',id::text,${actor},'requested' FROM order_returns WHERE request_key=${v.key}`,
    ]);
    return { ok: true, id: results[2][0].return_id };
  } catch (e) { if (conflict(e)) return (await replay()) ?? failed('stale'); throw e; }
}

const RETURN_MOVES = { requested:['approved','rejected'], approved:['received','rejected'], received:['refunded','closed'] };
export async function moveReturn(sql, input, actor) {
  const id=whole(input.id,1),version=whole(input.version),from=text(input.from,20),to=text(input.to,20);
  const condition=text(input.condition,80),restock=input.restock===true;
  const refund=amount(input.refund_amount ?? '0'),method=text(input.refund_method,40),reference=text(input.refund_reference,100);
  const refundedOn=text(input.refunded_on,10);
  if (!id || version===null || !RETURN_MOVES[from]?.includes(to) ||
      (to==='received' && !['resellable','damaged','opened'].includes(condition)) ||
      (restock && (to!=='received' || condition!=='resellable')) ||
      (to==='refunded' && (refund===null || refund<=0 || !['cash','bank-transfer','wallet'].includes(method) || !reference || !validDay(refundedOn)))) return failed('input');
  try {
    await sql.transaction([
      auditContext(sql,actor,'return-receipt'),
      sql`SELECT o.id FROM orders o JOIN order_returns r ON r.order_id=o.id WHERE r.id=${id}::int FOR UPDATE OF o`,
      sql`WITH moved AS (
        UPDATE order_returns r SET state=${to},version=version+1,updated_at=now(),
          condition=CASE WHEN ${to}='received' THEN ${condition} ELSE condition END,
          restocked=CASE WHEN ${to}='received' THEN ${restock}::boolean ELSE restocked END,
          refund_amount=CASE WHEN ${to}='refunded' THEN ${refund}::numeric ELSE refund_amount END,
          refund_method=CASE WHEN ${to}='refunded' THEN ${method} ELSE refund_method END,
          refund_reference=CASE WHEN ${to}='refunded' THEN ${reference} ELSE refund_reference END,
          refunded_at=CASE WHEN ${to}='refunded' THEN ${refundedOn || null}::date::timestamp AT TIME ZONE 'Africa/Cairo' ELSE refunded_at END
        FROM orders o WHERE r.id=${id}::int AND r.order_id=o.id AND o.status='delivered'
          AND r.state=${from} AND r.version=${version}::int
          AND (${to}<>'refunded' OR (
            ${refundedOn || null}::date <= (now() AT TIME ZONE 'Africa/Cairo')::date
            AND ${refund}::numeric <= coalesce(o.collected_amount,0)-coalesce((
              SELECT sum(other.refund_amount) FROM order_returns other WHERE other.order_id=o.id AND other.state='refunded' AND other.id<>r.id
            ),0)
            AND ${refund}::numeric <= greatest(o.subtotal-o.discount,0)-coalesce((
              SELECT sum(other.refund_amount) FROM order_returns other WHERE other.order_id=o.id AND other.state='refunded' AND other.id<>r.id
            ),0)
            AND ${refund}::numeric <= round((SELECT sum(i.price*ri.qty) FROM return_items ri JOIN order_items i ON i.id=ri.order_item_id
              WHERE ri.return_id=r.id) * greatest(o.subtotal-o.discount,0) / nullif(o.subtotal,0),2)
          ))
          AND (NOT ${restock}::boolean OR NOT EXISTS (
            SELECT 1 FROM return_items ri JOIN order_items i ON i.id=ri.order_item_id
            LEFT JOIN products p ON p.id=i.product_id WHERE ri.return_id=r.id AND p.id IS NULL
          )) RETURNING r.id
      ) SELECT 1/count(*)::int AS guard FROM moved`,
      sql`UPDATE products p SET stock=p.stock+x.qty
        FROM (SELECT i.product_id,sum(ri.qty)::int AS qty FROM return_items ri JOIN order_items i ON i.id=ri.order_item_id
          WHERE ri.return_id=${id}::int AND ${to}='received' AND ${restock}::boolean GROUP BY i.product_id) x
        WHERE p.id=x.product_id`,
      sql`INSERT INTO admin_audit(area,record_id,actor,action,detail)
        VALUES ('returns',${String(id)},${actor},${to},jsonb_build_object('from',${from}::text,'restocked',${restock}::boolean))`,
    ]);
    return {ok:true};
  } catch(e) { if(conflict(e))return failed('stale');throw e; }
}

export function shippingInput(input) {
  const code=text(input.code,30),name_ar=text(input.name_ar,80),name_en=text(input.name_en,80);
  const fee=amount(input.fee),free=amount(input.free_over),min=whole(input.min_days,0,30),max=whole(input.max_days,0,30),version=whole(input.version);
  if(!['cairo','giza','qalyubia'].includes(code)||!name_ar||!name_en||fee===null||free===null||min===null||max===null||max<min||version===null)return null;
  return {code,name_ar,name_en,fee,free,min,max,version,active:input.active===true};
}
export async function saveShippingZone(sql,input,actor) {
  const v=shippingInput(input);if(!v)return failed('input');
  if(!actorOk(actor))throw new Error('Authenticated actor required');
  try {
    await sql.transaction([
      sql`WITH changed AS (UPDATE shipping_zones SET name_ar=${v.name_ar},name_en=${v.name_en},fee=${v.fee},free_over=${v.free},
        min_days=${v.min},max_days=${v.max},active=${v.active},version=version+1
        WHERE code=${v.code} AND version=${v.version} RETURNING code)
        SELECT 1/count(*)::int AS guard FROM changed`,
      sql`INSERT INTO admin_audit(area,record_id,actor,action,detail) VALUES ('shipping',${v.code},${actor},'updated',
        jsonb_build_object('fee',${v.fee}::numeric,'free_over',${v.free}::numeric,'min_days',${v.min}::int,'max_days',${v.max}::int,'active',${v.active}::boolean))`,
    ]);return {ok:true};
  }catch(e){if(conflict(e))return failed('stale');throw e;}
}

export async function createSettlement(sql,input,actor) {
  const courier=text(input.courier,80),reference=text(input.reference,100),date=text(input.settled_on,10),received=amount(input.received),fees=amount(input.fees??'0'),notes=text(input.notes,300);
  const ids=Array.isArray(input.order_ids)?input.order_ids.map(v=>whole(v,1)).sort((a,b)=>a-b):[];
  if(!actorOk(actor))throw new Error('Authenticated actor required');
  if(!courier||!reference||!validDay(date)||received===null||fees===null||!ids.length||ids.length>100||ids.some(v=>!v)||new Set(ids).size!==ids.length)return failed('input');
  try {
    await sql.transaction([
      sql`SELECT id FROM orders WHERE id=ANY(${ids}::int[]) ORDER BY id FOR UPDATE`,
      sql`WITH made AS (INSERT INTO courier_settlements(courier,reference,settled_on,received,fees,notes,actor)
        SELECT ${courier},${reference},${date}::date,${received}::numeric,${fees}::numeric,${notes},${actor}
        WHERE (SELECT count(*) FROM orders o WHERE o.id=ANY(${ids}::int[]) AND o.status='delivered'
          AND o.courier=${courier} AND o.collected_amount IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM settlement_orders so WHERE so.order_id=o.id))=${ids.length}::int
        AND ${date}::date<=(now() AT TIME ZONE 'Africa/Cairo')::date RETURNING id)
        SELECT 1/count(*)::int AS guard FROM made`,
      sql`INSERT INTO settlement_orders(settlement_id,order_id,expected,recorded_collected)
        SELECT s.id,o.id,o.total,o.collected_amount FROM courier_settlements s,orders o
        WHERE s.reference=${reference} AND o.id=ANY(${ids}::int[])`,
      sql`INSERT INTO admin_audit(area,record_id,actor,action)
        SELECT 'settlements',id::text,${actor},'recorded' FROM courier_settlements WHERE reference=${reference}`,
    ]);return {ok:true};
  }catch(e){if(conflict(e))return failed('stale');throw e;}
}
