import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {manifestFromRow,validateManifest,expectedCatalogue,prepareCatalogueManifest,verifyCatalogueBuild,safeSlug} from '../lib/catalog-build-guard.mjs';
globalThis.fetch=async()=>{throw new Error('NO_NETWORK_IN_CATALOGUE_GUARD_TEST');};
const now=Date.now(),site='https://newstarseven.com';
function sourceRow(extra={}){return {project:'lingering-dream-59985926',branch:'br-wild-salad-b1hjooi1',database:'neondb',version_num:180006,read_only:'on',observed_at:new Date(now).toISOString(),products:[
 {id:1,sku:'SYNTH-A',slug:'wax-a',kind:'wax',featured:true,sort:20},
 {id:2,sku:'SYNTH-B',slug:'gel-wax-b',kind:'gelwax',featured:false,sort:0},
 {id:3,sku:'SYNTH-C',slug:'wax-c',kind:'wax',featured:true,sort:10},
 ],articles:[{slug:'guide-both',lang:'ar'},{slug:'guide-both',lang:'en'},{slug:'guide-en-only',lang:'en'}],...extra};}
const manifest=()=>manifestFromRow(sourceRow(),{now});
const loc=(route,lang)=>lang==='en'?(route==='/'?'/en':'/en'+route):route;
function cards(products,lang){return '<div class="grid">'+products.map(product=>`<div class="card"><a class="card-hit" href="${loc('/product/'+product.slug,lang)}"><h3>Synthetic public product</h3></a></div>`).join('')+'</div>';}
function page(route,m,{cardProducts,itemCount,canonical:forcedCanonical,extra=''}={}){
 const expected=expectedCatalogue(m,{now}),requested=route==='/en'||route.startsWith('/en/')?'en':'ar';
 const article=/^\/(?:en\/)?article\/([a-z0-9-]+)$/.exec(route);
 const available=article?expected.articles.filter(row=>row.slug===article[1]).map(row=>row.lang):null;
 const language=available?(available.includes(requested)?requested:available[0]):requested;
 const canonical=forcedCanonical||(article?loc('/article/'+article[1],language):route);
 let body=article?'<article class="article"><p>Synthetic article body.</p></article>':'',collection;
 if(route==='/'||route==='/en')body+=cards(cardProducts||expected.featured,requested);
 else if(route==='/shop'||route==='/en/shop'){const products=cardProducts||expected.products;body+=cards(products,requested);collection=products;}
 else{const category=/^\/(?:en\/)?shop\/([a-z0-9-]+)$/.exec(route);if(category){const kind=expected.categories.find(c=>c.slug===category[1]).kind;const products=cardProducts||expected.products.filter(p=>p.kind===kind);body+=cards(products,requested);collection=products;}}
 const jsonld=collection?`<script type="application/ld+json">${JSON.stringify({'@type':'CollectionPage',url:site+route,mainEntity:{'@type':'ItemList',numberOfItems:itemCount??collection.length,itemListElement:collection.map(p=>({url:site+loc('/product/'+p.slug,requested)}))}})}</script>`:'';
 return `<!doctype html><html><head><link rel="canonical" href="${site+canonical}"></head><body><div class="s7page" lang="${language}" dir="${language==='en'?'ltr':'rtl'}"><main id="content"><h1>Synthetic catalogue page</h1>${body}${jsonld}${extra}</main></div></body></html>`;
}
const htmlFile=(build,route)=>path.join(build,'server','app',(route==='/'?'index':route.slice(1))+'.html');
const sitemap=(paths,extra='')=>'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'+paths.map(route=>`<url><loc>${site+route}</loc></url>`).join('')+extra+'</urlset>';
async function fixture(t,m=manifest()){
 const folder=await mkdtemp(path.join(tmpdir(),'s7-catalogue-guard-')),build=path.join(folder,'.next');
 t.after(async()=>{
  const resolved=path.resolve(folder);
  assert.equal(path.dirname(resolved).toLowerCase(),path.resolve(tmpdir()).toLowerCase());
  assert.match(path.basename(resolved),/^s7-catalogue-guard-[a-zA-Z0-9]+$/);
  assert.equal((await realpath(resolved)).toLowerCase(),resolved.toLowerCase());
  await rm(resolved,{recursive:true,force:true});
 });
 const expected=expectedCatalogue(m,{now});await mkdir(path.join(build,'server','app'),{recursive:true});
 for(const route of expected.requiredPaths){const file=htmlFile(build,route);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,page(route,m));}
 await writeFile(path.join(build,'prerender-manifest.json'),JSON.stringify({version:4,routes:Object.fromEntries(expected.requiredPaths.map(route=>[route,{}]))}));
 await writeFile(path.join(build,'server','app','sitemap.xml.body'),sitemap(expected.sitemapPaths));
 return {build,m,expected};
}
const verify=f=>verifyCatalogueBuild({manifest:f.m,buildDir:f.build,now});

