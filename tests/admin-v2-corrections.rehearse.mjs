import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite,DDL,lazySql,editModule} from './admin-ledger-fixture.mjs';
import {recordCollection} from '../lib/collection-ledger.mjs';
import {createReturn,moveReturn,createSettlement,financialReport} from '../lib/admin-operations.mjs';
const migration=await readFile(new URL('../db/admin-operations-20261104.sql',import.meta.url),'utf8'),actor='admin:1';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const db=new PGlite();
const ready=(async()=>{await db.waitReady;await db.exec(DDL+`ALTER TABLE orders ADD COLUMN collected_amount numeric(10,2);ALTER TABLE orders ADD COLUMN settled_at timestamptz;ALTER TABLE orders ADD COLUMN courier text NOT NULL DEFAULT '';CREATE TABLE admins(id int,role text,suspended_at timestamptz);`);await db.exec(migration);})();
after(async()=>{await db.close();});
async function fixture(run){await ready;
 await db.exec(`TRUNCATE orders,courier_settlements,admin_audit,stock_movements RESTART IDENTITY CASCADE;UPDATE products SET stock=20;TRUNCATE stock_movements,admin_audit RESTART IDENTITY;DELETE FROM shipping_zones;INSERT INTO shipping_zones VALUES('cairo','Cairo','Cairo',30,300,1,2,true,0),('giza','Giza','Giza',30,300,1,2,true,0),('qalyubia','Qalyubia','Qalyubia',30,300,2,3,true,0);`);const sql=lazySql(db);
 const seed=async({status='delivered',collected=100,discount=0,old=false,city='Cairo'}={})=>{const o=(await db.query(`INSERT INTO orders(ref,name,phone,email,address,city,status,subtotal,discount,shipping,total,collected_amount,settled_at,courier) VALUES($1,'Synthetic','01000000001','synthetic@check.invalid','Synthetic address',$2,$3,200,$4::numeric,30,230-$4::numeric,$5::numeric,CASE WHEN $5::numeric IS NULL THEN NULL WHEN $6::boolean THEN now()-interval '40 days' ELSE now() END,'SYNTH Courier') RETURNING *`,[randomUUID(),city,status,discount,collected,old])).rows[0];const i=(await db.query("INSERT INTO order_items(order_id,product_id,sku,name,price,qty) VALUES($1,1,'SYNTH-P','Synthetic',100,2) RETURNING id",[o.id])).rows[0].id;return {o,i};};
 await run({db,sql,seed});
}
const save=(f,id,seq,amount,reason='Synthetic correction')=>recordCollection(f.sql,{order_id:id,expect_seq:seq,amount,reason},actor);
const reports=async f=>Object.fromEntries((await financialReport(f.sql,30)).map(r=>[r.period,Number(r.collected)]));
const row=async(f,id)=>(await f.db.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0];
const events=async(f,id)=>(await f.db.query('SELECT * FROM collection_movements WHERE order_id=$1 ORDER BY id',[id])).rows;
async function received(f,o,i,qty=1){const r=await createReturn(f.sql,{order_id:o.id,request_key:randomUUID(),reason:'Synthetic returned goods',items:[{id:i,qty}]},actor);assert.ok(r.ok);assert.ok((await moveReturn(f.sql,{id:r.id,version:0,from:'requested',to:'approved'},actor)).ok);assert.ok((await moveReturn(f.sql,{id:r.id,version:1,from:'approved',to:'received',condition:'opened'},actor)).ok);return r.id;}
const refund=(f,id,amount)=>moveReturn(f.sql,{id,version:2,from:'received',to:'refunded',refund_amount:String(amount),refund_method:'cash',refund_reference:'SYNTHETIC',refunded_on:today()},actor);

