import {sql} from '../../../../../lib/db.js';
import {csvCell} from '../../../../../lib/admin-operations.mjs';
import {requireOwner} from '../../../_lib/guard.js';
export const dynamic='force-dynamic';
export async function GET(){
  await requireOwner();
  const rows=await sql`SELECT s.reference,s.courier,s.settled_on,s.received,s.fees,coalesce(sum(o.recorded_collected),0) AS recorded
    FROM courier_settlements s LEFT JOIN settlement_orders o ON o.settlement_id=s.id GROUP BY s.id ORDER BY s.id DESC LIMIT 5000`;
  const csv='Reference,Courier,Date,Received,Fees,Recorded collected,Difference\r\n'+rows.map(r=>[r.reference,r.courier,r.settled_on,r.received,r.fees,r.recorded,Number(r.received)+Number(r.fees)-Number(r.recorded)].map(csvCell).join(',')).join('\r\n');
  return new Response('\uFEFF'+csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="starseven-settlements.csv"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
