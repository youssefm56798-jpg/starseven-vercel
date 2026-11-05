// Collection declarations and corrections are accounting events. The aggregate
// on orders is the current balance; moving that balance must not move history.
export const MAX_COLLECTION=1000000;
const conflict=e=>['22012','23505','40001','40P01'].includes(e?.code);
const clean=v=>String(v??'').trim().slice(0,300);
function cents(value){
  const s=String(value??'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(s)||Number(s)>MAX_COLLECTION)return null;
  return Math.round(Number(s)*100);
}
export async function recordCollection(sql,input,actor){
  const id=Number(input.order_id),seq=Number(input.expect_seq),raw=String(input.amount??'').trim(),reason=clean(input.reason);
  const next=raw===''?null:cents(raw);
  if(!/^(0|[1-9]\d*)$/.test(String(input.expect_seq))||!Number.isSafeInteger(seq)||seq>2147483646||!Number.isSafeInteger(id)||id<1||id>2147483647||(raw!==''&&next===null)||!/^admin:[1-9]\d*$/.test(actor))return {ok:false,error:'input'};
  // Text preserves PostgreSQL's microseconds for the later compare-and-swap;
  // a JavaScript Date can only preserve milliseconds.
  const [before]=await sql`SELECT id,ref,status,total,collected_amount,settled_at::text AS settled_at,collection_seq FROM orders WHERE id=${id}::int`;
  if(!before)return {ok:false,error:'locked'};
  if(before.status!=='delivered')return {ok:false,error:'locked'};
  if(Number(before.collection_seq)!==seq)return {ok:false,error:'stale'};
  const prior=before.collected_amount===null?null:cents(before.collected_amount);
  if(before.collected_amount!==null&&(prior===null||!before.settled_at))return {ok:false,error:'review'};
  const oldAmount=prior===null?null:(prior/100).toFixed(2),amount=next===null?null:(next/100).toFixed(2);
  const oldDate=before.settled_at instanceof Date?before.settled_at.toISOString():before.settled_at;
  const changed=prior!==next;
  if(changed&&prior!==null&&reason.length<5)return {ok:false,error:'reason'};
  const statements=[
    // Separate commands: after waiting here, dependency checks below see a
    // fresh READ COMMITTED snapshot of committed refunds and settlements.
    sql`SELECT id FROM orders WHERE id=${id}::int FOR UPDATE`,
    sql`WITH matched AS (SELECT id FROM orders WHERE id=${id}::int AND status='delivered'
      AND collection_seq=${seq}::int AND collected_amount IS NOT DISTINCT FROM ${oldAmount}::numeric
      AND settled_at IS NOT DISTINCT FROM ${oldDate}::timestamptz)
      SELECT 1/count(*)::int AS collection_guard FROM matched`,
  ];
  if(!changed){
    try{await sql.transaction(statements);return {ok:true,changed:false,amount,total:Number(before.total)};}
    catch(e){if(conflict(e))return {ok:false,error:'stale'};throw e;}
  }
  const delta=(((next??0)-(prior??0))/100).toFixed(2);
  const kind=next===null?'cleared':prior===null?'recorded':'corrected';
  const explanation=reason||(kind==='recorded'?'Initial collection declaration':'Collection cleared');
  statements.push(
    sql`SELECT 1/(NOT EXISTS(SELECT 1 FROM order_returns WHERE order_id=${id}::int AND state='refunded')
      AND NOT EXISTS(SELECT 1 FROM settlement_orders WHERE order_id=${id}::int))::int AS collection_dependency_guard`,
    sql`INSERT INTO collection_movements(order_id,collection_seq,kind,amount_delta,occurred_at,actor,reason)
      SELECT ${id}::int,${seq}::int,'opening',${oldAmount}::numeric,${oldDate}::timestamptz,${actor},'Legacy opening balance'
      WHERE ${oldAmount}::numeric IS NOT NULL AND NOT EXISTS(SELECT 1 FROM collection_movements WHERE order_id=${id}::int)`,
    sql`SELECT 1/(coalesce(sum(amount_delta),0)=${oldAmount??'0'}::numeric)::int AS collection_balance_guard
      FROM collection_movements WHERE order_id=${id}::int`,
    sql`UPDATE orders SET collected_amount=${amount}::numeric,
      settled_at=CASE WHEN ${amount}::numeric IS NULL THEN NULL ELSE coalesce(settled_at,now()) END,
      collection_seq=collection_seq+1 WHERE id=${id}::int`,
    sql`INSERT INTO collection_movements(order_id,collection_seq,kind,amount_delta,occurred_at,actor,reason)
      VALUES(${id}::int,${seq+1}::int,${kind},${delta}::numeric,now(),${actor},${explanation})`,
    sql`INSERT INTO admin_audit(area,record_id,actor,action,detail) VALUES('collections',${String(id)},${actor},${kind},
      jsonb_build_object('before',jsonb_build_object('collected_amount',${oldAmount}::numeric),
        'after',jsonb_build_object('collected_amount',${amount}::numeric)))`,
    sql`INSERT INTO order_events(order_id,kind,actor,note) VALUES(${id}::int,'note',${actor},
      ${'Collection '+kind+': '+(oldAmount??'not recorded')+' -> '+(amount??'not recorded')+'. '+explanation})`,
  );
  try{await sql.transaction(statements);return {ok:true,changed:true,amount,total:Number(before.total)};}
  catch(e){if(conflict(e))return {ok:false,error:'stale'};throw e;}
}
