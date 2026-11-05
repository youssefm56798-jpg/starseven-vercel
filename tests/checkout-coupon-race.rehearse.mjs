// Explicit fake-database rehearsal, excluded from the dependency-free *.test.mjs suite.
// Run with S7_SYNTHETIC_MODULE_ROOT pointing to the already installed rehearsal-tools.
// No .env, hosted connection, listening server, real key or notification is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ok,fail,readJson,langOf} from '../lib/http.js';
import {discountFor,cartTotals} from '../lib/pricing.js';
import {normalizePhone} from '../lib/phone.js';
import {formatRef} from '../lib/order-number.js';
import * as claims from '../lib/coupon-claims.mjs';
import * as eligibility from '../lib/customer-eligibility.mjs';
import * as shipping from '../lib/shipping-policy.mjs';

const runtimeRoot=process.env.S7_SYNTHETIC_MODULE_ROOT;
if(!runtimeRoot)throw new Error('Set S7_SYNTHETIC_MODULE_ROOT to the approved existing fake DB runtime');
const require=createRequire(pathToFileURL(path.join(runtimeRoot,'package.json')));
const {PGlite}=require('@electric-sql/pglite');
const keep=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NODE_TEST_CONTEXT']);
for(const name of Object.keys(process.env))if(!keep.has(name.toUpperCase()))delete process.env[name];
globalThis.fetch=async()=>{throw new Error('HOSTED_FETCH_FORBIDDEN');};
const routeSource=await readFile(new URL('../app/api/order/route.js',import.meta.url),'utf8');

