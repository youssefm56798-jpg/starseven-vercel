import {governorateFor,todayInCairo,addWorkingDays} from './delivery-eta.js';
export async function shippingQuote(sql,city,{requireActive=true}={}){
  const code=governorateFor(city);if(!code)return null;
  const [row]=await sql`SELECT code,fee,free_over,min_days,max_days,active,version FROM shipping_zones WHERE code=${code} LIMIT 1`;
  if(!row||(requireActive&&!row.active))return null;
  return {...row,fee:Number(row.fee),free_over:Number(row.free_over),min_days:Number(row.min_days),max_days:Number(row.max_days),version:Number(row.version)};
}
export function shippingGuard(sql,quote,{requireActive=true}={}){
  return sql`WITH locked AS (SELECT code FROM shipping_zones WHERE code=${quote.code} AND version=${quote.version}::int
    AND fee=${quote.fee}::numeric AND free_over=${quote.free_over}::numeric
    AND min_days=${quote.min_days}::int AND max_days=${quote.max_days}::int
    AND (NOT ${requireActive}::boolean OR active=true) FOR SHARE)
    SELECT 1/count(*)::int AS shipping_guard FROM locked`;
}
export function policyDeliveryWindow(quote,now=new Date()){
  const day=todayInCairo(now);
  return {from:addWorkingDays(day,quote.min_days),to:addWorkingDays(day,quote.max_days)};
}
