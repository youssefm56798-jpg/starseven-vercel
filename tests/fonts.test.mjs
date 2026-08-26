/**
 * Every font the stylesheets ask for must actually be loaded.
 *
 * This exists because the port dropped the Google Fonts <link> the PHP site
 * carried, and nothing replaced it. Thirty-four `font-family` declarations
 * went on naming 'Anton' and 'Cairo', the browser found neither, and the whole
 * site quietly rendered in a system sans — including the display type the
 * design is built around.
 *
 * Nothing catches that. The build compiles, the CSS is valid, the selectors
 * match, and `document.fonts.check('400 100px Anton')` even returns true when
 * no such face is registered. The only signal was the page looking wrong.
 *
 * So: read the family names out of the stylesheets, read the fonts the layout
 * declares, and assert the first set is covered by the second.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(join(ROOT, p), 'utf8');

const STYLESHEETS = [
  'app/globals.css',
  'app/landing.css',
  'app/hair-types/hairtypes.css',
  'app/admin/admin.css',
].filter(p => existsSync(join(ROOT, p)));

const LAYOUT = read('app/layout.js');

/** Font variables the layout actually declares, e.g. '--font-anton'. */
function declaredVariables() {
  return new Set([...LAYOUT.matchAll(/variable:\s*'(--font-[a-z0-9-]+)'/g)].map(m => m[1]));
}

/** Every font-family declaration in a stylesheet. */
function declarations(css) {
  return [...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map(m => m[1].trim());
}

test('the layout loads a font for every family the CSS names', () => {
  const declared = declaredVariables();
  assert.ok(declared.size > 0, 'app/layout.js declares no fonts at all');

  const missing = [];
  for (const file of STYLESHEETS) {
    for (const value of declarations(read(file))) {
      for (const m of value.matchAll(/var\(\s*(--font-[a-z0-9-]+)\s*\)/g)) {
        if (!declared.has(m[1])) missing.push(`${file}: ${m[1]} is used but never loaded`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('no stylesheet names a web font by a literal it cannot load', () => {
  // A quoted family name only works if something registers that exact face.
  // Generic and system families are fine — they need no loading.
  const SYSTEM = new Set([
    'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-monospace', 'inherit',
    'ui-sans-serif', 'cursive', 'fantasy', '-apple-system', 'blinkmacsystemfont',
    'segoe ui', 'roboto', 'helvetica neue', 'arial', 'sfmono-regular', 'menlo',
    'consolas', 'courier new', 'initial', 'unset', 'revert',
  ]);

  const offenders = [];
  for (const file of STYLESHEETS) {
    for (const value of declarations(read(file))) {
      for (const m of value.matchAll(/['"]([^'"]+)['"]/g)) {
        if (!SYSTEM.has(m[1].toLowerCase())) {
          offenders.push(`${file}: "${m[1]}" is named but nothing loads it — use a var(--font-*)`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('Cairo ships the Arabic subset, because Arabic is the default language', () => {
  // Left implicit, next/font ships Latin only. The Arabic storefront would
  // then fall back for every glyph on the page — the original bug, restored.
  const cairo = LAYOUT.match(/Cairo\(\{[\s\S]*?\}\)/);
  assert.ok(cairo, 'Cairo is not loaded');
  assert.match(cairo[0], /subsets:\s*\[[^\]]*'arabic'/,
    'Cairo is loaded without the arabic subset');
});

test('the weights the CSS uses are the weights that get downloaded', () => {
  const cairo = LAYOUT.match(/Cairo\(\{[\s\S]*?\}\)/)?.[0] ?? '';
  const loaded = new Set([...cairo.matchAll(/'(\d{3})'/g)].map(m => m[1]));

  // Collect the weights actually asked for alongside the Cairo variable.
  const used = new Set();
  for (const file of STYLESHEETS) {
    const css = read(file);
    for (const m of css.matchAll(/font-weight\s*:\s*(\d{3})/g)) used.add(m[1]);
  }

  const missing = [...used].filter(w => !loaded.has(w));
  assert.deepEqual(missing, [],
    `the CSS asks for weight(s) ${missing.join(', ')} that are never downloaded — ` +
    'the browser will synthesise them, which looks wrong on a display face');
});

test('the display face is applied to the hero', () => {
  // The specific thing the customer complained about, twice.
  const landing = read('app/landing.css');
  const rule = landing.match(/\.s7home \.en-display\{[^}]*\}/);
  assert.ok(rule, '.en-display has no rule');
  assert.match(rule[0], /font-family:var\(--font-anton\)/,
    'the English hero is not set in Anton');
});

test('images keep their aspect ratio when a column is narrower than they are', () => {
  // Every <img> in this codebase carries width and height attributes, which is
  // right — they reserve space and prevent layout shift. But `max-width:100%`
  // then shrinks the width while the height attribute holds the height fixed,
  // so the image stretches. A 600x600 product shot rendered 381x600 and was
  // clipped by the container. `height:auto` is what stops that.
  const css = read('app/globals.css');
  const base = css.match(/(^|\n)img\{([^}]*)\}/);
  assert.ok(base, 'no base img rule found in globals.css');
  assert.match(base[2], /height:\s*auto/,
    'the base img rule sets max-width without height:auto, so any image in a ' +
    'column narrower than its width attribute will render stretched');
});
