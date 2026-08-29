/**
 * TOTP, against the RFC.
 *
 * lib/totp.js is a hand-written implementation of RFC 4226 and RFC 6238, and
 * the argument for writing it rather than installing it is that both documents
 * are short and neither has moved in over a decade. That argument only holds if
 * the implementation is checked against the published vectors, so it is — every
 * SHA-1 row in RFC 6238 Appendix B, which is the entire published set for the
 * algorithm this uses.
 *
 * A wrong TOTP implementation does not look wrong. It produces six plausible
 * digits that no authenticator app agrees with, and the failure arrives as an
 * admin who cannot sign in, on a screen where the only diagnostic available is
 * "that code is not right". These vectors are what stands between that and a
 * review that said the arithmetic looked fine.
 *
 * No database and no network, like everything else under tests/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  base32Decode,
  base32Encode,
  hotp,
  newRecoveryCodes,
  newSecret,
  normaliseRecoveryCode,
  openSecret,
  otpauthUri,
  readableSecret,
  recoveryHash,
  sealSecret,
  stepFor,
  totpAt,
  verifyTotp,
} from '../lib/totp.js';

/**
 * The RFC 6238 seed is the ASCII string "12345678901234567890", used as the
 * HMAC key directly. Our API takes base32 because that is what an authenticator
 * app is given, so the seed goes in through base32Encode — which also means
 * every vector below exercises the codec as well as the arithmetic.
 */
const SEED = new TextEncoder().encode('12345678901234567890');
const SEED_B32 = base32Encode(SEED);

/* --------------------------------------------------------------- base32 */

test('base32 round-trips the RFC 4648 examples', () => {
  const enc = s => base32Encode(new TextEncoder().encode(s));
  // RFC 4648 section 10, with the padding removed — nothing emits padding here.
  assert.equal(enc(''), '');
  assert.equal(enc('f'), 'MY');
  assert.equal(enc('fo'), 'MZXQ');
  assert.equal(enc('foo'), 'MZXW6');
  assert.equal(enc('foob'), 'MZXW6YQ');
  assert.equal(enc('fooba'), 'MZXW6YTB');
  assert.equal(enc('foobar'), 'MZXW6YTBOI');
});

test('base32 decodes back to the same bytes', () => {
  for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', '12345678901234567890']) {
    const bytes = new TextEncoder().encode(s);
    assert.deepEqual([...base32Decode(base32Encode(bytes))], [...bytes], s);
  }
});

test('base32 decoding forgives spacing and case', () => {
  const want = [...base32Decode(SEED_B32)];
  assert.deepEqual([...base32Decode(readableSecret(SEED_B32))], want, 'grouped in fours');
  assert.deepEqual([...base32Decode(SEED_B32.toLowerCase())], want, 'lowercase');
  assert.deepEqual([...base32Decode(`  ${SEED_B32}  `)], want, 'surrounding whitespace');
  // Padding is legal input even though nothing here writes it.
  assert.deepEqual([...base32Decode(`${SEED_B32}======`)], want, 'padded');
});

/* ------------------------------------------------------ RFC 4226 vectors */

test('HOTP matches every RFC 4226 Appendix D vector', async () => {
  const want = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];
  for (let counter = 0; counter < want.length; counter++) {
    assert.equal(await hotp(SEED, counter), want[counter], `counter ${counter}`);
  }
});

/* ------------------------------------------------------ RFC 6238 vectors */

test('TOTP matches every SHA-1 vector in RFC 6238 Appendix B', async () => {
  // The RFC prints eight digits; six is what this module and every
  // authenticator app use, and the six-digit code is the last six of the eight
  // because both are the same integer reduced modulo a power of ten.
  const vectors = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [seconds, code] of vectors) {
    const step = Math.floor(seconds / 30);
    assert.equal(await totpAt(SEED_B32, step), code, `T=${seconds}`);
  }
});

test('stepFor is the RFC definition of T', () => {
  assert.equal(stepFor(59 * 1000), 1);
  assert.equal(stepFor(1111111109 * 1000), 37037036);
  assert.equal(stepFor(20000000000 * 1000), 666666666);
  // The boundary, which is the one an off-by-one would land on.
  assert.equal(stepFor(29999), 0);
  assert.equal(stepFor(30000), 1);
});

/* ------------------------------------------------------------- verifying */

const AT = 1111111109 * 1000;

test('a current code verifies and reports its step', async () => {
  const step = await verifyTotp(SEED_B32, '081804', { at: AT });
  assert.equal(step, 37037036);
});

test('one step of drift either way is accepted', async () => {
  const before = await totpAt(SEED_B32, 37037035);
  const after = await totpAt(SEED_B32, 37037037);
  assert.equal(await verifyTotp(SEED_B32, before, { at: AT }), 37037035);
  assert.equal(await verifyTotp(SEED_B32, after, { at: AT }), 37037037);
});

test('two steps of drift is refused', async () => {
  const far = await totpAt(SEED_B32, 37037038);
  assert.equal(await verifyTotp(SEED_B32, far, { at: AT }), null);
});

