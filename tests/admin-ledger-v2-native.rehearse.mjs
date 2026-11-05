// Targeted V2 delta only, actual unchanged restricted grants and owned PG17.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withOwnedPg17} from './owned-pg17.mjs';
import {DDL,lazySql,editModule,statusModule,checkoutModule,seedOrder,snapshot} from './admin-ledger-fixture.mjs';
import {GRANTS,SEQUENCE_GRANTS} from '../db/grants.mjs';
import {CLAIM_ACTOR,CLAIM_ACTOR_PREFIX,claimUsage,readClaimState} from '../lib/coupon-claims.mjs';
const keep=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NODE_TEST_CONTEXT']);for(const name of Object.keys(process.env))if(!keep.has(name.toUpperCase()))delete process.env[name];
globalThis.fetch=()=>{throw new Error('HOSTED_FETCH_FORBIDDEN');};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function waiting(owner,pid){for(let i=0;i<200;i++){if((await owner.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('SECOND_REAL_CONNECTION_DID_NOT_WAIT');}
test('V2 restricted PG17 cancellation and renamed-origin enforcement',async t=>withOwnedPg17(async({control,connect,version})=>{
 await control.query('CREATE DATABASE s7_synthetic_ledger');const owner=await connect('s7_synthetic_ledger'),one=await connect('s7_synthetic_ledger'),two=await connect('s7_synthetic_ledger');
 await owner.query('CREATE ROLE s7_synthetic_ledger_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');const pid2=(await two.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 async function reset(){
  await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'+DDL);await owner.query('GRANT USAGE ON SCHEMA public TO s7_synthetic_ledger_app');
  for(const name of ['offers','products','orders','order_items','order_events','offer_redemptions','order_tokens','order_attempts'])await owner.query('GRANT '+GRANTS[name].join(',')+' ON '+name+' TO s7_synthetic_ledger_app');
  for(const [name,rights]of Object.entries(SEQUENCE_GRANTS))await owner.query('GRANT '+rights.join(',')+' ON SEQUENCE '+name+' TO s7_synthetic_ledger_app');
  await one.query('SET ROLE s7_synthetic_ledger_app');await two.query('SET ROLE s7_synthetic_ledger_app');assert.equal((await one.query('SELECT current_user AS role')).rows[0].role,'s7_synthetic_ledger_app');
 }
 for(const value of [2,1,0,-2])await t.test('native original counter '+value+' cancels once, preserves receipt and records exact review flag',async()=>{
  await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query('UPDATE offers SET used_count=$1 WHERE id=1',[value]);const sql=lazySql(one),status=await statusModule(sql);
  const result=await status.transition({orderId:id,to:'cancelled'});assert.equal(result.ok,true);assert.equal(result.couponReviewNeeded===true,value<=0);const row=(await owner.query('SELECT status,coupon,discount,total FROM orders WHERE id=$1',[id])).rows[0];assert.deepEqual(row,{status:'cancelled',coupon:'SYNTH-A',discount:'10.00',total:'120.00'});assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=1')).rows[0].used_count,value>0?value-1:value);assert.equal((await owner.query('SELECT stock FROM products')).rows[0].stock,21);assert.equal((await owner.query('SELECT count(*)::int AS n FROM offer_redemptions')).rows[0].n,0);assert.equal((await owner.query("SELECT count(*)::int AS n FROM order_events WHERE kind='note' AND note LIKE '%counter was nonpositive%'")).rows[0].n,value<=0?1:0);
  const saved=await snapshot(owner);assert.equal((await status.transition({orderId:id,to:'cancelled'})).ok,false);assert.deepEqual(await snapshot(owner),saved);
 });
 await t.test('two genuine zero-counter cancels return stock/claim and append review only once',async()=>{
  await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query('UPDATE offers SET used_count=0 WHERE id=1');const locked=deferred(),release=deferred();let held=false;
  const status1=await statusModule(lazySql(one,{async afterStatement(statement){if(!held&&statement.text.includes('FOR UPDATE')){held=true;locked.resolve();await release.promise;}}})),status2=await statusModule(lazySql(two));
  const first=status1.transition({orderId:id,to:'cancelled'});await locked.promise;const second=status2.transition({orderId:id,to:'cancelled'});try{await waiting(owner,pid2);}finally{release.resolve();}
  assert.equal((await first).couponReviewNeeded,true);assert.equal((await second).ok,false);assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=1')).rows[0].used_count,0);assert.equal((await owner.query('SELECT stock FROM products')).rows[0].stock,21);assert.equal((await owner.query("SELECT count(*)::int AS n FROM order_events WHERE kind='note' AND note LIKE '%counter was nonpositive%'")).rows[0].n,1);
 });
 await t.test('review metadata stays transaction-bound when another writer changes the counter immediately after commit',async()=>{
  await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query('UPDATE offers SET used_count=0 WHERE id=1');const locked=deferred(),release=deferred(),committed=deferred(),returnResult=deferred();let held=false;
  const guarded={async query(text,values){const result=await one.query(text,values);if(text==='COMMIT'){committed.resolve();await returnResult.promise;}return result;}};
  const status=await statusModule(lazySql(guarded,{async afterStatement(statement){if(!held&&statement.text.includes('FOR UPDATE')){held=true;locked.resolve();await release.promise;}}}));
  const first=status.transition({orderId:id,to:'cancelled'});await locked.promise;const later=two.query('UPDATE offers SET used_count=1 WHERE id=1');try{await waiting(owner,pid2);}finally{release.resolve();}
  await committed.promise;await later;returnResult.resolve();const result=await first;assert.equal(result.ok,true);assert.equal(result.couponReviewNeeded,true);assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=1')).rows[0].used_count,1);
 });
 for(const value of [0,7])await t.test('deleted original never decrements recreated same-code counter '+value,async()=>{
  await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query('DELETE FROM offers WHERE id=1');const replacement=(await owner.query("INSERT INTO offers(code,used_count) VALUES('SYNTH-A',$1) RETURNING id",[value])).rows[0].id;const status=await statusModule(lazySql(one));assert.equal((await status.transition({orderId:id,to:'cancelled'})).ok,true);assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=$1',[replacement])).rows[0].used_count,value);
 });
 await t.test('same restricted edit path still refuses a nonpositive counter without any state change',async()=>{
  await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query('UPDATE offers SET used_count=0 WHERE id=1');const saved=await snapshot(owner),edit=await editModule(lazySql(one));assert.equal((await edit.editOrder({orderId:id,coupon:''})).reason,'coupon-review');assert.deepEqual(await snapshot(owner),saved);
 });
 for(const variant of ['redacted','malformed','future'])await t.test('renamed '+variant+' origin blocks both checkout and transaction-time admin claim under restricted role',async()=>{
  await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query("UPDATE offers SET code='SYNTH-RENAMED',per_customer=1 WHERE id=1");
  if(variant==='redacted')await owner.query("UPDATE orders SET phone='',email='' WHERE id=$1",[id]);else await owner.query("INSERT INTO order_events(order_id,kind,actor,note) VALUES($1,'edit',$2,'untrusted latest')",[id,variant==='future'?CLAIM_ACTOR_PREFIX+'v2':CLAIM_ACTOR]);
  const sql=lazySql(one);assert.equal((await claimUsage(sql,{offerId:1,code:'SYNTH-RENAMED',phone:'01000000000'}))[0].n,1);assert.equal((await readClaimState(sql,(await owner.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0])).kind,'review');
  const checkout=await checkoutModule(lazySql(two)),saved=await snapshot(owner);assert.equal((await checkout.POST(checkout.request({coupon:'SYNTH-RENAMED'}))).status,422);assert.deepEqual(await snapshot(owner),saved);
  const another=await seedOrder(owner,{ref:'SYNTH-OTHER'}),before=await snapshot(owner),edit=await editModule(sql);assert.equal((await edit.editOrder({orderId:another,coupon:'SYNTH-RENAMED'})).reason,'coupon-spent');assert.deepEqual(await snapshot(owner),before);if(variant==='redacted')assert.equal((await owner.query('SELECT phone FROM orders WHERE id=$1',[id])).rows[0].phone,'');
 });
 t.diagnostic('Owned PostgreSQL '+version+'; current GRANTS/SEQUENCE_GRANTS unchanged; all writers restricted; fixture stopped and owned cluster removed afterward.');
}));
