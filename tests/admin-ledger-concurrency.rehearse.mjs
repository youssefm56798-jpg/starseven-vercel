import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withOwnedPg17} from './owned-pg17.mjs';
import {DDL,lazySql,editModule,statusModule,checkoutModule,seedOrder} from './admin-ledger-fixture.mjs';
import {GRANTS,SEQUENCE_GRANTS} from '../db/grants.mjs';
const keep=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NODE_TEST_CONTEXT']);for(const name of Object.keys(process.env))if(!keep.has(name.toUpperCase()))delete process.env[name];
globalThis.fetch=()=>{throw new Error('HOSTED_FETCH_FORBIDDEN');};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function waiting(control,pid){
 for(let i=0;i<200;i++){const row=(await control.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];if(row?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,10));}
 throw new Error('REAL_SECOND_CONNECTION_DID_NOT_WAIT');
}
test('owned PG17 restricted-role matrix and real two-connection schedules',async t=>{
 await withOwnedPg17(async({control,connect,version})=>{
  await control.query('CREATE DATABASE s7_synthetic_ledger');const owner=await connect('s7_synthetic_ledger'),one=await connect('s7_synthetic_ledger'),two=await connect('s7_synthetic_ledger');
  await owner.query('CREATE ROLE s7_synthetic_ledger_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
  const pid2=(await two.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  async function reset(){
   await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'+DDL);
   await owner.query('GRANT USAGE ON SCHEMA public TO s7_synthetic_ledger_app');
   for(const table of ['offers','products','orders','order_items','order_events','offer_redemptions','order_tokens','order_attempts'])await owner.query('GRANT '+GRANTS[table].join(',')+' ON '+table+' TO s7_synthetic_ledger_app');
   for(const [name,rights]of Object.entries(SEQUENCE_GRANTS))await owner.query('GRANT '+rights.join(',')+' ON SEQUENCE '+name+' TO s7_synthetic_ledger_app');
   await one.query('SET ROLE s7_synthetic_ledger_app');await two.query('SET ROLE s7_synthetic_ledger_app');
  }
  await t.test('actual app grants permit ledger operations and forbid event mutation/redemption reassignment',async()=>{
   await reset();const id=await seedOrder(owner);const sql=lazySql(one),edit=await editModule(sql),status=await statusModule(sql);
   assert.equal((await one.query('SELECT current_user AS role')).rows[0].role,'s7_synthetic_ledger_app');
   for(const query of ["UPDATE order_events SET note='forbidden'","DELETE FROM order_events","UPDATE offer_redemptions SET phone='forbidden'","SELECT * FROM order_events FOR UPDATE","SELECT * FROM offer_redemptions FOR UPDATE"])await assert.rejects(one.query(query),error=>error.code==='42501');
   assert.equal((await edit.editOrder({orderId:id,coupon:'SYNTH-A'})).ok,true);assert.equal((await edit.editOrder({orderId:id,contact:{phone:'01000000001'}})).ok,true);assert.equal((await status.transition({orderId:id,to:'cancelled'})).ok,true);
   const checkout=await checkoutModule(sql);assert.equal((await checkout.POST(checkout.request({idempotency_key:'synthetic-role-checkout'}))).status,200);
  });
  for(const [label,maximum]of [['last global use',1],['last per-phone use',null]])await t.test('edit vs checkout contend for '+label+' with a fresh count after waiting',async()=>{
   await reset();const id=await seedOrder(owner);await owner.query('UPDATE offers SET max_uses=$1,per_customer=1 WHERE id=2',[maximum]);
   const locked=deferred(),release=deferred();let held=false;
   const sql1=lazySql(one,{async afterStatement(statement){if(!held&&/FOR UPDATE/.test(statement.text)){held=true;locked.resolve();await release.promise;}}}),sql2=lazySql(two);
   const edit=await editModule(sql1),checkout=await checkoutModule(sql2),first=edit.editOrder({orderId:id,coupon:'SYNTH-B'});await locked.promise;
   const second=checkout.POST(checkout.request({coupon:'SYNTH-B'}));
   try{await waiting(owner,pid2);}finally{release.resolve();}
   assert.equal((await first).ok,true);assert.equal((await second).status,422);
   assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=2')).rows[0].used_count,1);assert.equal((await owner.query('SELECT count(*)::int AS n FROM offer_redemptions')).rows[0].n,1);assert.equal((await owner.query('SELECT stock FROM products')).rows[0].stock,20);
  });
  await t.test('phone move vs checkout share generation serialization and cannot exceed destination limit',async()=>{
   await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query('UPDATE offers SET max_uses=NULL,per_customer=1 WHERE id=1');
   const locked=deferred(),release=deferred();let held=false;const sql1=lazySql(one,{async afterStatement(statement){if(!held&&/FOR UPDATE/.test(statement.text)){held=true;locked.resolve();await release.promise;}}}),sql2=lazySql(two);
   const edit=await editModule(sql1),checkout=await checkoutModule(sql2),first=edit.editOrder({orderId:id,contact:{phone:'01000000001'}});await locked.promise;
   const second=checkout.POST(checkout.request({phone:'01000000001'}));try{await waiting(owner,pid2);}finally{release.resolve();}
   assert.equal((await first).ok,true);assert.equal((await second).status,422);assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=1')).rows[0].used_count,1);assert.equal((await owner.query('SELECT phone FROM offer_redemptions')).rows[0].phone,'01000000001');
  });
  await t.test('opposite A→B/B→A swaps lock IDs consistently and both preserve one claim',async()=>{
   await reset();const a=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10}),b=await seedOrder(owner,{coupon:'SYNTH-B',managed:true,phone:'01000000001',ref:'SYNTH-OTHER',discount:25});
   const locked=deferred(),release=deferred();let held=false;const firstSql=lazySql(one,{async afterStatement(statement){if(!held&&/FOR UPDATE/.test(statement.text)){held=true;locked.resolve();await release.promise;}}});
   const firstEdit=await editModule(firstSql),secondEdit=await editModule(lazySql(two)),first=firstEdit.editOrder({orderId:a,coupon:'SYNTH-B'});await locked.promise;const second=secondEdit.editOrder({orderId:b,coupon:'SYNTH-A'});
   try{await waiting(owner,pid2);}finally{release.resolve();}
   assert.equal((await first).ok,true);assert.equal((await second).ok,true);assert.deepEqual((await owner.query('SELECT used_count FROM offers ORDER BY id')).rows.map(r=>r.used_count),[1,1]);assert.equal((await owner.query('SELECT count(*)::int AS n FROM offer_redemptions')).rows[0].n,2);
  });
  await t.test('edit wins before queued cancellation; cancellation CAS refuses stale claim then retry returns B',async()=>{
   await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});const locked=deferred(),release=deferred();let held=false;
   const edit=await editModule(lazySql(one,{async afterStatement(statement,index){if(!held&&index===0){held=true;locked.resolve();await release.promise;}}})),status=await statusModule(lazySql(two));
   const first=edit.editOrder({orderId:id,coupon:'SYNTH-B'});await locked.promise;const second=status.transition({orderId:id,to:'cancelled'});try{await waiting(owner,pid2);}finally{release.resolve();}
   assert.equal((await first).ok,true);assert.equal((await second).ok,false);assert.equal((await owner.query('SELECT coupon FROM orders WHERE id=$1',[id])).rows[0].coupon,'SYNTH-B');assert.equal((await status.transition({orderId:id,to:'cancelled'})).ok,true);assert.deepEqual((await owner.query('SELECT used_count FROM offers ORDER BY id')).rows.map(r=>r.used_count),[0,0]);assert.equal((await owner.query('SELECT stock FROM products')).rows[0].stock,21);
  });
  await t.test('two cancellations return the managed counter/stock only once',async()=>{
   await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});const locked=deferred(),release=deferred();let held=false;
   const firstStatus=await statusModule(lazySql(one,{async afterStatement(statement,index){if(!held&&index===0){held=true;locked.resolve();await release.promise;}}})),secondStatus=await statusModule(lazySql(two));
   const first=firstStatus.transition({orderId:id,to:'cancelled'});await locked.promise;const second=secondStatus.transition({orderId:id,to:'cancelled'});try{await waiting(owner,pid2);}finally{release.resolve();}
   assert.equal((await first).ok,true);assert.equal((await second).ok,false);assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=1')).rows[0].used_count,0);assert.equal((await owner.query('SELECT stock FROM products')).rows[0].stock,21);assert.equal((await owner.query('SELECT count(*)::int AS n FROM offer_redemptions')).rows[0].n,0);
  });
  for(const to of ['cancelled','shipped'])await t.test(to+' wins before a queued edit; the edit changes no stock/claim',async()=>{
   await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});const locked=deferred(),release=deferred();let held=false;
   const status=await statusModule(lazySql(one,{async afterStatement(statement,index){if(!held&&index===0){held=true;locked.resolve();await release.promise;}}})),edit=await editModule(lazySql(two));
   const first=status.transition({orderId:id,to});await locked.promise;const second=edit.editOrder({orderId:id,coupon:'SYNTH-B',lines:[{id:1,qty:2}]});try{await waiting(owner,pid2);}finally{release.resolve();}
   assert.equal((await first).ok,true);assert.equal((await second).reason,'not-editable');assert.equal((await owner.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status,to);assert.equal((await owner.query('SELECT stock FROM products')).rows[0].stock,to==='cancelled'?21:20);assert.equal((await owner.query('SELECT used_count FROM offers WHERE id=2')).rows[0].used_count,0);
  });
  await t.test('different-generation same-code slot collision rolls the losing phone move back as a conflict',async()=>{
   await reset();const id=await seedOrder(owner,{coupon:'SYNTH-A',managed:true,discount:10});await owner.query("UPDATE offers SET code='SYNTH-OLD' WHERE id=1; INSERT INTO offers(code,discount_value,max_uses,per_customer) VALUES('SYNTH-A',10,NULL,1)");
   const locked=deferred(),release=deferred();let held=false;
   const checkout=await checkoutModule(lazySql(one,{async afterStatement(statement){if(!held&&statement.text.includes('WITH usage AS')){held=true;locked.resolve();await release.promise;}}})),edit=await editModule(lazySql(two));
   const first=checkout.POST(checkout.request({phone:'01000000001'}));await locked.promise;const second=edit.editOrder({orderId:id,contact:{phone:'01000000001'}});try{await waiting(owner,pid2);}finally{release.resolve();}
   assert.equal((await first).status,200);assert.equal((await second).reason,'conflict');assert.equal((await owner.query('SELECT phone,edit_seq FROM orders WHERE id=$1',[id])).rows[0].phone,'01000000000');assert.equal((await owner.query('SELECT edit_seq FROM orders WHERE id=$1',[id])).rows[0].edit_seq,0);assert.equal((await owner.query("SELECT used_count FROM offers WHERE code='SYNTH-OLD'")).rows[0].used_count,1);assert.equal((await owner.query("SELECT used_count FROM offers WHERE code='SYNTH-A'")).rows[0].used_count,1);
  });
  assert.match(version,/^17\./);
  t.diagnostic('Owned PostgreSQL '+version+'; all application writers used the restricted role; fixture shutdown and scoped deletion follow.');
 });
});
