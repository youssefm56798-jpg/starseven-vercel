import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {AR} from '../lib/admin-ar.mjs';
import {adminLanguage,adminTranslate,adminFormat,adminTitle} from '../lib/admin-copy.mjs';
const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core');
const root=new URL('../app/admin/',import.meta.url);
const files=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):e.name.endsWith('.js')?[path.join(d,e.name)]:[]);
test('all explicit admin copy has Arabic coverage, while domain inputs stay unchanged',()=>{
  const missing=[];
  for(const file of files(root.pathname.replace(/^\/([A-Za-z]:)/,'$1'))){
    if(file.endsWith(path.sep+'locale.js'))continue;
    const source=readFileSync(file,'utf8'),ast=babel.parseSync(source,{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}});
    const visit=n=>{if(!n||typeof n!=='object')return;
      if(n.type==='JSXOpeningElement'&&n.name.name==='AdminText'){
        const a=n.attributes.find(a=>a.name?.name==='text');if(a?.value?.type==='StringLiteral'&&!Object.hasOwn(AR,a.value.value))missing.push(a.value.value);
      }
      if(n.type==='JSXText'&&/[A-Za-z]{2}/.test(n.value))missing.push(n.value.trim());
      for(const [k,v]of Object.entries(n)){if(['loc','comments','leadingComments','trailingComments','innerComments'].includes(k))continue;if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}
    };visit(ast);
  }
  assert.deepEqual([...new Set(missing)],[]);
  assert.equal(adminTranslate('en','Orders'),'Orders');assert.equal(adminTranslate('ar','Orders'),'الطلبات');
  assert.equal(adminTranslate('ar','SYNTH-ORDER-001'),'SYNTH-ORDER-001');assert.equal(adminLanguage('fr'),'en');
  for(const key of ['Yes','No','percent','fixed','none','requested','approved','received','refunded','closed','rejected','resellable','damaged','opened'])assert.notEqual(adminTranslate('ar',key),key,key+' needs a translation');
});
test('Arabic dynamic messages preserve interpolation and dates use Cairo in both languages',()=>{
  assert.equal(adminTranslate('ar','Include order {0}',['123']),'تضمين الطلب 123');
  assert.equal(adminTranslate('ar','Row 4: use four columns.'),'الصف 4: استخدم أربعة أعمدة.');
  assert.match(adminFormat('en','2026-11-03T23:30:00Z','dt'),/4 Nov/);
  assert.match(adminFormat('ar','2026-11-03T23:30:00Z','dt'),/٤ نوفمبر/);
  assert.equal(adminFormat('ar','invalid','dt'),'—');
  const title='Offers \u2014 Star Seven admin';
  assert.equal(adminTitle('ar',title),AR[title]);
  assert.equal(adminTitle('en',AR[title]),title);
});
