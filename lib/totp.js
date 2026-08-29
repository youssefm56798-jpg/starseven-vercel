/**
 * Time-based one-time passwords, and the recovery codes that go with them.
 *
 * All of it is arithmetic over an HMAC, so none of it needs a dependency. That
 * matters here beyond taste: this project has nine runtime dependencies, and
 * the two things a 2FA library would bring are a base32 codec and RFC 6238,
 * both of which are short enough to read in one sitting and neither of which
 * has changed since 2011. What a library would genuinely add is somebody else's
 * test suite, so the RFC test vectors are checked in tests/totp.test.mjs
 * instead — all six of them, which is the whole published set.
 *
 * Everything below uses WebCrypto rather than node:crypto, for the same reason
 * lib/order-access.js does: it is the API that exists in both runtimes, so
 * nothing here pins the admin to the Node runtime.
 *
 * ---------------------------------------------------------------------------
 * Why SHA-1
 *
 * Because every authenticator app in the world does. RFC 6238 permits SHA-256
 * and SHA-512, Google Authenticator ignores the algorithm parameter in the
 * enrolment URI and assumes SHA-1, and an admin who scans a SHA-256 secret into
 * it gets six digits that are always wrong with nothing on screen to say why.
 * The weakness in SHA-1 is collision resistance, which HMAC does not rely on,
 * and the secret is 160 bits of machine randomness rather than anything
 * guessable. This is the one place where following the herd is the correct
 * cryptographic judgement.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, no padding. Padding is optional and no app emits it. */
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * The inverse, forgiving about how it is typed.
 *
 * Anything outside the alphabet is dropped rather than rejected: an admin
 * copying a secret out of the enrolment screen will paste the spaces this
 * module puts in for legibility, and lowercase is what a phone keyboard offers
 * first. Neither is an error worth showing anyone.
 */
export function base32Decode(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh secret: 160 bits, which is what RFC 4226 asks for. */
export function newSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The same secret, grouped in fours, for somebody typing it in by hand. */
export const readableSecret = s => String(s).replace(/(.{4})/g, '$1 ').trim();

/** The 30-second step a moment falls in. RFC 6238 calls this T. */
export const stepFor = (ms = Date.now()) => Math.floor(ms / 1000 / 30);

/**
 * One HOTP value. RFC 4226 section 5.
 *
 * The counter is written as eight big-endian bytes through BigInt rather than
 * with a DataView and two 32-bit halves. Steps will not exceed 2**32 for
 * another four thousand years, but splitting a counter by hand is the kind of
 * code that is wrong for a decade before anybody finds out.
 */
export async function hotp(keyBytes, counter, digits = 6) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );

  const message = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    message[i] = Number(c & 0xffn);
    c >>= 8n;
  }

  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));

  // Dynamic truncation: the low nibble of the last byte picks where to read a
  // four-byte window, and the top bit is masked off so the result is positive
  // whatever the language decides a signed integer is.
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];

  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** The code an app would show for this secret, at this step. */
export const totpAt = (secret, step) => hotp(base32Decode(secret), step);

/**
 * Check a code, and say which step it matched.
 *
 * Returns the step number rather than a boolean, and the caller is expected to
 * store it. A code is valid for its own 30-second step and for one step either
 * side, which is the standard allowance for a phone whose clock has drifted -
 * and which means a code is live for up to ninety seconds. Ninety seconds is
 * long enough for a code read off a screen, or typed into a page pretending to
 * be this one, to be used twice. Recording the step that was accepted and
 * refusing anything at or below it next time closes that back down to the
 * single use the code was meant to have.
 *
 * The comparison is length-checked and then constant-time. A timing signal on
 * six digits is not much of an oracle, but it is free to close and the same
 * discipline is already applied to the CSRF token.
 */