// Load the actual handler body with explicit dependency injection. Shared HTTP,
// phone, reference and pricing functions above are the real application modules.
// Only framework/provider boundaries are doubles. Every SQL statement executes
// in real in-memory PostgreSQL; no SQL predicate is simulated by JavaScript.
function handler(dependencies){
 const body=routeSource.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 return new Function(...Object.keys(dependencies),body+'\nreturn POST;')(...Object.values(dependencies));
}
const ddl=`
CREATE SEQUENCE order_ref_seq START WITH 100001;
CREATE TABLE shipping_zones(code text PRIMARY KEY,name_ar text NOT NULL,name_en text NOT NULL,fee numeric(10,2),free_over numeric(10,2),min_days int,max_days int,active boolean,version int);
INSERT INTO shipping_zones VALUES('cairo','القاهرة','Cairo',30,300,1,2,true,0),('giza','الجيزة','Giza',30,300,1,2,true,0),('qalyubia','القليوبية','Qalyubia',30,300,2,3,true,0);
CREATE TABLE products(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sku text UNIQUE,name_ar text,name_en text,price numeric(10,2),stock integer,image text,active boolean DEFAULT true);
CREATE TABLE offers(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,code text UNIQUE,active boolean,starts_at timestamptz,ends_at timestamptz,discount_type text,discount_value numeric(10,2),min_total numeric(10,2),max_uses integer,used_count integer,per_customer integer,first_order_only boolean NOT NULL DEFAULT false);
CREATE TABLE orders(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ref text UNIQUE,name text,phone text,address text,city text,notes text,lang text,subtotal numeric(10,2),shipping numeric(10,2),discount numeric(10,2),total numeric(10,2),coupon text,source text,ip text,email text,access_hash text,edit_seq integer DEFAULT 0,status text DEFAULT 'new');
CREATE TABLE order_events(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id integer REFERENCES orders(id),kind text,actor text,note text);
CREATE TABLE order_items(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id integer REFERENCES orders(id),product_id integer,sku text,name text,price numeric(10,2),qty smallint);
CREATE TABLE order_tokens(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id integer REFERENCES orders(id),token_hash text,purpose text);
CREATE TABLE order_attempts(idem_key text PRIMARY KEY,ref text,response json NOT NULL);
CREATE TABLE offer_redemptions(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,code text,order_id integer REFERENCES orders(id),phone text,email text,slot integer);
CREATE UNIQUE INDEX idx_redemptions_slot ON offer_redemptions(code,phone,slot);
INSERT INTO products(sku,name_ar,name_en,price,stock,image) VALUES('SYNTH-P','منتج تجريبي','Synthetic',100,10,'/synthetic.png');
INSERT INTO offers(code,active,ends_at,discount_type,discount_value,min_total,max_uses,used_count,per_customer) VALUES('SYNTH50',true,now()+interval '1 hour','percent',50,0,10,0,2);
`;
async function fixture(run){
 const db=await PGlite.create();
 const calls=[],deferred=[],errors=[];let notifyCalls=0,beforeTransaction=async()=>{},atTransactionStart=async()=>{},diagnosticFailure=false;
 try{
  await db.exec(ddl);
  function sql(strings,...values){
   const text=strings.reduce((all,part,index)=>all+(index?'$'+index:'')+part,'');
   return {text,values,then(resolve,reject){calls.push(text);if(diagnosticFailure&&/AS eligible\s*$/.test(text))return Promise.reject(new Error('SYNTHETIC_DIAGNOSTIC_READ_FAILURE')).then(resolve,reject);return db.query(text,values).then(result=>result.rows).then(resolve,reject);}};
  }
  sql.transaction=async statements=>{
   await beforeTransaction();calls.push('BEGIN');await db.query('BEGIN');
   try{await atTransactionStart();const results=[];for(const statement of statements){calls.push(statement.text);results.push((await db.query(statement.text,statement.values)).rows);}await db.query('COMMIT');calls.push('COMMIT');return results;}
   catch(error){await db.query('ROLLBACK');calls.push('ROLLBACK');throw error;}
  };
  const dependencies={...claims,...eligibility,...shipping,after:callback=>deferred.push(callback),sql,clientIp:()=> '192.0.2.1',rateOk:async()=>true,
   ok,fail,readJson,langOf,token40:()=> 'synthetic-never-live-subscriber-token',formatRef,fakeOrderRef:()=> 'synthetic-honeypot',discountFor,cartTotals,normalizePhone,
   sendMail:async()=>{notifyCalls++;},tplOrder:()=>['Synthetic','Synthetic'],tplOrderAdmin:()=>['Synthetic','Synthetic'],
   newAccessToken:()=> 'synthetic-never-live-access-token',sha256:async()=> 'synthetic-access-digest',orderUrl:()=> 'https://example.invalid/synthetic',
   site:{shipping:30,freeOver:300,currency:'EGP',whatsapp:'00000000000'},mail:{notifyTo:'synthetic@example.invalid'},limits:{order:[20,60],orderPhone:[20,60]},maxOrderLines:20,
   str:(value,max)=>String(value??'').trim().slice(0,max),trapped:value=>Boolean(String(value??'').trim()),isEmail:value=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
   tooMany:()=>fail('Synthetic rate refusal',429),tooBig:()=>fail('Synthetic size refusal',413),isServed:value=>value==='Cairo',console:{error:(...values)=>errors.push(values)},
  };
  const POST=handler(dependencies);
  const request=extra=>new Request('https://example.invalid/api/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Synthetic Shopper',phone:'01000000000',address:'Synthetic address only',email:'synthetic@example.invalid',city:'Cairo',lang:'en',coupon:'SYNTH50',idempotency_key:'synthetic-checkout-key-0001',items:[{sku:'SYNTH-P',qty:1}],...extra})});
  await run({db,calls,deferred,errors,POST,request,setBeforeTransaction(callback){beforeTransaction=callback;},setAtTransactionStart(callback){atTransactionStart=callback;},failDiagnosticRead(){diagnosticFailure=true;},get notifyCalls(){return notifyCalls;}});
 }finally{await db.close();}
}
async function state(db){return (await db.query(`SELECT (SELECT count(*)::int FROM orders) AS orders,(SELECT count(*)::int FROM order_items) AS items,(SELECT count(*)::int FROM order_tokens) AS tokens,(SELECT count(*)::int FROM order_attempts) AS attempts,(SELECT count(*)::int FROM offer_redemptions) AS redemptions,(SELECT stock FROM products WHERE sku='SYNTH-P') AS stock,(SELECT used_count FROM offers WHERE code='SYNTH50') AS used`)).rows[0];}
async function rejectedWhole(fixture,expectedStock=10){
 const response=await fixture.POST(fixture.request());const body=await response.json();
 assert.equal(response.status,422);assert.equal(body.ok,false);assert.equal(body.field,'coupon');
 assert.match(body.error,/code.*changed|code.*available|discount.*changed/i);
 assert.deepEqual(await state(fixture.db),{orders:0,items:0,tokens:0,attempts:0,redemptions:0,stock:expectedStock,used:0});
 assert.equal(fixture.deferred.length,0);assert.equal(fixture.notifyCalls,0);
}

