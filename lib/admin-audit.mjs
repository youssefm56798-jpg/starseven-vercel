// A second allowlist at the display boundary: never print arbitrary row JSON.
const FIELDS={
  collected_amount:['Collected','money'],
  code:['Code'],active:['Active','boolean'],discount_type:['Discount type'],discount_value:['Discount value'],
  min_total:['Minimum total','money'],max_uses:['Maximum uses'],per_customer:['Per-phone limit'],first_order_only:['First order only','boolean'],
  starts_at:['Start time','dt'],ends_at:['End time','dt'],role:['Role'],suspended_at:['Suspended at','dt'],
  price:['Price','money'],compare_at:['Compare-at price','money'],stock:['Stock'],featured:['Featured','boolean'],archived_at:['Archived at','dt'],
};
export function auditChanges(detail){
  const before=detail?.before??{},after=detail?.after??{};
  return Object.entries(FIELDS).flatMap(([key,[label,kind]])=>{
    if(JSON.stringify(before[key]??null)===JSON.stringify(after[key]??null))return [];
    return [{key,label,kind,before:before[key]??null,after:after[key]??null}];
  });
}
