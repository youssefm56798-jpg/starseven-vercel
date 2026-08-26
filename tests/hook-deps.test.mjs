/**
 * Every identifier in a React dependency array must exist in its file.
 *
 * This exists because of a real outage. The URL migration renamed the locale
 * helper `q` to `L` and updated every call site — but missed one dependency
 * array in the checkout:
 *
 *     }, [add, q]);
 *
 * A dependency array is evaluated during render, so that line threw
 * `ReferenceError: q is not defined` the moment the checkout mounted, and the
 * error boundary replaced the page. `next build` was green throughout: the
 * build compiles, it does not resolve identifiers. There is no linter on this
 * project, so nothing else was looking.
 *
 * The checkout was down for eight deploys.
 *
 * The check is deliberately narrow. It does not try to be ESLint — it reads
 * the identifiers out of `useEffect`/`useMemo`/`useCallback`/`useLayoutEffect`
 * dependency arrays and asserts each one is bound somewhere in the same file
 * as an import, a declaration, a function name or a parameter. That is exactly
 * the shape of the bug, it needs no dependencies, and it runs in milliseconds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Identifiers that are always available without being declared. */
const GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'console',
  'Math', 'JSON', 'Date', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'Set', 'Map', 'RegExp', 'Promise', 'undefined', 'null', 'true', 'false',
  'globalThis', 'localStorage', 'sessionStorage', 'performance', 'process',
]);

/**
 * Every name bound in a file: imports, declarations, function names,
 * parameters and destructured properties. Intentionally over-generous — the
 * goal is zero false alarms on a name that is genuinely present, not a
 * complete scope model.
 */
function boundNames(src) {
  const names = new Set();
  const add = s => { for (const m of s.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]); };

  for (const m of src.matchAll(/import\s+([^;]+?)\s+from/g)) add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([^=;]+)=/g)) add(m[1]);
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // Parameter lists: anything inside the parens of a function or arrow.
  for (const m of src.matchAll(/(?:function\s*[A-Za-z_$\w]*\s*|\)\s*=>|\(\s*)\(([^)]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(([^)]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([^;)]+?)(?:\s+of|\s+in|;)/g)) add(m[1]);

  return names;
}

const HOOK = /\b(?:useEffect|useLayoutEffect|useMemo|useCallback)\s*\(/g;

/** The dependency array of each hook call, as raw source. */
function depArrays(src) {
  const out = [];
  for (const m of src.matchAll(HOOK)) {
    // Walk forward from the opening paren, tracking depth, to the matching
    // close. The dependency array is the last [...] before it.
    let depth = 0, i = m.index + m[0].length - 1, end = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    const call = src.slice(m.index, end);
    const close = call.lastIndexOf(']');
    const open = close === -1 ? -1 : call.lastIndexOf('[', close);
    if (open !== -1) out.push({ deps: call.slice(open + 1, close), at: m.index });
  }
  return out;
}

const FILES = walk(join(ROOT, 'app')).concat(walk(join(ROOT, 'lib')));

test('every hook dependency is a name that exists in its file', () => {
  const problems = [];

  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    if (!HOOK.test(src)) { HOOK.lastIndex = 0; continue; }
    HOOK.lastIndex = 0;

    const bound = boundNames(src);

    for (const { deps, at } of depArrays(src)) {
      // Only bare identifiers and the head of a member expression matter:
      // `a`, `a.b`, `a?.b`. Anything else (calls, literals) is skipped.
      const cleaned = deps.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/[(){}]/.test(cleaned)) continue;   // a call or object in the deps — skip

      for (const part of cleaned.split(',')) {
        const name = part.trim().split(/[.?[\]]/)[0].trim();
        if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        if (GLOBALS.has(name)) continue;
        if (!bound.has(name)) {
          const line = src.slice(0, at).split('\n').length;
          problems.push(`${file.replace(ROOT, '')}:~${line} → "${name}" is not defined in this file`);
        }
      }
    }
  }

  assert.deepEqual(problems, [], 'undefined identifiers in dependency arrays:\n' + problems.join('\n'));
});
