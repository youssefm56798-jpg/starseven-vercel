import {sql} from '../../../../../lib/db.js';
import {csvCell} from '../../../../../lib/admin-operations.mjs';
import {requireOwner} from '../../../_lib/guard.js';
export const dynamic='force-dynamic';
export async function GET(){
  await requireOwner();
  const rows=await sql`SELECT sku,stock FROM products WHERE archived_at IS NULL ORDER BY sku`;
  const csv='SKU,Expected,Delta,Reason\r\n'+rows.map(r=>[r.sku,r.stock,'',''].map(csvCell).join(',')).join('\r\n');
  return new Response('\uFEFF'+csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="starseven-stock.csv"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