test('a code at or below the last accepted step is refused', async () => {
  // This is the replay guard. Having accepted 37037036 once, the same code —
  // still inside its ninety-second life — must not work a second time, and
  // neither must the older code the drift window would otherwise still allow.
  assert.equal(await verifyTotp(SEED_B32, '081804', { at: AT, after: 37037036 }), null);
  const older = await totpAt(SEED_B32, 37037035);
  assert.equal(await verifyTotp(SEED_B32, older, { at: AT, after: 37037036 }), null);
  // The next step still works, so the guard expires sessions rather than logins.
  const next = await totpAt(SEED_B32, 37037037);
  assert.equal(await verifyTotp(SEED_B32, next, { at: AT, after: 37037036 }), 37037037);
});

test('malformed input is refused rather than coerced', async () => {
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, {}]) {
    assert.equal(await verifyTotp(SEED_B32, bad, { at: AT }), null, String(bad));
  }
});

test('a code with the spacing an app displays still verifies', async () => {
  // Several authenticator apps show "081 804" and a phone keyboard will happily
  // put the space in. Stripping non-digits before checking the length is
  // deliberate: the alternative is an admin holding a correct code that the
  // form refuses, with nothing on screen to explain why.
  assert.equal(await verifyTotp(SEED_B32, '081 804', { at: AT }), 37037036);
  assert.equal(await verifyTotp(SEED_B32, ' 081804 ', { at: AT }), 37037036);
  // It is a strip, not a filter: a six-digit code hiding inside a longer string
  // is still the wrong length once the letters go, and must not be accepted.
  assert.equal(await verifyTotp(SEED_B32, '0818040', { at: AT }), null);
});

test('no secret means nothing verifies', async () => {
  assert.equal(await verifyTotp('', '081804', { at: AT }), null);
  assert.equal(await verifyTotp(null, '081804', { at: AT }), null);
});

/* ---------------------------------------------------------------- secrets */

test('a fresh secret is 160 bits of base32', () => {
  const s = newSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(s).length, 20);
  assert.notEqual(newSecret(), newSecret(), 'two secrets in a row must differ');
});

test('the enrolment URI carries what an authenticator app reads', () => {
  const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'admin@example.com');
  const u = new URL(uri);
  assert.equal(u.protocol, 'otpauth:');
  assert.equal(decodeURIComponent(u.pathname).replace(/^\/+/, ''),
    'New Star Seven:admin@example.com');
  assert.equal(u.searchParams.get('secret'), 'JBSWY3DPEHPK3PXP');
  assert.equal(u.searchParams.get('algorithm'), 'SHA1');
  assert.equal(u.searchParams.get('digits'), '6');
  assert.equal(u.searchParams.get('period'), '30');
});

/* -------------------------------------------------------- recovery codes */

test('recovery codes are ten distinct fifty-bit codes', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10, 'a set with a duplicate in it is nine codes');
  for (const c of codes) assert.match(c, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
});

test('a recovery code is recognised however it is typed', async () => {
  const [code] = newRecoveryCodes(1);
  const want = await recoveryHash(code);
  for (const variant of [
    code.toLowerCase(),
    code.replace('-', ''),
    code.replace('-', ' '),
    `  ${code}  `,
  ]) {
    assert.equal(await recoveryHash(variant), want, variant);
  }
});

test('the stored digest is not the code', async () => {
  const [code] = newRecoveryCodes(1);
  const digest = await recoveryHash(code);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.ok(!digest.includes(normaliseRecoveryCode(code)));
  // Domain-separated, so the same string hashed for another purpose elsewhere
  // in the codebase cannot be replayed as a recovery code.
  const plain = await recoveryHash(code);
  assert.notEqual(plain, await import('../lib/order-access.js')
    .then(m => m.sha256(normaliseRecoveryCode(code))).catch(() => null));
});

/* ------------------------------------------------------ secrets at rest */

test('a sealed secret opens back to itself', async () => {
  process.env.SESSION_SECRET = 'a-long-enough-test-secret-value';
  const secret = newSecret();
  const sealed = await sealSecret(secret);
  assert.notEqual(sealed, secret);
  assert.ok(!sealed.includes(secret), 'the plaintext must not survive in the envelope');
  assert.equal(await openSecret(sealed), secret);
});

test('sealing twice gives two different envelopes', async () => {
  process.env.SESSION_SECRET = 'a-long-enough-test-secret-value';
  const secret = newSecret();
  assert.notEqual(await sealSecret(secret), await sealSecret(secret),
    'a fixed IV would let two identical secrets be spotted in a dump');
});

test('an envelope sealed under another key does not open', async () => {
  process.env.SESSION_SECRET = 'a-long-enough-test-secret-value';
  const sealed = await sealSecret(newSecret());
  process.env.SESSION_SECRET = 'a-completely-different-secret-x';
  assert.equal(await openSecret(sealed), null);
});

test('openSecret answers null rather than throwing on rubbish', async () => {
  process.env.SESSION_SECRET = 'a-long-enough-test-secret-value';
  for (const bad of ['', 'nonsense', 'v1.', 'v1.aa.bb', 'v2.aa.bb', null, undefined]) {
    assert.equal(await openSecret(bad), null, String(bad));
  }
});

test('a tampered envelope does not open', async () => {
  process.env.SESSION_SECRET = 'a-long-enough-test-secret-value';
  const sealed = await sealSecret(newSecret());
  const [v, iv, ct] = sealed.split('.');
  // Flip one character of the ciphertext. GCM authenticates, so this must fail
  // rather than decrypt to something else.
  const flipped = ct[0] === 'A' ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
  assert.equal(await openSecret(`${v}.${iv}.${flipped}`), null);
});
