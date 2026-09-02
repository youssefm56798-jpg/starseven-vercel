/**
 * The number a customer knows their order by.
 *
 * ---------------------------------------------------------------------------
 * Two shapes, for ever
 *
 * Orders placed from now on get a counting number — 100001, 100002 — stored as
 * the digits alone and shown as #100001. Orders placed before that carry
 * S7-DDMM-NNNNN and keep it.
 *
 * Both shapes stay valid inputs everywhere a customer can type one, because a
 * shop cannot tell a customer holding a six-month-old confirmation email that
 * their order number is no longer a number. Every lookup goes through
 * normaliseRef() and every screen through formatRef(), so neither the database
 * nor the templates need to know which era a reference came from.
 *
 * ---------------------------------------------------------------------------
 * The number is not a credential and must never become one
 *
 * It is guessable on purpose — #100002 comes after #100001 — and that is safe
 * only because it grants nothing. Reading an order needs the random token from
 * lib/order-access.js; having a fresh link emailed needs the reference AND the
 * address it was placed with, rate limited on both. If anything ever starts
 * treating a reference as proof of identity, that is the bug, not this file.
 *
 * What a sequential number does leak is volume: two orders a week apart tell
 * anybody who placed them how many orders happened in between. That was a
 * deliberate trade for a number a customer can read down a phone, and the gaps
 * from failed checkouts blur it a little — see db/schema.sql.
 */

/** `#100001` for a number, `S7-2708-1234` unchanged. Presentation only. */
export function formatRef(ref) {
  const s = String(ref ?? '').trim();
  if (!s) return '';
  return /^\d+$/.test(s) ? `#${s}` : s;
}

/**
 * What somebody typed, turned into what the database stores.
 *
 * People write the number the way it is printed — with the hash, sometimes with
 * a space after it, sometimes both. The hash is decoration this module adds for
 * display, so it has to come back off before anything is looked up, or a
 * customer who copies the number exactly as they were shown it gets told their
 * order does not exist.
 *
 * Uppercased for the old shape, where `s7-2708-1234` and `S7-2708-1234` are the
 * same order and a customer reading one off a screen types whichever they see.
 * A digits-only reference is unaffected by it.
 */
export function normaliseRef(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Whether a reference is one of the two shapes this shop issues. */
export const isRef = ref => /^\d{1,12}$/.test(ref) || /^S7-\d{4}-\d{4,6}$/.test(ref);

/*
 * There is deliberately no nextOrderRef() here.
 *
 * Drawing the next number needs a database round trip, and this module is
 * imported by client components - app/checkout/CheckoutClient.js renders the
 * reference on the confirmation screen. A single `import { sql }` at the top of
 * this file would pull the Neon driver into the browser bundle to support a
 * function the browser can never call.
 *
 * So the sequence read lives in app/api/order/route.js, which already has the
 * client, and everything in here stays pure - the same split lib/pricing.js
 * makes for the same reason, and what lets these functions be tested without a
 * database.
 */

/**
 * A number-shaped answer for the honeypot, costing nothing.
 *
 * When a bot fills the hidden field the route replies exactly as it would to a
 * real customer — same shape, plausible reference — and writes nothing. That
 * reply must not come from the sequence, for two reasons that both matter:
 * a bot would otherwise advance the real numbering by one on every attempt, and
 * the number it was handed would tell it exactly where the counter is, which is
 * the shop's order volume.
 *
 * Random within the same range instead, so it is indistinguishable from a real
 * one to the thing being lied to, and tells it nothing.
 */
export function fakeOrderRef() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(10000 + (buf[0] % 90000));
}
