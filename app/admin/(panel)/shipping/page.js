import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText } from '../../_lib/locale.js';
import {sql} from '../../../../lib/db.js';
import {csrfToken,csrfOk} from '../../../../lib/auth.js';
import {redirect} from 'next/navigation';
import {saveShippingZone} from '../../../../lib/admin-operations.mjs';
import {requireOwner} from '../../_lib/guard.js';
import {finishOperation,readOperation,ReadFailure} from '../../_lib/operations.js';
import {Flash} from '../../_lib/ui.js';
export const dynamic='force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({title:'Shipping — Star Seven admin'});}
async function save(form){'use server';const admin=await requireOwner();if(!(await csrfOk(form.get('_csrf'))))redirect('/admin/shipping?m=csrf');return finishOperation('/admin/shipping',()=>saveShippingZone(sql,{...Object.fromEntries(['code','version','name_ar','name_en','fee','free_over','min_days','max_days'].map(k=>[k,form.get(k)])),active:form.get('active')==='1'},`admin:${admin.id}`));}
export default async function Shipping({searchParams}){
  await requireOwner();const sp=await searchParams,token=await csrfToken();const result=await readOperation(()=>sql`SELECT * FROM shipping_zones ORDER BY code`);
  return <><h1><AdminText text="Shipping" /></h1><p className="sub"><AdminText text="Delivery zones, fees and promised working-day ranges. Courier and tracking references remain on each order. This does not create shipments, labels or courier API connections." /></p><Flash code={sp?.m}/>
    {!result.data||result.data.length!==3?<ReadFailure result={result.data?{setup:true}:result}/>:result.data.map(z=><div className="panel" key={z.code}><h2>{z.name_ar} · {z.name_en}</h2><form className="pad" action={save}><input type="hidden" name="_csrf" value={token} /><input type="hidden" name="code" value={z.code}/><input type="hidden" name="version" value={z.version}/>
      <div className="grid2"><label><AdminText text="Arabic name" /><input name="name_ar" defaultValue={z.name_ar} dir="rtl" required maxLength={80}/></label><label><AdminText text="English name" /><input name="name_en" defaultValue={z.name_en} dir="ltr" required maxLength={80}/></label><label><AdminText text="Delivery fee (EGP)" /><input name="fee" type="number" min="0" max="99999999.99" step="0.01" defaultValue={z.fee} required/></label><label><AdminText text="Free delivery above (EGP)" /><input name="free_over" type="number" min="0" max="99999999.99" step="0.01" defaultValue={z.free_over} required/></label><label><AdminText text="Earliest working day" /><input name="min_days" type="number" min="0" max="30" defaultValue={z.min_days} required/></label><label><AdminText text="Latest working day" /><input name="max_days" type="number" min="0" max="30" defaultValue={z.max_days} required/></label></div>
      <label><input type="checkbox" name="active" value="1" defaultChecked={z.active}/><AdminText text="Accept deliveries in this zone" /></label><button className="btn red" type="submit"><AdminText text="Save delivery policy" /></button>
    </form></div>)}
    <p className="muted"><AdminText text="Existing confirmed delivery dates remain unchanged. A changed policy applies to later checkouts and confirmations." /></p>
  </>;
}
