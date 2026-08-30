import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import { BCRYPT_COST } from '../../../../lib/credentials.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'First-time setup — Star Seven admin', robots: { index: false, follow: false } };

const SETUP_ERRORS = {
  bad_email: 'Enter a valid email address.',
  short_pass: 'Use a password of at least 10 characters.',
  exists: 'An admin already exists. Remove ADMIN_SETUP_KEY from the environment.',
  csrf: 'Session expired — reload the page and try again.',
};

/**
 * Constant-time compare of the setup key, on digests rather than on the strings.
 *
 * The previous version was labelled "length-independent" and was not: it
 * early-returned when the lengths differed, so the loop only ran for a guess of
 * the right length. That is a length oracle. It was never measurable in
 * practice - a few dozen integer operations behind a network round trip and a
 * React render - which is why it is being fixed as correctness rather than
 * reported as a vulnerability, but a comment that claims a property the code
 * does not have is worse than no comment.
 *
 * Hashing both sides first makes it true rather than nearly true: two SHA-256
 * digests are always 32 bytes, so there is no length branch left to leak and
 * timingSafeEqual can do the comparison it is designed for.
 *
 * An unset or short key still means setup is CLOSED, not open to everyone. That
 * check stays outside the compare on purpose: it is a statement about the
 * server's own configuration and reveals nothing about the guess.
 */
function keyOk(given) {
  const want = process.env.ADMIN_SETUP_KEY || '';
  if (want.length < 8 || typeof given !== 'string') return false;
  const digest = v => createHash('sha256').update(String(v), 'utf8').digest();
  return timingSafeEqual(digest(want), digest(given));
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

  const hash = await bcrypt.hash(pass, BCRYPT_COST);

  // The WHERE NOT EXISTS is the real guard: two people opening this page at the
  // same moment cannot both create an admin.
  //
  // The role is written explicitly rather than left to the column default,
  // which is 'staff'. This is the bootstrap: the first account has to be the
  // one that can create the others, or the shop is set up and immediately
  // locked out of its own accounts screen. Everything after this comes from
  // /admin/accounts, where an owner chooses the role deliberately.
  const rows = await sql`
    INSERT INTO admins (email, pass_hash, name, role)
    SELECT ${email}, ${hash}, ${name}, 'owner'
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