test('unchanged collection saves preserve the original period, date, sequence and ledger',()=>fixture(async f=>{
 const {o}=await f.seed({old:true});const before=await reports(f);assert.deepEqual(before,{current:0,previous:100});
 for(let i=0;i<3;i++)assert.deepEqual((await save(f,o.id,0,'100','')).changed,false);
 assert.deepEqual(await reports(f),before);assert.equal(String((await row(f,o.id)).settled_at),String(o.settled_at));assert.equal((await row(f,o.id)).collection_seq,0);assert.equal((await events(f,o.id)).length,0);
}));
test('legacy opening remains in its original period; signed corrections are append-only in their current period',()=>fixture(async f=>{
 const {o}=await f.seed({old:true});assert.ok((await save(f,o.id,0,'80')).ok);
 assert.deepEqual(await reports(f),{current:-20,previous:100});const movements=await events(f,o.id);assert.deepEqual(movements.map(m=>Number(m.amount_delta)),[100,-20]);assert.deepEqual(movements.map(m=>m.kind),['opening','corrected']);
 assert.equal(String((await row(f,o.id)).settled_at),String(o.settled_at));assert.equal((await row(f,o.id)).collection_seq,1);
 assert.ok((await save(f,o.id,1,'90')).ok);assert.deepEqual(await reports(f),{current:-10,previous:100});
 assert.equal((await events(f,o.id)).filter(m=>m.kind==='opening').length,1);
}));
test('collection declaration, zero, clear and replay retain an auditable balance',()=>fixture(async f=>{
 const {o}=await f.seed({collected:null});assert.ok((await save(f,o.id,0,'0','')).ok);assert.equal((await save(f,o.id,1,'0','')).changed,false);
 assert.ok((await save(f,o.id,1,'')).ok);assert.equal((await row(f,o.id)).settled_at,null);
 assert.ok((await save(f,o.id,2,'25','')).ok);assert.equal((await row(f,o.id)).collection_seq,3);assert.equal((await events(f,o.id)).length,3);assert.deepEqual(await reports(f),{current:25,previous:0});
 const audit=(await f.db.query("SELECT count(*)::int AS n FROM admin_audit WHERE area='collections'")).rows[0].n;assert.equal(audit,3);
}));
test('missing reasons, invalid decimals and stale collection forms cannot mutate balance or history',()=>fixture(async f=>{
 const {o}=await f.seed();assert.equal((await save(f,o.id,0,'90','')).error,'reason');
 for(const value of ['1e3','100.001','-1'])assert.equal((await save(f,o.id,0,value)).error,'input');
 assert.equal((await save(f,o.id,null,'90')).error,'input');assert.ok((await save(f,o.id,0,'90')).ok);
 assert.equal((await save(f,o.id,0,'80')).error,'stale');assert.equal(Number((await row(f,o.id)).collected_amount),90);assert.equal((await events(f,o.id)).length,2);
}));

test('a late collection failure rolls back the opening, correction, aggregate, sequence and audit together',()=>fixture(async f=>{
 const {o}=await f.seed({old:true});
 const before=await row(f,o.id),report=await reports(f);
 const failing=lazySql(f.db,{afterStatement:async statement=>{if(statement.text.includes('INSERT INTO order_events'))throw Object.assign(new Error('Synthetic late failure'),{code:'SYNTHETIC'});}});
 await assert.rejects(recordCollection(failing,{order_id:o.id,expect_seq:0,amount:'80',reason:'Synthetic correction'},actor),e=>e.code==='SYNTHETIC');
 assert.deepEqual(await row(f,o.id),before);assert.equal((await events(f,o.id)).length,0);assert.deepEqual(await reports(f),report);
 assert.equal((await f.db.query("SELECT count(*)::int AS n FROM admin_audit WHERE area='collections'")).rows[0].n,0);
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM order_events WHERE order_id=$1',[o.id])).rows[0].n,0);
 assert.ok((await save(f,o.id,0,'80')).ok);assert.equal((await events(f,o.id)).length,2);
}));

