// Test-only resolution of already installed dependencies; no link/install or
// application loader change. Clear provider settings before test imports.
import {registerHooks} from 'node:module';
const packageRoot=new URL('../../migration-worktree/package.json',import.meta.url).href;
const keep=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NODE_TEST_CONTEXT']);
for(const name of Object.keys(process.env))if(!keep.has(name.toUpperCase()))delete process.env[name];
globalThis.fetch=()=>{throw new Error('HOSTED_FETCH_FORBIDDEN');};
registerHooks({resolve(specifier,context,next){
 try{return next(specifier,context);}catch(error){
  if(error.code!=='ERR_MODULE_NOT_FOUND'||specifier.startsWith('.')||specifier.startsWith('/')||specifier.startsWith('node:'))throw error;
  return next(specifier,{...context,parentURL:packageRoot});
 }
}});
