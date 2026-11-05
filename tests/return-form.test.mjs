import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),swc=require('next/dist/build/swc');
const source=await readFile(new URL('../app/admin/(panel)/returns/[id]/page.js',import.meta.url),'utf8');
const code=await swc.transform(source+'\nexport {move as testMove};',{filename:'ReturnCase.js',jsc:{target:'es2022',parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const redirect=url=>{throw Object.assign(new Error('redirect'),{url});};
let calls=[],ownerChecks=0;
const module={exports:{}};
new vm.Script(code.code).runInNewContext({module,exports:module.exports,require(id){
 if(id.startsWith('react/'))return require(id);
 if(id==='next/link')return ({children,...props})=>React.createElement('a',props,children);
 if(id==='next/navigation')return {redirect,notFound:()=>{throw Error('not found');}};
 if(id.endsWith('/locale-server.js'))return {localizedAdminMetadata:v=>v};
 if(id.endsWith('/locale.js'))return {AdminText:({text})=>text,AdminFormat:({value})=>String(value??''),AdminActor:({value})=>value};
 if(id.endsWith('/guard.js'))return {requireOwner:async()=>{ownerChecks++;return {id:1};}};
 if(id.endsWith('/auth.js'))return {csrfToken:async()=>'synthetic-only',csrfOk:async sent=>sent==='synthetic-only'};
 if(id.endsWith('/ui.js'))return {Flash:()=>null};
 if(id.endsWith('/operations.js'))return {finishOperation:async(url,run)=>{await run();redirect(url+'?m=ops_saved');}};
 if(id.endsWith('/admin-operations.mjs'))return {moveReturn:async(sql,input,actor)=>{calls.push({input,actor});return {ok:true};}};
 if(id.endsWith('/db.js'))return {sql:async strings=>strings.join('').includes('SELECT r.*,o.ref')?[{id:1,order_id:1,ref:'100001',state:'requested',version:0,reason:'Synthetic reason',refund_amount:0}]:[]};
 throw Error('Unexpected return dependency '+id);
},Number,Object,FormData});

test('the real approval form carries its action without a named submitter; owner and CSRF checks remain at the boundary',async()=>{
 const html=renderToStaticMarkup(await module.exports.default({params:Promise.resolve({id:'1'}),searchParams:Promise.resolve({})}));
 const form=(html.match(/<form\b[\s\S]*?<\/form>/g)??[]).find(f=>f.includes('Approve return'));assert.ok(form);
 const data=new FormData();
 for(const input of form.match(/<input\b[^>]*>/g)??[]){const name=input.match(/\bname="([^"]*)"/)?.[1],value=input.match(/\bvalue="([^"]*)"/)?.[1];if(name)data.append(name,value??'');}
 assert.equal(data.get('to'),'approved');
 calls=[];ownerChecks=0;
 await assert.rejects(module.exports.testMove(data),e=>e.url==='/admin/returns/1?m=ops_saved');
 assert.equal(ownerChecks,1);assert.equal(calls.length,1);assert.equal(calls[0].input.to,'approved');assert.equal(calls[0].actor,'admin:1');
 data.set('_csrf','invalid-synthetic');calls=[];
 await assert.rejects(module.exports.testMove(data),e=>e.url==='/admin/returns?m=csrf');assert.equal(calls.length,0);
});
