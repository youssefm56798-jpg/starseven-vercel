/**
 * Every file that uses a node:crypto function imports it.
 *
 * This exists because of a real, shipped, invisible break. A commit tightened
 * the /admin/setup key comparison to be constant-time, added createHash and
 * timingSafeEqual to the function — and imported neither. Every request to
 * /admin/setup threw ReferenceError and rendered the 500 page.
 *
 * Nothing caught it. `next build` compiles a ReferenceError happily, because it
 * is a runtime fault and not a syntax one. The test suite did not reach it: the
 * admin suites enumerate Server Actions and route handlers and check each one
 * guards a session, which that file does. And it failed CLOSED, so it did not
 * even look wrong from outside — the page refused everybody, which is roughly
 * what a setup page does anyway. It sat there until somebody opened it during a
 * handover check.
 *
 * A general linter would find this and this project has none. So this is the
 * narrow version. The crypto helpers are the ones that get added to a security
 * fix in a hurry, and they are the ones whose absence fails closed and
 * therefore silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** The node:crypto names this codebase actually reaches for. */
const NAMES = [
  'createHash', 'createHmac', 'timingSafeEqual', 'randomBytes',
  'randomUUID', 'scrypt', 'scryptSync', 'createCipheriv', 'createDecipheriv',
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** Source with comments removed, so prose naming a function is not read as a call. */
function code(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(l => (l.trim().startsWith('//') ? '' : l))
    .join('\n');
}

test('nothing calls a node:crypto function it has not imported', () => {
  const files = [
    ...walk(join(ROOT, 'app')),
    ...walk(join(ROOT, 'lib')),
    ...walk(join(ROOT, 'scripts')),
  ];
  assert.ok(files.length > 50, `only found ${files.length} files - has the scan broken?`);

  const problems = [];

  for (const file of files) {
    const src = code(file);

    for (const name of NAMES) {
      // A CALL of it, and not `crypto.createHash(...)` off the Web Crypto global
      // or a namespace import — those bring their own object with them.
      const called = new RegExp(String.raw`(^|[^.\w])${name}\s*\(`).test(src);
      if (!called) continue;

      const imported =
        // import { createHash } from 'node:crypto'   (or from 'crypto')
        new RegExp(String.raw`import\s*\{[^}]*\b${name}\b[^}]*\}\s*from\s*['"](node:)?crypto['"]`, 's').test(src)
        // const { createHash } = require('crypto') | await import('node:crypto')
        || new RegExp(String.raw`\{[^}]*\b${name}\b[^}]*\}\s*=\s*(await\s+import|require)\(\s*['"](node:)?crypto['"]`, 's').test(src)
        // ...or the file declares its own function of that name, which is fine.
        || new RegExp(String.raw`(function|const|let|var)\s+${name}\b`).test(src);

      if (!imported) {
        problems.push(`${relative(ROOT, file).split(sep).join('/')} calls ${name}() without importing it`);
      }
    }
  }

  assert.deepEqual(problems, [],
    `these throw ReferenceError at runtime and build cleanly:\n${problems.join('\n')}`);
});
