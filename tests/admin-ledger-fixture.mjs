// Focused synthetic order/offer schema. Never an installer or live-data seam.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {cartTotals,discountFor} from '../lib/pricing.js';
import {normalizePhone} from '../lib/phone.js';
import {deliveryWindow,governorateFor} from '../lib/delivery-eta.js';
import {ok,fail,readJson,langOf} from '../lib/http.js';
import {formatRef} from '../lib/order-number.js';
import * as claims from '../lib/coupon-claims.mjs';
import * as eligibility from '../lib/customer-eligibility.mjs';
import * as shipping from '../lib/shipping-policy.mjs';
const require=createRequire(process.env.S7_SYNTHETIC_MODULE_ROOT ? process.env.S7_SYNTHETIC_MODULE_ROOT.replace(/\\/g,'/')+'/package.json' : new URL('../../rehearsal-tools/package.json',import.meta.url));
export const {PGlite}=require('@electric-sql/pglite');
export const {pg_trgm}=require('@electric-sql/pglite/contrib/pg_trgm');
export const DDL=`
CREATE SEQUENCE order_ref_seq START WITH 100001;
CREATE TABLE offers(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,code text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,starts_at timestamptz,ends_at timestamptz,discount_type text NOT NULL DEFAULT 'percent',discount_value numeric(10,2) NOT NULL DEFAULT 0,min_total numeric(10,2) NOT NULL DEFAULT 0,max_uses integer,used_count integer NOT NULL DEFAULT 0,per_customer integer,first_order_only boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX idx_offers_code ON offers(code) WHERE code<>'';
CREATE TABLE products(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sku text UNIQUE,name_ar text,name_en text,price numeric(10,2),stock integer,image text,active boolean DEFAULT true);
CREATE TABLE orders(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ref text UNIQUE,name text,lang text NOT NULL DEFAULT 'en',status text NOT NULL DEFAULT 'new' CHECK(status IN('new','confirmed','shipped','delivered','cancelled')),coupon text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',city text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',subtotal numeric(10,2) NOT NULL DEFAULT 0,discount numeric(10,2) NOT NULL DEFAULT 0,shipping numeric(10,2) NOT NULL DEFAULT 0,total numeric(10,2) NOT NULL DEFAULT 0,edit_seq integer NOT NULL DEFAULT 0,source text,ip text,access_hash text,cancelled_at timestamptz,expected_from date,expected_to date,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE order_items(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id integer NOT NULL REFERENCES orders(id),product_id integer,sku text,name text,price numeric(10,2),qty smallint);
CREATE TABLE order_events(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id integer NOT NULL REFERENCES orders(id),kind text NOT NULL DEFAULT 'status' CHECK(kind IN('status','note','refund-request','mail','call','edit')),from_status text NOT NULL DEFAULT '',to_status text NOT NULL DEFAULT '',actor text NOT NULL DEFAULT 'system',note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE offer_redemptions(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,code text NOT NULL,order_id integer NOT NULL REFERENCES orders(id),phone text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',slot integer,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX idx_redemptions_slot ON offer_redemptions(code,phone,slot);
CREATE TABLE order_tokens(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id integer REFERENCES orders(id),token_hash text,purpose text);
CREATE TABLE order_attempts(idem_key text PRIMARY KEY,ref text,response json NOT NULL);
CREATE TABLE shipping_zones(code text PRIMARY KEY,name_ar text NOT NULL,name_en text NOT NULL,fee numeric(10,2),free_over numeric(10,2),min_days int,max_days int,active boolean,version int);
INSERT INTO shipping_zones VALUES('cairo','القاهرة','Cairo',30,300,1,2,true,0),('giza','الجيزة','Giza',30,300,1,2,true,0),('qalyubia','القليوبية','Qalyubia',30,300,2,3,true,0);
INSERT INTO offers(code,discount_value,max_uses,per_customer) VALUES('SYNTH-A',10,10,2),('SYNTH-B',25,10,2);
INSERT INTO products(sku,name_ar,name_en,price,stock,image) VALUES('SYNTH-P','Synthetic','Synthetic',100,20,'/synthetic.png');
`;
export function lazySql(db,{beforeTransaction=async()=>{},afterStatement=async()=>{}}={}){
 const calls=[];
 function sql(strings,...values){const text=strings.reduce((all,part,index)=>all+(index?'$'+index:'')+part,'');return {text,values,then(resolve,reject){calls.push(text);return db.query(text,values).then(result=>result.rows).then(resolve,reject);}};}
 sql.calls=calls;
 sql.transaction=async statements=>{await beforeTransaction();calls.push('BEGIN');await db.query('BEGIN');try{const results=[];for(let index=0;index<statements.length;index++){const statement=statements[index];calls.push(statement.text);results.push((await db.query(statement.text,statement.values)).rows);await afterStatement(statement,index);}await db.query('COMMIT');calls.push('COMMIT');return results;}catch(error){await db.query('ROLLBACK');calls.push('ROLLBACK');throw error;}};
 return sql;
}
export async function editModule(sql){
 const source=await readFile(new URL('../lib/order-edit.js',import.meta.url),'utf8');
 const body=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 return new Function('sql','site','cartTotals','discountFor','normalizePhone',...Object.keys(claims),...Object.keys(eligibility),...Object.keys(shipping),body+'\nreturn {editOrder};')(sql,{shipping:30,freeOver:300},cartTotals,discountFor,normalizePhone,...Object.values(claims),...Object.values(eligibility),...Object.values(shipping));
}
export async function statusModule(sql){
 const source=await readFile(new URL('../lib/order-status.js',import.meta.url),'utf8');
 const body=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 return new Function('sql','deliveryWindow','governorateFor',...Object.keys(claims),...Object.keys(shipping),body+'\nreturn {transition,logEvent,eventsFor,canSelfCancel};')(sql,deliveryWindow,governorateFor,...Object.values(claims),...Object.values(shipping));
}
export async function cancelModule(db,transitionAndNotify,canSelfCancel){
 const deferred=[];
 const source=await readFile(new URL('../app/api/order/cancel/route.js',import.meta.url),'utf8'),body=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 const dependencies={after:callback=>deferred.push(callback),clientIp:()=> '192.0.2.1',rateOk:async()=>true,ok,fail,readJson,
  site:{url:'https://example.invalid'},mail:{notifyTo:'synthetic@example.invalid'},originAllowed:()=>true,
  orderFor:async(ref,token)=>token==='synthetic-token'? (await db.query('SELECT * FROM orders WHERE ref=$1',[ref])).rows[0]:null,
  formatRef,canSelfCancel,transitionAndNotify,sendMail:async()=>{throw new Error('REAL_MAIL_FORBIDDEN');},esc:value=>String(value),
 };
 const POST=new Function(...Object.keys(dependencies),body+'\nreturn POST;')(...Object.values(dependencies));
 const request=()=>new Request('https://example.invalid/api/order/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ref:'SYNTH-ORDER',t:'synthetic-token'})});
 return {POST,request,deferred};
}
export async function customerTimeline(sql){
 const source=await readFile(new URL('../lib/order-access.js',import.meta.url),'utf8'),start=source.indexOf('export async function timelineFor('),end=source.indexOf('\n}',start)+2;
 assert.ok(start>=0&&end>start);return new Function('sql',source.slice(start,end).replace('export ','')+'\nreturn timelineFor;')(sql);
}
export async function notificationModule(sql,editOrder,transition){
 const deferred=[],errors=[];
 const source=await readFile(new URL('../lib/order-notify.js',import.meta.url),'utf8');
 const body=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 const value=new Function('sql','editOrder','transition','after','console',body+'\nreturn {editAndNotify,transitionAndNotify};')(sql,editOrder,transition,callback=>deferred.push(callback),{error:(...args)=>errors.push(args)});
 return {...value,deferred,errors};
}
export async function checkoutModule(sql){
 const deferred=[],errors=[];
 const source=await readFile(new URL('../app/api/order/route.js',import.meta.url),'utf8');
 const body=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 const dependencies={...claims,...eligibility,...shipping,after:callback=>deferred.push(callback),sql,clientIp:()=> '192.0.2.1',rateOk:async()=>true,
  ok,fail,readJson,langOf,token40:()=> 'synthetic-never-live-subscriber',formatRef,fakeOrderRef:()=> 'synthetic-honeypot',discountFor,cartTotals,normalizePhone,
  sendMail:async()=>{throw new Error('REAL_MAIL_FORBIDDEN');},tplOrder:()=>['Synthetic','Synthetic'],tplOrderAdmin:()=>['Synthetic','Synthetic'],
  newAccessToken:()=> 'synthetic-never-live-access',sha256:async()=> 'synthetic-access-digest',orderUrl:()=> 'https://example.invalid/synthetic',
  site:{shipping:30,freeOver:300,currency:'EGP',whatsapp:'00000000000'},mail:{notifyTo:'synthetic@example.invalid'},limits:{order:[20,60],orderPhone:[20,60]},maxOrderLines:20,
  str:(value,max)=>String(value??'').trim().slice(0,max),trapped:value=>Boolean(String(value??'').trim()),isEmail:value=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
  tooMany:()=>fail('Synthetic rate refusal',429),tooBig:()=>fail('Synthetic size refusal',413),isServed:value=>value==='Cairo',console:{error:(...args)=>errors.push(args)},
 };
 const POST=new Function(...Object.keys(dependencies),body+'\nreturn POST;')(...Object.values(dependencies));
 const request=extra=>new Request('https://example.invalid/api/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Synthetic Shopper',phone:'01000000000',address:'Synthetic address only',email:'synthetic@example.invalid',city:'Cairo',lang:'en',coupon:'SYNTH-A',idempotency_key:'synthetic-new-checkout-key-0001',items:[{sku:'SYNTH-P',qty:1}],...extra})});
 return {POST,request,deferred,errors};
}
export async function seedOrder(db,{coupon='',phone='01000000000',managed=false,ref='SYNTH-ORDER',discount=0}={}){
 const row=(await db.query("INSERT INTO orders(ref,name,phone,address,city,email,coupon,subtotal,discount,shipping,total) VALUES($1,'Synthetic',$2,'Synthetic address','Cairo','synthetic@example.invalid',$3,100,$4::numeric,30,130-$4::numeric) RETURNING id",[ref,phone,coupon,discount])).rows[0];
 await db.query("INSERT INTO order_items(order_id,product_id,sku,name,price,qty) VALUES($1,1,'SYNTH-P','Synthetic',100,1)",[row.id]);
 if(coupon){
  const offer=(await db.query('UPDATE offers SET used_count=used_count+1 WHERE code=$1 RETURNING id',[coupon])).rows[0];assert.ok(offer);
  const slot=(await db.query('SELECT coalesce(max(slot),-1)+1 AS slot FROM offer_redemptions WHERE code=$1 AND phone=$2',[coupon,phone])).rows[0].slot;
  const redemption=(await db.query("INSERT INTO offer_redemptions(code,order_id,phone,email,slot) VALUES($1,$2,$3,'synthetic@example.invalid',$4) RETURNING id",[coupon,row.id,phone,slot])).rows[0];
  if(managed)await db.query("INSERT INTO order_events(order_id,kind,actor,note) VALUES($1,'edit',$2,$3)",[row.id,claims.CLAIM_ACTOR,JSON.stringify({protocol:claims.CLAIM_PROTOCOL,version:1,state:'claimed',offerId:offer.id,redemptionId:redemption.id,editSeq:0})]);
 }
 return row.id;
}
export async function snapshot(db){
 const result={};for(const name of ['orders','order_items','order_events','offers','offer_redemptions','products'])result[name]=(await db.query('SELECT * FROM '+name+' ORDER BY id')).rows;
 return JSON.parse(JSON.stringify(result));
}
export const ownWorktree=fileURLToPath(new URL('../',import.meta.url));
