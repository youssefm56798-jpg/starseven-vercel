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
  note_added: ['ok', 'Note added.'],
  dispatch_saved: ['ok', 'Courier and tracking reference saved.'],
  /*
   * Editing an order. Every refusal lib/order-edit.js can answer with has its
   * own line, because each one has a different next action for whoever is on
   * the phone at the time — and a single "could not save that" would leave them
   * guessing which. None of them can carry a value: a flash is a query string,
   * and a message the URL can carry is a message an attacker can choose, so the
   * ones about a specific product or a specific code say where to look instead
   * of naming it.
   */
  order_edited: ['ok', 'Order updated — totals, stock and the coupon have all been recalculated.'],
  edit_nothing: ['ok', 'Nothing changed, so nothing was saved.'],
  edit_stale: ['err', 'This order changed while you had it open. Reload and make the change again — nothing was saved.'],
  edit_locked: ['err', 'That order has shipped or is finished, so its contents can no longer be changed.'],
  edit_empty: ['err', 'An order cannot be emptied. Cancel it instead — that returns the stock and tells the customer.'],
  edit_toomany: ['err', 'That is too many separate lines for one order.'],
  edit_unknown: ['err', 'That product is not on sale, so it cannot be added.'],
  edit_unpriced: ['err', 'That product has no price yet, so it cannot be added to an order.'],
  edit_stock: ['err', 'There is not enough stock for that quantity. Nothing was changed — reload to see what is left.'],
  edit_phone: ['err', 'That is not a valid Egyptian mobile number.'],
  edit_address: ['err', 'The address is too short to deliver to.'],
  edit_coupon_bad: ['err', 'That discount code is not valid, or it has expired.'],
  edit_coupon_spent: ['err', 'That discount code has been fully used.'],
  edit_coupon_min: ['err', 'This order is now below the minimum that code applies on. Clear the code or add to the order.'],
  edit_coupon_gone: ['err', 'The code on this order no longer exists in Offers. Clear it to save the change.'],
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
  product_created: ['ok', 'Product created. It is in the list below.'],
  product_archived: ['ok', 'Archived — off the shop, and at the bottom of this page if you want it back.'],
  product_restored: ['ok', 'Restored, still hidden. Press Show when it is ready to sell.'],
  product_discarded: ['ok', 'Deleted for good. That SKU and web address are free again.'],
  product_missing: ['err', 'That product no longer exists.'],
  product_needs_name: ['err', 'Both names are required — Arabic and English.'],
  product_bad_kind: ['err', 'Pick a category from the list.'],
  product_bad_colour: ['err', 'The accent colour has to be a six-digit hex value like #D7291D.'],
  product_bad_sku: ['err', 'A SKU is letters, digits and hyphens, 2 to 40 characters. Nothing else.'],
  product_bad_slug: ['err', 'The web address needs at least two Latin letters or digits. Type one, or give the product an English name.'],
  product_bad_image: ['err', 'Every product needs a picture: upload one, or type the path of a file under public/.'],
  product_dupe_sku: ['err', 'Another product already uses that SKU. SKUs are permanent, so pick a different one.'],
  product_dupe_slug: ['err', 'Another product already uses that web address. Pick a different one.'],
  product_dupe: ['err', 'That SKU or web address is already taken.'],
  // Reachable when the product was archived in another tab between this page
  // rendering and the button being pressed.
  product_locked: ['err', 'That product is archived. Restore it first.'],
  discard_seeded: ['err', 'This SKU comes from the deploy seed. Deleting the row would only make the next deploy add it back, live — so it stays archived.'],
  discard_ordered: ['err', 'This product is on past orders. Deleting it would stop those orders putting stock back if they are ever cancelled, so it stays archived.'],
  discard_not_archived: ['err', 'Archive it first. Deleting for good is only offered from the archive.'],
  image_empty: ['err', 'That file was empty.'],
  image_too_big: ['err', 'That picture is too large. 3 MB is the limit.'],
  image_not_image: ['err', 'That file is not a WebP, PNG, JPEG or GIF image — whatever it is called.'],
  image_too_small: ['err', 'That picture is too small to use on a product card.'],
  image_too_large: ['err', 'That picture is enormous. Resize it to 4096 pixels or less on each side.'],
  image_odd_shape: ['err', 'That picture is a very long strip. Product shots need to be roughly square.'],
  image_no_store: ['err', 'No image store is attached, so uploads are off. Type a path under public/ instead.'],
  image_failed: ['err', 'The image could not be stored. Nothing was saved — try again.'],
  admin_created: ['ok', 'Admin created. Remove ADMIN_SETUP_KEY from the environment now, then log in.'],
  offer_missing: ['err', 'That offer no longer exists.'],
  offer_needs_text: ['err', 'Arabic title and body are required.'],
  csrf: ['err', 'Session expired — reload the page and try again.'],
  bad_input: ['err', 'That did not look right — check the form and try again.'],
  pw_changed: ['ok', 'Password changed. Every other browser has been signed out.'],
  pw_wrong: ['err', 'That is not your current password.'],
  rate: ['err', 'Too many attempts. Wait a few minutes and try again.'],
  pw_mismatch: ['err', 'The two new passwords do not match.'],
  pw_short: ['err', 'Use a new password of at least 10 characters.'],
  pw_weak: ['err', 'That password is too easy to guess, or contains your email address.'],
  pw_same: ['err', 'That is already your password.'],
  recovery_used: ['err', 'You signed in with a recovery code, so that one is now spent. Check how many are left on the Security tab.'],
  // Roles and accounts. A staff member who follows a stale link to an
  // owner-only screen lands here, so it has to read as an explanation rather
  // than as an accusation.
  forbidden: ['err', 'That is owner-only. Ask the shop owner if you need it.'],
  acct_created: ['ok', 'Account created. Hand the password over in person and have them change it on the Security tab.'],
  acct_promoted: ['ok', 'That account is now an owner, and has been signed out so the change takes effect.'],
  acct_demoted: ['ok', 'That account is now staff, and has been signed out so the change takes effect.'],
  acct_suspended: ['ok', 'Account suspended. Every browser it was signed in to has been signed out.'],
  acct_restored: ['ok', 'Account restored — they can sign in again.'],
  acct_removed: ['ok', 'Account deleted. What it already did stays on the order history.'],
  acct_reset_sent: ['ok', 'A password reset link is on its way to that address.'],
  acct_duplicate: ['err', 'There is already an account with that email address.'],
  acct_bad_email: ['err', 'That does not look like an email address.'],
  acct_missing: ['err', 'That account no longer exists — reload to see the current list.'],
  acct_self: ['err', 'You cannot change your own role, suspend yourself or delete your own account. Ask the other owner.'],
  acct_last_owner: ['err', 'That is the last owner. It cannot be demoted, suspended or removed — this is exactly the lockout this screen exists to prevent.'],
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
  bye_all: ['ok', 'Signed out everywhere. Every other browser has been signed out too.'],
  // One message for a wrong app code and a wrong recovery code, the same way
  // the password screen gives one message for a wrong email and a wrong
  // password: telling somebody which half they got right is telling them
  // something they did not have.
  bad2fa: ['err', 'That code is not right. App codes change every 30 seconds — try the current one.'],
  expired: ['err', 'That took too long. Enter your email and password again.'],
  totp_off: ['ok', 'Two-factor is off, and every session has been signed out. Log in again.'],
  // Said only to somebody who has already produced the right password, so it
  // reveals nothing an attacker did not already hold — and a member of staff
  // whose access was withdrawn deserves a straight answer rather than being
  // told their password is wrong.
  suspended: ['err', 'That account has been suspended. Ask the shop owner to restore it.'],
  bad_email: ['err', 'That does not look like an email address.'],
  reset_sent: ['ok', 'If that address has an admin account, a link to set a new password is on its way. It works once and expires in 30 minutes.'],
  reset_dead: ['err', 'That reset link has already been used or has expired. Ask for another one.'],
  pw_reset: ['ok', 'Password set, and every browser signed out. Log in with the new one.'],
  pw_short: ['err', 'Use a password of at least 10 characters.'],
  pw_weak: ['err', 'That password is too easy to guess, or contains your email address.'],
  pw_mismatch: ['err', 'The two passwords do not match.'],
  bad_input: ['err', 'That did not look right — check the form and try again.'],
};

/** A wa.me link for an Egyptian mobile number, as the PHP built it. */
export function waLink(phone) {
  return `https://wa.me/2${String(phone || '').replace(/^0+/, '')}`;
}

/*
 * imgSrc() used to live here: it turned "assets/wax-red.webp" into
 * "/assets/wax-red.webp" for the admin thumbnail. It is gone, not moved,
 * because products.image now holds two shapes — a file in public/ and an
 * uploaded image on an absolute Vercel Blob URL — and a local copy of that
 * knowledge is how the admin ended up asking this site for `/https://...`.
 * The one implementation is imageUrl() in lib/product-image.js, and the
 * storefront and the panel both call it.
 */
