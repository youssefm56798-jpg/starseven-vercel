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
