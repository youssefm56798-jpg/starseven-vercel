/**
 * The shop category pages.
 *
 * Wax and gel were `?kind=` filters that canonicalled back to /shop, so the
 * two head terms this brand sells against — "hair wax" and "hair gel" — had no
 * page of their own. They are paths now. What these tests hold is the part
 * that is easy to half-do: that each category has its own title, description
 * and canonical, that the copy is genuinely different rather than the same
 * sentence with a word swapped, and that an unknown category cannot mint a
 * third address for the same catalogue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, shopPath, shopCopy, shopMeta } from '../app/shop/lib.js';

// lib/config.js falls back to this when NEXT_PUBLIC_SITE_URL is unset.
const BASE = 'http://localhost:3000';
const LANGS = ['ar', 'en'];

test('there are exactly two categories', () => {
  assert.deepEqual(KINDS, ['wax', 'gel']);
});

test('a category is a path; anything else is the whole line', () => {
  assert.equal(shopPath('wax'), '/shop/wax');
  assert.equal(shopPath('gel'), '/shop/gel');
  for (const bogus of [null, undefined, '', 'all', 'clay', 'WAX', 'wax/gel', '../admin']) {
    assert.equal(shopPath(bogus), '/shop', `${bogus} should not mint a path`);
  }
});

test('every category has its own title and description in both languages', () => {
  for (const lang of LANGS) {
    const seen = new Set();
    for (const kind of [null, ...KINDS]) {
      const c = shopCopy(kind, lang);
      for (const field of ['crumb', 'h1', 'title', 'desc', 'lead']) {
        assert.ok(c[field] && c[field].trim().length > 0, `${kind}/${lang} missing ${field}`);
      }
      assert.ok(!seen.has(c.title), `duplicate title on ${kind}/${lang}`);
      assert.ok(!seen.has(c.desc), `duplicate description on ${kind}/${lang}`);
      seen.add(c.title);
      seen.add(c.desc);
    }
  }
});

test('the two category descriptions are not the same sentence reworded', () => {
  for (const lang of LANGS) {
    const wax = new Set(shopCopy('wax', lang).lead.split(/\s+/));
    const gel = new Set(shopCopy('gel', lang).lead.split(/\s+/));
    const shared = [...wax].filter(w => gel.has(w)).length;
    const overlap = shared / Math.min(wax.size, gel.size);
    assert.ok(overlap < 0.6, `${lang} leads overlap ${Math.round(overlap * 100)}%`);
  }
});

test('Arabic copy is Arabic and English copy is not', () => {
  const arabic = /[؀-ۿ]/;
  for (const kind of [null, ...KINDS]) {
    assert.ok(arabic.test(shopCopy(kind, 'ar').h1), `${kind} ar h1 is not Arabic`);
    assert.ok(!arabic.test(shopCopy(kind, 'en').h1), `${kind} en h1 contains Arabic`);
    assert.ok(arabic.test(shopCopy(kind, 'ar').desc), `${kind} ar desc is not Arabic`);
    assert.ok(!arabic.test(shopCopy(kind, 'en').desc), `${kind} en desc contains Arabic`);
  }
});

test('each page self-canonicals at its own language and its own path', () => {
  assert.equal(shopMeta('wax', 'ar').alternates.canonical, `${BASE}/shop/wax`);
  assert.equal(shopMeta('wax', 'en').alternates.canonical, `${BASE}/en/shop/wax`);
  assert.equal(shopMeta('gel', 'ar').alternates.canonical, `${BASE}/shop/gel`);
  assert.equal(shopMeta('gel', 'en').alternates.canonical, `${BASE}/en/shop/gel`);
  assert.equal(shopMeta(null, 'ar').alternates.canonical, `${BASE}/shop`);
  assert.equal(shopMeta(null, 'en').alternates.canonical, `${BASE}/en/shop`);
});

test('a category declares both languages as alternates of itself', () => {
  for (const kind of KINDS) {
    for (const lang of LANGS) {
      const langs = shopMeta(kind, lang).alternates.languages;
      assert.equal(langs['ar-EG'], `${BASE}/shop/${kind}`);
      assert.equal(langs['en-EG'], `${BASE}/en/shop/${kind}`);
      assert.equal(langs['x-default'], `${BASE}/shop/${kind}`);
    }
  }
});

test('descriptions stay inside what a search result will show', () => {
  for (const kind of [null, ...KINDS]) {
    for (const lang of LANGS) {
      const d = shopMeta(kind, lang).description;
      assert.ok(d.length <= 200, `${kind}/${lang} description is ${d.length} chars`);
      assert.ok(d.length >= 70, `${kind}/${lang} description is only ${d.length} chars`);
    }
  }
});

test('a title says which category it is', () => {
  assert.match(shopCopy('wax', 'en').title, /wax/i);
  assert.match(shopCopy('gel', 'en').title, /gel/i);
  assert.ok(shopCopy('wax', 'ar').title.includes('واكس'));
  assert.ok(shopCopy('gel', 'ar').title.includes('جل'));
});
