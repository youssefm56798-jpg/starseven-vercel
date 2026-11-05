'use client';
import { AdminText } from '../../_lib/locale.js';

import {useState} from 'react';
import {parseStockCsv} from '../../../../lib/stock-csv.mjs';
export default function StockImport({action,csrf}){
  const [raw,setRaw]=useState(''),[rows,setRows]=useState(null),[error,setError]=useState('');
  const preview=()=>{try{setRows(parseStockCsv(raw));setError('');}catch(e){setRows(null);setError(e.message);}};
  return <div className="panel"><h2><AdminText text="Import stock adjustments" /></h2><div className="pad"><p><AdminText text="Use columns SKU,Expected,Delta,Reason. Preview before submitting. All rows commit together; a stale balance rejects the entire import." /></p>
    <label><AdminText text="CSV file" /><input type="file" accept=".csv,text/csv" onChange={async e=>{const f=e.target.files?.[0];setRows(null);if(!f)return;if(f.size>65536){setError('CSV is too large. Maximum 64 KB.');return;}setRaw(await f.text());setError('');}}/></label>
    <label><AdminText text="CSV content" /><textarea rows={6} value={raw} onChange={e=>{setRaw(e.target.value);setRows(null);}} maxLength={65536}/></label>
    <button type="button" className="btn ghost" onClick={preview}><AdminText text="Preview import" /></button>
    {error&&<p className="flash err" role="alert">{<AdminText text={error} />}</p>}
    {rows&&<><div className="table-scroll"><table><thead><tr><th><AdminText text="SKU" /></th><th><AdminText text="Expected stock" /></th><th><AdminText text="Change" /></th><th><AdminText text="Resulting stock" /></th><th><AdminText text="Reason" /></th></tr></thead><tbody>{rows.map(r=><tr key={r.sku}><td>{r.sku}</td><td>{r.expected}</td><td>{r.delta}</td><td>{r.expected+r.delta}</td><td>{r.reason}</td></tr>)}</tbody></table></div><form action={action}><input type="hidden" name="_csrf" value={csrf}/><input type="hidden" name="csv" value={raw}/><button className="btn red" type="submit"><AdminText text="Apply previewed stock changes" /></button></form></>}
  </div></div>;
}
