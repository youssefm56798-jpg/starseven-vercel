/**
 * Finding the Server Actions in the source, as text.
 *
 * Shared by tests/admin-actions.test.mjs (does each action check who is calling
 * and whether they meant to) and tests/action-permissions.test.mjs (is the
 * check the RIGHT one for what the action writes). It lives here rather than in
 * both because a duplicated parser is a parser that drifts: fix a bug in one
 * copy and the other quietly goes on finding fewer actions than exist, which is
 * the failure mode where a guard test keeps passing while it stops guarding.
 *
 * Both callers assert that the walk found the actions they know about, so the
 * scanner cannot silently match nothing from either side.
 *
 * Text rather than imports, because these modules pull in next/navigation,
 * next/headers and the database, and none of that survives node:test.
 *
 * Not named *.test.mjs on purpose - the runner glob is tests/(star)(star)/(star).test.mjs,
 * so this file is a library and not an empty suite.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** A literal backslash, without writing one. */
const BACKSLASH = 92;
const SEP = String.fromCharCode(BACKSLASH);

export const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Every .js file under a directory. */
export function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * The body of a function, given the index just after the `(` of its parameter
 * list.
 *
 * The parameter list is skipped first, by counting parentheses. Three of the
 * actions in this codebase take a destructured object - `sendOfferBatch({
 * offerId, csrf })` - and reaching for the first `{` after the name lands on
 * that instead of on the body. The scan then reported those three as having no
 * CSRF check while they were the ones checking it most carefully, which is the
 * worst failure a test like this can have: it is wrong about the code being
 * right.
 *
 * Brace counting rather than a regex for the body, because an action contains
 * braces in template literals, in JSX and in nested functions, and
 * `[the rest]*?\}` stops at the first of those. Strings and comments are
 * skipped so a brace inside either cannot unbalance the count.
 */
export function bodyAt(src, afterOpenParen) {
  let depth = 1;
  let i = afterOpenParen;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
  }
  const start = src.indexOf('{', i);
  if (start < 0) return '';

  let braces = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; if (j < 1) break; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      j++;
      while (j < src.length && src[j] !== quote) j += (src.charCodeAt(j) === BACKSLASH ? 2 : 1);
      continue;
    }
    if (c === '{') braces++;
    else if (c === '}') {
      braces--;
      if (braces === 0) return src.slice(start, j + 1);
    }
  }
  return '';
}

/**
 * Every Server Action in app/, as { file, name, body }.
 *
 * Two shapes, because the codebase uses both: a module with 'use server' at the
 * top, where every exported function is an action, and a function with
 * 'use server' as its first statement inside a page file.
 */
export function serverActions() {
  const found = [];
  for (const full of walk(join(ROOT, 'app'))) {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('use server')) continue;
    const file = relative(ROOT, full).split(SEP).join('/');
    const moduleLevel = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use server['"];/.test(src);

    for (const m of src.matchAll(/(?:export\s+)?async function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
      const body = bodyAt(src, m.index + m[0].length);
      const inline = /^\{\s*(?:\/\/[^\n]*\n\s*)*['"]use server['"];/.test(body);
      const exported = m[0].startsWith('export');
      if (!inline && !(moduleLevel && exported)) continue;
      found.push({ file, name: m[1], body });
    }
  }
  return found;
}
