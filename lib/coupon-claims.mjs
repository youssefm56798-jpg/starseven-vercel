// Internal claim provenance. No schema change and no personal data copied into
// the append-only audit. Ordinary application inputs cannot choose this actor.
import {normalizePhone} from './phone.js';
export const CLAIM_ACTOR_PREFIX='system:coupon-claim:';
export const CLAIM_ACTOR=CLAIM_ACTOR_PREFIX+'v1';
export const CLAIM_PROTOCOL='starseven:coupon-claim';
export const CLAIM_NOTE_PATTERN='^\\{"protocol":"starseven:coupon-claim","version":1,"state":"claimed","offerId":[1-9][0-9]{0,9},"redemptionId":[1-9][0-9]{0,9},"editSeq":(0|[1-9][0-9]{0,9})\\}$';
const int=(value,min=1)=>Number.isInteger(value)&&value>=min&&value<=2147483647;
const sameKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function parseClaimEvent(event){
 if(!event||event.kind!=='edit'||event.actor!==CLAIM_ACTOR||!int(Number(event.id))||typeof event.note!=='string'||event.note.length>512)return null;
 let state;try{state=JSON.parse(event.note);}catch{return null;}
 if(state?.protocol!==CLAIM_PROTOCOL||state.version!==1||!int(state.editSeq,0))return null;
 if(state.state==='claimed'){
  if(!sameKeys(state,['protocol','version','state','offerId','redemptionId','editSeq'])||!int(state.offerId)||!int(state.redemptionId))return null;
  if(event.note!==JSON.stringify({protocol:CLAIM_PROTOCOL,version:1,state:'claimed',offerId:state.offerId,redemptionId:state.redemptionId,editSeq:state.editSeq}))return null;
 }else if(state.state==='released'){
  if(!sameKeys(state,['protocol','version','state','editSeq']))return null;
  if(event.note!==JSON.stringify({protocol:CLAIM_PROTOCOL,version:1,state:'released',editSeq:state.editSeq}))return null;
 }else return null;
 return {...state,eventId:Number(event.id)};
}
export function claimStateFor(order,event,redemptions){
 const state=event?parseClaimEvent(event):null,seq=Number(order.edit_seq)||0;
 const review={kind:'review',eventId:event?Number(event.id):null};
 if((event&&!state)||(state&&state.editSeq>seq))return review;
 if(state?.state==='released'&&order.status==='cancelled'&&!redemptions.length)return {kind:'none',eventId:state.eventId};
 if(order.status==='cancelled')return review;
 if(!order.coupon){
  if(redemptions.length||state?.state==='claimed')return review;
  return {kind:'none',eventId:state?.eventId??null};
 }
 if(state?.state!=='claimed'||redemptions.length!==1)return review;
 const row=redemptions[0],phone=normalizePhone(order.phone);
 if(!phone||Number(row.id)!==state.redemptionId||Number(row.order_id)!==Number(order.id)||row.code!==order.coupon||row.phone!==phone||row.email!==order.email)return review;
 return {kind:'claimed',...state};
}
export async function readClaimState(sql,order){
 // Always select the latest reserved event, including malformed/wrong-kind
 // entries; never search backwards until an older valid marker is found.
 const [event]=await sql`SELECT id,kind,actor,note FROM order_events
   WHERE order_id=${order.id} AND actor LIKE ${CLAIM_ACTOR_PREFIX+'%'} ORDER BY id DESC LIMIT 1`;
 const redemptions=await sql`SELECT id,order_id,code,phone,email FROM offer_redemptions
   WHERE order_id=${order.id} ORDER BY id`;
 return claimStateFor(order,event,redemptions);
}