test('same-code replacement cannot spend a new offer using an earlier quote',async()=>fixture(async f=>{
 f.setBeforeTransaction(async()=>{await f.db.query("DELETE FROM offers WHERE code='SYNTH50'");await f.db.query("INSERT INTO offers(code,active,ends_at,discount_type,discount_value,min_total,max_uses,used_count,per_customer) VALUES('SYNTH50',true,now()+interval '1 hour','percent',1,100000,1,0,2)");});
 await rejectedWhole(f);assert.equal((await f.db.query("SELECT id FROM offers WHERE code='SYNTH50'")).rows[0].id,2);
}));
for(const [name,change]of [
 ['discount value',"discount_value=1"],['discount type',"discount_type='fixed'"],
 ['minimum',"min_total=50"],['unlimited per-phone policy',"per_customer=NULL"],['tighter per-phone policy',"per_customer=1"],
 ['expiry',"ends_at=now()-interval '1 second'"],['future start',"starts_at=now()+interval '1 hour'"],
])test(name+' changed after quoting aborts the complete order',async()=>fixture(async f=>{
 f.setBeforeTransaction(()=>f.db.query('UPDATE offers SET '+change+" WHERE code='SYNTH50'"));await rejectedWhole(f);
}));
test('unchanged quote creates one complete order, one redemption and defers all notification work',async()=>fixture(async f=>{
 const response=await f.POST(f.request());const body=await response.json();assert.equal(response.status,200);assert.equal(body.discount,50);
 assert.deepEqual(await state(f.db),{orders:1,items:1,tokens:1,attempts:1,redemptions:1,stock:9,used:1});assert.equal(f.deferred.length,1);assert.equal(f.notifyCalls,0);
}));
test('transaction-time start/end boundaries remain inclusive',async()=>fixture(async f=>{
 f.setAtTransactionStart(()=>f.db.query('UPDATE offers SET starts_at=now(),ends_at=now()'));
 const response=await f.POST(f.request());assert.equal(response.status,200);assert.equal((await state(f.db)).used,1);
}));
test('an expired quote returns an actionable Arabic coupon error without order writes',async()=>fixture(async f=>{
 f.setBeforeTransaction(()=>f.db.query("UPDATE offers SET ends_at=now()-interval '1 second'"));
 const response=await f.POST(f.request({lang:'ar'}));const body=await response.json();assert.equal(response.status,422);assert.equal(body.field,'coupon');assert.match(body.error,/كود الخصم/);assert.equal((await state(f.db)).orders,0);assert.equal(f.deferred.length,0);
}));
test('a committed replay wins before changed coupon/stock refusal and never sends a second notification',async()=>fixture(async f=>{
 const first=await f.POST(f.request());const firstBody=await first.json();
 await f.db.exec("UPDATE offers SET active=false,ends_at=now()-interval '1 second'; UPDATE products SET stock=0");
 const replay=await f.POST(f.request());assert.equal(replay.status,200);assert.deepEqual(await replay.json(),firstBody);
 assert.equal((await state(f.db)).orders,1);assert.equal(f.deferred.length,1);assert.equal(f.notifyCalls,0);
}));
test('a losing write claim replays first even when the current coupon is invalid',async()=>fixture(async f=>{
 const original={ref:'synthetic-prior-order',discount:50,message:'Synthetic original reply'};
 f.setBeforeTransaction(async()=>{await f.db.query('INSERT INTO order_attempts(idem_key,ref,response) VALUES($1,$2,$3::json)',['synthetic-checkout-key-0001',original.ref,JSON.stringify(original)]);await f.db.query("UPDATE offers SET active=false WHERE code='SYNTH50'");});
 const response=await f.POST(f.request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,...original});
 const saved=await state(f.db);assert.equal(saved.orders,0);assert.equal(saved.stock,10);assert.equal(saved.attempts,1);assert.equal(f.deferred.length,0);
}));
test('valid coupon plus a concurrent stock loss returns the stock field and leaves coupon untouched',async()=>fixture(async f=>{
 f.setBeforeTransaction(()=>f.db.query('UPDATE products SET stock=0'));
 const response=await f.POST(f.request());const body=await response.json();assert.equal(response.status,409);assert.equal(body.field,'items');
 assert.deepEqual(await state(f.db),{orders:0,items:0,tokens:0,attempts:0,redemptions:0,stock:0,used:0});assert.equal(f.deferred.length,0);
}));
test('only the optional diagnostic read failing after rollback keeps the existing stock refusal',async()=>fixture(async f=>{
 const initial=await state(f.db);
 f.setBeforeTransaction(()=>f.db.query("UPDATE offers SET ends_at=now()-interval '1 second'"));
 f.failDiagnosticRead();
 const response=await f.POST(f.request());const body=await response.json();
 assert.equal(response.status,409);assert.equal(body.ok,false);assert.equal(body.field,'items');assert.match(body.error,/sold out.*cart/i);
 assert.deepEqual(await state(f.db),initial);assert.equal(f.deferred.length,0);assert.equal(f.notifyCalls,0);
 const rollback=f.calls.indexOf('ROLLBACK'),diagnostic=f.calls.findIndex(text=>/AS eligible\s*$/.test(text));
 assert.ok(rollback>=0&&diagnostic>rollback);assert.ok(f.calls.slice(rollback+1,diagnostic).some(text=>/FROM order_attempts/.test(text)),'replay read remains before optional diagnosis');
 assert.equal(f.calls.filter(text=>/AS eligible\s*$/.test(text)).length,1);
}));
test('a depleted total cap is diagnosed as coupon refusal rather than stock loss',async()=>fixture(async f=>{
 f.setBeforeTransaction(()=>f.db.query("UPDATE offers SET max_uses=1,used_count=1 WHERE code='SYNTH50'"));
 const response=await f.POST(f.request());assert.equal(response.status,422);assert.equal((await response.json()).field,'coupon');const saved=await state(f.db);assert.equal(saved.orders,0);assert.equal(saved.stock,10);assert.equal(saved.used,1);
}));
test('a full per-phone ledger is diagnosed as coupon refusal and never takes stock',async()=>fixture(async f=>{
 f.setBeforeTransaction(async()=>{await f.db.query("INSERT INTO orders(ref) VALUES('synthetic-prior-1'),('synthetic-prior-2')");await f.db.query("INSERT INTO offer_redemptions(code,order_id,phone,slot) SELECT 'SYNTH50',id,'01000000000',id-1 FROM orders");});
 const response=await f.POST(f.request());assert.equal(response.status,422);assert.equal((await response.json()).field,'coupon');const saved=await state(f.db);assert.equal(saved.orders,2);assert.equal(saved.redemptions,2);assert.equal(saved.stock,10);assert.equal(saved.used,0);
}));
test('no-coupon checkout and no-coupon stock refusal keep their original behavior',async()=>fixture(async f=>{
 const success=await f.POST(f.request({coupon:''}));assert.equal(success.status,200);assert.equal((await success.json()).discount,0);assert.equal((await state(f.db)).used,0);
 f.setBeforeTransaction(()=>f.db.query('UPDATE products SET stock=0'));
 const failure=await f.POST(f.request({coupon:'',idempotency_key:'synthetic-checkout-key-0002'}));assert.equal(failure.status,409);assert.equal((await failure.json()).field,'items');assert.equal((await state(f.db)).orders,1);
}));
