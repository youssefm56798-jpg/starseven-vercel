// Explicit real in-memory PostgreSQL tests; no environment/hosted client/mail.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite,DDL,lazySql,editModule,statusModule,cancelModule,customerTimeline,notificationModule,checkoutModule,seedOrder,snapshot} from './admin-ledger-fixture.mjs';
import {CLAIM_ACTOR,CLAIM_ACTOR_PREFIX,CLAIM_PROTOCOL,readClaimState,claimUsage} from '../lib/coupon-claims.mjs';
const keep=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NODE_TEST_CONTEXT']);
for(const name of Object.keys(process.env))if(!keep.has(name.toUpperCase()))delete process.env[name];
globalThis.fetch=()=>{throw new Error('HOSTED_FETCH_FORBIDDEN');};
const db=await PGlite.create();after(()=>db.close());
async function fixture(run){
 await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'+DDL);
 let beforeTransaction=async()=>{},afterStatement=async()=>{},expected;
 const sql=lazySql(db,{async beforeTransaction(){await beforeTransaction();expected=await snapshot(db);},async afterStatement(statement,index){await afterStatement(statement,index);}});
 const {editOrder}=await editModule(sql),status=await statusModule(sql),notifications=await notificationModule(sql,editOrder,status.transition),checkout=await checkoutModule(sql);
 const f={db,sql,editOrder,...status,...notifications,checkout,get expected(){return expected;},setBeforeTransaction(fn){beforeTransaction=fn;},setAfterStatement(fn){afterStatement=fn;}};
 await run(f);
}
async function order(db,id){return (await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0];}
async function used(db,code){return (await db.query('SELECT used_count FROM offers WHERE code=$1',[code])).rows[0]?.used_count;}
async function aligned(f,id){
 const current=await order(f.db,id),claim=await readClaimState(f.sql,current);assert.equal(claim.kind,current.coupon?'claimed':'none');
 const rows=(await f.db.query('SELECT * FROM offer_redemptions WHERE order_id=$1',[id])).rows;
 if(current.coupon){assert.equal(rows.length,1);assert.equal(rows[0].code,current.coupon);assert.equal(rows[0].phone,current.phone);assert.equal(rows[0].email,current.email);assert.equal(rows[0].id,claim.redemptionId);}
 else assert.equal(rows.length,0);
 return claim;
}
async function refused(f,call,reasons=['coupon-review']){
 const initial=await snapshot(f.db),result=await call();assert.equal(result.ok,false);assert.ok(reasons.includes(result.reason),result.reason);
 assert.deepEqual(await snapshot(f.db),f.expected??initial);assert.equal(f.deferred.length,0);return result;
}
test('none→B creates one exact modern record, counter and private marker with no copied contact data',()=>fixture(async f=>{
 const id=await seedOrder(db);const result=await f.editAndNotify({orderId:id,expectSeq:0,coupon:'SYNTH-B'});assert.equal(result.ok,true);assert.equal(await used(db,'SYNTH-B'),1);const state=await aligned(f,id);assert.equal(state.offerId,2);assert.equal(f.deferred.length,1);
 const event=(await db.query('SELECT note FROM order_events WHERE actor=$1',[CLAIM_ACTOR])).rows[0];assert.deepEqual(Object.keys(JSON.parse(event.note)).sort(),['editSeq','offerId','protocol','redemptionId','state','version']);
}));
test('modern A→B atomically returns A and spends B; repeated unchanged save is a no-op',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});assert.equal((await f.editOrder({orderId:id,expectSeq:0,coupon:'SYNTH-B'})).ok,true);
 assert.equal(await used(db,'SYNTH-A'),0);assert.equal(await used(db,'SYNTH-B'),1);assert.equal((await aligned(f,id)).offerId,2);
 const saved=await snapshot(db);assert.equal((await f.editOrder({orderId:id,expectSeq:1,coupon:'SYNTH-B',lines:[{id:1,qty:1}]})).changed,false);assert.deepEqual(await snapshot(db),saved);
}));
test('modern A→none releases once; cancellation after removal cannot return A twice',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});assert.equal((await f.editOrder({orderId:id,coupon:''})).ok,true);await aligned(f,id);assert.equal(await used(db,'SYNTH-A'),0);
 assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,true);assert.equal(await used(db,'SYNTH-A'),0);assert.equal((await db.query('SELECT stock FROM products')).rows[0].stock,21);
 const saved=await snapshot(db);assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,false);assert.deepEqual(await snapshot(db),saved);
}));
test('modern phone move preserves agreed money/global count and moves exact record/marker',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query("UPDATE offers SET active=false,ends_at=now()-interval '1 day',discount_value=1 WHERE id=1");
 const result=await f.editOrder({orderId:id,contact:{phone:'01000000001'}});assert.equal(result.ok,true);assert.equal((await order(db,id)).total,'120.00');assert.equal((await order(db,id)).discount,'10.00');assert.equal(await used(db,'SYNTH-A'),1);await aligned(f,id);
 assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,true);assert.equal(await used(db,'SYNTH-A'),0);assert.equal((await readClaimState(f.sql,await order(db,id))).kind,'none');
}));
test('same normalized phone, unchanged submitted quantities and same code do not reprice or allocate a slot',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:false,discount:10});await db.query('DELETE FROM offers WHERE id=1');const saved=await snapshot(db);
 const result=await f.editOrder({orderId:id,coupon:'SYNTH-A',lines:[{id:1,qty:1}],contact:{phone:'+20 100 000 0000'}});assert.equal(result.ok,true);assert.equal(result.changed,false);assert.deepEqual(await snapshot(db),saved);
}));
test('address/city/notes preserve grandfathered money with deleted legacy offer and inconsistent ledger',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',discount:10});await db.query('DELETE FROM offers WHERE id=1');await db.query('DELETE FROM offer_redemptions');
 const result=await f.editOrder({orderId:id,contact:{address:'Corrected synthetic address',city:'Giza',notes:'Synthetic delivery note'}});assert.equal(result.ok,true);assert.equal((await order(db,id)).total,'120.00');assert.equal((await order(db,id)).discount,'10.00');assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_redemptions')).rows[0].n,0);
}));
for(const change of [{coupon:'SYNTH-B'},{coupon:''},{contact:{phone:'01000000001'}},{lines:[{id:1,qty:2}]}])test('legacy coupon-sensitive '+JSON.stringify(change)+' refuses without adopting provenance',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',discount:10});await refused(f,()=>f.editAndNotify({orderId:id,...change}));
}));
for(const [name,mutation]of [
 ['missing',"DELETE FROM offer_redemptions"],
 ['duplicate',"INSERT INTO offer_redemptions(code,order_id,phone,email,slot) VALUES('SYNTH-A',1,'01000000000','synthetic@example.invalid',1)"],
 ['wrong phone',"UPDATE offer_redemptions SET phone='01000000001'"],
 ['wrong code',"UPDATE offer_redemptions SET code='SYNTH-B'"],
 ['future marker',`INSERT INTO order_events(order_id,kind,actor,note) VALUES(1,'edit','${CLAIM_ACTOR_PREFIX}v2','{}')`],
])test('modern '+name+' history refuses coupon-sensitive edit unchanged',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.exec(mutation);await refused(f,()=>f.editOrder({orderId:id,coupon:'SYNTH-B'}));
}));
test('phone cap counts other modern claims and refuses the whole move without a second global spend',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await seedOrder(db,{coupon:'SYNTH-A',managed:true,phone:'01000000001',ref:'SYNTH-OTHER',discount:10});await db.query('UPDATE offers SET per_customer=1 WHERE id=1');await refused(f,()=>f.editOrder({orderId:id,contact:{phone:'01000000001'}}),['coupon-spent']);
}));
test('same claim can fill total/phone caps while a basket edit requotes exactly once',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('UPDATE offers SET max_uses=1,per_customer=1 WHERE id=1');assert.equal((await f.editOrder({orderId:id,lines:[{id:1,qty:2}]})).ok,true);assert.equal(await used(db,'SYNTH-A'),1);assert.equal((await order(db,id)).discount,'20.00');assert.equal((await aligned(f,id)).editSeq,0);
 assert.equal((await f.editOrder({orderId:id,contact:{phone:'01000000001'}})).ok,true);await aligned(f,id);
}));
test('original ID survives a code rename for phone-cap counting and cancellation',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query("UPDATE offers SET code='SYNTH-RENAMED',per_customer=1 WHERE id=1");
 assert.equal((await claimUsage(f.sql,{offerId:1,code:'SYNTH-RENAMED',phone:'01000000000'}))[0].n,1);
 const response=await f.checkout.POST(f.checkout.request({coupon:'SYNTH-RENAMED'}));assert.equal(response.status,422);
 assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,true);assert.equal(await used(db,'SYNTH-RENAMED'),0);
}));
test('deleted modern generation may cancel or swap without decrementing same-code replacement',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.exec("DELETE FROM offers WHERE id=1; INSERT INTO offers(code,discount_value,used_count,max_uses,per_customer) VALUES('SYNTH-A',1,7,10,2)");
 assert.equal((await f.editOrder({orderId:id,coupon:'SYNTH-B'})).ok,true);assert.equal(await used(db,'SYNTH-A'),7);assert.equal(await used(db,'SYNTH-B'),1);
 assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,true);assert.equal(await used(db,'SYNTH-A'),7);assert.equal(await used(db,'SYNTH-B'),0);
}));
test('deleted original modern generation refuses phone/requote but address correction remains available',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('DELETE FROM offers WHERE id=1');await refused(f,()=>f.editOrder({orderId:id,contact:{phone:'01000000001'}}));await refused(f,()=>f.editOrder({orderId:id,lines:[{id:1,qty:2}]}));assert.equal((await f.editOrder({orderId:id,contact:{address:'Corrected synthetic address'}})).ok,true);
 assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,true);assert.equal((await readClaimState(f.sql,await order(db,id))).kind,'none');
}));
test('legacy cancellation returns physical stock and only order-owned ledger; unknown counter stays for explicit private review',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',discount:10});await seedOrder(db,{coupon:'SYNTH-B',managed:true,ref:'SYNTH-OTHER',phone:'01000000002',discount:25});
 const result=await f.transitionAndNotify({orderId:id,to:'cancelled'});assert.equal(result.ok,true);assert.equal(result.couponReviewNeeded,true);assert.equal(await used(db,'SYNTH-A'),1);assert.equal((await order(db,id)).coupon,'SYNTH-A');assert.equal((await order(db,id)).discount,'10.00');assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_redemptions WHERE order_id=$1',[id])).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_redemptions WHERE order_id=2')).rows[0].n,1);assert.equal(f.deferred.length,1);assert.equal((await db.query("SELECT count(*)::int AS n FROM order_events WHERE kind='note' AND note LIKE 'Coupon history needs owner review%' ")).rows[0].n,1);
 const saved=await snapshot(db);assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,false);assert.deepEqual(await snapshot(db),saved);
}));
test('known modern existing generation with zero counter cancels with a private review',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('UPDATE offers SET used_count=0 WHERE id=1');const result=await f.transitionAndNotify({orderId:id,to:'cancelled'});assert.equal(result.ok,true);assert.equal(result.couponReviewNeeded,true);assert.equal(await used(db,'SYNTH-A'),0);assert.equal((await order(db,id)).status,'cancelled');assert.equal((await db.query('SELECT stock FROM products')).rows[0].stock,21);assert.equal((await readClaimState(f.sql,await order(db,id))).kind,'none');assert.equal(f.deferred.length,1);
}));
for(const [name,change]of [
 ['ID replacement',"DELETE FROM offers WHERE id=2; INSERT INTO offers(code,discount_value,min_total,max_uses,per_customer) VALUES('SYNTH-B',1,100000,1,2)"],
 ['value',"UPDATE offers SET discount_value=1 WHERE id=2"],['type',"UPDATE offers SET discount_type='fixed' WHERE id=2"],['minimum',"UPDATE offers SET min_total=50 WHERE id=2"],
 ['per-phone policy',"UPDATE offers SET per_customer=1 WHERE id=2"],['expiry',"UPDATE offers SET ends_at=now()-interval '1 second' WHERE id=2"],['start',"UPDATE offers SET starts_at=now()+interval '1 hour' WHERE id=2"],['total cap',"UPDATE offers SET max_uses=0 WHERE id=2"],
 ['inactive',"UPDATE offers SET active=false WHERE id=2"],
])test('new quote '+name+' change between read and write rolls back all old/new effects',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});f.setBeforeTransaction(()=>db.exec(change));await refused(f,()=>f.editAndNotify({orderId:id,coupon:'SYNTH-B',lines:[{id:1,qty:2}]}),['coupon-invalid','coupon-spent']);
}));
test('stock failure with valid quote returns stock refusal and preserves old claim',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});f.setBeforeTransaction(()=>db.query('UPDATE products SET stock=0'));await refused(f,()=>f.editOrder({orderId:id,coupon:'SYNTH-B',lines:[{id:1,qty:2}]}),['no-stock']);
}));
test('slot integer exhaustion is a bounded whole-transaction conflict, never a partial claim',()=>fixture(async f=>{
 const id=await seedOrder(db);await seedOrder(db,{coupon:'SYNTH-B',managed:true,ref:'SYNTH-OTHER',discount:25});await db.query("UPDATE offer_redemptions SET slot=2147483647 WHERE code='SYNTH-B'");await refused(f,()=>f.editOrder({orderId:id,coupon:'SYNTH-B'}),['conflict']);
}));
test('uncapped checkout writes durable provenance; replay returns original without another marker/mail',()=>fixture(async f=>{
 await db.query('UPDATE offers SET per_customer=NULL,max_uses=NULL WHERE id=1');const first=await f.checkout.POST(f.checkout.request()),reply=await first.json();assert.equal(first.status,200);assert.equal((await readClaimState(f.sql,await order(db,1))).kind,'claimed');const saved=await snapshot(db);const replay=await f.checkout.POST(f.checkout.request());assert.deepEqual(await replay.json(),reply);assert.deepEqual(await snapshot(db),saved);assert.equal(f.checkout.deferred.length,1);
}));
test('new generation checkout excludes proven old generation and legacy current-code counts stay conservative',()=>fixture(async f=>{
 await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.exec("DELETE FROM offers WHERE id=1; INSERT INTO offers(code,discount_value,per_customer,max_uses) VALUES('SYNTH-A',10,1,10)");
 assert.equal((await f.checkout.POST(f.checkout.request())).status,200);assert.equal(await used(db,'SYNTH-A'),1);
}));
test('reserved prefix cannot be written by generic logEvent and is absent from admin projection',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query("INSERT INTO order_events(order_id,kind,actor,note) VALUES($1,'edit',$2,'malformed future')",[id,CLAIM_ACTOR_PREFIX+'v999']);
 const before=f.sql.calls.length;assert.equal(await f.logEvent({orderId:id,kind:'note',actor:CLAIM_ACTOR_PREFIX+'v999',note:'synthetic forged note'}),false);assert.equal(f.sql.calls.length,before);assert.equal((await f.eventsFor(id)).some(e=>e.actor.startsWith(CLAIM_ACTOR_PREFIX)),false);assert.equal((await readClaimState(f.sql,await order(db,id))).kind,'review');
}));
test('legacy current-code phone history is counted conservatively without adopting its generation',()=>fixture(async f=>{
 await seedOrder(db,{coupon:'SYNTH-A',discount:10});await db.exec("DELETE FROM offers WHERE id=1; INSERT INTO offers(code,discount_value,per_customer,max_uses) VALUES('SYNTH-A',10,1,10)");
 const saved=await snapshot(db);assert.equal((await f.checkout.POST(f.checkout.request())).status,422);assert.deepEqual(await snapshot(db),saved);
}));
test('latest reserved marker is checked again after order serialization, never inferred from the pre-read',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});f.setBeforeTransaction(()=>db.query("INSERT INTO order_events(order_id,kind,actor,note) VALUES($1,'edit',$2,'unknown future')",[id,CLAIM_ACTOR_PREFIX+'v2']));
 await refused(f,()=>f.editOrder({orderId:id,coupon:'SYNTH-B'}));
}));
test('same-claim repricing terms cannot drift between read and write',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});f.setBeforeTransaction(()=>db.query('UPDATE offers SET discount_value=1 WHERE id=1'));await refused(f,()=>f.editOrder({orderId:id,lines:[{id:1,qty:2}]}),['conflict']);
}));
test('new admin claim window boundaries are inclusive at transaction time',()=>fixture(async f=>{
 const id=await seedOrder(db);f.setAfterStatement(async(statement,index)=>{if(index===0)await db.query('UPDATE offers SET starts_at=now(),ends_at=now() WHERE id=2');});
 assert.equal((await f.editOrder({orderId:id,coupon:'SYNTH-B'})).ok,true);await aligned(f,id);
}));
test('slot gaps allocate max slot plus one while the cap counts records',()=>fixture(async f=>{
 const id=await seedOrder(db);await seedOrder(db,{coupon:'SYNTH-B',managed:true,ref:'SYNTH-OTHER',discount:25});await db.query('UPDATE offer_redemptions SET slot=8');
 assert.equal((await f.editOrder({orderId:id,coupon:'SYNTH-B'})).ok,true);assert.equal((await db.query('SELECT slot FROM offer_redemptions WHERE order_id=$1',[id])).rows[0].slot,9);
}));
for(const counter of [0,7])test('legacy cancel never decrements a preexisting recreated same-code counter '+counter,()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',discount:10});await db.query('DELETE FROM offers WHERE id=1');await db.query("INSERT INTO offers(code,used_count) VALUES('SYNTH-A',$1)",[counter]);assert.equal((await f.transition({orderId:id,to:'cancelled'})).couponReviewNeeded,true);assert.equal(await used(db,'SYNTH-A'),counter);assert.equal((await db.query('SELECT stock FROM products')).rows[0].stock,21);
}));
test('future-version latest marker uses bounded legacy cancellation and cannot return older v1 generation',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query("INSERT INTO order_events(order_id,kind,actor,note) VALUES($1,'edit',$2,'{}')",[id,CLAIM_ACTOR_PREFIX+'v2']);
 assert.equal((await f.transition({orderId:id,to:'cancelled'})).couponReviewNeeded,true);assert.equal(await used(db,'SYNTH-A'),1);
}));
test('every generic writer rejects the reserved prefix and actual customer SQL excludes all marker/internal notes',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});const before=f.sql.calls.length;
 assert.equal((await f.editOrder({orderId:id,actor:CLAIM_ACTOR_PREFIX+'v2',contact:{notes:'synthetic'}})).reason,'bad-input');assert.equal((await f.transition({orderId:id,to:'confirmed',actor:CLAIM_ACTOR_PREFIX+'v2'})).reason,'bad-input');assert.equal(f.sql.calls.length,before);
 await db.query("INSERT INTO order_events(order_id,kind,actor,note,to_status) VALUES($1,'status','admin:1','private synthetic','confirmed'),($1,'note','system','private review','')",[id]);
 const timeline=await customerTimeline(f.sql),rows=await timeline(id);assert.equal(rows.length,1);assert.equal(rows[0].note,'');assert.equal(Object.hasOwn(rows[0],'actor'),false);assert.equal(JSON.stringify(rows).includes('offerId'),false);
}));
test('no-coupon basket/contact/cancel preserve ordinary behavior and never spend an offer',()=>fixture(async f=>{
 const id=await seedOrder(db);assert.equal((await f.editOrder({orderId:id,lines:[{id:1,qty:2}]})).ok,true);assert.equal((await order(db,id)).total,'230.00');assert.equal((await f.editOrder({orderId:id,contact:{phone:'01000000001'}})).ok,true);assert.equal((await f.transition({orderId:id,to:'cancelled'})).ok,true);assert.deepEqual((await db.query('SELECT used_count FROM offers ORDER BY id')).rows.map(r=>r.used_count),[0,0]);assert.equal((await db.query('SELECT count(*)::int AS n FROM offer_redemptions')).rows[0].n,0);
}));
test('a stale sequence refuses before any ledger or notification write',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});assert.equal((await f.editOrder({orderId:id,contact:{address:'Corrected synthetic address'}})).ok,true);const saved=await snapshot(db);assert.equal((await f.editAndNotify({orderId:id,expectSeq:0,coupon:'SYNTH-B'})).reason,'stale');assert.deepEqual(await snapshot(db),saved);assert.equal(f.deferred.length,0);
}));
test('actual cancel API preserves modern nonpositive cancellation and hides private review metadata',()=>fixture(async f=>{
 await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query('UPDATE offers SET used_count=0 WHERE id=1');
 const cancel=await cancelModule(db,f.transitionAndNotify,f.canSelfCancel),response=await cancel.POST(cancel.request()),body=await response.json();assert.equal(response.status,200);assert.deepEqual(body,{ok:true,status:'cancelled',from:'new'});assert.equal((await db.query('SELECT used_count FROM offers WHERE id=1')).rows[0].used_count,0);assert.equal(f.deferred.length,1);assert.equal(cancel.deferred.length,1);
}));
test('actual legacy cancel API succeeds without exposing review/provenance and defers both notifications',()=>fixture(async f=>{
 await seedOrder(db,{coupon:'SYNTH-A',discount:10});const cancel=await cancelModule(db,f.transitionAndNotify,f.canSelfCancel),response=await cancel.POST(cancel.request()),body=await response.json();assert.equal(response.status,200);assert.deepEqual(body,{ok:true,status:'cancelled',from:'new'});assert.equal(Object.hasOwn(body,'couponReviewNeeded'),false);assert.equal(f.deferred.length,1);assert.equal(cancel.deferred.length,1);assert.equal(await used(db,'SYNTH-A'),1);
}));
test('retention-redacted identities refuse claim edits and address correction never resurrects ledger contact data',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.query("UPDATE orders SET phone='',email='' WHERE id=$1",[id]);await refused(f,()=>f.editOrder({orderId:id,contact:{phone:'01000000001'}}));
 assert.equal((await f.editOrder({orderId:id,contact:{address:'Corrected synthetic address'}})).ok,true);const current=await order(db,id);assert.equal(current.phone,'');assert.equal(current.email,'');const markers=(await db.query('SELECT note FROM order_events WHERE actor=$1',[CLAIM_ACTOR])).rows;assert.equal(JSON.stringify(markers).includes('synthetic@example.invalid'),false);
}));
test('malformed latest canonical text and duplicate order claims never exclude legacy-conservative counts',()=>fixture(async f=>{
 const id=await seedOrder(db,{coupon:'SYNTH-A',managed:true,discount:10});await db.exec("DELETE FROM offers WHERE id=1; INSERT INTO offers(code,per_customer) VALUES('SYNTH-A',1)");
 const latest=(await db.query('SELECT note FROM order_events WHERE actor=$1',[CLAIM_ACTOR])).rows[0].note;await db.query("INSERT INTO order_events(order_id,kind,actor,note) VALUES($1,'edit',$2,$3)",[id,CLAIM_ACTOR,latest+'\n']);assert.equal((await claimUsage(f.sql,{offerId:3,code:'SYNTH-A',phone:'01000000000'}))[0].n,1);
 await db.query('DELETE FROM order_events WHERE id=(SELECT max(id) FROM order_events)');await db.query("INSERT INTO offer_redemptions(code,order_id,phone,email,slot) VALUES('OTHER',1,'01000000000','synthetic@example.invalid',0)");assert.equal((await claimUsage(f.sql,{offerId:3,code:'SYNTH-A',phone:'01000000000'}))[0].n,1);
}));
