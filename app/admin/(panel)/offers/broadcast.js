'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sendOfferBatch } from '../../_lib/offer-actions.js';

const ERRORS = {
  auth: 'Your session expired. Log in again.',
  csrf: 'Session expired — reload the page and try again.',
  missing: 'That offer no longer exists.',
  bad_input: 'That request did not look right.',
  network: 'The connection dropped. Reload and broadcast again — already-sent addresses will repeat.',
};

/**
 * Drives the batched send. The button posts one batch, then immediately posts
 * the next from the cursor it got back, so a long list finishes without any one
 * request outliving the function timeout.
 */
export default function BroadcastButton({ offerId, csrf, recipients }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    const plural = recipients === 1 ? 'subscriber' : 'subscribers';
    if (!window.confirm(`Send this offer to ${recipients} ${plural} now? This cannot be undone.`)) return;

    setRunning(true);
    setError('');
    setFinished(false);
    setSent(0);

    let after = 0;
    let total = 0;

    try {
      for (;;) {
        const r = await sendOfferBatch({ offerId, afterId: after, csrf });
        if (r.error) { setError(ERRORS[r.error] || 'Something went wrong.'); break; }

        total += r.sent;
        setSent(total);

        // No rows came back: the list is finished, whatever `done` claims.
        if (r.processed === 0 || r.done) { setFinished(true); break; }
        after = r.nextAfterId;
      }
    } catch {
      setError(ERRORS.network);
    }

    setRunning(false);
    router.refresh();
  }

  return (
    <span className="bar-row">
      <button className="btn sm red" type="button" onClick={run} disabled={running}>
        {running ? 'Sending…' : 'Broadcast'}
      </button>
      {running && <span className="muted">{sent} delivered so far — keep this tab open.</span>}
      {!running && finished && <span className="muted">Broadcast finished. {sent} emails sent.</span>}
      {error && <span className="muted" style={{ color: '#D7291D', fontWeight: 800 }}>{error}</span>}
    </span>
  );
}
