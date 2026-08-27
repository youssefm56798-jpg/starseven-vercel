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
 * So: read the family names out of the stylesheets, read the fonts the font
 * module declares, and assert the first set is covered by the second.
 *
 * The declarations used to live in app/layout.js and now live in lib/fonts.js,
 * which splits this file's reads in two. Loading a face and applying it are
 * separate steps in separate files now, and a face that is loaded perfectly but
 * never applied to <html> leaves the site in exactly the system-sans state
 * described above — so the two halves are asserted separately, and one test
 * asserts they are still connected to each other.
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

/** Where the faces are loaded, and where they are applied to the document. */
const FONTS = read('lib/fonts.js');
const LAYOUT = read('app/layout.js');

/** Font variables lib/fonts.js actually declares, e.g. '--font-anton'. */
function declaredVariables() {
  return new Set([...FONTS.matchAll(/variable:\s*'(--font-[a-z0-9-]+)'/g)].map(m => m[1]));
}

/** Every font-family declaration in a stylesheet. */
function declarations(css) {
  return [...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map(m => m[1].trim());
}

test('a font is loaded for every family the CSS names', () => {
  const declared = declaredVariables();
  assert.ok(declared.size > 0, 'lib/fonts.js declares no fonts at all');

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

test('every face lib/fonts.js loads is applied to <html> by the layout', () => {
  // The half of the job that stayed in app/layout.js. Loading a face and
  // putting its generated class on <html> are now two edits in two files, so
  // it is possible to do the first and forget the second — and the result is
  // silent: the build compiles, every var(--font-*) resolves to nothing, and
  // the site renders in a system sans exactly as it did before the fonts were
  // wired up at all.
  // Comments first: the block above the layout function discusses <html> at
  // length, and the element this test wants is the one that is rendered.
  const jsx = LAYOUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const html = jsx.match(/<html[\s\S]*?>/);
  assert.ok(html, 'app/layout.js renders no <html> element');

  const missing = [];
  for (const variable of declaredVariables()) {
    const instance = variable.replace('--font-', '');
    if (!new RegExp(`\\$\\{${instance}\\.variable\\}`).test(html[0])) {
      missing.push(`${variable} is loaded in lib/fonts.js but never reaches <html>`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('there is exactly one next/font call site per face', () => {
  // The reason lib/fonts.js exists. Each next/font call generates its own class
  // name and its own preload links, so a second call for a family already
  // loaded there does not reuse it — it ships the same font twice under two
  // names. A later phase splits the root layout per language tree, and the
  // tempting way to do that is to re-declare the fonts in the new half.
  assert.doesNotMatch(LAYOUT, /from\s+'next\/font/,
    'app/layout.js calls next/font itself — import the instances from ' +
    'lib/fonts.js instead, or the same face ships twice under two class names');
  assert.match(LAYOUT, /from\s+'\.\.\/lib\/fonts\.js'/,
    'app/layout.js does not import the shared font instances');
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
  // The assertion is right; the reason it used to give was not. next/font asks
  // Google for the family with no subset parameter and self-hosts every subset
  // that comes back, so `subsets` does not decide what is downloaded - it
  // decides which files are marked preloadable. Dropping 'arabic' would leave
  // the Arabic storefront, which is the default language, waiting on an
  // unpreloaded file for every glyph above the fold.
  const cairo = FONTS.match(/Cairo\(\{[\s\S]*?\}\)/);
  assert.ok(cairo, 'Cairo is not loaded');
  assert.match(cairo[0], /subsets:\s*\[[^\]]*'arabic'/,
    'Cairo is loaded without the arabic subset');
});

test('the weights the CSS uses are the weights that get downloaded', () => {
  const cairo = FONTS.match(/Cairo\(\{[\s\S]*?\}\)/)?.[0] ?? '';
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

test('the display tier blocks and the body tier swaps', () => {
  // The two loading policies lib/fonts.js explains at length, asserted rather
  // than only described. Anton and Tajawal set the hero, and on 'swap' it
  // paints in an Arial-derived fallback before changing under the reader —
  // reported three times as the English font having changed on its own. Cairo
  // is the body tier and wants the opposite: readable immediately beats
  // correct but invisible. Flipping either is a one-word edit that nothing
  // else in this suite would notice.
  const strategy = family => {
    const call = FONTS.match(new RegExp(`${family}\\(\\{[\\s\\S]*?\\}\\)`));
    assert.ok(call, `${family} is not loaded`);
    const display = call[0].match(/display:\s*'(\w+)'/);
    assert.ok(display, `${family} does not set a display strategy`);
    return display[1];
  };

  assert.equal(strategy('Anton'), 'block',
    'Anton sets the hero: on swap it paints in the fallback first and visibly changes');
  assert.equal(strategy('Tajawal'), 'block',
    'Tajawal sets the Arabic hero: on swap it paints in the fallback first and visibly changes');
  assert.equal(strategy('Cairo'), 'swap',
    'Cairo is the body tier: on block the running text is invisible until it arrives');
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
