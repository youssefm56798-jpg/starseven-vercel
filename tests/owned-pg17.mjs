// Dedicated PG17 fixture. Vendor binaries are read only; all cluster files stay
// under this detached worktree and are removed only after verified shutdown.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ownWorktree} from './admin-ledger-fixture.mjs';
const require=createRequire(new URL('../../migration-worktree/package.json',import.meta.url));
const {Client}=require('pg');
export async function withOwnedPg17(run){
 const bin=fileURLToPath(new URL('../../rehearsal-native-pg17/pgsql/bin/',import.meta.url));
 const parent=path.resolve(ownWorktree,'test-runtime');await mkdir(parent,{recursive:true});
 const directory=await mkdtemp(path.join(parent,'ledger-'));
 assert.equal(path.dirname(path.resolve(directory)),parent);
 const env={};for(const key of ['SystemRoot','windir','ComSpec','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
 env.PATH=bin+';'+(env.SystemRoot||env.SYSTEMROOT||'C:/Windows')+'/System32';
 const init=spawnSync(path.join(bin,'initdb.exe'),['-D',directory,'-U','s7_synthetic_owner','--auth-host=trust','--auth-local=trust','--encoding=UTF8','--locale=C','--no-sync'],{env,cwd:bin,windowsHide:true,encoding:'utf8',timeout:30000});
 if(init.status!==0)throw new Error('SYNTHETIC_PG17_INIT_FAILED');
 const port=await new Promise((resolve,reject)=>{const socket=createServer();socket.on('error',reject);socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
 const child=spawn(path.join(bin,'postgres.exe'),['-D',directory,'-h','127.0.0.1','-p',String(port),'-c','max_connections=12','-c','log_statement=none','-c','log_min_error_statement=panic'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.resume();child.stderr.resume();
 const clients=new Set();let stopped=false;
 const connect=async(database='postgres')=>{
  assert.ok(database==='postgres'||database==='s7_synthetic_ledger');
  const client=new Client({host:'127.0.0.1',port,database,user:'s7_synthetic_owner',connectionTimeoutMillis:1000,statement_timeout:12000,query_timeout:15000,application_name:'s7_ledger_synthetic'});client.on('error',()=>{});
  try{await client.connect();const actual=(await client.query('SHOW data_directory')).rows[0].data_directory;assert.equal(path.resolve(actual).toLowerCase(),path.resolve(directory).toLowerCase(),'refuse any other loopback server');}catch(error){await client.end().catch(()=>{});throw error;}
  clients.add(client);return client;
 };
 try{
  let control;for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error('SYNTHETIC_PG17_EXITED');try{control=await connect();break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  if(!control)throw new Error('SYNTHETIC_PG17_NOT_READY');
  const version=(await control.query('SHOW server_version')).rows[0].server_version;assert.equal(Number.parseInt(version),17);
  return await run({control,connect,version,directory});
 }finally{
  for(const client of clients)await client.end().catch(()=>{});
  const stop=spawnSync(path.join(bin,'pg_ctl.exe'),['-D',directory,'-m','fast','-w','stop'],{env,windowsHide:true,encoding:'utf8',timeout:15000});
  if(stop.status!==0&&child.exitCode===null){child.kill();throw new Error('SYNTHETIC_PG17_SHUTDOWN_FAILED');}
  await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
  assert.equal(await readFile(path.join(directory,'postmaster.pid'),'utf8').catch(()=>null),null);stopped=true;
  // Verify final absolute/resolved scope before recursive deletion on Windows.
  assert.equal(stopped,true);assert.equal(path.dirname(path.resolve(directory)),parent);assert.match(path.basename(directory),/^ledger-[a-zA-Z0-9]+$/);
  assert.equal((await realpath(directory)).toLowerCase(),path.resolve(directory).toLowerCase());
  assert.equal((await realpath(parent)).toLowerCase(),parent.toLowerCase());
  await rm(directory,{recursive:true,force:false});
 }
}
