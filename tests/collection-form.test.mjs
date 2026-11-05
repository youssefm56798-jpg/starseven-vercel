import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),swc=require('next/dist/build/swc');
const source=await readFile(new URL('../app/admin/(panel)/orders/[id]/page.js',import.meta.url),'utf8');
const code=await swc.transform(source+'\nexport {saveSettlement as testSave};',{filename:'OrderDetail.js',jsc:{target:'es2022',parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
let calls=[],permissions=[],allowed=true,result={ok:true,changed:false,amount:'100.00',total:100},failure=null;
const redirect=url=>{throw Object.assign(new Error('redirect'),{url});};
const order={id:1,ref:'100001',status:'delivered',collection_seq:7,collected_amount:'100.00',total:'100.00',subtotal:'100.00',discount:'0.00',shipping:'0.00',city:'Cairo',phone:'01000000001',email:'synthetic@check.invalid',address:'Synthetic address',name:'Synthetic',courier:'Synthetic Courier',created_at:'2026-11-01T00:00:00Z',settled_at:'2026-11-02T00:00:00Z'};
const module={exports:{}};
new vm.Script(code.code).runInNewContext({module,exports:module.exports,Number,Object,FormData,URLSearchParams,console:{error:()=>{}},require(id){
 if(id.startsWith('react/'))return require(id);
 if(id==='next/link')return ({children,...props})=>React.createElement('a',props,children);
 if(id==='next/navigation')return {redirect,notFound:()=>{throw Error('not found');}};
 if(id.endsWith('/locale-server.js'))return {localizedAdminMetadata:v=>v};
 if(id.endsWith('/locale.js'))return {AdminText:({text})=>text,AdminFormat:({value})=>String(value??''),AdminActor:({value})=>value,AdminElement:({as='span',children,...props})=>React.createElement(as,props,children)};
 if(id.endsWith('/guard.js'))return {requirePermission:async permission=>{permissions.push(permission);if(!allowed)throw Error('denied');return {id:1};}};
 if(id.endsWith('/auth.js'))return {csrfToken:async()=>'synthetic-only',csrfOk:async v=>v==='synthetic-only'};
 if(id.endsWith('/ui.js'))return {Flash:()=>null,dt:String,money:String,waLink:()=>'/synthetic'};
 if(id.endsWith('/collection-ledger.mjs'))return {recordCollection:async(sql,input,actor)=>{calls.push({input,actor});if(failure)throw failure;return result;}};
 if(id.endsWith('/db.js'))return {sql:async strings=>strings.join('').includes('FROM orders o')?[order]:[]};
 if(id.endsWith('/order-status.js'))return {STATUSES:['delivered'],nextFrom:()=>[],eventsFor:async()=>[],logEvent:async()=>{}};
 if(id.endsWith('/order-notify.js'))return {transitionAndNotify:async()=>{},editAndNotify:async()=>{}};
 if(id.endsWith('/order-edit.js'))return {canEdit:()=>false,MAX_QTY:20};
 if(id.endsWith('/delivery-eta.js'))return {formatWindow:()=>'',zoneFor:()=> 'metro'};
 if(id.endsWith('/order-number.js'))return {formatRef:v=>String(v)};
 throw Error('Unexpected order dependency '+id);
}});
const form=()=>{const f=new FormData();f.set('_csrf','synthetic-only');f.set('id','1');f.set('collection_seq','7');f.set('collected','100');f.set('collection_reason','');return f;};
const reset=()=>{calls=[];permissions=[];allowed=true;failure=null;result={ok:true,changed:false,amount:'100.00',total:100};};

test('actual collection form renders the current sequence, reason and original collection date',async()=>{
 reset();const html=renderToStaticMarkup(await module.exports.default({params:Promise.resolve({id:'1'}),searchParams:Promise.resolve({})}));
 const cash=(html.match(/<form\b[\s\S]*?<\/form>/g)??[]).find(f=>f.includes('collection_seq'));assert.ok(cash);
 assert.match(cash,/name="collection_seq" value="7"/);assert.match(cash,/name="_csrf" value="synthetic-only"/);
 const reason=(cash.match(/<input\b[^>]*>/g)??[]).find(i=>i.includes('name="collection_reason"'));assert.ok(reason);assert.match(reason,/minLength="5"/);assert.match(reason,/maxLength="300"/);
 assert.match(html,/First collection record/);assert.match(html,/2026-11-02T00:00:00Z/);assert.match(html,/locked after a refund or courier settlement/);
});

test('actual collection action preserves permission and CSRF boundaries and passes the rendered sequence',async()=>{
 reset();await assert.rejects(module.exports.testSave(form()),e=>e.url==='/admin/orders/1?m=cash_unchanged');
 assert.deepEqual(permissions,['orders:write']);assert.equal(calls.length,1);assert.equal(calls[0].input.expect_seq,'7');assert.equal(calls[0].actor,'admin:1');
 reset();const bad=form();bad.set('_csrf','invalid-synthetic');await assert.rejects(module.exports.testSave(bad),e=>e.url==='/admin/orders/1?m=csrf');assert.equal(calls.length,0);
 reset();allowed=false;await assert.rejects(module.exports.testSave(form()),/denied/);assert.equal(calls.length,0);
});

test('actual collection action returns bounded error feedback and safe database failure handling',async()=>{
 for(const [error,flash]of [['input','cash_bad'],['reason','cash_reason'],['locked','cash_locked'],['review','cash_review'],['stale','cash_conflict']]){reset();result={ok:false,error};await assert.rejects(module.exports.testSave(form()),e=>e.url==='/admin/orders/1?m='+flash);}
 reset();failure=Object.assign(new Error('Synthetic database unavailable'),{code:'08006'});await assert.rejects(module.exports.testSave(form()),e=>e.url==='/admin/orders/1?m=ops_unavailable');
});
