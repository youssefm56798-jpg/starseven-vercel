import { localizedAdminMetadata } from "../../../_lib/locale-server.js";
import { AdminText, AdminFormat, AdminActor } from '../../../_lib/locale.js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {readOperation,ReadFailure} from '../../../_lib/operations.js';
import { sql } from '../../../../../lib/db.js';
import { requirePermission } from '../../../_lib/guard.js';
import { money,dt } from '../../../_lib/ui.js';
export const dynamic='force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({title:'Customer history — Star Seven admin'});}
export default async function Customer({params}) {
  await requirePermission('orders:read');const {id}=await params;
  if(!/^[1-9]\d{0,9}$/.test(id))notFound();
  const [seed]=await sql`SELECT phone,name FROM orders WHERE id=${Number(id)}::int`;
  if(!seed?.phone)notFound();
  const orders=await sql`SELECT id,ref,status,total,collected_amount,email,created_at,notes FROM orders WHERE phone=${seed.phone} ORDER BY id DESC LIMIT 100`;
  const notes=await sql`SELECT e.note,e.actor,e.created_at FROM order_events e JOIN orders o ON o.id=e.order_id
    WHERE o.phone=${seed.phone} AND e.kind='note' AND e.actor NOT LIKE 'system:coupon-claim:%' ORDER BY e.id DESC LIMIT 50`;
  const returns=await readOperation(()=>sql`SELECT r.id,r.state,r.refund_amount,r.created_at,o.ref FROM order_returns r JOIN orders o ON o.id=r.order_id WHERE o.phone=${seed.phone} ORDER BY r.id DESC LIMIT 100`);
  return <><h1><AdminText text="Customer history" /></h1><p className="sub">{seed.name} · <span dir="ltr">{seed.phone}</span></p>
    <div className="panel"><h2><AdminText text="Orders" /></h2><div className="table-scroll"><table><thead><tr><th><AdminText text="Order" /></th><th><AdminText text="Status" /></th><th><AdminText text="Booked total" /></th><th><AdminText text="Collected" /></th><th><AdminText text="Date" /></th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><Link href={`/admin/orders/${o.id}`}>#{o.ref}</Link></td><td>{<AdminText text={o.status} />}</td><td>{<AdminFormat kind="money" value={o.total} />}</td><td>{o.collected_amount===null?<AdminText text="Not recorded" />:<AdminFormat kind="money" value={o.collected_amount} />}</td><td>{<AdminFormat kind="dt" value={o.created_at} />}</td></tr>)}</tbody></table></div></div>
    <div className="panel"><h2><AdminText text="Contact notes" /></h2><div className="pad">{notes.length===0?<p><AdminText text="No notes recorded." /></p>:notes.map((n,i)=><div key={i}><p>{n.note}</p><small>{<AdminFormat kind="dt" value={n.created_at} />} · <AdminActor value={n.actor}/></small></div>)}</div></div>
    <div className="panel"><h2><AdminText text="Returns for this customer"/></h2>{!returns.data?<ReadFailure result={returns}/>:<div className="table-scroll"><table><thead><tr><th><AdminText text="Order"/></th><th><AdminText text="Status"/></th><th><AdminText text="Refunded"/></th><th><AdminText text="Date"/></th></tr></thead><tbody>{returns.data.map(r=><tr key={r.id}><td><Link href={`/admin/returns/${r.id}`}>#{r.ref}</Link></td><td><AdminText text={r.state}/></td><td><AdminFormat kind="money" value={r.refund_amount}/></td><td><AdminFormat kind="dt" value={r.created_at}/></td></tr>)}</tbody></table>{!returns.data.length&&<p className="pad"><AdminText text="No returns recorded."/></p>}</div>}</div>
    <Link href="/admin/customers"><AdminText text="All customers" /></Link>
  </>;
}
