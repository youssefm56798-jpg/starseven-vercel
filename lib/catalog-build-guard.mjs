// Public-catalogue build checks only. No DB import, dotenv loader or server.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {CATEGORIES} from '../app/shop/lib.js';
import {HAIR_TYPES} from './hairtypes.js';
import {HAIR_STYLES} from './hairstyles.js';
const require=createRequire(import.meta.url);
// Already locked through html-to-text; no new package/dependency is introduced.
const {parseDocument}=require('htmlparser2');
const SOURCE={project:'lingering-dream-59985926',branch:'br-wild-salad-b1hjooi1',database:'neondb',major:18};
const ORIGINS=new Set(['https://newstarseven.com','https://www.newstarseven.com']);
const MAX_PRODUCTS=5000,MAX_ARTICLES=10000,MAX_AGE=60*60*1000;
export class CatalogueBuildError extends Error {
 constructor(code,route){super(code);this.name='CatalogueBuildError';this.code=code;if(route)this.route=route;}
}
const fail=(code,route)=>{throw new CatalogueBuildError(code,route);};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function safeSlug(value){
 if(typeof value!=='string'||value.length>160||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))fail('CATALOGUE_UNSAFE_SLUG');
 return value;
}
const locale=(route,lang)=>lang==='en'?(route==='/'?'/en':'/en'+route):route;
const langs=route=>['ar','en'].map(lang=>locale(route,lang));
export function catalogueSiteOrigin(value){if(!ORIGINS.has(value))fail('CATALOGUE_SITE_ORIGIN_REFUSED');return value;}
function normalizedProducts(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_PRODUCTS)fail('CATALOGUE_PRODUCTS_EMPTY_OR_OVERSIZE');
 const products=rows.map(row=>{
  if(!row||!Number.isSafeInteger(row.id)||row.id<1||!Number.isSafeInteger(row.sort)||typeof row.sku!=='string'||!row.sku||row.sku.length>100||/[\x00-\x1f\x7f]/.test(row.sku)||typeof row.kind!=='string'||row.kind.length>64||typeof row.featured!=='boolean')fail('CATALOGUE_PRODUCT_SHAPE_REFUSED');
  return {id:row.id,sku:row.sku,slug:safeSlug(row.slug),kind:row.kind,featured:row.featured,sort:row.sort};
 }).sort((a,b)=>a.sort-b.sort||a.id-b.id);
 for(const field of ['id','sku','slug'])if(new Set(products.map(row=>row[field])).size!==products.length)fail('CATALOGUE_PRODUCT_DUPLICATE');
 return products;
}
function normalizedArticles(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_ARTICLES)fail('CATALOGUE_ARTICLES_EMPTY_OR_OVERSIZE');
 const articles=rows.map(row=>{
  if(!row||!['ar','en'].includes(row.lang))fail('CATALOGUE_ARTICLE_LANGUAGE_REFUSED');
  return {slug:safeSlug(row.slug),lang:row.lang};
 }).sort((a,b)=>(a.slug>b.slug?1:a.slug<b.slug?-1:0)||(a.lang>b.lang?1:a.lang<b.lang?-1:0));
 if(new Set(articles.map(row=>row.slug+'\0'+row.lang)).size!==articles.length)fail('CATALOGUE_ARTICLE_DUPLICATE');
 return articles;
}
export function manifestFromRow(row,{siteOrigin='https://newstarseven.com',now=Date.now()}={}){
 if(!row||row.project!==SOURCE.project||row.branch!==SOURCE.branch||row.database!==SOURCE.database||Math.floor(Number(row.version_num)/10000)!==SOURCE.major||row.read_only!=='on')fail('CATALOGUE_SOURCE_IDENTITY_REFUSED');
 const observed=Date.parse(row.observed_at);
 if(!Number.isFinite(observed)||observed>now+5*60*1000||now-observed>MAX_AGE)fail('CATALOGUE_SOURCE_TIME_REFUSED');
 const manifest={version:1,purpose:'public-catalogue-build-manifest',siteOrigin:catalogueSiteOrigin(siteOrigin),source:{...SOURCE,observedAt:new Date(observed).toISOString()},products:normalizedProducts(row.products),articles:normalizedArticles(row.articles)};
 if(!CATEGORIES.some(category=>manifest.products.some(product=>product.kind===category.kind)))fail('CATALOGUE_CATEGORIES_EMPTY');
 manifest.digest=hash(manifest);return manifest;
}
export function validateManifest(manifest,{now=Date.now()}={}){
 if(manifest?.version!==1||manifest.purpose!=='public-catalogue-build-manifest'||! /^[a-f0-9]{64}$/.test(manifest.digest||''))fail('CATALOGUE_MANIFEST_REFUSED');
 const expected=manifestFromRow({project:manifest.source?.project,branch:manifest.source?.branch,database:manifest.source?.database,version_num:(manifest.source?.major||0)*10000,read_only:'on',observed_at:manifest.source?.observedAt,products:manifest.products,articles:manifest.articles},{siteOrigin:manifest.siteOrigin,now});
 if(hash(expected)!==hash(manifest))fail('CATALOGUE_MANIFEST_DIGEST_REFUSED');
 return manifest;
}
// A single fixed SELECT, executed only by explicit CLI prepare. Every value
// selected is identity or public catalogue metadata, never auth/customer data.
function manifestQuery(sql){return sql`
 SELECT current_database() AS database,
        current_setting('neon.project_id',true) AS project,
        current_setting('neon.branch_id',true) AS branch,
        current_setting('server_version_num')::int AS version_num,
        current_setting('transaction_read_only') AS read_only,
        current_timestamp::text AS observed_at,
        (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.sort,p.id),'[]'::jsonb)
           FROM (SELECT id,sku,slug,kind,featured,sort FROM public.products
                  WHERE active=true ORDER BY sort,id LIMIT 5001) p) AS products,
        (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.slug,a.lang),'[]'::jsonb)
           FROM (SELECT DISTINCT slug,lang FROM public.articles
                  WHERE status='published' ORDER BY slug,lang LIMIT 10001) a) AS articles`;}
