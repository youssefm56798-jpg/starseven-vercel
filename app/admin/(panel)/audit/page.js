import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText, AdminFormat, AdminActor } from '../../_lib/locale.js';
import {sql} from '../../../../lib/db.js';
import {requireOwner} from '../../_lib/guard.js';
import {readOperation,ReadFailure} from '../../_lib/operations.js';
import {dt} from '../../_lib/ui.js';
import {auditChanges} from '../../../../lib/admin-audit.mjs';
export const dynamic='force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({title:'Admin audit history — Star Seven admin'});}
export default async function Audit(){
  await requireOwner();const result=await readOperation(()=>sql`SELECT id,area,record_id,actor,action,detail,created_at FROM admin_audit ORDER BY id DESC LIMIT 200`);
  return <><h1><AdminText text="Admin audit history" /></h1><p className="sub"><AdminText text="Latest 200 recorded changes. Passwords, authentication tokens and customer contact details are excluded from this view." /></p>
    {!result.data?<ReadFailure result={result}/>:<div className="panel"><h2><AdminText text="Changes" /></h2><div className="table-scroll"><table><thead><tr><th><AdminText text="Date" /></th><th><AdminText text="Area" /></th><th><AdminText text="Record" /></th><th><AdminText text="Actor" /></th><th><AdminText text="Action" /></th><th><AdminText text="Changes" /></th></tr></thead><tbody>{result.data.map(e=><tr key={e.id}><td>{<AdminFormat kind="dt" value={e.created_at} />}</td><td><AdminText text={e.area}/></td><td>{e.record_id}</td><td><AdminActor value={e.actor}/></td><td><AdminText text={e.action}/></td><td><AuditDetail detail={e.detail}/></td></tr>)}</tbody></table>{!result.data.length&&<div className="empty"><AdminText text="No recorded changes yet." /></div>}</div></div>}
  </>;
}

function AuditValue({value,kind}){
  if(value===null)return <>-</>;
  if(kind==='boolean')return <AdminText text={value?'Yes':'No'}/>;
  if(kind==='money'||kind==='dt')return <AdminFormat kind={kind} value={value}/>;
  return <AdminText text={String(value)}/>;
}
function AuditDetail({detail}){
  return <dl>{auditChanges(detail).map(c=><div key={c.key}><dt><AdminText text={c.label}/></dt><dd><span><AdminText text="Before"/>: <AuditValue value={c.before} kind={c.kind}/></span>{' → '}<span><AdminText text="After"/>: <AuditValue value={c.after} kind={c.kind}/></span></dd></div>)}</dl>;
}
