import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'First-time setup — Star Seven admin', robots: { index: false, follow: false } };

const SETUP_ERRORS = {
  bad_email: 'Enter a valid email address.',
  short_pass: 'Use a password of at least 10 characters.',
  exists: 'An admin already exists. Remove ADMIN_SETUP_KEY from the environment.',
  csrf: 'Session expired — reload the page and try again.',
};

/** Length-independent compare, so the key cannot be guessed a character at a time. */
function keyOk(given) {
  const want = process.env.ADMIN_SETUP_KEY || '';
  // No key configured means setup is closed, not open to everyone.
  if (want.length < 8 || typeof given !== 'string' || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function adminExists() {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM admins`;
  return Number(rows[0]?.c || 0) > 0;
}

async function createFirstAdmin(formData) {
  'use server';

  const key = String(formData.get('key') || '');
  // The key guards the action too — the page check alone would leave the POST open.
  if (!keyOk(key)) redirect('/admin/login');

  const back = `/admin/setup?key=${encodeURIComponent(key)}`;
  if (!(await csrfOk(formData.get('_csrf')))) redirect(`${back}&e=csrf`);

  const email = String(formData.get('email') || '').trim().toLowerCase();
  const pass = String(formData.get('pass') || '');
  const name = String(formData.get('name') || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`${back}&e=bad_email`);
  if (pass.length < 10) redirect(`${back}&e=short_pass`);

  const hash = await bcrypt.hash(pass, 12);

  // The WHERE NOT EXISTS is the real guard: two people opening this page at the
  // same moment cannot both create an admin.
  const rows = await sql`
    INSERT INTO admins (email, pass_hash, name)
    SELECT ${email}, ${hash}, ${name}
    WHERE NOT EXISTS (SELECT 1 FROM admins)
    RETURNING id`;

  if (!rows.length) redirect(`${back}&e=exists`);
  redirect('/admin/login?m=created');
}

export default async function SetupPage({ searchParams }) {
  const sp = await searchParams;
  const key = String(sp?.key || '');

  if (!keyOk(key)) {
    return (
      <>
        <header className="bar"><div className="brand"><i>★</i> STAR SEVEN</div></header>
        <div className="wrap">
          <h1>403 — Forbidden</h1>
          <p className="sub">This page needs the setup key.</p>
        </div>
      </>
    );
  }

  if (await adminExists()) {
    return (
      <>
        <header className="bar"><div className="brand"><i>★</i> STAR SEVEN</div></header>
        <div className="wrap">
          <h1>Already set up</h1>
          <p className="sub">
            An admin already exists, so this page will not run again. Remove
            <code> ADMIN_SETUP_KEY </code> from the environment — it is not needed any more.
          </p>
          <a className="btn" href="/admin/login">Go to the login screen</a>
        </div>
      </>
    );
  }

  const err = SETUP_ERRORS[String(sp?.e || '')];
  const token = await csrfToken();

  return (
    <>
      <header className="bar"><div className="brand"><i>★</i> STAR SEVEN</div></header>
      <div className="wrap">
        <h1>Create the first admin</h1>
        <p className="sub">This page stops working after one use. Clear ADMIN_SETUP_KEY once you are done.</p>

        {err ? <div className="flash err">{err}</div> : null}

        <div className="panel" style={{ maxWidth: '520px' }}>
          <div className="pad">
            <form action={createFirstAdmin}>
              <input type="hidden" name="_csrf" value={token} />
              <input type="hidden" name="key" value={key} />
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" defaultValue="Youssef" required />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" name="email" required autoComplete="username" />
              </div>
              <div className="field">
                <label htmlFor="pass">Password (10+ characters)</label>
                <input id="pass" type="password" name="pass" minLength={10} required autoComplete="new-password" />
              </div>
              <button className="btn red" type="submit">Create admin</button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
