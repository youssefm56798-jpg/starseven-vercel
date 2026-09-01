/**
 * The WhatsApp webhook's signature check, and the parsing behind it.
 *
 * This is the highest-value test file in the repository, and it is worth being
 * blunt about why. /api/whatsapp/webhook is a PUBLIC URL. A POST to it claims
 * "the customer on this order replied", and acting on that claim marks a phone
 * verified, keeps an order's stock, and can cancel the order outright. The
 * signature is the only thing standing between that and one curl command.
 *
 * So the failure this file exists to catch is not "the check is wrong" — it is
 * "the check silently stopped being a check". Every assertion below is written
 * against that: a secret that is missing, a signature that is absent, a body
 * that was re-serialised on the way in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  signatureValid, verifyChallenge, parseWebhook, localPhone,
} from '../lib/whatsapp.js';

const SECRET = 'a-test-app-secret-long-enough';
const sign = (body, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/* --------------------------------------------------------- the signature */

test('a body Meta signed is accepted', () => {
  const body = JSON.stringify({ entry: [{ changes: [] }] });
  assert.equal(signatureValid(body, sign(body), SECRET), true);
});

test('a body signed with the wrong secret is refused', () => {
  const body = '{"hello":true}';
  assert.equal(signatureValid(body, sign(body, 'a-different-secret-entirely'), SECRET), false);
});

test('a body altered after signing is refused', () => {
  const body = JSON.stringify({ entry: [{ id: '1' }] });
  const header = sign(body);
  // The attack this stops: a real signed payload replayed with the order
  // number swapped for somebody else's.
  assert.equal(signatureValid(`${body} `, header, SECRET), false);
  assert.equal(signatureValid(body.replace('"1"', '"2"'), header, SECRET), false);
});

test('no signature, an empty one, or a differently-shaped one is refused', () => {
  const body = '{}';
  for (const header of [
    undefined, null, '', 'sha256=', 'sha256=zzzz', 'deadbeef',
    // The right digest under the wrong algorithm prefix. Accepting this would
    // mean the prefix is decoration, and sha1 is forgeable.
    sign(body).replace('sha256=', 'sha1='),
    // Right length, wrong alphabet.
    `sha256=${'g'.repeat(64)}`,
    // Right digest, truncated.
    sign(body).slice(0, 40),
  ]) {
    assert.equal(signatureValid(body, header, SECRET), false,
      `${JSON.stringify(header)} was accepted`);
  }
});

test('an unset or trivially short secret verifies NOTHING', () => {
  /*
   * The single most dangerous failure available here, because it looks like the
   * feature working: with no secret configured, a check that returned true
   * would accept every forged request on a URL that anybody can find. An
   * environment variable nobody set must not take the door off its hinges.
   */
  const body = '{}';
  for (const secret of ['', undefined, null, 'short', 'x'.repeat(15)]) {
    assert.equal(signatureValid(body, sign(body, String(secret)), secret), false,
      `secret ${JSON.stringify(secret)} was allowed to verify`);
  }
});

test('the signature is checked against the raw body, not a reparse', () => {
  /*
   * The classic way this breaks. `JSON.parse` then `JSON.stringify` produces
   * semantically identical JSON with different bytes - key order, whitespace,
   * unicode escapes - so the digest no longer matches, and the tempting fix for
   * THAT is to stop checking. Asserted so the property is stated rather than
   * assumed: a round-tripped body does not verify under the original signature.
   */
  const raw = '{"b":1,\n  "a":"\\u00e9"}';
  const header = sign(raw);
  assert.equal(signatureValid(raw, header, SECRET), true);
  assert.equal(signatureValid(JSON.stringify(JSON.parse(raw)), header, SECRET), false);
});

