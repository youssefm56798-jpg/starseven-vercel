import { AdminText } from './locale.js';
import { redirect } from 'next/navigation';

// Server actions keep actor and permission at the request boundary. Nothing
// accepts an actor, role, trusted amount or return URL from a submitted form.
export async function finishOperation(returnTo, operation) {
  let result;
  try { result = await operation(); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/.test(error?.code ?? '') ? error.code : 'OPS_ERROR';
    console.error('[s7] Admin operation failed:', code);
    result = { ok: false, error: 'unavailable' };
  }
  redirect(returnTo + '?m=' + (result.ok ? 'ops_saved' : result.error === 'input' ? 'bad_input' : result.error === 'unavailable' ? 'ops_unavailable' : 'ops_stale'));
}

export function SetupRequired() {
  return <div className="flash err" role="status"><AdminText text="These tools are awaiting database setup. No change has been made. Contact the site maintainer." /></div>;
}
export function Unavailable() {
  return <div className="flash err" role="alert"><AdminText text="This section could not load. Reload the page. No change has been made." /></div>;
}
export async function readOperation(run) {
  try { return { data: await run() }; }
  catch (error) {
    console.error('[s7] Admin section unavailable:', /^[A-Z0-9]{5}$/.test(error?.code ?? '') ? error.code : 'OPS_ERROR');
    return { setup: ['42P01','42703'].includes(error?.code) };
  }
}
export function ReadFailure({ result }) { return result.setup ? <SetupRequired /> : <Unavailable />; }
export function Csrf({ value }) { return <input type="hidden" name="_csrf" value={value} />; }
