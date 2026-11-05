// The actor is supplied by a guarded server caller, never read from a form.
export async function auditedQuery(sql,actor,reason,statement){
  if(!/^(?:admin:[1-9]\d*|system(?::[a-z-]+)?)$/.test(String(actor)))throw new Error('Invalid audit actor');
  const results=await sql.transaction([
    sql`SELECT set_config('s7.audit_actor',${actor}::text,true),set_config('s7.audit_reason',${String(reason).slice(0,300)}::text,true)`,
    statement,
  ]);
  return results[1];
}