test('the route verifies before it parses or reads anything', () => {
  const src = readFileSync(`${ROOT}app/api/whatsapp/webhook/route.js`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => (l.trim().startsWith('//') ? '' : l)).join('\n');

  /*
   * Scanned inside the POST handler, not across the whole file. The helpers it
   * calls are declared above it and contain queries of their own, so a
   * file-wide search measures where things are WRITTEN rather than the order
   * they run in - which is not the property worth protecting.
   */
  const at = src.indexOf('export async function POST');
  assert.ok(at > 0, 'the webhook no longer exports a POST handler');
  const handler = src.slice(at);

  const check = handler.indexOf('signatureValid(');
  const parse = handler.indexOf('JSON.parse(');
  const query = handler.search(/\bsql`|\bclaim\(|orderForReply\(/);

  assert.ok(check > 0, 'the webhook no longer verifies the signature at all');
  assert.ok(parse > check, 'the webhook parses the body before verifying it');
  assert.ok(query > check, 'the webhook touches the database before verifying');

  // And the refusal has to be a refusal, not a 200 that quietly does nothing.
  assert.match(handler.slice(check, check + 400), /status:\s*403/,
    'an unsigned request is no longer refused with 403');

  // It must read the body as text. `req.json()` would leave nothing to verify.
  assert.match(src, /await req\.text\(\)/);
  assert.doesNotMatch(src, /await req\.json\(\)/,
    'the webhook reads parsed JSON, so the raw bytes Meta signed are gone');
});

/* --------------------------------------------------------- the handshake */

test('the subscription handshake echoes the challenge only for the right token', () => {
  const TOKEN = 'a-verify-token-long-enough';
  const params = (over = {}) => new URLSearchParams({
    'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1158201444', ...over,
  });

  assert.equal(verifyChallenge(params(), TOKEN), '1158201444');
  assert.equal(verifyChallenge(params({ 'hub.verify_token': 'wrong' }), TOKEN), null);
  assert.equal(verifyChallenge(params({ 'hub.mode': 'unsubscribe' }), TOKEN), null);
  // Same failure mode as the signature: no token configured means no.
  assert.equal(verifyChallenge(params(), ''), null);
  assert.equal(verifyChallenge(params(), 'short'), null);
});

test('the handshake will not echo an arbitrary payload back', () => {
  // It is a reflection endpoint if the challenge is unbounded, and a reflection
  // endpoint on your own domain is a gift to somebody phishing your customers.
  const TOKEN = 'a-verify-token-long-enough';
  const p = c => new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': c });
  assert.equal(verifyChallenge(p('<script>alert(1)</script>'), TOKEN), null);
  assert.equal(verifyChallenge(p('x'.repeat(500)), TOKEN), null);
  assert.equal(verifyChallenge(p(''), TOKEN), null);
});

/* ------------------------------------------------------------- the phone */

test('a WhatsApp number becomes the number the orders table stores', () => {
  // Meta sends 201028282216; the order carries 01028282216.
  assert.equal(localPhone('201028282216'), '01028282216');
  assert.equal(localPhone('+20 102 828 2216'), '01028282216');
  assert.equal(localPhone('01028282216'), '01028282216');
  assert.equal(localPhone(''), '');
  assert.equal(localPhone(null), '');
});

/* ------------------------------------------------------------ the parsing */

test('a button tap is read as a reply with its payload', () => {
  const { replies, statuses } = parseWebhook({
    entry: [{ changes: [{ value: { messages: [{
      id: 'wamid.ABC', from: '201028282216', type: 'button',
      button: { payload: '10001', text: 'أكّد' },
      context: { id: 'wamid.OUT' },
    }] } }] }],
  });

  assert.equal(statuses.length, 0);
  assert.deepEqual(replies, [{
    id: 'wamid.ABC', from: '01028282216', payload: '10001', context: 'wamid.OUT',
  }]);
});

test('typed text is a reply too, with no payload', () => {
  // It still proves the number is real, which is the point of the exchange.
  const { replies } = parseWebhook({
    entry: [{ changes: [{ value: { messages: [{
      id: 'wamid.T', from: '201028282216', type: 'text', text: { body: 'تمام' },
    }] } }] }],
  });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].payload, '');
  assert.equal(replies[0].from, '01028282216');
});

test('only delivered and failed statuses are kept', () => {
  const { statuses } = parseWebhook({
    entry: [{ changes: [{ value: { statuses: [
      { id: 'wamid.1', status: 'sent' },
      { id: 'wamid.2', status: 'delivered' },
      { id: 'wamid.3', status: 'read' },
      { id: 'wamid.4', status: 'failed' },
    ] } }] }],
  });
  assert.deepEqual(statuses, [
    { id: 'wamid.2', status: 'delivered' },
    { id: 'wamid.4', status: 'failed' },
  ]);
});

test('a shape this app has never seen is ignored, never thrown on', () => {
  /*
   * Meta sends far more than this shop cares about, and adds to it over time.
   * A handler that throws on an unfamiliar envelope is a handler Meta retries
   * for ever, so the parser has to shrug rather than fail.
   */
  for (const body of [
    null, undefined, {}, { entry: null }, { entry: [null] },
    { entry: [{ changes: null }] },
    { entry: [{ changes: [{ value: null }] }] },
    { entry: [{ changes: [{ value: { messages: 'not an array' } }] }] },
    { entry: [{ changes: [{ value: { messages: [null, 42] } }] }] },
    // A message with no id or no sender is unusable, not fatal.
    { entry: [{ changes: [{ value: { messages: [{ from: '20100' }] } }] }] },
    { entry: [{ changes: [{ value: { messages: [{ id: 'x' }] } }] }] },
  ]) {
    assert.doesNotThrow(() => parseWebhook(body), `threw on ${JSON.stringify(body)}`);
    const out = parseWebhook(body);
    assert.ok(Array.isArray(out.replies) && Array.isArray(out.statuses));
  }
});

test('oversized strings in a forged payload are capped', () => {
  // Signed bodies are the only ones that get this far, but an id column is not
  // a place to put a megabyte just because the signature checked out.
  const { replies } = parseWebhook({
    entry: [{ changes: [{ value: { messages: [{
      id: 'w'.repeat(5000), from: '201028282216',
      button: { payload: 'p'.repeat(5000) },
      context: { id: 'c'.repeat(5000) },
    }] } }] }],
  });
  assert.equal(replies[0].id.length, 128);
  assert.equal(replies[0].payload.length, 64);
  assert.equal(replies[0].context.length, 128);
});