test('prepare performs exactly one fixed query through a READ ONLY repeatable-read transaction',async()=>{
 let calls=0;
 const sql={async transaction(callback,options){calls++;assert.equal(options.readOnly,true);assert.equal(options.isolationLevel,'RepeatableRead');const queries=callback((strings,...values)=>({query:strings.join(''),values}));assert.equal(queries.length,1);assert.equal(queries[0].values.length,0);assert.match(queries[0].query,/^\s*SELECT current_database/);assert.match(queries[0].query,/WHERE active=true/);assert.match(queries[0].query,/WHERE status='published'/);assert.doesNotMatch(queries[0].query,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|REVOKE)\b/);return [[sourceRow()]];}};
 const result=await prepareCatalogueManifest(sql,{now});assert.equal(calls,1);assert.equal(result.products.length,3);validateManifest(result,{now});
});
test('source/query failures and wrong identity are refused without echoing underlying secret-like input',async()=>{
 await assert.rejects(prepareCatalogueManifest({transaction(){throw new Error('postgresql://synthetic:DO_NOT_ECHO@invalid');}}),error=>error.message==='CATALOGUE_SOURCE_QUERY_FAILED'&&!JSON.stringify(error).includes('DO_NOT_ECHO'));
 for(const extra of [{project:'other'},{branch:'other'},{database:'other'},{version_num:170011},{read_only:'off'}])assert.throws(()=>manifestFromRow(sourceRow(extra),{now}),/CATALOGUE_SOURCE_IDENTITY_REFUSED/);
});
test('empty, duplicate, unsupported and stale source manifests fail closed',()=>{
 for(const extra of [{products:[]},{articles:[]},{products:[sourceRow().products[0],sourceRow().products[0]]},{articles:[{slug:'a',lang:'fr'}]},{observed_at:new Date(now-3600001).toISOString()}])assert.throws(()=>manifestFromRow(sourceRow(extra),{now}));
 const changed=structuredClone(manifest());changed.products.pop();assert.throws(()=>validateManifest(changed,{now}),/CATALOGUE_MANIFEST_DIGEST_REFUSED/);
});
test('unsafe slugs/site origins cannot become file paths or offsite catalogue URLs',()=>{
 for(const slug of ['../escape','%2e%2e','a/b','a\\b','https://example.invalid','x?y','x#y',' x','UPPER','a%2fb'])assert.throws(()=>safeSlug(slug),/CATALOGUE_UNSAFE_SLUG/);
 assert.throws(()=>manifestFromRow(sourceRow(),{now,siteOrigin:'https://unreviewed.invalid'}),/CATALOGUE_SITE_ORIGIN_REFUSED/);
});
test('actual filters preserve both product languages, mapped kinds and legitimate article translation fallback',async t=>{
 const f=await fixture(t),result=await verify(f);assert.equal(result.products,3);assert.equal(result.publishedArticleRows,3);assert.equal(result.publishedArticleSlugs,2);assert.equal(result.categories,2);
 assert.ok(f.expected.requiredPaths.includes('/article/guide-en-only'));assert.ok(f.expected.requiredPaths.includes('/en/article/guide-en-only'));
 assert.equal(f.expected.sitemapPaths.includes('/article/guide-en-only'),false);assert.ok(f.expected.sitemapPaths.includes('/en/article/guide-en-only'));
 assert.ok(f.expected.requiredPaths.includes('/shop/gel-wax'));assert.equal(f.expected.requiredPaths.includes('/shop/gelwax'),false);
});
test('a missing product prerender entry is rejected even when other build output exists',async t=>{
 const f=await fixture(t),file=path.join(f.build,'prerender-manifest.json'),data=JSON.parse(await readFile(file,'utf8'));delete data.routes['/product/wax-a'];await writeFile(file,JSON.stringify(data));
 await assert.rejects(verify(f),error=>error.code==='CATALOGUE_PRERENDER_ROUTE_MISSING'&&error.route==='/product/wax-a');
});
test('a pruned HTML file is rejected even if the prerender manifest advertises its route',async t=>{
 const f=await fixture(t);await rm(htmlFile(f.build,'/en/article/guide-both'));
 await assert.rejects(verify(f),/CATALOGUE_BUILD_FILE_MISSING/);
});
test('base-only sitemap and alternate-link-only dynamic URLs cannot pass',async t=>{
 const f=await fixture(t);const dynamic=f.expected.sitemapPaths.filter(route=>/^\/(?:en\/)?(?:product|article|shop)\//.test(route));
 await writeFile(path.join(f.build,'server/app/sitemap.xml.body'),sitemap(f.expected.sitemapPaths.filter(route=>!dynamic.includes(route)),dynamic.map(route=>`<url><xhtml:link href="${site+route}"/></url>`).join('')));
 await assert.rejects(verify(f),/CATALOGUE_SITEMAP_ROUTE_MISSING/);
});
test('an invented missing-translation sitemap URL is rejected',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.build,'server/app/sitemap.xml.body'),sitemap([...f.expected.sitemapPaths,'/article/guide-en-only']));
 await assert.rejects(verify(f),/CATALOGUE_SITEMAP_UNEXPECTED_DYNAMIC_ROUTE/);
});
test('fallback article canonical and rendered language follow the row that exists',async t=>{
 const f=await fixture(t);await writeFile(htmlFile(f.build,'/article/guide-en-only'),page('/article/guide-en-only',f.m,{canonical:'/article/guide-en-only'}));
 await assert.rejects(verify(f),/CATALOGUE_CANONICAL_MISMATCH/);
});
test('missing visible home cards cannot be replaced by anchors embedded inside script strings',async t=>{
 const f=await fixture(t),missing=f.expected.featured[0];
 await writeFile(htmlFile(f.build,'/'),page('/',f.m,{cardProducts:f.expected.featured.slice(1),extra:`<script>self.synthetic=${JSON.stringify(cards([missing],'ar'))}</script>`}));
 await assert.rejects(verify(f),/CATALOGUE_CARD_SET_MISMATCH/);
});
test('shop requires all active product cards and the actual ItemList count',async t=>{
 const f=await fixture(t);await writeFile(htmlFile(f.build,'/shop'),page('/shop',f.m,{itemCount:0}));await assert.rejects(verify(f),/CATALOGUE_ITEMLIST_MISMATCH/);
 await writeFile(htmlFile(f.build,'/shop'),page('/shop',f.m,{cardProducts:f.expected.products.slice(1)}));await assert.rejects(verify(f),/CATALOGUE_CARD_SET_MISMATCH/);
});
test('offsite product links cannot satisfy otherwise correct visible-card counts',async t=>{
 const f=await fixture(t),file=htmlFile(f.build,'/shop');
 await writeFile(file,(await readFile(file,'utf8')).replace('href="/product/gel-wax-b"','href="https://unreviewed.invalid/product/gel-wax-b"'));
 await assert.rejects(verify(f),/CATALOGUE_CARD_SET_MISMATCH/);
});
test('all ten current database kinds map to their real bilingual category slugs',async t=>{
 const mapping={wax:'wax',gel:'gel',gelwax:'gel-wax',cream:'cream-gel',clay:'clay-wax',pomade:'pomade',spray:'hair-spray',cologne:'cologne',shampoo:'shampoo',depilatory:'depilatory'};
 const products=Object.keys(mapping).map((kind,i)=>({id:i+1,sku:'SYNTH-KIND-'+i,slug:'kind-'+i,kind,featured:false,sort:i}));
 const m=manifestFromRow(sourceRow({products}),{now}),f=await fixture(t,m);
 assert.equal(f.expected.categories.length,10);
 for(const slug of Object.values(mapping))for(const prefix of ['', '/en'])assert.ok(f.expected.requiredPaths.includes(prefix+'/shop/'+slug));
 await verify(f);
});
test('home fallback requires first eight sorted active products without requiring the other active cards',async t=>{
 const products=Array.from({length:10},(_,i)=>({id:i+1,sku:'SYNTH-'+i,slug:'item-'+i,kind:'wax',featured:false,sort:9-i}));
 const m=manifestFromRow(sourceRow({products}),{now}),f=await fixture(t,m);assert.equal(f.expected.featured.length,8);assert.equal(f.expected.featured[0].slug,'item-9');await verify(f);
 await writeFile(htmlFile(f.build,'/en'),page('/en',m,{cardProducts:f.expected.products}));await assert.rejects(verify(f),/CATALOGUE_CARD_SET_MISMATCH/);
});
test('default/help/verify CLI never loads or queries a configured database, and bad manifest destinations stop before prepare',()=>{
 const require=createRequire(import.meta.url),moduleRoot=path.resolve(path.dirname(require.resolve('htmlparser2')),'../..');
 const env={NODE_PATH:moduleRoot,DATABASE_URL:'postgresql://synthetic:DO_NOT_ECHO@invalid/neondb'};
 for(const [key,value]of Object.entries(process.env))if(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(key.toUpperCase()))env[key]=value;
 const script=fileURLToPath(new URL('../scripts/verify-catalog-build.mjs',import.meta.url));
 for(const args of [[],['--help']]){const child=spawnSync(process.execPath,[script,...args],{env,encoding:'utf8',windowsHide:true});assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).defaultQuery,false);assert.doesNotMatch(child.stdout+child.stderr,/DO_NOT_ECHO|CATALOGUE_SOURCE_QUERY_FAILED/);}
 const bad=spawnSync(process.execPath,[script,'prepare','--manifest','package.json'],{env,encoding:'utf8',windowsHide:true});assert.notEqual(bad.status,0);assert.match(bad.stderr,/CATALOGUE_MANIFEST_PATH_REFUSED/);assert.doesNotMatch(bad.stdout+bad.stderr,/DO_NOT_ECHO/);
 const verifyChild=spawnSync(process.execPath,[script,'verify','--manifest','.vercel/catalogue-source-manifest-missing-test.json'],{env,encoding:'utf8',windowsHide:true});assert.notEqual(verifyChild.status,0);assert.match(verifyChild.stderr,/CATALOGUE_MANIFEST_FILE_REFUSED/);assert.doesNotMatch(verifyChild.stdout+verifyChild.stderr,/DO_NOT_ECHO|CATALOGUE_SOURCE_QUERY_FAILED/);
});
