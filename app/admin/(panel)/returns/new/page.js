import { localizedAdminMetadata } from "../../../_lib/locale-server.js";
import { AdminText, AdminElement, AdminFormat } from '../../../_lib/locale.js';
import {randomUUID} from 'node:crypto';
import {notFound,redirect} from 'next/navigation';
import {sql} from '../../../../../lib/db.js';
import {csrfToken,csrfOk} from '../../../../../lib/auth.js';
import {createReturn} from '../../../../../lib/admin-operations.mjs';
import {requireOwner} from '../../../_lib/guard.js';
import {money,Flash} from '../../../_lib/ui.js';
export const dynamic='force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({title:'New return — Star Seven admin'});}
async function open(form){
  'use server';const admin=await requireOwner();if(!(await csrfOk(form.get('_csrf'))))redirect('/admin/returns?m=csrf');
  const items=Array.from(form.entries()).filter(([k,v])=>/^qty_[1-9]\d*$/.test(k)&&Number(v)>0).map(([k,v])=>({id:k.slice(4),qty:v}));
  let result;try{result=await createReturn(sql,{order_id:form.get('order_id'),reason:form.get('reason'),request_key:form.get('request_key'),items},`admin:${admin.id}`);}catch(e){console.error('[s7] Return creation failed:',/^[A-Z0-9]{5}$/.test(e?.code??'')?e.code:'OPS_ERROR');result={ok:false,error:'unavailable'};}
  if(result.ok)redirect(`/admin/returns/${result.id}?m=ops_saved`);
  redirect('/admin/returns?m='+(result.error==='input'?'bad_input':result.error==='unavailable'?'ops_unavailable':'ops_stale'));
}
export default async function NewReturn({searchParams}){
  await requireOwner();const sp=await searchParams,id=String(sp?.order??'');if(!/^[1-9]\d{0,9}$/.test(id))notFound();
  const [order]=await sql`SELECT id,ref,status FROM orders WHERE id=${Number(id)}::int`;if(order?.status!=='delivered')notFound();
  const items=await sql`SELECT i.id,i.sku,i.name,i.price,i.qty-coalesce((SELECT sum(ri.qty) FROM return_items ri JOIN order_returns r ON r.id=ri.return_id WHERE ri.order_item_id=i.id AND r.state<>'rejected'),0) AS available FROM order_items i WHERE i.order_id=${order.id}`;
  const token=await csrfToken();
  return <><h1><AdminText text="New return" /></h1><p className="sub"><AdminText text="Order #" />{order.ref}<AdminText text=". Select only the units being returned. Previously reserved return quantities cannot be claimed again." /></p><Flash code={sp?.m}/>
    <div className="panel"><h2><AdminText text="Returned items" /></h2><form className="pad" action={open}><input type="hidden" name="_csrf" value={token} /><input type="hidden" name="order_id" value={order.id}/><input type="hidden" name="request_key" value={randomUUID()}/><div className="table-scroll"><table><thead><tr><th><AdminText text="Item" /></th><th><AdminText text="Unit price before discount" /></th><th><AdminText text="Returnable quantity" /></th><th><AdminText text="Quantity to return" /></th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.name}<div><code>{i.sku}</code></div></td><td>{<AdminFormat kind="money" value={i.price} />}</td><td>{Number(i.available)}</td><td><AdminElement as="input" aria-label={`Return quantity for ${i.sku}`} name={`qty_${i.id}`} type="number" min="0" max={Number(i.available)} defaultValue="0" step="1"/></td></tr>)}</tbody></table></div><label><AdminText text="Reason" /><textarea name="reason" minLength={5} maxLength={500} required/></label><button className="btn red" type="submit"><AdminText text="Open return case" /></button></form></div>
  </>;
}
