import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLAIM_ACTOR,CLAIM_ACTOR_PREFIX,CLAIM_PROTOCOL,parseClaimEvent,claimStateFor} from '../lib/coupon-claims.mjs';
const state=()=>({protocol:CLAIM_PROTOCOL,version:1,state:'claimed',offerId:7,redemptionId:11,editSeq:0});
const event=payload=>({id:21,kind:'edit',actor:CLAIM_ACTOR,note:JSON.stringify(payload??state())});
const order=()=>({id:5,edit_seq:2,coupon:'SYNTH',phone:'01000000000',email:'synthetic@example.invalid'});
const row=()=>({id:11,order_id:5,code:'SYNTH',phone:'01000000000',email:'synthetic@example.invalid'});
test('reserved marker validates exact version/state/keys and contains no copied contact fields',()=>{
 const parsed=parseClaimEvent(event());assert.equal(parsed.offerId,7);assert.equal(parsed.redemptionId,11);assert.equal(parsed.eventId,21);
 for(const patch of [{protocol:'other'},{version:2},{state:'other'},{offerId:0},{offerId:1.5},{offerId:'7'},{offerId:2147483648},{redemptionId:-1},{editSeq:-1},{phone:'synthetic'}])assert.equal(parseClaimEvent(event({...state(),...patch})),null);
 assert.equal(parseClaimEvent({...event(),kind:'note'}),null);assert.equal(parseClaimEvent({...event(),actor:'admin:1'}),null);assert.equal(parseClaimEvent({...event(),note:'not json'}),null);
});
test('a matching modern claim uses durable ID regardless of any current same-code offer row',()=>{
 const result=claimStateFor(order(),event(),[row()]);assert.equal(result.kind,'claimed');assert.equal(result.offerId,7);assert.equal(result.redemptionId,11);
});
test('matching legacy counts/records or old offer timestamps never establish generation identity',()=>{
 assert.equal(claimStateFor({...order(),offer_id:7,offer_created_at:'2020-01-01'},null,[row()]).kind,'review');
});
test('latest malformed/wrong-version/future-sequence marker never falls back to prior history',()=>{
 for(const current of [{...event(),note:'broken'},event({...state(),version:2}),event({...state(),editSeq:3}),{...event(),actor:CLAIM_ACTOR_PREFIX+'v2'}])assert.equal(claimStateFor(order(),current,[row()]).kind,'review');
});
test('released terminal order may retain historical coupon/money with no active claim',()=>{
 const released=event({protocol:CLAIM_PROTOCOL,version:1,state:'released',editSeq:2});
 assert.deepEqual(claimStateFor({...order(),status:'cancelled'},released,[]),{kind:'none',eventId:21});
 assert.equal(claimStateFor({...order(),status:'new'},released,[]).kind,'review');
 assert.equal(claimStateFor({...order(),status:'cancelled'},released,[row()]).kind,'review');
});
test('missing/duplicate/mismatched modern ledger records refuse review without repair',()=>{
 for(const rows of [[],[row(),{...row(),id:12}],[{...row(),id:12}],[{...row(),code:'OTHER'}],[{...row(),phone:'01000000001'}],[{...row(),email:'other@example.invalid'}],[{...row(),order_id:6}]])assert.equal(claimStateFor(order(),event(),rows).kind,'review');
});
test('normalized identity spelling preserves the same claim without copying phone/email into marker',()=>{
 assert.equal(claimStateFor({...order(),phone:'+20 100 000 0000'},event(),[row()]).kind,'claimed');
 assert.equal(Object.hasOwn(parseClaimEvent(event()),'phone'),false);assert.equal(Object.hasOwn(parseClaimEvent(event()),'email'),false);
});
test('no-coupon starts only with no ledger and no current claimed marker',()=>{
 const empty={...order(),coupon:''};assert.deepEqual(claimStateFor(empty,null,[]),{kind:'none',eventId:null});
 assert.equal(claimStateFor(empty,null,[row()]).kind,'review');assert.equal(claimStateFor(empty,event(),[]).kind,'review');
 const released=event({protocol:CLAIM_PROTOCOL,version:1,state:'released',editSeq:2});assert.deepEqual(claimStateFor(empty,released,[]),{kind:'none',eventId:21});
 assert.equal(parseClaimEvent(event({protocol:CLAIM_PROTOCOL,version:1,state:'released',editSeq:2,offerId:7})),null);
});
