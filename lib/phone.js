/**
 * Egyptian mobile numbers.
 * Valid prefixes: 010 Vodafone, 011 Etisalat, 012 Orange, 015 WE.
 */

/**
 * Normalises to local 11-digit form (01XXXXXXXXX).
 * Accepts +20 / 0020 / bare-10-digit input and any spacing or dashes.
 * Returns null when the number is not a valid Egyptian mobile.
 */
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D+/g, '');

  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2);

  if (d.length === 10 && d[0] === '1') d = '0' + d;

  return /^01[0125]\d{8}$/.test(d) ? d : null;
}