export function lockClaimGenerations(sql,ids){
 return [...new Set(ids.filter(id=>id!=null))].sort((a,b)=>a-b).map(id=>sql`
   SELECT id FROM offers WHERE id=${id}::int ORDER BY id FOR UPDATE`);
}
export function guardLatestClaim(sql,orderId,eventId){
 return sql`SELECT 1 / (CASE WHEN (SELECT id FROM order_events
   WHERE order_id=${orderId} AND actor LIKE ${CLAIM_ACTOR_PREFIX+'%'} ORDER BY id DESC LIMIT 1)
   IS NOT DISTINCT FROM ${eventId}::int THEN 1 ELSE 0 END)::int AS guard`;
}
export function guardClaimState(sql,order,state){
 return sql`
   SELECT 1 / (CASE WHEN
     (SELECT id FROM order_events WHERE order_id=${order.id} AND actor LIKE ${CLAIM_ACTOR_PREFIX+'%'} ORDER BY id DESC LIMIT 1)
       IS NOT DISTINCT FROM ${state.eventId??null}::int
     AND (SELECT count(*) FROM offer_redemptions WHERE order_id=${order.id})=${state.kind==='claimed'?1:0}::int
     AND (${state.kind!=='claimed'}::boolean OR EXISTS(
       SELECT 1 FROM offer_redemptions WHERE id=${state.redemptionId??null}::int AND order_id=${order.id}
         AND code=${order.coupon} AND phone=${normalizePhone(order.phone)} AND email=${order.email}
     )) THEN 1 ELSE 0 END)::int AS guard`;
}
export function returnClaimCounter(sql,offerId){
 // The durable ID, never a current code lookup. A deleted original generation
 // has no counter to return; an existing zero counter is inconsistent.
 return sql`
   WITH returned AS (
     UPDATE offers SET used_count=used_count-1 WHERE id=${offerId}::int AND used_count>0 RETURNING id
   )
   SELECT 1 / (CASE WHEN EXISTS(SELECT 1 FROM returned)
     OR NOT EXISTS(SELECT 1 FROM offers WHERE id=${offerId}::int) THEN 1 ELSE 0 END)::int AS guard`;
}
export function removeClaimRecord(sql,orderId,redemptionId){
 return sql`WITH removed AS (
   DELETE FROM offer_redemptions WHERE id=${redemptionId}::int AND order_id=${orderId} RETURNING id
 ) SELECT 1 / count(*)::int AS guard FROM removed`;
}
export function returnCancelledClaimCounter(sql,orderId,offerId){
 // Cancellation preserves availability without inventing a missing use. The
 // preceding original-generation lock makes this decision transaction-bound.
 return sql`
   WITH returned AS (
     UPDATE offers SET used_count=used_count-1 WHERE id=${offerId}::int AND used_count>0 RETURNING id
   ), reviewed AS (
     INSERT INTO order_events(order_id,kind,actor,note)
     SELECT ${orderId}::int,'note','system',
       'Coupon history needs owner review; the original offer counter was nonpositive and was left unchanged.'
     WHERE NOT EXISTS(SELECT 1 FROM returned)
       AND EXISTS(SELECT 1 FROM offers WHERE id=${offerId}::int AND used_count<=0)
     RETURNING id
   ) SELECT 1 / (CASE WHEN EXISTS(SELECT 1 FROM returned) OR EXISTS(SELECT 1 FROM reviewed)
       OR NOT EXISTS(SELECT 1 FROM offers WHERE id=${offerId}::int) THEN 1 ELSE 0 END)::int AS guard,
     EXISTS(SELECT 1 FROM reviewed) AS coupon_review_needed`;
}
export function releaseClaimState(sql,orderId){
 return sql`INSERT INTO order_events(order_id,kind,actor,note)
   SELECT id,'edit',${CLAIM_ACTOR}::text,
     format('{"protocol":"starseven:coupon-claim","version":1,"state":"released","editSeq":%s}',edit_seq)
   FROM orders WHERE id=${orderId}`;
}

// Enforcement also counts a canonical immutable origin pointing to this exact
// surviving record/order, even after contact redaction or an untrusted latest
// marker. This is conservative counting ONLY: mutation proof stays latest-only.
// No contact value is copied or restored from audit metadata.
export function claimUsage(sql,{offerId,code,phone}){
 return sql`
   SELECT count(*)::int AS n FROM offer_redemptions r JOIN orders o ON o.id=r.order_id
   LEFT JOIN LATERAL (SELECT kind,actor,note FROM order_events WHERE order_id=r.order_id AND actor LIKE ${CLAIM_ACTOR_PREFIX+'%'}
     ORDER BY id DESC LIMIT 1) e ON true
   WHERE r.phone=${phone} AND (EXISTS(
     SELECT 1 FROM order_events origin WHERE origin.order_id=r.order_id AND origin.kind='edit'
       AND origin.actor=${CLAIM_ACTOR} AND origin.note~${CLAIM_NOTE_PATTERN} AND right(origin.note,1)='}'
       AND substring(origin.note FROM '"redemptionId":([0-9]+)')=r.id::text
       AND substring(origin.note FROM '"offerId":([0-9]+)')=${offerId}::text
       AND lpad(substring(origin.note FROM '"editSeq":([0-9]+)'),10,'0')<='2147483647'
   ) OR CASE WHEN e.kind='edit' AND e.actor=${CLAIM_ACTOR} AND e.note~${CLAIM_NOTE_PATTERN}
     AND right(e.note,1)='}' AND o.status<>'cancelled'
     AND (SELECT count(*) FROM offer_redemptions owned WHERE owned.order_id=r.order_id)=1
     AND substring(e.note FROM '"redemptionId":([0-9]+)')=r.id::text
     AND lpad(substring(e.note FROM '"offerId":([0-9]+)'),10,'0')<='2147483647'
     AND lpad(substring(e.note FROM '"editSeq":([0-9]+)'),10,'0')<=lpad(o.edit_seq::text,10,'0')
     AND r.code=o.coupon AND r.phone=o.phone AND r.email=o.email
   THEN substring(e.note FROM '"offerId":([0-9]+)')=${offerId}::text
   ELSE r.code=${code} END)`;
}

