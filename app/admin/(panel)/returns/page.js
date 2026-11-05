import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText, AdminFormat } from '../../_lib/locale.js';
import Link from 'next/link';
import {sql} from '../../../../lib/db.js';
import {requireOwner} from '../../_lib/guard.js';
import {readOperation,ReadFailure} from '../../_lib/operations.js';
import {money,dt,Flash} from '../../_lib/ui.js';
export const dynamic='force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({title:'Returns and refunds — Star Seven admin'});}
export default async function Returns({searchParams}){
  await requireOwner();const sp=await searchParams;const result=await readOperation(async()=>({cases:await sql`SELECT r.id,r.state,r.reason,r.refund_amount,r.created_at,o.ref FROM order_returns r JOIN orders o ON o.id=r.order_id ORDER BY r.id DESC LIMIT 100`,delivered:await sql`SELECT id,ref FROM orders WHERE status='delivered' ORDER BY id DESC LIMIT 50`}));
  return <><h1><AdminText text="Returns and refunds" /></h1><p className="sub"><AdminText text="A delivered return is separate from cancellation. Stock is returned only after received goods are explicitly marked resellable." /></p><Flash code={sp?.m}/>
    {!result.data?<ReadFailure result={result}/>:<>
      <div className="panel"><h2><AdminText text="Open a return case" /></h2><form method="get" action="/admin/returns/new" className="pad bar-row"><label htmlFor="return-order"><AdminText text="Delivered order" /></label><select id="return-order" name="order" required><option value=""><AdminText text="Choose an order" /></option>{result.data.delivered.map(o=><option value={o.id} key={o.id}>#{o.ref}</option>)}</select><button className="btn" type="submit"><AdminText text="Choose returned items" /></button></form></div>
      <div className="panel"><h2><AdminText text="Return cases" /></h2><div className="table-scroll"><table><thead><tr><th><AdminText text="Case" /></th><th><AdminText text="Order" /></th><th><AdminText text="Status" /></th><th><AdminText text="Reason" /></th><th><AdminText text="Refund recorded" /></th><th><AdminText text="Opened" /></th></tr></thead><tbody>{result.data.cases.map(r=><tr key={r.id}><td><Link href={`/admin/returns/${r.id}`}>#{r.id}</Link></td><td>#{r.ref}</td><td>{<AdminText text={r.state} />}</td><td>{r.reason}</td><td>{<AdminFormat kind="money" value={r.refund_amount} />}</td><td>{<AdminFormat kind="dt" value={r.created_at} />}</td></tr>)}</tbody></table>{result.data.cases.length===0&&<div className="empty"><AdminText text="No return cases." /></div>}</div></div>
    </>}
  </>;
}
