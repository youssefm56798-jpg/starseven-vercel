import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText, AdminFormat } from '../../_lib/locale.js';
import Link from 'next/link';
import { sql } from '../../../../lib/db.js';
import { financialReport, operationalSummary, percentageChange, reportDays } from '../../../../lib/admin-operations.mjs';
import { requireOwner } from '../../_lib/guard.js';
import { money, num } from '../../_lib/ui.js';
import { readOperation, ReadFailure } from '../../_lib/operations.js';
export const dynamic = 'force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({ title: 'Reports — Star Seven admin' });}
export default async function Reports({ searchParams }) {
  await requireOwner();
  const sp=await searchParams,days=reportDays(sp?.days);
  const result=await readOperation(async()=>({periods:await financialReport(sql,days),ops:await operationalSummary(sql)}));
  if(!result.data)return <><h1><AdminText text="Reports" /></h1><ReadFailure result={result}/></>;
  const current=result.data.periods.find(v=>v.period==='current'),previous=result.data.periods.find(v=>v.period==='previous'),ops=result.data.ops;
  const metrics=[['Orders','orders',false],['Booked order value','booked',true],['Collection records and corrections','collected',true],['Refunds recorded','refunded',true],['Discount spend','discount_spend',true],['Return cases','return_cases',false]];
  return <>
    <h1><AdminText text="Reports" /></h1><p className="sub"><AdminText text="Cairo calendar days. Booked value is not cash received. Profit is unavailable until product and operating costs are recorded." /></p>
    <form className="bar-row" method="get"><label htmlFor="report-days"><AdminText text="Period" /></label><select id="report-days" name="days" defaultValue={days}><option value="7"><AdminText text="7 days" /></option><option value="30"><AdminText text="30 days" /></option><option value="90"><AdminText text="90 days" /></option><option value="365"><AdminText text="365 days" /></option></select><button className="btn" type="submit"><AdminText text="Apply" /></button></form>
    <div className="panel"><h2><AdminText text="Period comparison" /></h2><div className="table-scroll"><table><thead><tr><th><AdminText text="Metric" /></th><th><AdminText text="Selected period" /></th><th><AdminText text="Previous equal period" /></th><th><AdminText text="Change" /></th></tr></thead><tbody>{metrics.map(([label,key,isMoney])=>{const change=percentageChange(current[key],previous[key]);return <tr key={key}><th>{<AdminText text={label} />}</th><td>{isMoney?<AdminFormat kind="money" value={current[key]} />:<AdminFormat kind="number" value={current[key]} />}</td><td>{isMoney?<AdminFormat kind="money" value={previous[key]} />:<AdminFormat kind="number" value={previous[key]} />}</td><td>{change===null?<AdminText text="No comparison base" />:`${change>0?'+':''}${change}%`}</td></tr>;})}</tbody></table></div></div>
    <div className="cards"><div className="kpi"><b>{<AdminFormat kind="money" value={Number(current.collected)-Number(current.refunded)} />}</b><span><AdminText text="Collections and corrections less refunds" /></span></div><div className="kpi"><b>{Number(current.orders)?`${(Number(current.cancelled)/Number(current.orders)*100).toFixed(1)}%`:'—'}</b><span><AdminText text="Cancellation rate" /></span></div><div className="kpi"><b>{<AdminFormat kind="money" value={ops.cash_outstanding} />}</b><span><AdminText text="Delivered cash outstanding" /></span></div></div>
    <p className="sub"><AdminText text="Collection entries and corrections use their own recording dates; refunds use their refund date. Other period figures use order creation date. Returns and cancellation counts can therefore describe different cohorts." /></p>
    <p className="sub"><AdminText text="Corrections appear in the period they are recorded. Earlier collection periods stay unchanged. Untouched older records use their original collection date."/></p>
    <div className="panel"><h2><AdminText text="Needs attention now" /></h2><div className="ops-grid pad">
      <Link href="/admin/orders?status=new"><AdminText text="New orders older than 24 hours:" />{' '}{<AdminFormat kind="number" value={ops.aging_new} />}</Link>
      <Link href="/admin/orders?status=confirmed"><AdminText text="Confirmed older than 48 hours:" />{' '}{<AdminFormat kind="number" value={ops.aging_confirmed} />}</Link>
      <Link href="/admin/orders?status=shipped"><AdminText text="Past promised delivery date:" />{' '}{<AdminFormat kind="number" value={ops.overdue_delivery} />}</Link>
      <Link href="/admin/orders"><AdminText text="Unresolved cancellation requests:" />{' '}{<AdminFormat kind="number" value={ops.cancellation_requests} />}</Link>
      <Link href="/admin/returns"><AdminText text="Open return cases:" />{' '}{<AdminFormat kind="number" value={ops.open_returns} />}</Link>
      <Link href="/admin/stock"><AdminText text="Priced products running low:" />{' '}{<AdminFormat kind="number" value={ops.low_stock} />}</Link>
    </div></div>
    <div className="panel"><h2><AdminText text="Operational and SEO checks" /></h2><div className="pad"><p><AdminText text="Checkout is currently paused. This dashboard does not reopen it or certify external email, courier or payment services." /></p><p><AdminText text="Search performance is measured in Search Console; visits and booked orders do not establish collected revenue or return on investment." /></p><p><a href="https://search.google.com/search-console" target="_blank" rel="noreferrer"><AdminText text="Open Search Console" /></a> · <Link href="/admin/audit"><AdminText text="Open admin audit history" /></Link></p></div></div>
  </>;
}
