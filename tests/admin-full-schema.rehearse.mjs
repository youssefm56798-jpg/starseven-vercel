// Exact cumulative schema + intended restricted app grants, in memory only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite,pg_trgm,lazySql} from './admin-ledger-fixture.mjs';
import {grantStatements} from '../db/grants.mjs';
import {auditedQuery} from '../lib/audit-query.mjs';
import {recordCollection} from '../lib/collection-ledger.mjs';
test('actual product editor preserves concurrent stock; exact app grants support triggers and exclude credentials from audit',async()=>{
  const db=new PGlite({extensions:{pg_trgm}});await db.waitReady;
  try{
    await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
    await db.exec("CREATE ROLE s7_app");for(const statement of grantStatements())await db.exec(statement);
    await db.query("INSERT INTO products(sku,slug,kind,name_ar,name_en,price,stock,image) VALUES('SYNTH-P','synthetic','wax','تجريبي','Synthetic',100,20,'/synthetic.png')");
    await db.query("INSERT INTO admins(email,pass_hash,name,role) VALUES('synthetic@example.invalid','SYNTHETIC_NONLOGIN','Synthetic','owner')");
    const sql=lazySql(db);
    const source=await readFile(new URL('../lib/product-admin.js',import.meta.url),'utf8');
    const start=source.indexOf('export async function updateProduct('),end=source.indexOf('\n}',start)+2;
    assert.ok(start>=0&&end>start);
    const updateProduct=new Function('sql','auditedQuery','published',source.slice(start,end).replace('export ','')+'\nreturn updateProduct;')(sql,auditedQuery,async()=>{});
    const row=(await db.query('SELECT * FROM products WHERE id=1')).rows[0];
    const values={...row,hair_types:row.hair_types??[],long_ar:row.long_ar??'',long_en:row.long_en??'',howto_ar:row.howto_ar??'',howto_en:row.howto_en??'',highlights_ar:row.highlights_ar??'',highlights_en:row.highlights_en??''};
    await db.exec('SET ROLE s7_app');
    // Simulate stock reserved after the admin loaded the form.
    await db.query('UPDATE products SET stock=19 WHERE id=1');
    const saved=await updateProduct(1,{...values,name_en:'Copy edited'},20,'admin:1');assert.equal(saved.ok,true);
    assert.equal((await db.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,19);
    const stale=await updateProduct(1,{...values,stock:25,stock_reason:'Synthetic counted stock'},20,'admin:1');assert.equal(stale.ok,false);
    const good=await updateProduct(1,{...values,stock:25,stock_reason:'Synthetic counted stock'},19,'admin:1');assert.equal(good.ok,true);
    const movement=(await db.query('SELECT actor,reason,delta,balance FROM stock_movements ORDER BY id DESC LIMIT 1')).rows[0];
    assert.deepEqual(movement,{actor:'admin:1',reason:'Synthetic counted stock',delta:6,balance:25});
    const before=Number((await db.query("SELECT count(*)::int AS n FROM admin_audit WHERE area='accounts'")).rows[0].n);
    await db.query("UPDATE admins SET pass_hash='ANOTHER_SYNTHETIC_NONLOGIN' WHERE id=1");
    assert.equal(Number((await db.query("SELECT count(*)::int AS n FROM admin_audit WHERE area='accounts'")).rows[0].n),before);
    await auditedQuery(sql,'admin:1','account-suspend',sql`UPDATE admins SET suspended_at=now() WHERE id=1`);
    const accountAudit=(await db.query("SELECT actor,detail FROM admin_audit WHERE area='accounts' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(accountAudit.actor,'admin:1');
    assert.ok(accountAudit.detail.after.suspended_at);
    const audit=(await db.query('SELECT detail FROM admin_audit ORDER BY id DESC LIMIT 1')).rows[0].detail;
    assert.equal(Object.hasOwn(audit.after??{},'pass_hash'),false);
    const cash=(await db.query("INSERT INTO orders(ref,name,phone,address,city,status,subtotal,total,collected_amount,settled_at) VALUES('SYNTH-CASH','Synthetic','01000000001','Synthetic address','Cairo','delivered',100,130,130,'2026-08-01 10:20:30.123456+00') RETURNING id")).rows[0];
    const collection=await recordCollection(sql,{order_id:cash.id,expect_seq:0,amount:'120',reason:'Synthetic audited correction'},'admin:1');assert.ok(collection.ok);
    assert.deepEqual((await db.query('SELECT kind,amount_delta FROM collection_movements WHERE order_id=$1 ORDER BY id',[cash.id])).rows.map(m=>[m.kind,Number(m.amount_delta)]),[['opening',130],['corrected',-10]]);
    assert.equal(Number((await db.query('SELECT collected_amount FROM orders WHERE id=$1',[cash.id])).rows[0].collected_amount),120);
    assert.equal((await db.query("SELECT detail->'after'->>'collected_amount' AS amount FROM admin_audit WHERE area='collections' ORDER BY id DESC LIMIT 1")).rows[0].amount,'120.00');
    await assert.rejects(db.query("UPDATE collection_movements SET reason='overwrite'"),e=>e.code==='42501');
    await assert.rejects(db.query('DELETE FROM collection_movements'),e=>e.code==='42501');
    await assert.rejects(db.query("UPDATE stock_movements SET reason='overwrite'"),e=>e.code==='42501');
    await assert.rejects(db.query('DELETE FROM admin_audit'),e=>e.code==='42501');
  }finally{await db.close();}
});
