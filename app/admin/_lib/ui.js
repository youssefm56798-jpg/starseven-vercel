import { site } from '../../../lib/config.js';

/**
 * Small shared helpers for the admin screens. `_lib` is a private folder, so
 * Next never routes to anything in here.
 */

/** Money, matching the PHP `money()` helper: 1,234.00 EGP */
export function money(v) {
  const n = Number(v || 0);
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${site.currency}`;
}

/** Whole-number KPI, e.g. 12,400 */
export function num(v) {
  return Math.round(Number(v || 0)).toLocaleString('en-US');
}

/**
 * Postgres TIMESTAMPTZ arrives either as a Date (driver-parsed) or as a string
 * like "2026-08-25 12:00:00+00", which Safari refuses to parse — hence the swap
 * to ISO shape before handing it to Date.
 */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const TZ = 'Africa/Cairo';

/** "3 Aug, 14:22" — the PHP date('j M, H:i'), rendered in shop time. */
export function dt(v) {
  const d = toDate(v);
  if (!d) return '—';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** "3 Aug 2026" — the PHP date('j M Y'). */
export function day(v) {
  const d = toDate(v);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** "3 Aug" — used for the offer window. */
export function dayShort(v) {
  const d = toDate(v);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
}

/** Drops trailing zeros: 15.00 -> 15, 12.50 -> 12.5 */
export function trimNum(v) {
  return String(Number(v || 0));
}

/**
 * Flash messages travel as a short code in the query string, never as free text
 * — a message the URL can carry is a message an attacker can choose.
 */
const MESSAGES = {
  order_saved: ['ok', 'Order updated.'],
  order_cancelled: ['ok', 'Order cancelled — stock and coupon returned.'],
  // Delivered and cancelled are terminal, so the panel does not offer a way out
  // of either. Reaching this means the order moved in another tab between the
  // page rendering and Save being pressed.
  bad_move: ['err', 'That order has already moved on — reload to see where it is now.'],
  sub_confirmed: ['ok', 'Confirmed manually.'],
  sub_unsubbed: ['ok', 'Marked as unsubscribed.'],
  sub_deleted: ['ok', 'Subscriber deleted.'],
  offer_created: ['ok', 'Offer created. Review it, then broadcast when you are ready.'],
  offer_updated: ['ok', 'Offer updated.'],
  offer_deleted: ['ok', 'Offer deleted.'],
  product_saved: ['ok', 'Product saved.'],
  product_toggled: ['ok', 'Product visibility changed.'],
  product_featured: ['ok', 'Home page selection changed.'],
  admin_created: ['ok', 'Admin created. Remove ADMIN_SETUP_KEY from the environment now, then log in.'],
  offer_missing: ['err', 'That offer no longer exists.'],
  offer_needs_text: ['err', 'Arabic title and body are required.'],
  csrf: ['err', 'Session expired — reload the page and try again.'],
  bad_input: ['err', 'That did not look right — check the form and try again.'],
};

export function Flash({ code }) {
  const m = MESSAGES[code];
  if (!m) return null;
  return <div className={`flash ${m[0]}`}>{m[1]}</div>;
}

/** Login-screen messages live on a differently styled page. */
export const LOGIN_MESSAGES = {
  bad: ['err', 'Wrong email or password.'],
  rate: ['err', 'Too many attempts. Wait a few minutes and try again.'],
  csrf: ['err', 'Session expired — reload the page and try again.'],
  created: ['ok', 'Admin created. Log in below.'],
  bye: ['ok', 'Signed out.'],
};

/** A wa.me link for an Egyptian mobile number, as the PHP built it. */
export function waLink(phone) {
  return `https://wa.me/2${String(phone || '').replace(/^0+/, '')}`;
}

/** Public URL for a product image row value like "assets/wax-red.webp". */
export function imgSrc(image) {
  const s = String(image || '');
  return s.startsWith('/') ? s : `/${s}`;
}