export function writeClaimRecord(sql,{orderId=null,ref=null,offerId,code,phone,email,perCustomer}){
 return sql`
   WITH usage AS (
     SELECT count(*)::int AS n FROM offer_redemptions r JOIN orders o ON o.id=r.order_id
     LEFT JOIN LATERAL (SELECT kind,actor,note FROM order_events WHERE order_id=r.order_id AND actor LIKE ${CLAIM_ACTOR_PREFIX+'%'}
       ORDER BY id DESC LIMIT 1) e ON true
     WHERE r.phone=${phone} AND (EXISTS(
       SELECT 1 FROM order_events origin WHERE origin.order_id=r.order_id AND origin.kind='edit'
         AND origin.actor=${CLAIM_ACTOR} AND origin.note~${CLAIM_NOTE_PATTERN} AND right(origin.note,1)='}'
         AND substring(origin.note FROM '"redemptionId":([0-9]+)')=r.id::text
         AND substring(origin.note FROM '"offerId":([0-9]+)')=${offerId}::text
         AND lpad(substring(origin.note FROM '"editSeq":([0-9]+)'),10,'0')<='2147483647'
     ) OR CASE WHEN e.kind='edit' AND e.actor=${CLAIM_ACTOR} AND e.note~${CLAIM_NOTE_PATTERN}
       AND right(e.note,1)='}' AND o.status<>'cancelled'
       AND (SELECT count(*) FROM offer_redemptions owned WHERE owned.order_id=r.order_id)=1
       AND substring(e.note FROM '"redemptionId":([0-9]+)')=r.id::text
       AND lpad(substring(e.note FROM '"offerId":([0-9]+)'),10,'0')<='2147483647'
       AND lpad(substring(e.note FROM '"editSeq":([0-9]+)'),10,'0')<=lpad(o.edit_seq::text,10,'0')
       AND r.code=o.coupon AND r.phone=o.phone AND r.email=o.email
     THEN substring(e.note FROM '"offerId":([0-9]+)')=${offerId}::text ELSE r.code=${code} END)
   ), slots AS (
     SELECT coalesce(max(slot),-1)::bigint+1 AS slot FROM offer_redemptions WHERE code=${code} AND phone=${phone}
   ), claimed AS (
     INSERT INTO offer_redemptions(code,order_id,phone,email,slot)
     SELECT ${code}::text,o.id,${phone}::text,${email}::text,
       CASE WHEN ${perCustomer}::int IS NULL THEN NULL ELSE slots.slot::int END
     FROM orders o CROSS JOIN usage CROSS JOIN slots
     WHERE (o.id=${orderId}::int OR (${orderId}::int IS NULL AND o.ref=${ref}::text))
       AND (${perCustomer}::int IS NULL OR (usage.n<${perCustomer}::int AND slots.slot<=2147483647))
       AND NOT EXISTS(SELECT 1 FROM offer_redemptions WHERE order_id=o.id)
     RETURNING id,order_id
   ), logged AS (
     INSERT INTO order_events(order_id,kind,actor,note)
     SELECT o.id,'edit',${CLAIM_ACTOR}::text,
       format('{"protocol":"starseven:coupon-claim","version":1,"state":"claimed","offerId":%s,"redemptionId":%s,"editSeq":%s}',
         ${offerId}::int,c.id,o.edit_seq)
     FROM claimed c JOIN orders o ON o.id=c.order_id RETURNING id
   ) SELECT 1 / count(*)::int AS guard FROM logged`;
}
