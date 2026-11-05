// Explicit isolated PostgreSQL rehearsal. No environment files, network, mail
// or application database client are imported by this test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite,DDL,lazySql,checkoutModule,statusModule} from './admin-ledger-fixture.mjs';
import {adjustStock,importStock,createReturn,moveReturn,saveShippingZone,createSettlement,financialReport,operationalSummary,customerHistory,csvCell} from '../lib/admin-operations.mjs';
import {parseStockCsv} from '../lib/stock-csv.mjs';
import {hasPriorOrder} from '../lib/customer-eligibility.mjs';
const migration=await readFile(new URL('../db/admin-operations-20261104.sql',import.meta.url),'utf8');
const actor='admin:1';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function fixture(run){
 const db=new PGlite();await db.waitReady;
 try{
  await db.exec(DDL+`ALTER TABLE products ADD COLUMN archived_at timestamptz;
    ALTER TABLE orders ADD COLUMN collected_amount numeric(10,2);
    ALTER TABLE orders ADD COLUMN settled_at timestamptz;
    ALTER TABLE orders ADD COLUMN courier text NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN refund_requested_at timestamptz;
    CREATE TABLE subscribers(id int,phone text,email text,status text);
    CREATE TABLE admins(id int,role text,suspended_at timestamptz,pass_hash text);`);
  await db.exec(migration);
  const sql=lazySql(db);
  const seed=async({status='delivered',phone='01000000000',email='synthetic@example.invalid',discount=0,collected=100}={})=>{
   const o=(await db.query(`INSERT INTO orders(ref,name,phone,email,status,subtotal,total,discount,collected_amount,settled_at,courier)
    VALUES($1,'Synthetic',$2,$3,$4,100,100-$5,$5,$6,now(),'SYNTH Courier') RETURNING id`,[randomUUID(),phone,email,status,discount,collected])).rows[0];
   const i=(await db.query("INSERT INTO order_items(order_id,product_id,sku,name,price,qty) VALUES($1,1,'SYNTH-P','Synthetic',50,2) RETURNING id",[o.id])).rows[0];return {order:o.id,item:i.id};
  };
  await run({db,sql,seed});
 }finally{await db.close();}
}
const openCase=async(f,extra={})=>{const s=await f.seed(extra);const result=await createReturn(f.sql,{order_id:s.order,reason:'Synthetic reason',request_key:randomUUID(),items:[{id:s.item,qty:1}]},actor);assert.equal(result.ok,true);return {...s,case:result.id};};
const move=(f,id,version,from,to,extra={})=>moveReturn(f.sql,{id,version,from,to,...extra},actor);
test('stock changes and trigger audit commit together with authenticated actor',()=>fixture(async f=>{
 assert.equal((await adjustStock(f.sql,{id:1,expected:20,delta:3,reason:'Synthetic restock'},actor)).ok,true);
 const r=(await f.db.query('SELECT delta,balance,actor,reason FROM stock_movements ORDER BY id DESC LIMIT 1')).rows[0];assert.deepEqual(r,{delta:3,balance:23,actor,reason:'Synthetic restock'});
 assert.equal((await adjustStock(f.sql,{id:1,expected:20,delta:1,reason:'Stale change'},actor)).error,'stale');
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM stock_movements')).rows[0].n,1);
}));
test('negative stock and multirow stale imports roll back every balance and ledger row',()=>fixture(async f=>{
 await f.db.query("INSERT INTO products(sku,stock) VALUES('SYNTH-Q',10)");
 assert.equal((await adjustStock(f.sql,{id:1,expected:20,delta:-21,reason:'Impossible adjustment'},actor)).ok,false);
 assert.equal((await importStock(f.sql,'SKU,Expected,Delta,Reason\nSYNTH-P,20,2,First adjustment\nSYNTH-Q,99,2,Stale adjustment',actor)).ok,false);
 assert.deepEqual((await f.db.query('SELECT stock FROM products ORDER BY id')).rows.map(x=>x.stock),[20,10]);
 assert.equal((await f.db.query("SELECT count(*)::int AS n FROM stock_movements WHERE reason='First adjustment'")).rows[0].n,0);
}));
test('CSV handles quotes and commas and refuses duplicates, malformed and empty fields',()=>{
 assert.equal(parseStockCsv('SKU,Expected,Delta,Reason\r\nSYNTH-P,20,2,"Stock, counted twice"')[0].reason,'Stock, counted twice');
 for(const raw of ['SKU,Expected,Delta,Reason\nSYNTH-P,20,1,Reason one\nSYNTH-P,21,1,Reason two','SKU,Expected,Delta,Reason\nSYNTH-P,,1,Reason one','SKU,Expected,Delta,Reason\nSYNTH-P,20,1,"unclosed'])assert.throws(()=>parseStockCsv(raw));
 assert.equal(csvCell('  =SUM(A1:A2)'),'"\'  =SUM(A1:A2)"');assert.equal(csvCell('A"B'),'"A""B"');
});
test('return request is idempotent and cannot reserve quantities twice',()=>fixture(async f=>{
 const s=await f.seed(),data={order_id:s.order,reason:'Synthetic reason',request_key:randomUUID(),items:[{id:s.item,qty:2}]};
 const a=await createReturn(f.sql,data,actor),b=await createReturn(f.sql,data,actor);assert.equal(a.id,b.id);
 assert.equal((await createReturn(f.sql,{...data,reason:'Changed request'},actor)).ok,false);
 assert.equal((await createReturn(f.sql,{...data,request_key:randomUUID()},actor)).ok,false);
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM order_returns')).rows[0].n,1);
}));
test('only delivered orders and their own lines can enter a return case',()=>fixture(async f=>{
 const a=await f.seed({status:'shipped'}),b=await f.seed();
 assert.equal((await createReturn(f.sql,{order_id:a.order,reason:'Synthetic reason',request_key:randomUUID(),items:[{id:a.item,qty:1}]},actor)).ok,false);
 assert.equal((await createReturn(f.sql,{order_id:b.order,reason:'Synthetic reason',request_key:randomUUID(),items:[{id:a.item,qty:1}]},actor)).ok,false);
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM order_returns')).rows[0].n,0);
}));
test('received resellable stock returns exactly once; stale transitions preserve state',()=>fixture(async f=>{
 const s=await openCase(f);assert.equal((await move(f,s.case,0,'requested','approved')).ok,true);
 assert.equal((await move(f,s.case,1,'approved','received',{condition:'resellable',restock:true})).ok,true);
 assert.equal((await move(f,s.case,1,'approved','received',{condition:'resellable',restock:true})).ok,false);
 assert.equal((await f.db.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,21);
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM stock_movements')).rows[0].n,1);
}));
test('damaged goods cannot be restocked and unreceived cases cannot be refunded',()=>fixture(async f=>{
 const s=await openCase(f);await move(f,s.case,0,'requested','approved');
 assert.equal((await move(f,s.case,1,'approved','received',{condition:'damaged',restock:true})).ok,false);
 assert.equal((await move(f,s.case,1,'approved','refunded',{refund_amount:10,refund_method:'cash',refund_reference:'SYNTH',refunded_on:today()})).ok,false);
 assert.equal((await f.db.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,20);
}));
test('refund cap uses returned discounted value and recorded cash, with one atomic payment record',()=>fixture(async f=>{
 const s=await openCase(f,{discount:20,collected:80});await move(f,s.case,0,'requested','approved');await move(f,s.case,1,'approved','received',{condition:'opened'});
 const fields={refund_method:'cash',refund_reference:'SYNTH REF',refunded_on:today()};
 assert.equal((await move(f,s.case,2,'received','refunded',{...fields,refund_amount:41})).ok,false);
 assert.equal((await move(f,s.case,2,'received','refunded',{...fields,refund_amount:40})).ok,true);
 assert.equal((await move(f,s.case,2,'received','refunded',{...fields,refund_amount:40})).ok,false);
 const r=(await f.db.query('SELECT state,refund_amount FROM order_returns')).rows[0];assert.equal(r.state,'refunded');assert.equal(Number(r.refund_amount),40);
}));
test('no recorded cash means no refund; closing leaves order delivered and money unchanged',()=>fixture(async f=>{
 const s=await openCase(f,{collected:null});await move(f,s.case,0,'requested','approved');await move(f,s.case,1,'approved','received',{condition:'damaged'});
 assert.equal((await move(f,s.case,2,'received','refunded',{refund_amount:1,refund_method:'wallet',refund_reference:'SYNTH',refunded_on:today()})).ok,false);
 assert.equal((await move(f,s.case,2,'received','closed')).ok,true);assert.equal((await f.db.query('SELECT status FROM orders')).rows[0].status,'delivered');
}));
test('shipping version guards reject stale changes and invalid date ranges',()=>fixture(async f=>{
 await f.db.exec("UPDATE shipping_zones SET version=0,fee=30,free_over=300,min_days=1,max_days=2 WHERE code='cairo'");
 const v={code:'cairo',version:0,name_ar:'القاهرة',name_en:'Cairo',fee:'40',free_over:'400',min_days:1,max_days:3,active:true};
 assert.equal((await saveShippingZone(f.sql,v,actor)).ok,true);assert.equal((await saveShippingZone(f.sql,v,actor)).ok,false);
 assert.equal((await saveShippingZone(f.sql,{...v,version:1,min_days:5,max_days:2},actor)).ok,false);
 assert.equal(Number((await f.db.query("SELECT fee FROM shipping_zones WHERE code='cairo'")).rows[0].fee),40);
}));
test('courier settlement is all-or-nothing and never changes collected cash or double includes an order',()=>fixture(async f=>{
 const s=await f.seed(),v={courier:'SYNTH Courier',reference:'SYNTH-BATCH',settled_on:today(),received:'80',fees:'10',order_ids:[s.order]};
 assert.equal((await createSettlement(f.sql,{...v,courier:'Wrong courier'},actor)).ok,false);
 assert.equal((await createSettlement(f.sql,v,actor)).ok,true);
 assert.equal((await createSettlement(f.sql,{...v,reference:'SYNTH-BATCH2'},actor)).ok,false);
 assert.equal(Number((await f.db.query('SELECT collected_amount FROM orders')).rows[0].collected_amount),100);
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM courier_settlements')).rows[0].n,1);
}));
test('reports distinguish booked, collected, refunded and outstanding; customer history is separate from consent',()=>fixture(async f=>{
 await f.seed({collected:60,discount:10});await f.seed({status:'new',phone:'01100000000',email:'other@example.invalid',collected:null});
 const periods=await financialReport(f.sql,30),current=periods.find(p=>p.period==='current');assert.equal(Number(current.booked),190);assert.equal(Number(current.collected),60);
 const ops=await operationalSummary(f.sql);assert.equal(Number(ops.cash_outstanding),30);
 const contacts=await customerHistory(f.sql,'01000000000');assert.equal(contacts.length,1);assert.equal(contacts[0].marketing_consent,false);
}));
test('first-order checkout checks any earlier phone OR email, not just this coupon redemption',()=>fixture(async f=>{
 await f.db.exec("UPDATE offers SET first_order_only=true WHERE code='SYNTH-A'");
 const checkout=await checkoutModule(f.sql);await f.seed({status:'cancelled'});
 for(const body of [{email:'new@example.invalid'},{phone:'01100000000'}]){
  const response=await checkout.POST(checkout.request(body));assert.equal(response.status,422);assert.match((await response.json()).error,/first-order discount/);
 }
 assert.equal(checkout.deferred.length,0);assert.equal((await f.db.query('SELECT used_count FROM offers WHERE id=1')).rows[0].used_count,0);
}));
test('fresh first-order checkout and its idempotent retry create one order and one claim',()=>fixture(async f=>{
 await f.db.exec("UPDATE offers SET first_order_only=true WHERE code='SYNTH-A'");const checkout=await checkoutModule(f.sql);
 const a=await checkout.POST(checkout.request());assert.equal(a.status,200);const b=await checkout.POST(checkout.request());assert.equal(b.status,200);
 assert.equal((await a.json()).ref,(await b.json()).ref);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,1);assert.equal(checkout.deferred.length,1);
 assert.equal(await hasPriorOrder(f.sql,'+20 100 000 0000','different@example.invalid'),true);
}));

test('historical unknown-address fulfilment retains old ETA, while missing served-area policy refuses atomically',()=>fixture(async f=>{
 const a=await f.seed({status:'new'}),b=await f.seed({status:'new',phone:'01100000000'});
 await f.db.query("UPDATE orders SET city='Historic unrecognised village' WHERE id=$1",[a.order]);
 await f.db.query("UPDATE orders SET city='Cairo' WHERE id=$1",[b.order]);
 const {transition}=await statusModule(f.sql);
 assert.equal((await transition({orderId:a.order,to:'confirmed',actor})).ok,true);
 assert.ok((await f.db.query('SELECT expected_from FROM orders WHERE id=$1',[a.order])).rows[0].expected_from);
 await f.db.exec("DELETE FROM shipping_zones WHERE code='cairo'");
 assert.equal((await transition({orderId:b.order,to:'confirmed',actor})).reason,'delivery-policy');
 assert.equal((await f.db.query('SELECT status FROM orders WHERE id=$1',[b.order])).rows[0].status,'new');
}));