export async function verifyTotp(secret, input, { at = Date.now(), skew = 1, after = 0 } = {}) {
  const code = String(input ?? '').replace(/\D/g, '');
  if (code.length !== 6) return null;
  if (!secret) return null;

  const now = stepFor(at);
  for (let d = -skew; d <= skew; d++) {
    const step = now + d;
    if (step <= Number(after)) continue;
    if (timingSafeEqual(code, await totpAt(secret, step))) return step;
  }
  return null;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The enrolment URI, which is what a QR code would encode.
 *
 * There is no QR code on the enrolment screen and that is a decision, not an
 * omission: drawing one means either a dependency or three hundred lines of
 * Reed-Solomon, and every authenticator app made in the last decade accepts a
 * secret typed in by hand. The screen shows the secret in groups of four and
 * the URI in full, so a phone can take either.
 *
 * The label carries the issuer as well as the account, because that prefix is
 * what several apps actually display in the list; the issuer parameter alone is
 * ignored by some of them.
 */
export function otpauthUri(secret, account, issuer = 'New Star Seven') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${q}`;
}

/* -------------------------------------------------------------- recovery */

/**
 * Ten codes, ten characters each, out of the same 32-symbol alphabet.
 *
 * Fifty bits apiece. A byte divides evenly into 32, so the modulo is unbiased
 * without a rejection loop - which is worth saying out loud, because the same
 * line over an alphabet whose size is not a power of two would quietly favour
 * the first few symbols.
 *
 * Hyphenated in the middle only for reading and typing; normalise() takes the
 * hyphen back off before anything is hashed, so a code works whichever way it
 * is entered.
 */
export function newRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.getRandomValues(new Uint8Array(10));
    const body = [...raw].map(b => B32[b % 32]).join('');
    codes.push(`${body.slice(0, 5)}-${body.slice(5)}`);
  }
  return codes;
}

/** What gets hashed: uppercase, alphabet only, hyphen and spaces gone. */
export const normaliseRecoveryCode = c =>
  String(c ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');

const hex = buf => Array.from(new Uint8Array(buf))
  .map(b => b.toString(16).padStart(2, '0')).join('');

export async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

/** The digest stored for a recovery code. Domain-separated from any other. */
export const recoveryHash = code => sha256(`s7-recovery:${normaliseRecoveryCode(code)}`);

/* ------------------------------------------------- the secret, at rest */

/**
 * The shared secret is encrypted in the database, not stored in the clear.
 *
 * A TOTP secret is not a password hash. A password hash in a stolen dump is
 * work to be done; a TOTP secret in a stolen dump is the second factor, handed
 * over, for every admin at once - and the entire purpose of the second factor
 * is that compromising the first one is not enough. So it is sealed with a key
 * that lives in the environment and never in the table, which means a dump
 * without the environment is inert.
 *
 * AES-GCM, key derived from SESSION_SECRET by one SHA-256 with a label in front
 * of it. Not a KDF with a work factor, deliberately: SESSION_SECRET is already
 * a long random string rather than a passphrase, so stretching it buys nothing,
 * and this runs on every verification. The label is there so that the same
 * environment variable cannot produce the same key for two different purposes.
 *
 * The cost is real and worth stating plainly: rotating SESSION_SECRET signs
 * every admin out - it already did - and now also makes every enrolled secret
 * undecryptable, so two-factor has to be set up again. openSecret returns null
 * rather than throwing on any failure, and the callers treat null as "not
 * enrolled", so the way out of that is the enrolment screen rather than a
 * locked-out panel.
 */
const b64u = bytes => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64u = s => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

async function sealKey() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) throw new Error('SESSION_SECRET is missing or too short');
  const material = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`s7-totp-key-v1:${s}`),
  );
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** "v1.<iv>.<ciphertext>", both base64url. The version prefix is for later. */
export async function sealSecret(plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await sealKey(), new TextEncoder().encode(String(plain)),
  ));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}

/** The secret back, or null for anything that does not open. Never throws. */
export async function openSecret(sealed) {
  try {
    const [version, iv, ct] = String(sealed ?? '').split('.');
    if (version !== 'v1' || !iv || !ct) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64u(iv) }, await sealKey(), unb64u(ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
