import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText, AdminFormat } from '../../_lib/locale.js';
import Link from 'next/link';
import { sql } from '../../../../lib/db.js';
import { customerHistory } from '../../../../lib/admin-operations.mjs';
import { requirePermission } from '../../_lib/guard.js';
import { money, dt } from '../../_lib/ui.js';
import { readOperation, ReadFailure } from '../../_lib/operations.js';
export const dynamic='force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({title:'Customers — Star Seven admin'});}
export default async function Customers({searchParams}) {
  await requirePermission('orders:read');const sp=await searchParams,q=String(sp?.q??'').slice(0,100);
  const result=await readOperation(()=>customerHistory(sql,q));
  return <><h1><AdminText text="Customers" /></h1><p className="sub"><AdminText text="Contact history grouped by normalized phone. Guest contact details do not prove a unique person. Marketing consent is separate from ordering." /></p>
    <form method="get" className="bar-row"><label htmlFor="customer-search"><AdminText text="Name, phone or email" /></label><input id="customer-search" name="q" defaultValue={q} maxLength={100}/><button className="btn" type="submit"><AdminText text="Search" /></button></form>
    {!result.data?<ReadFailure result={result}/>:<div className="panel"><h2><AdminText text="Most recent contacts" /></h2><div className="table-scroll"><table><thead><tr><th><AdminText text="Customer" /></th><th><AdminText text="Orders" /></th><th><AdminText text="Collected less refunds" /></th><th><AdminText text="Last order" /></th><th><AdminText text="Marketing consent" /></th></tr></thead><tbody>{result.data.map(c=><tr key={c.customer_id}><td><Link href={`/admin/customers/${c.customer_id}`}>{c.name}</Link><div dir="ltr">{c.phone}</div></td><td>{Number(c.orders)}</td><td>{<AdminFormat kind="money" value={Number(c.collected)-Number(c.refunded)} />}</td><td>{<AdminFormat kind="dt" value={c.last_order} />}</td><td>{c.marketing_consent?<AdminText text="Opted in" />:<AdminText text="No active opt-in" />}</td></tr>)}</tbody></table>{result.data.length===0&&<div className="empty"><AdminText text="No matching customers." /></div>}</div></div>}
    <p className="muted"><AdminText text="Up to 100 contacts. Search to narrow the list." /></p>
  </>;
}
