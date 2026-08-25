/**
 * Normalisation for the long-form product copy edited in the admin panel.
 *
 * Six columns on `products` hold this copy: `long_ar` / `long_en` are
 * multi-paragraph descriptions rendered through lib/markdown.js, while
 * `howto_*` and `highlights_*` are one item per line — plain text, no bullet
 * characters, because the page draws the numbers and the ticks itself.
 *
 * A textarea posted from Windows arrives with CRLF endings, trailing spaces
 * and — when somebody pastes a whole document by accident — a great deal more
 * text than a product page can use. These helpers are pure so the rules are
 * testable without a database, and they are the only place the shape of the
 * stored value is decided.
 *
 * Caps are counted in characters, not bytes: they exist to stop a row bloating,
 * not to match a column width (the columns are TEXT).
 */

/** Longest accepted `long_ar` / `long_en`. */
export const LONG_MAX = 4000;

/** Longest accepted `howto_*` / `highlights_*`. */
export const LIST_MAX = 1200;

/** CRLF and lone CR both become LF, so line counting is the same everywhere. */
const toLf = raw => String(raw ?? '').replace(/\r\n?/g, '\n');

/**
 * Multi-paragraph body copy.
 *
 * Every line is trimmed, runs of blank lines collapse to the single blank line
 * that lib/markdown.js reads as a paragraph break, and the result is capped.
 * Blank lines are *kept* here — unlike the list fields — because they are the
 * paragraph separator.
 */
export function normaliseLongText(raw, max = LONG_MAX) {
  const text = toLf(raw)
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > max ? text.slice(0, max).trim() : text;
}

/**
 * One item per line.
 *
 * Lines are trimmed, blank ones dropped, and the list is cut at the last whole
 * line that still fits the cap — a truncated half-step is worse than a missing
 * one. The single exception is a first line already longer than the cap on its
 * own, which is hard-sliced so the field is not silently emptied.
 */
export function normaliseLines(raw, max = LIST_MAX) {
  const lines = toLf(raw)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const kept = [];
  let used = 0;

  for (const line of lines) {
    // Every line but the first also costs the newline that joins it.
    const cost = kept.length === 0 ? line.length : line.length + 1;
    if (used + cost > max) {
      if (kept.length === 0) kept.push(line.slice(0, max).trim());
      break;
    }
    kept.push(line);
    used += cost;
  }

  return kept.join('\n');
}
