// Actual server-page JSX and actual locale provider; isolated data adapters only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {AR} from '../lib/admin-ar.mjs';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),swc=require('next/dist/build/swc');
const compile=async file=>swc.transform(await readFile(new URL('../'+file,import.meta.url),'utf8'),{filename:file,jsc:{target:'es2022',parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const evaluate=(code,dependency)=>{const module={exports:{}};new vm.Script(code.code).runInNewContext({module,exports:module.exports,Number,Object,URLSearchParams,require:dependency});return module.exports;};
const locale=evaluate(await compile('app/admin/_lib/locale.js'),id=>{
 if(id==='react'||id.startsWith('react/'))return require(id);if(id==='next/navigation')return {usePathname:()=>'/admin/orders'};
 if(id.endsWith('admin-copy.mjs'))return require('../lib/admin-copy.mjs');throw Error('Unexpected locale dependency '+id);
});
const statuses=['new','confirmed','shipped','delivered','cancelled'],nextFrom=s=>({new:['confirmed','cancelled'],confirmed:['shipped','cancelled'],shipped:['delivered','cancelled']}[s]??[]);
let status='delivered';
const order=()=>({id:1,ref:'100001',status,lang:'en',collection_seq:0,collected_amount:'100.00',total:'100.00',subtotal:'100.00',discount:'0.00',shipping:'0.00',city:'Cairo',phone:'01000000001',email:'synthetic@check.invalid',address:'Synthetic address',name:'Synthetic customer',courier:'Synthetic Courier',created_at:'2026-11-01T00:00:00Z',settled_at:'2026-11-02T00:00:00Z'});
const histories=[{id:1,kind:'status',from_status:'confirmed',to_status:'shipped'},...['note','refund-request','mail','edit','call'].map((kind,i)=>({id:i+2,kind,note:'CUSTOMER-UNCHANGED'}))].map(e=>({...e,actor:'admin:1',created_at:'2026-11-02T00:00:00Z'}));
const sql=async strings=>{
 const text=strings.join('');
 if(text.includes('count(DISTINCT'))return [{orders:0,units:0}];
 if(text.includes('COUNT(*)')&&text.includes('subscribers'))return [{status:'active',c:1}];
 if(text.includes('COUNT(*)'))return [{status,c:1}];
 if(text.includes('SELECT * FROM subscribers'))return [{id:1,status:'active',email:'synthetic@check.invalid',name:'Synthetic customer',created_at:'2026-11-01T00:00:00Z'}];
 if(text.includes('SELECT o.*')||text.includes('SELECT * FROM orders'))return [order()];
 return [];
};
const dependency=id=>{
 if(id==='react'||id.startsWith('react/'))return require(id);
 if(id==='next/link')return ({children,...props})=>React.createElement('a',props,children);
 if(id==='next/navigation')return {redirect:()=>{throw Error('Unexpected redirect');},notFound:()=>{throw Error('Unexpected notFound');}};
 if(id.endsWith('/locale.js'))return locale;
 if(id.endsWith('/locale-server.js'))return {localizedAdminMetadata:v=>v};
 if(id.endsWith('/guard.js'))return {requirePermission:async()=>({id:1,role:'owner'})};
 if(id.endsWith('/auth.js'))return {csrfToken:async()=>'synthetic-only',csrfOk:async()=>false};
 if(id.endsWith('/db.js'))return {sql};
 if(id.endsWith('/ui.js'))return {Flash:()=>null,dt:String,day:String,money:String,waLink:()=>'/synthetic'};
 if(id.endsWith('/order-status.js'))return {STATUSES:statuses,nextFrom,eventsFor:async()=>histories,logEvent:async()=>{}};
 if(id.endsWith('/order-edit.js'))return {canEdit:s=>['new','confirmed'].includes(s),MAX_QTY:20};
 if(id.endsWith('/order-notify.js'))return {transitionAndNotify:async()=>{},editAndNotify:async()=>{}};
 if(id.endsWith('/collection-ledger.mjs'))return {recordCollection:async()=>{throw Error('No writes in render test');}};
 if(id.endsWith('/delivery-eta.js'))return {formatWindow:()=>'',zoneFor:()=> 'metro'};
 if(id.endsWith('/order-number.js'))return {formatRef:String,normaliseRef:String,isRef:()=>false};
 if(id.endsWith('/admin-roles.js'))return {can:()=>true};
 if(id.endsWith('/hairtypes.js'))return {bySlug:()=>null};
 if(id.endsWith('/confirm-button.js'))return ({message,children,...props})=>React.createElement('button',props,children);
 throw Error('Unexpected page dependency '+id);
};
const pages={detail:evaluate(await compile('app/admin/(panel)/orders/[id]/page.js'),dependency).default,orders:evaluate(await compile('app/admin/(panel)/orders/page.js'),dependency).default,subscribers:evaluate(await compile('app/admin/(panel)/subscribers/page.js'),dependency).default};
const render=async(page,lang)=>renderToStaticMarkup(React.createElement(locale.AdminLocaleProvider,{lang},await pages[page]({params:Promise.resolve({id:'1'}),searchParams:Promise.resolve({})})));
const title=s=>s[0].toUpperCase()+s.slice(1),escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

test('actual Arabic order detail translates badges, edit locks, transition messages, cash explanations and history for every order status',async()=>{
 for(const value of statuses){status=value;const html=await render('detail','ar');assert.match(html,/dir="rtl" lang="ar"/);assert.match(html,new RegExp('>'+escaped(AR[title(value)])+'<'));assert.doesNotMatch(html,/\b(New|Confirmed|Shipped|Delivered|Cancelled)\b/);
  assert.match(html,new RegExp('option value="'+value+'"[^>]*>'+escaped(AR[title(value)])+'</option>'));
  for(const key of ['Note','Cancellation asked','Email sent','Order edited','Call'])assert.match(html,new RegExp(escaped(AR[key])));
  assert.match(html,/CUSTOMER-UNCHANGED/);
 }
});
test('actual Arabic order filter and per-row status options retain their wire values',async()=>{
 status='new';const html=await render('orders','ar');
 for(const value of statuses)assert.match(html,new RegExp('option value="'+value+'"[^>]*>'+escaped(AR[title(value)])+'</option>'));
 assert.doesNotMatch(html,/>(New|Confirmed|Shipped|Delivered|Cancelled)</);
});
test('actual Arabic subscriber filter translates all statuses and preserves submitted values',async()=>{
 const html=await render('subscribers','ar');for(const value of ['active','pending','unsubscribed','bounced'])assert.match(html,new RegExp('option value="'+value+'"[^>]*>'+escaped(AR[title(value)])+'</option>'));
 assert.doesNotMatch(html,/>(Active|Pending|Unsubscribed|Bounced)</);
});
test('English controls retain their labels and dynamic value translation remains explicitly opt-in',async()=>{
 status='new';assert.match(await render('detail','en'),/option value="confirmed">Confirmed<\/option>/);assert.match(await render('subscribers','en'),/option value="bounced">Bounced<\/option>/);
 const html=renderToStaticMarkup(React.createElement(locale.AdminLocaleProvider,{lang:'ar'},React.createElement(locale.AdminText,{text:'Admin #{0}',values:['New']})));
 assert.match(html,/New/);assert.doesNotMatch(html,new RegExp(escaped(AR.New)));
});
