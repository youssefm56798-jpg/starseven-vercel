import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText, AdminFormat, AdminActor, StockReason } from '../../_lib/locale.js';
import { sql } from '../../../../lib/db.js';
import { csrfToken,csrfOk } from '../../../../lib/auth.js';
import {redirect} from 'next/navigation';
import { adjustStock,importStock } from '../../../../lib/admin-operations.mjs';
import StockImport from './StockImport.js';
import { requireOwner } from '../../_lib/guard.js';
import { finishOperation,readOperation,ReadFailure } from '../../_lib/operations.js';
import { Flash,dt } from '../../_lib/ui.js';
export const dynamic='force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({title:'Stock — Star Seven admin'});}
async function adjust(formData){'use server';const admin=await requireOwner();if(!(await csrfOk(formData.get('_csrf'))))redirect('/admin/stock?m=csrf');return finishOperation('/admin/stock',()=>adjustStock(sql,Object.fromEntries(['id','expected','delta','reason'].map(k=>[k,formData.get(k)])),`admin:${admin.id}`));}
async function importChanges(formData){'use server';const admin=await requireOwner();if(!(await csrfOk(formData.get('_csrf'))))redirect('/admin/stock?m=csrf');return finishOperation('/admin/stock',()=>importStock(sql,formData.get('csv'),`admin:${admin.id}`));}
export default async function Stock({searchParams}){
  await requireOwner();const sp=await searchParams,token=await csrfToken();
  const result=await readOperation(async()=>({products:await sql`SELECT id,sku,name_ar,name_en,stock FROM products WHERE archived_at IS NULL ORDER BY sku`,moves:await sql`SELECT id,sku,delta,balance,actor,reason,created_at FROM stock_movements ORDER BY id DESC LIMIT 100`}));
  return <><h1><AdminText text="Stock" /></h1><p className="sub"><AdminText text="Every stock change is recorded. A stale balance is rejected so another order cannot be overwritten." /></p><Flash code={sp?.m}/>
    {!result.data?<ReadFailure result={result}/>:<>
      <p><a href="/admin/stock/export"><AdminText text="Export current stock CSV" /></a></p>
      <StockImport action={importChanges} csrf={token}/>
      <div className="panel"><h2><AdminText text="Stock adjustments" /></h2><div className="table-scroll"><table><thead><tr><th><AdminText text="Product" /></th><th><AdminText text="Current stock" /></th><th><AdminText text="Adjustment and reason" /></th></tr></thead><tbody>{result.data.products.map(p=><tr key={p.id}><td>{p.name_ar}<div>{p.name_en}</div><code>{p.sku}</code></td><td>{Number(p.stock)}</td><td><form action={adjust} className="stock-adjust"><input type="hidden" name="_csrf" value={token} /><input type="hidden" name="id" value={p.id}/><input type="hidden" name="expected" value={p.stock}/><label><AdminText text="Quantity change" /><input name="delta" type="number" step="1" min="-1000000" max="1000000" required/></label><label><AdminText text="Reason" /><input name="reason" minLength={5} maxLength={300} required/></label><button className="btn sm" type="submit"><AdminText text="Record adjustment" /></button></form></td></tr>)}</tbody></table></div></div>
      <div className="panel"><h2><AdminText text="Latest stock movements" /></h2><div className="table-scroll"><table><thead><tr><th><AdminText text="Date" /></th><th><AdminText text="SKU" /></th><th><AdminText text="Change" /></th><th><AdminText text="Balance after change" /></th><th><AdminText text="Actor" /></th><th><AdminText text="Reason" /></th></tr></thead><tbody>{result.data.moves.map(m=><tr key={m.id}><td>{<AdminFormat kind="dt" value={m.created_at} />}</td><td><code>{m.sku}</code></td><td>{Number(m.delta)}</td><td>{Number(m.balance)}</td><td><AdminActor value={m.actor}/></td><td><StockReason value={m.reason}/></td></tr>)}</tbody></table></div></div>
    </>}
  </>;
}
