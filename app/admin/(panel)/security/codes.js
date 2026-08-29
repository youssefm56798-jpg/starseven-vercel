'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmTwoFactor, reissueRecoveryCodes } from '../../_lib/security-actions.js';

/**
 * The two controls that produce recovery codes, and the sheet that shows them.
 *
 * These are client components for one reason, and it is not interactivity. The
 * codes exist in the clear exactly once — the table holds only their SHA-256 —
 * so the response that mints them is the only place they can be read. The rest
 * of the panel posts a form and redirects with a flash code, and a redirect
 * cannot carry ten secrets: they would have to be parked somewhere first, and
 * every somewhere available (a cookie, the query string, a column) is a copy of
 * the plaintext this design exists to avoid keeping.
 *
 * Calling the server action from here and rendering what it returns keeps them
 * in one response body and nowhere else. The cost is that a refresh loses them,
 * which is why the sheet says so and offers a copy button rather than assuming
 * anyone will read ten codes off a screen and type them somewhere by hand.
 */

const ERRORS = {
  csrf: 'Session expired — reload the page and try again.',
  bad_code: 'That code is not right. App codes change every 30 seconds — try the current one.',
  not_started: 'That setup is no longer pending. Start again.',
  pw_wrong: 'That is not your current password.',
  network: 'The connection dropped. Nothing was changed — try again.',
};

function CodeSheet({ codes, onDone }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      // No clipboard permission, or an insecure origin. The codes are on the
      // screen either way, so this is a convenience failing, not the feature.
      setCopied(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: '14px' }}>
      <h2>Your recovery codes</h2>
      <div className="pad">
        <div className="flash err">
          This is the only time these are shown. Save them somewhere that is not
          this computer. Each one works once, and they are the only way back in
          if the phone is lost.
        </div>
        <div className="grid2" style={{ margin: '12px 0' }}>
          {codes.map(c => (
            <code key={c} style={{ fontSize: '15px', letterSpacing: '1px' }}>{c}</code>
          ))}
        </div>
        <div className="bar-row">
          <button type="button" className="btn sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy all'}
          </button>
          <button type="button" className="btn sm ghost" onClick={onDone}>
            I have saved them
          </button>
        </div>
      </div>
    </div>
  );
}

/** Step two of enrolment: prove the phone has the secret. */
export function ConfirmEnrolment({ csrf }) {
  const router = useRouter();
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (codes) return <CodeSheet codes={codes} onDone={() => router.refresh()} />;

  async function submit(e) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get('code');
    setBusy(true);
    setError('');
    try {
      const r = await confirmTwoFactor({ code, csrf });
      if (r.error) setError(ERRORS[r.error] || ERRORS.network);
      else setCodes(r.codes);
    } catch {
      setError(ERRORS.network);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      {error ? <div className="flash err">{error}</div> : null}
      <div className="field">
        <label htmlFor="enrol-code">Enter the six digits your app is showing</label>
        <input
          id="enrol-code"
          name="code"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          placeholder="123456"
          style={{ maxWidth: '160px' }}
        />
      </div>
      <button className="btn red" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Turn on two-factor'}
      </button>
    </form>
  );
}

/** A fresh set, which retires whatever was printed before. */
export function ReissueCodes({ csrf }) {
  const router = useRouter();
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (codes) return <CodeSheet codes={codes} onDone={() => router.refresh()} />;

  async function submit(e) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get('password');
    if (!window.confirm('Generate ten new codes? Any codes you have written down stop working.')) return;

    setBusy(true);
    setError('');
    try {
      const r = await reissueRecoveryCodes({ password, csrf });
      if (r.error) setError(ERRORS[r.error] || ERRORS.network);
      else setCodes(r.codes);
    } catch {
      setError(ERRORS.network);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      {error ? <div className="flash err">{error}</div> : null}
      <div className="field">
        <label htmlFor="reissue-pw">Your password</label>
        <input
          id="reissue-pw"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          style={{ maxWidth: '260px' }}
        />
      </div>
      <button className="btn sm ghost" type="submit" disabled={busy}>
        {busy ? 'Working…' : 'Generate new recovery codes'}
      </button>
    </form>
  );
}
