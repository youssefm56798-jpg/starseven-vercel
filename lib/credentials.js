/**
 * Credential rules — pure, so they can be tested without a database.
 *
 * Everything here is a decision about what the shop will accept, kept apart
 * from the code that stores it. The route handlers call these and do not
 * second-guess them, so there is one place where "is this a valid password"
 * is answered.
 */

/**
 * Email.
 *
 * Deliberately not RFC 5322. A full parser accepts addresses no mail server
 * here will ever deliver to and is a known source of catastrophic-backtracking
 * bugs. This asks the only questions that matter: one @, something either
 * side, a dot in the domain, no whitespace, and a sane length.
 */
export function normaliseEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function emailProblem(raw) {
  const email = normaliseEmail(raw);
  if (!email) return 'required';
  if (email.length > 254) return 'too-long';
  if (/\s/.test(email)) return 'whitespace';
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return 'shape';
  const domain = email.slice(at + 1);
  if (domain.length < 3 || !domain.includes('.')) return 'domain';
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return 'domain';
  return null;
}

export const emailOk = raw => emailProblem(raw) === null;

/**
 * Passwords.
 *
 * Length is the only rule that reliably buys strength, so it does the work: a
 * 10-character minimum rather than the usual 8, no composition rules, and a
 * cap so a megabyte of text cannot be sent to bcrypt.
 *
 * The list below is not a serious dictionary — a real one belongs in a
 * dependency this project does not have. It catches the handful that show up
 * first in every credential-stuffing run, plus anything derived from the
 * address being registered, which is the mistake real users actually make.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

const COMMON = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678910',
  'qwertyuiop', 'letmeinnow', 'iloveyou12', 'welcome123', 'admin12345',
  'passw0rd12', 'newstarseven', 'starseven123', 'egypt12345', '0123456789',
]);

export function passwordProblem(pw, email = '') {
  const s = String(pw ?? '');
  if (!s) return 'required';
  if (s.length < PASSWORD_MIN) return 'too-short';
  if (s.length > PASSWORD_MAX) return 'too-long';

  const flat = s.toLowerCase();
  if (COMMON.has(flat)) return 'common';

  // A single repeated character, or a straight run, whatever the length.
  if (/^(.)\1+$/.test(s)) return 'common';

  const local = normaliseEmail(email).split('@')[0];
  if (local && local.length >= 4 && flat.includes(local)) return 'contains-email';

  return null;
}

export const passwordOk = (pw, email) => passwordProblem(pw, email) === null;

/**
 * Free-text profile fields. Trimmed, collapsed and capped — a name is a label
 * on an order, not a document.
 */
export function cleanName(raw, max = 80) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Whether a request may change state.
 *
 * SameSite=Lax already stops the classic cross-site form post. This is the
 * second lock: the browser tells us where the request came from, and anything
 * that did not come from this site is refused. Requests with no Origin at all
 * are allowed only when Sec-Fetch-Site says same-origin, which covers clients
 * that omit Origin on same-origin fetches.
 */
export function originAllowed(req, siteUrl) {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = req.headers.get('origin');
  if (!origin) return fetchSite === 'same-origin' || fetchSite === 'none' || fetchSite === null;

  try {
    const got = new URL(origin);
    const want = new URL(siteUrl);
    return got.host === want.host && got.protocol === want.protocol;
  } catch {
    return false;
  }
}

/**
 * Cart lines, as accepted from a client.
 *
 * The server never trusts a price or a name from the browser — only a SKU and
 * a quantity, both re-checked against the catalogue before anything is
 * charged. This is also what a merged guest cart is filtered through.
 */
export const CART_MAX_QTY = 20;
export const CART_MAX_LINES = 50;

export function cleanCartLines(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const line of raw.slice(0, CART_MAX_LINES * 2)) {
    if (!line || typeof line.sku !== 'string') continue;
    const sku = line.sku.trim();
    if (!/^[A-Za-z0-9-]{1,48}$/.test(sku)) continue;
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const total = Math.min(CART_MAX_QTY, (seen.get(sku) || 0) + qty);
    seen.set(sku, total);
    if (seen.size >= CART_MAX_LINES) break;
  }
  return [...seen].map(([sku, qty]) => ({ sku, qty }));
}
