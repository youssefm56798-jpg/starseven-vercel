import { site } from './config.js';

/**
 * How prices are written for a customer.
 *
 * `site.currency` is the ISO code and belongs in structured data, invoices and
 * the API — not in the page. An Arabic shopper reads "جنيه", so every visible
 * price goes through here and the two never drift apart again.
 */
export function currencyLabel(lang) {
  return lang === 'en' ? 'EGP' : 'جنيه';
}

/** ISO code, for JSON-LD `priceCurrency` and anything machine-read. */
export const currencyCode = site.currency;

/** A whole-pound figure. Prices in this catalogue have no fractional part. */
export const whole = v => Math.round(Number(v) || 0);

/** Percentage saved, as a positive integer. Null when there is no discount. */
export function discountPercent(price, compareAt) {
  const p = Number(price);
  const c = Number(compareAt);
  if (!(c > 0) || !(p >= 0) || p >= c) return null;
  return Math.round(100 - (p / c) * 100);
}

/**
 * Whether the struck-through "was" price should be shown at all.
 *
 * The percentage badge has always been guarded - discountPercent() returns null
 * when the old price is not higher - but the struck-through NUMBER beside it was
 * rendered whenever compare_at was merely present. So a product whose price went
 * UP past its old compare_at showed "80 جنيه" with "55" crossed out next to it:
 * a price rise, displayed in the visual language of a discount, on a shop where
 * the number is collected in cash at the door.
 *
 * Found on S7-WAX-RED the day the client sent a new price list. The row was
 * corrected, and this exists so the next price rise cannot do it again — the two
 * halves of one claim now come from one rule instead of drifting apart.
 */
export const hasDiscount = (price, compareAt) =>
  compareAt != null && discountPercent(price, compareAt) !== null;
