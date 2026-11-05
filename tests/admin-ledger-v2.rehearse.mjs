// Targeted V2 delta tests only. Actual modules/SQL, fresh synthetic in-memory PG18.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite,DDL,lazySql,editModule,statusModule,notificationModule,checkoutModule,seedOrder,snapshot} from './admin-ledger-fixture.mjs';
import {CLAIM_ACTOR,CLAIM_ACTOR_PREFIX,readClaimState,claimUsage} from '../lib/coupon-claims.mjs';
const keep=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NODE_TEST_CONTEXT']);for(const name of Object.keys(process.env))if(!keep.has(name.toUpperCase()))delete process.env[name];
globalThis.fetch=()=>{throw new Error('HOSTED_FETCH_FORBIDDEN');};
const db=await PGlite.create();after(()=>db.close());
async function fixture(run,{afterStatement=async()=>{}}={}){
 await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'+DDL);
 const sql=lazySql(db,{afterStatement}),status=await statusModule(sql),{editOrder}=await editModule(sql),notification=await notificationModule(sql,editOrder,status.transition),checkout=await checkoutModule(sql);
 return run({sql,...status,editOrder,...notification,checkout});
}
async function current(id){return (await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0];}
async function counter(id=1){return (await db.query('SELECT used_count FROM offers WHERE id=$1',[id])).rows[0]?.used_count;}
async function assertCancelled(f,id,review){
 const order=await current(id);assert.equal(order.status,'cancelled');assert.equal(order.coupon,'SYNTH-A');assert.equal(order.discount,'10.00');assert.equal(order.total,'120.00');assert.equal((await db.query('SELECT stock FROM products')).rows[0].stock,21);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_redemptions WHERE order_id=$1',[id])).rows[0].n,0);assert.equal((await readClaimState(f.sql,order)).kind,'none');
 assert.equal((await db.query("SELECT count(*)::int AS n FROM order_events WHERE kind='status' AND to_status='cancelled'")).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM order_events WHERE kind='note' AND note LIKE '%counter was nonpositive%'")).rows[0].n,review?1:0);
}
for(const value of [2,1,0,-2])test('modern cancellation with original counter '+value+' preserves availability and transaction-bound review metadata',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('UPDATE offers SET used_count=$1 WHERE id=1',[value]);
 const result=await f.transitionAndNotify({orderId:id,to:'cancelled'});assert.equal(result.ok,true);assert.equal(result.couponReviewNeeded===true,value<=0);assert.equal(await counter(),value>0?value-1:value);await assertCancelled(f,id,value<=0);assert.equal(f.deferred.length,1);
 const saved=await snapshot(db);assert.equal((await f.transitionAndNotify({orderId:id,to:'cancelled'})).ok,false);assert.deepEqual(await snapshot(db),saved);assert.equal(f.deferred.length,1);
}));
test('zero-counter flag uses only transaction results, including wrapped driver results; no postcommit read is available',()=>fixture(async()=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('UPDATE offers SET used_count=0 WHERE id=1');let committed=false;
 const guarded={async query(text,values){if(committed)throw new Error('POSTCOMMIT_READ_FORBIDDEN');const result=await db.query(text,values);if(text==='COMMIT')committed=true;return result;}};
 const sql=lazySql(guarded),transaction=sql.transaction;sql.transaction=async statements=>(await transaction(statements)).map(rows=>({rows}));
 const status=await statusModule(sql),result=await status.transition({orderId:id,to:'cancelled'});assert.equal(result.ok,true);assert.equal(result.couponReviewNeeded,true);assert.equal(committed,true);assert.equal(sql.calls.at(-1),'COMMIT');
}));
test('failure after the private review result rolls back status/stock/audit/claim and never returns a success flag',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('UPDATE offers SET used_count=0 WHERE id=1');const saved=await snapshot(db);
 const result=await f.transitionAndNotify({orderId:id,to:'cancelled'});assert.equal(result.ok,false);assert.equal(Object.hasOwn(result,'couponReviewNeeded'),false);assert.deepEqual(await snapshot(db),saved);assert.equal(f.deferred.length,0);
},{async afterStatement(statement){if(statement.text.includes('AS coupon_review_needed'))await db.query('DELETE FROM offer_redemptions WHERE order_id=1');}}));
for(const value of [0,-2])test('coupon-sensitive EDIT still refuses original nonpositive counter '+value+' unchanged',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('UPDATE offers SET used_count=$1 WHERE id=1',[value]);const saved=await snapshot(db);const result=await f.editAndNotify({orderId:id,coupon:''});assert.equal(result.ok,false);assert.equal(result.reason,'coupon-review');assert.deepEqual(await snapshot(db),saved);assert.equal(f.deferred.length,0);
}));
for(const replacement of [0,7])test('deleted original cancellation never touches recreated same-code counter '+replacement,()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('DELETE FROM offers WHERE id=1');const row=(await db.query("INSERT INTO offers(code,used_count) VALUES('SYNTH-A',$1) RETURNING id",[replacement])).rows[0];
 const result=await f.transition({orderId:id,to:'cancelled'});assert.equal(result.ok,true);assert.equal(result.couponReviewNeeded===true,false);assert.equal(await counter(row.id),replacement);await assertCancelled(f,id,false);
}));
for(const variant of ['redacted','malformed','future','redacted+malformed','redacted+future'])test('renamed generation remains counted after '+variant+' without adopting mutation state or restoring PII',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query("UPDATE offers SET code='SYNTH-RENAMED',per_customer=1 WHERE id=1");
 if(variant.includes('redacted'))await db.query("UPDATE orders SET phone='',email='' WHERE id=$1",[id]);
 if(variant.includes('malformed')||variant.includes('future'))await db.query("INSERT INTO order_events(order_id,kind,actor,note) VALUES($1,'edit',$2,'malformed latest')",[id,variant.includes('future')?CLAIM_ACTOR_PREFIX+'v2':CLAIM_ACTOR]);
 assert.equal((await claimUsage(f.sql,{offerId:1,code:'SYNTH-RENAMED',phone:'01000000000'}))[0].n,1);assert.equal((await readClaimState(f.sql,await current(id))).kind,'review');
 const saved=await snapshot(db);assert.equal((await f.editOrder({orderId:id,contact:{phone:'01000000001'}})).reason,'coupon-review');assert.deepEqual(await snapshot(db),saved);
 assert.equal((await f.checkout.POST(f.checkout.request({coupon:'SYNTH-RENAMED'}))).status,422);assert.deepEqual(await snapshot(db),saved);
 const another=await seedOrder(db,{ref:'SYNTH-OTHER'}),before=await snapshot(db);const result=await f.editOrder({orderId:another,coupon:'SYNTH-RENAMED'});assert.equal(result.ok,false);assert.equal(result.reason,'coupon-spent');assert.deepEqual(await snapshot(db),before);
 if(variant.includes('redacted')){assert.equal((await current(id)).phone,'');assert.equal((await current(id)).email,'');}
}));
test('enforcement origin requires the surviving exact record/order and never creates ghost uses after release',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query("UPDATE offers SET code='SYNTH-RENAMED',per_customer=1 WHERE id=1");assert.equal((await claimUsage(f.sql,{offerId:1,code:'SYNTH-RENAMED',phone:'01000000000'}))[0].n,1);
 await db.query('DELETE FROM offer_redemptions WHERE order_id=$1',[id]);assert.equal((await claimUsage(f.sql,{offerId:1,code:'SYNTH-RENAMED',phone:'01000000000'}))[0].n,0);
}));
test('a proven distinct modern generation is not charged to a new same-code generation',()=>fixture(async f=>{
 await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('DELETE FROM offers WHERE id=1');const row=(await db.query("INSERT INTO offers(code,discount_value,max_uses,per_customer) VALUES('SYNTH-A',10,10,1) RETURNING id")).rows[0];assert.equal((await claimUsage(f.sql,{offerId:row.id,code:'SYNTH-A',phone:'01000000000'}))[0].n,0);assert.equal((await f.checkout.POST(f.checkout.request())).status,200);
}));