export async function prepareCatalogueManifest(sql,options={}){
 let result;
 try{result=await sql.transaction(query=>[manifestQuery(query)],{isolationLevel:'RepeatableRead',readOnly:true,fetchOptions:{signal:AbortSignal.timeout(30000)}});}
 catch{fail('CATALOGUE_SOURCE_QUERY_FAILED');}
 if(!Array.isArray(result)||result.length!==1||!Array.isArray(result[0])||result[0].length!==1)fail('CATALOGUE_SOURCE_RESULT_REFUSED');
 return manifestFromRow(result[0][0],options);
}
export function expectedCatalogue(manifest,{now=Date.now()}={}){
 validateManifest(manifest,{now});
 const products=manifest.products,articles=manifest.articles;
 const categories=CATEGORIES.filter(category=>products.some(product=>product.kind===category.kind));
 const featured=products.some(product=>product.featured)?products.filter(product=>product.featured):products.slice(0,8);
 const articleSlugs=[...new Set(articles.map(article=>article.slug))];
 const requiredPaths=[...new Set([...langs('/'),...langs('/shop'),...products.flatMap(product=>langs('/product/'+product.slug)),...categories.flatMap(category=>langs('/shop/'+category.slug)),...articleSlugs.flatMap(slug=>langs('/article/'+slug))])];
 const staticPaths=['/','/shop','/hair-types','/brand',...HAIR_TYPES.map(type=>'/hair-types/'+safeSlug(type.slug)),'/hair-styles',...HAIR_STYLES.map(style=>'/hair-styles/'+safeSlug(style.slug)),'/blog','/privacy','/terms'];
 const sitemapPaths=[...new Set([...staticPaths.flatMap(langs),...products.flatMap(product=>langs('/product/'+product.slug)),...categories.flatMap(category=>langs('/shop/'+category.slug)),...articles.map(article=>locale('/article/'+article.slug,article.lang))])];
 return {products,articles,categories,featured,requiredPaths,sitemapPaths};
}
function descendants(node,predicate){
 const found=[];
 const visit=value=>{if(predicate(value))found.push(value);if(['script','style','template'].includes(value.name))return;for(const child of value.children||[])visit(child);};
 visit(node);return found;
}
function allNodes(node,predicate){const found=[];const visit=value=>{if(predicate(value))found.push(value);for(const child of value.children||[])visit(child);};visit(node);return found;}
const hasClass=(node,name)=>String(node.attribs?.class||'').split(/\s+/).includes(name);
const text=node=>node.type==='text'?node.data:(node.children||[]).map(text).join('');
function publicPath(value,siteOrigin){
 if(typeof value!=='string'||!value||/[\\\x00-\x20\x7f%]/.test(value))return null;
 try{const url=new URL(value,siteOrigin);if(url.origin!==siteOrigin||url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return null;return url.pathname.length>1?url.pathname.replace(/\/$/,''):url.pathname;}catch{return null;}
}
function pageDom(html,route,manifest,expectedLang){
 const doc=parseDocument(html,{decodeEntities:true});
 const main=descendants(doc,node=>node.name==='main'&&node.attribs?.id==='content')[0];
 const heading=main&&descendants(main,node=>node.name==='h1').some(node=>text(node).trim());
 const frame=descendants(doc,node=>hasClass(node,'s7page')&&node.attribs?.lang===expectedLang&&node.attribs?.dir===(expectedLang==='en'?'ltr':'rtl')).length;
 const canonical=descendants(doc,node=>node.name==='link'&&String(node.attribs?.rel||'').split(/\s+/).includes('canonical')).map(node=>publicPath(node.attribs.href,manifest.siteOrigin));
 if(!main||!heading||!frame||canonical.length!==1)fail('CATALOGUE_PAGE_CONTENT_MISSING',route);
 return {doc,main,canonical:canonical[0]};
}
function samePaths(actual,expected,code,route){if(actual.length!==expected.length||new Set(actual).size!==actual.length||expected.some(value=>!actual.includes(value)))fail(code,route);}
function checkCards(main,products,lang,manifest,route){
 const links=descendants(main,node=>node.name==='a'&&hasClass(node,'card-hit')).map(node=>publicPath(node.attribs?.href,manifest.siteOrigin));
 samePaths(links,products.map(product=>locale('/product/'+product.slug,lang)),'CATALOGUE_CARD_SET_MISMATCH',route);
}
function checkCollection(doc,products,lang,manifest,route){
 const scripts=allNodes(doc,node=>node.name==='script'&&node.attribs?.type==='application/ld+json');
 const entries=[];
 for(const script of scripts){let value;try{value=JSON.parse(text(script));}catch{fail('CATALOGUE_JSONLD_INVALID',route);}const collect=x=>{if(Array.isArray(x))x.forEach(collect);else if(x&&typeof x==='object'){entries.push(x);if(x['@graph'])collect(x['@graph']);}};collect(value);}
 const page=entries.filter(entry=>entry['@type']==='CollectionPage'&&publicPath(entry.url,manifest.siteOrigin)===route);
 if(page.length!==1||page[0].mainEntity?.['@type']!=='ItemList'||page[0].mainEntity.numberOfItems!==products.length||!Array.isArray(page[0].mainEntity.itemListElement))fail('CATALOGUE_ITEMLIST_MISMATCH',route);
 const urls=page[0].mainEntity.itemListElement.map(item=>publicPath(item.url,manifest.siteOrigin));
 samePaths(urls,products.map(product=>locale('/product/'+product.slug,lang)),'CATALOGUE_ITEMLIST_MISMATCH',route);
}
async function readBuildFile(buildDir,relative,maxBytes){
 const base=path.resolve(buildDir),file=path.resolve(base,relative);
 if(!file.startsWith(base+path.sep))fail('CATALOGUE_BUILD_PATH_REFUSED');
 try{
  let cursor=file;
  while(true){const info=await lstat(cursor);if(info.isSymbolicLink())fail('CATALOGUE_BUILD_REPARSE_REFUSED');if(cursor===file&&(!info.isFile()||info.size>maxBytes))fail('CATALOGUE_BUILD_FILE_REFUSED');if(cursor===base)break;cursor=path.dirname(cursor);}
  return await readFile(file,'utf8');
 }catch(error){if(error instanceof CatalogueBuildError)throw error;fail('CATALOGUE_BUILD_FILE_MISSING');}
}
export async function verifyCatalogueBuild({manifest,buildDir,now=Date.now()}){
 const expected=expectedCatalogue(manifest,{now});
 let prerender;try{prerender=JSON.parse(await readBuildFile(buildDir,'prerender-manifest.json',8*1024*1024));}catch(error){if(error instanceof CatalogueBuildError)throw error;fail('CATALOGUE_PRERENDER_MANIFEST_INVALID');}
 if(!prerender?.routes||typeof prerender.routes!=='object')fail('CATALOGUE_PRERENDER_MANIFEST_INVALID');
 for(const route of expected.requiredPaths){
  if(!Object.hasOwn(prerender.routes,route))fail('CATALOGUE_PRERENDER_ROUTE_MISSING',route);
  const relative='server/app/'+(route==='/'?'index':route.slice(1))+'.html';
  const html=await readBuildFile(buildDir,relative,16*1024*1024);
  const requested=route==='/en'||route.startsWith('/en/')?'en':'ar';
  const article=/^\/(?:en\/)?article\/([a-z0-9-]+)$/.exec(route);
  const available=article?expected.articles.filter(row=>row.slug===article[1]).map(row=>row.lang):null;
  const rendered=available?(available.includes(requested)?requested:available[0]):requested;
  const page=pageDom(html,route,manifest,rendered);
  const canonical=article?locale('/article/'+article[1],rendered):route;
  if(page.canonical!==canonical)fail('CATALOGUE_CANONICAL_MISMATCH',route);
  if(route==='/'||route==='/en')checkCards(page.main,expected.featured,requested,manifest,route);
  else if(route==='/shop'||route==='/en/shop'){
   checkCards(page.main,expected.products,requested,manifest,route);checkCollection(page.doc,expected.products,requested,manifest,route);
  }else{
   const category=/^\/(?:en\/)?shop\/([a-z0-9-]+)$/.exec(route);
   if(category){const kind=expected.categories.find(value=>value.slug===category[1])?.kind;const products=expected.products.filter(product=>product.kind===kind);checkCards(page.main,products,requested,manifest,route);checkCollection(page.doc,products,requested,manifest,route);}
   if(article&&!descendants(page.main,node=>node.name==='article'&&hasClass(node,'article')).length)fail('CATALOGUE_ARTICLE_CONTENT_MISSING',route);
  }
 }
 const sitemap=parseDocument(await readBuildFile(buildDir,'server/app/sitemap.xml.body',8*1024*1024),{xmlMode:true,decodeEntities:true});
 const locations=allNodes(sitemap,node=>node.name==='url').flatMap(node=>(node.children||[]).filter(child=>child.name==='loc').map(child=>publicPath(text(child).trim(),manifest.siteOrigin)));
 if(locations.some(value=>value===null)||new Set(locations).size!==locations.length)fail('CATALOGUE_SITEMAP_URL_REFUSED');
 for(const route of expected.sitemapPaths)if(!locations.includes(route))fail('CATALOGUE_SITEMAP_ROUTE_MISSING',route);
 const dynamic=/^\/(?:en\/)?(?:product|article|shop)\//;
 for(const route of locations)if(dynamic.test(route)&&!expected.sitemapPaths.includes(route))fail('CATALOGUE_SITEMAP_UNEXPECTED_DYNAMIC_ROUTE',route);
 return {status:'catalogue-build-verified',products:expected.products.length,publishedArticleRows:expected.articles.length,publishedArticleSlugs:new Set(expected.articles.map(article=>article.slug)).size,categories:expected.categories.length,requiredPrerenderedPaths:expected.requiredPaths.length,requiredSitemapPaths:expected.sitemapPaths.length,manifestDigest:manifest.digest,queryPerformed:false};
}
