#!/usr/bin/env node
// Default/help and verify never import the DB. Only explicit prepare queries.
import {readFile,writeFile,mkdir,rename,unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CatalogueBuildError,catalogueSiteOrigin,prepareCatalogueManifest,verifyCatalogueBuild,validateManifest} from '../lib/catalog-build-guard.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function localPath(value){
 if(typeof value!=='string'||value.includes('://')||value.startsWith('\\\\'))throw new CatalogueBuildError('CATALOGUE_ARGUMENT_PATH_REFUSED');
 const resolved=path.resolve(root,value);if(!resolved.startsWith(path.resolve(root)+path.sep))throw new CatalogueBuildError('CATALOGUE_ARGUMENT_PATH_REFUSED');return resolved;
}
async function noReparse(file){
 let cursor=file;
 while(true){try{if((await lstat(cursor)).isSymbolicLink())throw new CatalogueBuildError('CATALOGUE_ARGUMENT_REPARSE_REFUSED');}catch(error){if(error.code!=='ENOENT')throw error;}if(cursor===path.resolve(root))break;cursor=path.dirname(cursor);}
}
export async function runCatalogueGuard(argv=process.argv.slice(2)){
 const mode=argv.shift();
 if(!mode||mode==='--help'){console.log(JSON.stringify({status:'usage',commands:['prepare','verify'],defaultQuery:false}));return;}
 if(!['prepare','verify'].includes(mode))throw new CatalogueBuildError('CATALOGUE_MODE_REFUSED');
 const options={manifest:'.vercel/catalogue-source-manifest.json',buildDir:'.next',siteOrigin:process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,'')};
 const names={'--manifest':'manifest','--build-dir':'buildDir','--site-origin':'siteOrigin'};
 const seen=new Set();
 while(argv.length){const key=argv.shift();if(!names[key]||seen.has(key)||!argv.length)throw new CatalogueBuildError('CATALOGUE_ARGUMENT_REFUSED');seen.add(key);options[names[key]]=argv.shift();}
 options.siteOrigin=catalogueSiteOrigin(options.siteOrigin);
 const manifestFile=localPath(options.manifest),buildDir=localPath(options.buildDir);
 if(path.dirname(manifestFile)!==path.resolve(root,'.vercel')||! /^catalogue-source-manifest(?:-[a-z0-9-]+)?\.json$/.test(path.basename(manifestFile)))throw new CatalogueBuildError('CATALOGUE_MANIFEST_PATH_REFUSED');
 await noReparse(manifestFile);await noReparse(buildDir);
 if(mode==='prepare'){
  let sql;try{({sql}=await import('../lib/db.js'));}catch{throw new CatalogueBuildError('CATALOGUE_SOURCE_QUERY_FAILED');}
  const manifest=await prepareCatalogueManifest(sql,{siteOrigin:options.siteOrigin});
  await mkdir(path.dirname(manifestFile),{recursive:true});await noReparse(manifestFile);
  const temporary=manifestFile+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});await rename(temporary,manifestFile);}finally{await unlink(temporary).catch(()=>{});}
  console.log(JSON.stringify({status:'catalogue-source-manifest-prepared',products:manifest.products.length,publishedArticleRows:manifest.articles.length,manifestDigest:manifest.digest,readOnly:true,queries:1}));
 }else{
  let manifest;try{const info=await lstat(manifestFile);if(!info.isFile()||info.size>8*1024*1024)throw new Error();manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch{throw new CatalogueBuildError('CATALOGUE_MANIFEST_FILE_REFUSED');}
  validateManifest(manifest);console.log(JSON.stringify(await verifyCatalogueBuild({manifest,buildDir})));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await runCatalogueGuard();}catch(error){console.error(JSON.stringify({status:'stopped',code:error instanceof CatalogueBuildError?error.code:'CATALOGUE_OPERATION_FAILED',...(error instanceof CatalogueBuildError&&error.route?{route:error.route}:{})}));process.exitCode=1;}
}
