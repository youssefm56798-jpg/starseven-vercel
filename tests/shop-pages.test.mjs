/**
 * The shop category pages.
 *
 * Wax and gel were `?kind=` filters that canonicalled back to /shop, so the
 * two head terms this brand sells against had no page of their own. They are
 * paths now, and the catalogue has since grown to seven categories.
 *
 * What these tests hold is the part that is easy to half-do: that each
 * category has its own title, description and canonical, that the copy is
 * genuinely different rather than the same sentence with a word swapped, and
 * that an unknown category cannot mint another address for the same catalogue.
 *
 * They also pin the one distinction that is easy to collapse by accident — a
 * category's URL slug is not its `kind` column, and conflating them would make
 * /shop/cream-gel query for kind = 'cream-gel' and quietly return nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, KINDS, shopPath, shopCopy, shopMeta, kindColumn } from '../app/shop/lib.js';

// lib/config.js falls back to this when NEXT_PUBLIC_SITE_URL is unset.
const BASE = 'http://localhost:3000';
const LANGS = ['ar', 'en'];

test('wax and gel lead the category list', () => {
  assert.equal(KINDS[0], 'wax');
  assert.equal(KINDS[1], 'gel');
});

test('every category has a distinct slug and a distinct kind column', () => {
  assert.equal(new Set(KINDS).size, KINDS.length, 'duplicate slug');
  const kinds = CATEGORIES.map(c => c.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'two categories share a kind column');
});

test('the kind column is a value the database CHECK allows', () => {
  // Mirrors the CHECK in db/schema.sql. A category whose kind is not in this
  // set inserts nothing and shows an empty page.
  const ALLOWED = new Set(['wax', 'gel', 'gelwax', 'cream', 'spray',
                           'cologne', 'shampoo', 'depilatory']);
  for (const c of CATEGORIES) {
    assert.ok(ALLOWED.has(c.kind), `${c.slug} maps to unknown kind ${c.kind}`);
  }
});

test('a category is a path; anything else is the whole line', () => {
  for (const slug of KINDS) assert.equal(shopPath(slug), `/shop/${slug}`);
  for (const bogus of [null, undefined, '', 'all', 'clay', 'WAX', 'wax/gel', '../admin']) {
    assert.equal(shopPath(bogus), '/shop', `${bogus} should not mint a path`);
  }
});

test('kindColumn resolves a slug and refuses anything else', () => {
  assert.equal(kindColumn('cream-gel'), 'cream');
  assert.equal(kindColumn('gel-wax'), 'gelwax');
  assert.equal(kindColumn('hair-spray'), 'spray');
  assert.equal(kindColumn('wax'), 'wax');
  for (const bogus of [null, undefined, '', 'all', 'cream', 'gelwax']) {
    assert.equal(kindColumn(bogus), null, `${bogus} should not resolve`);
  }
});

test('every category has its own title and description in both languages', () => {
  for (const lang of LANGS) {
    const seen = new Set();
    for (const slug of [null, ...KINDS]) {
      const c = shopCopy(slug, lang);
      for (const field of ['crumb', 'h1', 'title', 'desc', 'lead']) {
        assert.ok(c[field] && c[field].trim().length > 0, `${slug}/${lang} missing ${field}`);
      }
      assert.ok(!seen.has(c.title), `duplicate title on ${slug}/${lang}`);
      assert.ok(!seen.has(c.desc), `duplicate description on ${slug}/${lang}`);
      seen.add(c.title);
      seen.add(c.desc);
    }
  }
});

test('no two category leads are the same sentence reworded', () => {
  for (const lang of LANGS) {
    for (let i = 0; i < KINDS.length; i++) {
      for (let j = i + 1; j < KINDS.length; j++) {
        const a = new Set(shopCopy(KINDS[i], lang).lead.split(/\s+/));
        const b = new Set(shopCopy(KINDS[j], lang).lead.split(/\s+/));
        const shared = [...a].filter(w => b.has(w)).length;
        const overlap = shared / Math.min(a.size, b.size);
        assert.ok(overlap < 0.6,
          `${lang}: ${KINDS[i]} and ${KINDS[j]} leads overlap ${Math.round(overlap * 100)}%`);
      }
    }
  }
});

test('Arabic copy is Arabic and English copy is not', () => {
  const arabic = /[؀-ۿ]/;
  for (const slug of [null, ...KINDS]) {
    assert.ok(arabic.test(shopCopy(slug, 'ar').h1), `${slug} ar h1 is not Arabic`);
    assert.ok(!arabic.test(shopCopy(slug, 'en').h1), `${slug} en h1 contains Arabic`);
    assert.ok(arabic.test(shopCopy(slug, 'ar').desc), `${slug} ar desc is not Arabic`);
    assert.ok(!arabic.test(shopCopy(slug, 'en').desc), `${slug} en desc contains Arabic`);
  }
});

test('each page self-canonicals at its own language and its own path', () => {
  for (const slug of KINDS) {
    assert.equal(shopMeta(slug, 'ar').alternates.canonical, `${BASE}/shop/${slug}`);
    assert.equal(shopMeta(slug, 'en').alternates.canonical, `${BASE}/en/shop/${slug}`);
  }
  assert.equal(shopMeta(null, 'ar').alternates.canonical, `${BASE}/shop`);
  assert.equal(shopMeta(null, 'en').alternates.canonical, `${BASE}/en/shop`);
});

test('a category declares both languages as alternates of itself', () => {
  for (const slug of KINDS) {
    for (const lang of LANGS) {
      const langs = shopMeta(slug, lang).alternates.languages;
      assert.equal(langs['ar-EG'], `${BASE}/shop/${slug}`);
      assert.equal(langs['en-EG'], `${BASE}/en/shop/${slug}`);
      assert.equal(langs['x-default'], `${BASE}/shop/${slug}`);
    }
  }
});

test('descriptions stay inside what a search result will show', () => {
  for (const slug of [null, ...KINDS]) {
    for (const lang of LANGS) {
      const d = shopMeta(slug, lang).description;
      assert.ok(d.length <= 210, `${slug}/${lang} description is ${d.length} chars`);
      assert.ok(d.length >= 70, `${slug}/${lang} description is only ${d.length} chars`);
    }
  }
});

test('a title says which category it is', () => {
  assert.match(shopCopy('wax', 'en').title, /wax/i);
  assert.match(shopCopy('gel', 'en').title, /gel/i);
  assert.match(shopCopy('cologne', 'en').title, /cologne/i);
  assert.ok(shopCopy('wax', 'ar').title.includes('واكس'));
  assert.ok(shopCopy('gel', 'ar').title.includes('جل'));
});

test('the depilatory range says out loud that it is not styling wax', () => {
  // The Arabic SERP for "wax" is dominated by hair REMOVAL, and the styling
  // copy was deliberately qualified to stay out of it. Now that the removal
  // range is on the same site, its page has to draw the line itself.
  assert.match(shopCopy('depilatory', 'en').lead, /different thing/i);
  assert.ok(shopCopy('depilatory', 'ar').lead.includes('حاجة تانية'));
});

test('moving between shop categories does not play the page transition', async () => {
  // The chips read as filters. A 420ms cover plus a 620ms reveal on each one
  // made the catalogue feel broken, so PageWipe treats /shop -> /shop/wax as
  // one screen rather than a navigation. Read as text: PageWipe is a client
  // component and imports next/navigation, so it cannot be imported here.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const src = readFileSync(join(root, 'app/_components/PageWipe.js'), 'utf8');

  const m = src.match(/function isShopPath\(pathname\)\s*\{\s*return (\/.+\/)\.test/);
  assert.ok(m, 'PageWipe no longer skips the transition between shop categories');

  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')));
  for (const p of ['/shop', '/shop/wax', '/shop/cream-gel', '/en/shop', '/en/shop/gel-wax']) {
    assert.ok(re.test(p), `${p} should count as a shop screen`);
  }
  for (const p of ['/', '/blog', '/product/premium-wax-pro-x', '/shop/wax/extra', '/en/account']) {
    assert.ok(!re.test(p), `${p} should NOT count as a shop screen`);
  }
});
