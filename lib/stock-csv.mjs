export function parseStockCsv(raw) {
  const value=String(raw??'');
  if(new TextEncoder().encode(value).length>65536)throw new Error('CSV is too large. Maximum 64 KB.');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<=value.length;i++){
    const c=i===value.length?'\n':value[i];
    if(quoted){if(c==='"'&&value[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else if(i===value.length)throw new Error('Unclosed quoted field.');else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw new Error('Invalid CSV quotation.');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false;
      if(c!==','){if(c==='\r'&&value[i+1]==='\n')i++;if(row.some(v=>v.trim()!==''))rows.push(row);row=[];}
    }else{if(closed&&c!==' '&&c!=='\t')throw new Error('Invalid CSV quotation.');cell+=c;}
  }
  const header=rows.shift()?.map(v=>v.trim().toLowerCase().replace(/^\uFEFF/,''));
  if(header?.join(',')!=='sku,expected,delta,reason')throw new Error('Use columns: SKU,Expected,Delta,Reason.');
  if(!rows.length||rows.length>100)throw new Error('Include 1 to 100 stock rows.');
  const seen=new Set();
  return rows.map((r,index)=>{
    if(r.length!==4)throw new Error(`Row ${index+2}: use four columns.`);
    const [sku,expectedRaw,deltaRaw,reason]=r.map(v=>v.trim());
    const expected=Number(expectedRaw),delta=Number(deltaRaw);
    if(!/^[A-Za-z0-9-]{2,64}$/.test(sku)||seen.has(sku.toUpperCase())||
      !/^\d+$/.test(expectedRaw)||!Number.isSafeInteger(expected)||expected>2147483647||
      !/^-?\d+$/.test(deltaRaw)||!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1000000||
      reason.length<5||reason.length>300)throw new Error(`Row ${index+2}: invalid or duplicate stock data.`);
    seen.add(sku.toUpperCase());return {sku,expected,delta,reason};
  });
}