test('microsecond legacy collection dates survive unchanged saves and corrections exactly',()=>fixture(async f=>{
 const {o}=await f.seed();await f.db.query("UPDATE orders SET settled_at='2026-08-01 10:20:30.123456+00'::timestamptz WHERE id=$1",[o.id]);
 const stamp=async()=>(await f.db.query('SELECT settled_at::text AS stamp FROM orders WHERE id=$1',[o.id])).rows[0].stamp;
 const before=await stamp();assert.equal((await save(f,o.id,0,'100','')).changed,false);assert.equal(await stamp(),before);
 assert.ok((await save(f,o.id,0,'80')).ok);assert.equal(await stamp(),before);
 assert.equal((await f.db.query("SELECT occurred_at::text AS stamp FROM collection_movements WHERE order_id=$1 AND kind='opening'",[o.id])).rows[0].stamp,before);
}));
test('refunds freeze collection changes and clearing, while an unchanged save is still harmless',()=>fixture(async f=>{
 const {o,i}=await f.seed();const id=await received(f,o,i);assert.ok((await refund(f,id,10)).ok);
 assert.equal((await save(f,o.id,0,'90')).ok,false);assert.equal((await save(f,o.id,0,'')).ok,false);assert.equal((await save(f,o.id,0,'100','')).changed,false);
 assert.equal(Number((await row(f,o.id)).collected_amount),100);assert.equal((await events(f,o.id)).length,0);
}));
test('courier settlement membership freezes later collection corrections without changing its snapshot',()=>fixture(async f=>{
 const {o}=await f.seed();assert.ok((await createSettlement(f.sql,{courier:'SYNTH Courier',reference:randomUUID(),settled_on:today(),received:'90',fees:'10',order_ids:[o.id]},actor)).ok);
 assert.equal((await save(f,o.id,0,'110')).ok,false);assert.equal((await save(f,o.id,0,'')).ok,false);assert.equal((await save(f,o.id,0,'100','')).changed,false);
 assert.equal(Number((await f.db.query('SELECT recorded_collected FROM settlement_orders WHERE order_id=$1',[o.id])).rows[0].recorded_collected),100);
}));
test('split discounted refunds respect the aggregate merchandise entitlement as well as collected cash',()=>fixture(async f=>{
 const {o,i}=await f.seed({collected:219.99,discount:10.01});const a=await received(f,o,i),b=await received(f,o,i);
 assert.ok((await refund(f,a,95)).ok);assert.equal((await refund(f,b,95)).ok,false);assert.ok((await refund(f,b,94.99)).ok);
 assert.equal(Number((await f.db.query('SELECT sum(refund_amount) AS n FROM order_returns WHERE order_id=$1',[o.id])).rows[0].n),189.99);
 const combined=await f.seed({collected:219.99,discount:10.01});const c=await received(f,combined.o,combined.i,2);assert.ok((await refund(f,c,189.99)).ok);
}));
test('city-only edits validate the served policy and reprice shipping without moving items or the agreed discount',()=>fixture(async f=>{
 const {o}=await f.seed({status:'new',collected:null,discount:10.01});await f.db.exec("UPDATE shipping_zones SET fee=45,free_over=0 WHERE code='giza'");const {editOrder}=await editModule(f.sql);
 const res=await editOrder({orderId:o.id,actor,expectSeq:0,contact:{city:'Giza'}});assert.ok(res.ok);
 const after=await row(f,o.id);assert.equal(Number(after.discount),10.01);assert.equal(Number(after.shipping),45);assert.equal(Number(after.total),234.99);assert.equal((await f.db.query('SELECT qty FROM order_items WHERE order_id=$1',[o.id])).rows[0].qty,2);
 assert.equal(Number((await f.db.query('SELECT stock FROM products WHERE id=1')).rows[0].stock),20);
}));
test('city-only edits refuse disabled, missing and unserved policies without changing the order',()=>fixture(async f=>{
 const {o}=await f.seed({status:'new',collected:null});const {editOrder}=await editModule(f.sql);
 for(const setup of ["UPDATE shipping_zones SET active=false WHERE code='giza'","DELETE FROM shipping_zones WHERE code='giza'"]){await f.db.exec(setup);assert.equal((await editOrder({orderId:o.id,actor,expectSeq:0,contact:{city:'Giza'}})).reason,'bad-address');}
 assert.equal((await editOrder({orderId:o.id,actor,expectSeq:0,contact:{city:'Unserved town'}})).reason,'bad-address');assert.equal((await row(f,o.id)).city,'Cairo');
 assert.equal(Number((await row(f,o.id)).shipping),30);
}));

test('normalized unchanged cities preserve grandfathered charges without a policy reprice',()=>fixture(async f=>{
 const {o}=await f.seed({status:'new',collected:null,discount:10.01});await f.db.exec("UPDATE shipping_zones SET active=false,fee=99 WHERE code='cairo'");const {editOrder}=await editModule(f.sql);
 const result=await editOrder({orderId:o.id,actor,expectSeq:0,contact:{city:'  CAIRO  ',address:'Synthetic corrected flat'}});assert.ok(result.ok);
 const after=await row(f,o.id);assert.equal(after.city,'Cairo');assert.equal(Number(after.shipping),30);assert.equal(Number(after.discount),10.01);assert.equal(Number(after.total),219.99);
}));

test('a fullwidth equivalent city cannot persist an unrecognized shipping representation',()=>fixture(async f=>{
 const {o}=await f.seed({status:'new',collected:null});const {editOrder}=await editModule(f.sql);
 const before=await row(f,o.id),result=await editOrder({orderId:o.id,actor,expectSeq:0,contact:{city:'\uFF23\uFF41\uFF49\uFF52\uFF4F'}});
 assert.ok(result.ok);assert.equal(result.changed,false);assert.deepEqual(await row(f,o.id),before);
 const withAddress=await editOrder({orderId:o.id,actor,expectSeq:0,contact:{city:'\uFF23\uFF41\uFF49\uFF52\uFF4F',address:'Synthetic corrected flat'}});assert.ok(withAddress.ok);
 assert.equal((await row(f,o.id)).city,'Cairo');assert.equal(Number((await row(f,o.id)).shipping),30);
 assert.equal((await editOrder({orderId:o.id,actor,expectSeq:1,contact:{city:'\uFF27\uFF49\uFF5A\uFF41'}})).reason,'bad-address');assert.equal((await row(f,o.id)).city,'Cairo');
}));

test('delivered, refunded and settled orders refuse city edits without changing financial facts',()=>fixture(async f=>{
 const {editOrder}=await editModule(f.sql);
 const a=await f.seed(),b=await f.seed(),c=await f.seed();const returned=await received(f,b.o,b.i);assert.ok((await refund(f,returned,10)).ok);
 assert.ok((await createSettlement(f.sql,{courier:'SYNTH Courier',reference:randomUUID(),settled_on:today(),received:'90',fees:'10',order_ids:[c.o.id]},actor)).ok);
 for(const {o} of [a,b,c]){const before=await row(f,o.id);assert.equal((await editOrder({orderId:o.id,actor,expectSeq:0,contact:{city:'Giza'}})).reason,'not-editable');assert.deepEqual(await row(f,o.id),before);}
}));
