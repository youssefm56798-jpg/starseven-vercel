/**
 * Two phone-layout rules that are invisible on a desktop and easy to undo.
 *
 * Both were real bugs found by looking at a 375px screen, and neither would
 * have shown up in anything else here: no test renders CSS, and both pages
 * pass every other check while looking wrong. So these read the stylesheets as
 * text, the same way tests/route-handler-auth.test.mjs reads route files —
 * enough to catch the specific edit that brings the bug back, and honest about
 * being no substitute for looking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

const GLOBALS = read('app/globals.css');
const LANDING = read('app/landing.css');

test('the WhatsApp float is raised only on pages that have a buybar', () => {
  // .buybar is fixed to the bottom of product pages only. The float used to be
  // lifted 86px on every phone page to clear it, which parked it a third of
  // the way up the screen everywhere else — on top of body text, and on top of
  // the hair finder's two alternate product buttons.
  const raises = [...GLOBALS.matchAll(/([^\n{}]*)\{[^}]*bottom:calc\(86px[^}]*\}/g)]
    .map(m => m[1].trim());

  assert.ok(raises.length > 0, 'nothing raises the float any more — does the buybar still exist?');
  for (const selector of raises) {
    assert.match(selector, /pdp-has-buybar/,
      `"${selector}" raises the WhatsApp float 86px without requiring a buybar on the page, `
      + 'so it floats in the middle of every phone screen that has no bar');
  }
});

test('the float clears the buybar it is raised for', () => {
  // 86px against a bar whose own height is set by its padding and content. If
  // the bar grows past that the float lands back on top of it, which is the
  // bug this number exists to prevent.
  assert.match(GLOBALS, /\.pdp-has-buybar ~ \.wa-float\{bottom:calc\(86px \+ env\(safe-area-inset-bottom\)\)\}/,
    'the raised float no longer adds the safe-area inset, so it sits under the home indicator');
});

test('the finder alternates are a grid on a phone, not a wrapping row', () => {
  // Two names side by side need ~254px and the card is ~297px wide at 375. As
  // a flex row that fits by nine pixels, and stopped fitting the moment a
  // product name got longer — at which point the label and both pills each
  // took their own line. A two-column grid cannot go ragged.
  const phone = LANDING.match(/@media\(max-width:560px\)\{[\s\S]*?\n\}/);
  assert.ok(phone, 'the 560px block in landing.css has gone');

  assert.match(phone[0], /\.hres-alt\{display:grid;grid-template-columns:1fr 1fr\}/,
    'the alternate product links are no longer a two-column grid on phones');
  assert.match(phone[0], /\.hres-alt a:only-of-type\{grid-column:1 \/ -1\}/,
    'a lone alternate no longer spans both columns, so it renders as a half-width stub');
});

test('the result card is not double-padded on a phone', () => {
  // .hres-in pads the dark panel and .hres-pick pads the card inside it, on
  // top of the page gutter. At the desktop clamp that left the card 281px of a
  // 375px screen.
  const phone = LANDING.match(/@media\(max-width:560px\)\{[\s\S]*?\n\}/);
  assert.match(phone[0], /\.hres-in\{padding:16px\}/,
    'the finder panel is back to its desktop padding on phones, which squeezes the card');
});
