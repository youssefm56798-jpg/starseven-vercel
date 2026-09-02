import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Reading what Meta sends, and proving it was Meta that sent it.
 *
 * Everything here is pure: bytes in, verdict or plain data out. No database, no
 * request object, no next/server — so the security-critical half of the webhook
 * can be tested exhaustively without a Postgres or a running app, which is the
 * same split lib/pricing.js and lib/credentials.js make.
 *
 * ---------------------------------------------------------------------------
 * The webhook is a public URL
 *
 * /api/whatsapp/webhook has to be reachable by Meta, which means it is
 * reachable by anybody. A POST to it claims "the customer on order #100001
 * tapped Confirm", and acting on that claim is what marks a phone verified and
 * keeps an order's stock. Without verification, one curl command confirms every
 * order on the shop — which is exactly the abuse the confirmation exists to
 * stop, handed back with a public endpoint attached.
 *
 * So the signature is not a nicety here, it is the entire control. Everything
 * else in this file is parsing.
 */

/**
 * Whether this body really came from Meta.
 *
 * Three things have to be right, and each has been a real CVE in somebody's
 * webhook handler:
 *
 *   the RAW body   HMAC is over the exact bytes Meta signed. Parsing the JSON
 *                  and re-serialising it changes key order, whitespace and
 *                  unicode escapes, so the digest will not match — and the
 *                  tempting "fix" for that is to stop checking, which is how
 *                  this ends up disabled in production. The caller must read
 *                  the body as text and hand that same string here.
 *   constant time  a byte-by-byte compare that returns early leaks how much of
 *                  a forged signature was right, and a signature can be
 *                  guessed one byte at a time from that. timingSafeEqual, and
 *                  the length check before it is on the HEX STRING rather than
 *                  the decoded buffer, because timingSafeEqual throws on a
 *                  length mismatch rather than returning false.
 *   fail closed    no secret configured means nothing verifies, including
 *                  Meta. An unset environment variable must not quietly turn
 *                  the door off its hinges.
 *
 * Meta sends the header as `sha256=<64 hex chars>`. Anything else is refused
 * without being parsed.
 */
export function signatureValid(rawBody, header, secret) {
  if (typeof rawBody !== 'string' || typeof secret !== 'string' || secret.length < 16) return false;

  const given = String(header ?? '');
  if (!given.startsWith('sha256=')) return false;

  const hex = given.slice(7).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;

  const want = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  // Both are known-good 64-character hex by now, so the buffers are the same
  // length and timingSafeEqual cannot throw.
  return timingSafeEqual(Buffer.from(hex, 'hex'), Buffer.from(want, 'hex'));
}

/**
 * The GET handshake Meta performs once, when the webhook URL is first saved.
 *
 * It sends a mode, a token of our choosing and a challenge; echoing the
 * challenge back proves we control the endpoint. Returns the challenge string
 * to echo, or null to refuse.
 *
 * The token compare is constant time for the same reason the signature is: it
 * is a shared secret, and an endpoint that leaks it a byte at a time through
 * response timing has handed over the ability to re-point the webhook.
 */
export function verifyChallenge(params, verifyToken) {
  if (typeof verifyToken !== 'string' || verifyToken.length < 16) return null;
  if (params.get('hub.mode') !== 'subscribe') return null;

  const given = String(params.get('hub.verify_token') ?? '');
  if (given.length !== verifyToken.length) return null;

  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(verifyToken, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const challenge = String(params.get('hub.challenge') ?? '');
  // Meta's challenge is a short number. Bounded so this cannot be used to make
  // the shop echo an arbitrary payload back to whoever asked.
  return /^[A-Za-z0-9_-]{1,64}$/.test(challenge) ? challenge : null;
}

/** Egyptian numbers arrive as 20xxxxxxxxxx; the orders table stores 01xxxxxxxxx. */
export function localPhone(waNumber) {
  const digits = String(waNumber ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const national = digits.startsWith('20') ? digits.slice(2) : digits;
  return national.startsWith('0') ? national : `0${national}`;
}

/**
 * The parts of a Meta webhook this shop acts on.
 *
 * Meta's envelope is deeply nested and carries a great deal this app has no
 * opinion about — read receipts, profile changes, message reactions. Rather
 * than walk it defensively at the call site, everything that matters is pulled
 * out here into two flat lists, and anything unrecognised is silently ignored.
 * A webhook handler that throws on a shape it did not expect is a webhook
 * handler that Meta retries for ever.
 *
 *   replies    somebody sent us a message. `payload` is set only when they
 *              tapped one of our template buttons; it is absent when they
 *              typed. Both count as proof the number is real — see the route.
 *   statuses   what happened to a message WE sent. Only 'delivered' and
 *              'failed' are kept; 'sent' and 'read' change nothing here.
 *
 * Everything is length-capped on the way out. These strings reach SQL as
 * parameters so there is no injection to worry about, but an id column is not a
 * place to store a megabyte somebody put in a forged payload.
 */
export function parseWebhook(body) {
  const replies = [];
  const statuses = [];

  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value || typeof value !== 'object') continue;

      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m || typeof m !== 'object') continue;
        const id = cap(m.id, 128);
        const from = localPhone(m.from);
        if (!id || !from) continue;

        replies.push({
          id,
          from,
          // The button payload is a string WE chose when sending the template,
          // so it is the order number. Absent when they typed a reply instead.
          payload: cap(m.button?.payload ?? m.interactive?.button_reply?.id, 64),
          // What the reply is a reply TO. Meta only sets this on an actual
          // reply, and it is the stronger link: the id of our own outbound
          // message, which nobody guessing order numbers can produce.
          context: cap(m.context?.id, 128),
        });
      }

      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!s || typeof s !== 'object') continue;
        const id = cap(s.id, 128);
        const status = cap(s.status, 32);
        if (!id || (status !== 'delivered' && status !== 'failed')) continue;
        statuses.push({ id, status });
      }
    }
  }

  return { replies, statuses };
}

const cap = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
