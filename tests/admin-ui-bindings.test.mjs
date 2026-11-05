import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core');
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.js')?[path.join(dir,e.name)]:[]);
test('admin JSX component references have a declared binding, including feedback branches',()=>{
  const missing=[];
  for(const file of files(fileURLToPath(new URL('../app/admin/',import.meta.url)))){
    const ast=babel.parseSync(readFileSync(file,'utf8'),{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}}),bound=new Set(),used=new Set();
    const bind=n=>{if(!n||typeof n!=='object')return;if(n.type==='Identifier')bound.add(n.name);else if(n.type==='ObjectPattern')n.properties.forEach(p=>bind(p.value??p.argument));else if(n.type==='ArrayPattern')n.elements.forEach(bind);else if(n.type==='AssignmentPattern')bind(n.left);else if(n.type==='RestElement')bind(n.argument);};
    const visit=n=>{if(!n||typeof n!=='object')return;
      if(n.type==='ImportDeclaration')n.specifiers.forEach(s=>bind(s.local));
      if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)){bind(n.id);n.params.forEach(bind);}
      if(['VariableDeclarator','ClassDeclaration'].includes(n.type))bind(n.id);
      if(n.type==='JSXOpeningElement'&&n.name.type==='JSXIdentifier'&&/^[A-Z]/.test(n.name.name))used.add(n.name.name);
      for(const [key,value]of Object.entries(n)){if(['loc','comments','leadingComments','trailingComments','innerComments'].includes(key))continue;if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}
    };visit(ast);for(const name of used)if(!bound.has(name))missing.push({file:path.relative(process.cwd(),file),name});
  }
  assert.deepEqual(missing,[]);
});
