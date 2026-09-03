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
import { CATEGORIES, KINDS, shopPath, shopCopy, shopMeta, kindColumn, liveCategories } from '../app/shop/lib.js';

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
  const ALLOWED = new Set(['wax', 'gel', 'gelwax', 'cream', 'clay', 'pomade',
                           'spray', 'cologne', 'shampoo', 'depilatory']);
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

test('the transition skips filtering, and only filtering', async () => {
  // The chips read as filters. A 420ms cover plus a 620ms reveal on each one
  // made the catalogue feel broken, so PageWipe treats /shop -> /shop/wax as
  // one screen rather than a navigation.
  //
  // The rule has to be per language tree, and that is not a detail: matching
  // /shop/wax -> /en/shop as "filtering" silently took the transition off the
  // language toggle on every category page, which is the one control on the
  // page that most obviously IS a navigation.
  //
  // Read as text rather than imported: PageWipe is a client component and
  // imports next/navigation, so a node:test file cannot load it. The helper is
  // lifted out and evaluated, so this exercises the real predicate rather than
  // asserting a string is present somewhere in the file.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const src = readFileSync(join(root, 'app/_components/PageWipe.js'), 'utf8');

  const shopSrc = src.match(/function shopTree\(pathname\)\s*\{[\s\S]*?\n\}/);
  assert.ok(shopSrc, 'PageWipe no longer decides which tree a shop path is in');
  const adminSrc = src.match(/function isAdminPath\(pathname\)\s*\{[\s\S]*?\n\}/);
  assert.ok(adminSrc, 'PageWipe no longer exempts the admin panel');

  const shopTree = new Function(`${shopSrc[0]}; return shopTree;`)();
  const isAdminPath = new Function(`${adminSrc[0]}; return isAdminPath;`)();

  // Which tree each address belongs to.
  for (const [p, want] of [
    ['/shop', 'ar'], ['/shop/wax', 'ar'], ['/shop/cream-gel', 'ar'],
    ['/en/shop', 'en'], ['/en/shop/gel-wax', 'en'],
    ['/', null], ['/blog', null], ['/product/premium-wax-pro-x', null],
    ['/shop/wax/extra', null], ['/en/account', null], ['/shopping', null],
  ]) {
    assert.equal(shopTree(p), want, `${p} classified wrong`);
  }

  // The exemption itself: same tree is filtering, across trees is a language
  // switch and must keep the transition.
  const filtering = (from, to) => {
    const a = shopTree(from), b = shopTree(to);
    return Boolean(a && b && a === b);
  };
  assert.equal(filtering('/shop', '/shop/wax'), true, 'chip to chip should be silent');
  assert.equal(filtering('/en/shop/wax', '/en/shop/gel'), true, 'English chips too');
  assert.equal(filtering('/shop/wax', '/en/shop'), false, 'the language toggle is a navigation');
  assert.equal(filtering('/en/shop', '/shop'), false, 'and in the other direction');
  assert.equal(filtering('/', '/shop/wax'), false, 'home into a category is a navigation');
  assert.equal(filtering('/shop/wax', '/product/x'), false, 'a category into a product is too');

  // The admin shares the root layout and therefore this component. A
  // full-screen warm-paper panel with the storefront star mark does not belong
  // in a back office, and on the Export CSV link it was actively harmful: a
  // download leaves the page where it is, so nothing arrives and the panel sits
  // there until the failsafe expires.
  for (const p of ['/admin', '/admin/orders', '/admin/products']) {
    assert.equal(isAdminPath(p), true, `${p} should be exempt`);
  }
  for (const p of ['/', '/shop', '/administrator', '/en/admin']) {
    assert.equal(isAdminPath(p), false, `${p} should not be treated as admin`);
  }
});

test('the transition cannot latch itself off', async () => {
  // The latch that stops a second click landing mid-cover used to be a closure
  // variable lowered in exactly one place: the failsafe, 2500ms after the 420ms
  // cover. So for ~2.9 seconds after any transitioned click, every further
  // click was ignored and got no transition - which is most of the times a
  // person clicks twice. It has to be released when the navigation COMMITS.
  //
  // Guarded structurally: the latch and the timers must be refs, because a
  // closure variable is unreachable from the arrival effect by construction.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const src = readFileSync(join(root, 'app/_components/PageWipe.js'), 'utf8');

  assert.match(src, /const leaving = useRef\(/, 'the latch is a closure again, so no arrival can lower it');
  assert.match(src, /const failsafe = useRef\(/, 'the strand-guard is a closure again');
  assert.doesNotMatch(src, /let leaving\b/, 'a closure-scoped latch is back');

  const effects = src.split('useEffect(');
  const arrival = effects.find(b => /setAttribute\(\s*['"]data-enter['"]/.test(b));
  assert.ok(arrival, 'no arrival effect');
  assert.match(arrival, /leaving\.current = false/, 'the arrival never releases the latch');
  assert.match(arrival, /clearTimeout\(failsafe\.current\)/,
    'the arrival leaves a stale strand-guard armed to fire into the next navigation');
});

test('arriving where the cover was skipped does not play the reveal on its own', async () => {
  // The transition is two halves and only the first one was being skipped. The
  // click handler already refused to hijack a move between two shop paths, so
  // no panel ever rose on a filter chip - but the arrival effect answered to
  // any pathname change at all, so the second half still ran and swept a panel
  // up over a page that had never been covered. Every chip flashed it, and so
  // did every browser back and forward. What holds the two halves together is
  // a latch: the cover records that it ran, the arrival refuses to reveal
  // anything unless it did, and the pageshow/popstate failsafe puts the latch
  // back down. Read as text for the same reason as the test above: PageWipe is
  // a client component and imports next/navigation.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const src = readFileSync(join(root, 'app/_components/PageWipe.js'), 'utf8');

  // Each effect body, in source order: leaving, arriving, then the failsafe.
  const effects = src.split(/useEffect\s*\(/).slice(1);
  const leaving = effects.find(b => b.includes('isPlainInternalLink'));
  const arrival = effects.find(b => /setAttribute\(\s*['"]data-enter['"]/.test(b));
  const failsafe = effects.find(b => b.includes('pageshow') && b.includes('popstate'));
  assert.ok(leaving, 'nothing starts the cover on a click any more');
  assert.ok(arrival, 'nothing arms the reveal any more');
  assert.ok(failsafe, 'the pageshow/popstate failsafe is gone');

  // The latch names itself: the arrival bails out on a ref that says nothing is
  // covering the page. Whatever it is called, the rest has to agree with it.
  const bail = arrival.match(/if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\s*\.current\s*\)\s*return/);
  assert.ok(bail, 'the reveal plays without asking whether anything was covered');
  const name = bail[1].replace(/\$/g, '\\$&');
  const raised = new RegExp(`${name}\\.current\\s*=\\s*true`);
  const lowered = new RegExp(`${name}\\.current\\s*=\\s*false`);

  assert.match(src, new RegExp(`const\\s+${name}\\s*=\\s*useRef\\(\\s*false\\s*\\)`),
    `${bail[1]} is not a ref that starts out down`);
  assert.ok(arrival.indexOf(bail[0]) < arrival.search(/setAttribute\(\s*['"]data-enter['"]/),
    'the reveal is armed before the guard gets a chance to stop it');
  assert.match(arrival, lowered, 'one cover would arm every later arrival');

  assert.match(leaving, raised, 'the cover no longer records that it ran');
  assert.ok(leaving.search(raised) > leaving.indexOf('isPlainInternalLink'),
    'the cover claims to have run before deciding whether it should run at all');

  assert.match(failsafe, lowered,
    'back and forward leave the latch up, so the next arrival reveals a page nobody covered');
});

test('every control that filters the catalogue opts out of the page transition', async () => {
  // The exemption above is a rule about paths, and it only fires when the
  // visitor is ALREADY on a shop page. That is not where the complaint came
  // from. Pressing "hair spray" in the nav submenu, or a range link in the
  // footer, happens from the home page or an article, and it used to play the
  // full 420ms cover and 620ms reveal even though it lands on the same
  // catalogue screen the chips land on.
  //
  // So the controls that filter say so themselves, with data-no-transition on
  // the anchor. This test is the list, and it holds both directions: the
  // pickers carry the attribute, and the two links that are genuinely leaving
  // the page do not. Read as text - these are server and client components
  // that import next/link, next/navigation and the database, so none of them
  // can be imported under node:test.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  // Comments first, so a needle matches markup and never the prose explaining
  // it. The `[^:]` guard is what keeps 'https://...' literals intact.
  const read = rel => readFileSync(join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /**
   * The opening tag that starts at `from`. Brace-aware, because an arrow
   * function in a prop - onClick={e => ...} - puts a `>` inside the tag, and a
   * naive scan to the first `>` would cut the tag in half and report a missing
   * attribute that is sitting right there.
   */
  const openingTagAt = (src, from) => {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) return src.slice(from, i + 1);
    }
    return null;
  };

  /**
   * The <Link> that owns the nth occurrence of `needle`, which may be a prop
   * inside the tag or the link's own child text. Refusing an intervening
   * </Link> is what stops a <button> two lines further down from being
   * credited to the <Link> above it - the hold tiles are exactly that shape.
   */
  const linkAround = (src, needle, nth, where) => {
    let at = -1;
    for (let i = 0; i < nth; i++) {
      at = src.indexOf(needle, at + 1);
      assert.notEqual(at, -1, `${where}: occurrence ${nth} of ${needle} is gone - retarget this test`);
    }
    const start = src.lastIndexOf('<Link', at);
    assert.notEqual(start, -1, `${where}: nothing opens a <Link> before it`);
    assert.ok(!src.slice(start, at).includes('</Link>'),
      `${where}: the nearest <Link> closes before the needle, so this is not a link any more`);
    const tag = openingTagAt(src, start);
    assert.ok(tag, `${where}: could not find where the <Link> tag ends`);
    return tag;
  };

  // file, needle, which occurrence, does it filter?, what it is
  const CONTROLS = [
    ['app/shop/view.js', "active === 'all' ? 'on' : ''", 1, true,
      'the All chip on /shop'],
    ['app/shop/view.js', "active === c.slug ? 'on' : ''", 1, true,
      'the category chips on /shop'],
    ['app/_components/Chrome.js', 'The full line', 1, true,
      'the All row of the nav submenu'],
    ['app/_components/Chrome.js', '/shop/${c.slug}', 1, true,
      'the nav submenu categories - the control the client named'],
    ['app/_components/Chrome.js', '/shop/${c.slug}', 2, true,
      'the footer range column'],
    ['app/_components/Landing.js', 'tab tab-out', 1, true,
      'the home range tabs, which sit in the same pill row as the filters'],
    ['app/_components/Landing.js', 'className="hcard"', 1, true,
      'the gel wax hold tile, identical to the three tiles that filter'],
    ['app/_components/Landing.js', 'pickHair(x.slug)', 1, true,
      'the home hair-type tiles, which cancel their own click and filter in place'],

    // The other direction. These land on the shop too and must still wipe,
    // because neither of them is part of a picker: one is the site map at the
    // bottom of every page, the other a bordered button below the home grid
    // worded as leaving.
    ['app/_components/Chrome.js', 'The full line', 2, false,
      'the footer Links column, which is the site map'],
    ['app/_components/Landing.js', '{d.shop_all}', 1, false,
      'See the whole range, the button below the home grid'],
  ];

  for (const [file, needle, nth, filters, what] of CONTROLS) {
    const tag = linkAround(read(file), needle, nth, `${file} (${what})`);
    const opted = /\bdata-no-transition\b/.test(tag);
    assert.equal(opted, filters, filters
      ? `${file}: ${what} filters the catalogue but still plays the page transition`
      : `${file}: ${what} is a page change and should keep the page transition`);
  }

  // PageWipe has to be reading the attribute these call sites are writing.
  const wipe = read('app/_components/PageWipe.js');
  assert.match(wipe, /dataset\.noTransition\s*!==\s*undefined/,
    'PageWipe no longer honours data-no-transition, so every opt-out above is inert');

  // The trap in the presence check: React renders a data attribute set to
  // false as the string "false", which is still present, so an author writing
  // data-no-transition={false} to mean "do transition" would silently get the
  // opposite. Conditional opt-outs have to render undefined instead.
  for (const [file] of CONTROLS) {
    assert.doesNotMatch(read(file), /data-no-transition=\{\s*(?:false|true)\s*\}/,
      `${file}: data-no-transition is presence-based - a boolean renders as a string and always opts out`);
  }
});

test('the page transition listens in the capture phase, or it does nothing at all', async () => {
  // Restoring this component unchanged restored a component that never fired.
  //
  // <Link> navigates from a React onClick, and React 19 under the App Router
  // hydrates the document itself, so React's delegated listeners are on
  // `document`. A bubble listener added by an effect is therefore on the same
  // node and registered later, so it runs second - after Link has already
  // called preventDefault - and PageWipe bails on e.defaultPrevented before it
  // does anything. Measured against the dev server on a trusted mouse click:
  // the click reached a document-level bubble listener with defaultPrevented
  // already true, and the cover never played on any link on the site.
  //
  // Capture runs on the way down, ahead of Link's onClick. It also keeps Link
  // from navigating out from under the cover, because app-dir/link.js returns
  // early on `if (e.defaultPrevented)`. So the phase is not a preference here,
  // it is the whole difference between a transition and dead code - and it is
  // invisible in review, which is why it is pinned.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const src = readFileSync(join(root, 'app/_components/PageWipe.js'), 'utf8');

  assert.match(src, /addEventListener\(\s*'click'\s*,\s*onClick\s*,\s*true\s*\)/,
    'the click listener is not in the capture phase, so next/link prevents the ' +
    'default before PageWipe ever sees the click and no transition plays');
  assert.match(src, /removeEventListener\(\s*'click'\s*,\s*onClick\s*,\s*true\s*\)/,
    'the listener is added in the capture phase but removed from the bubble ' +
    'phase, so it is never actually removed and every remount adds another');
});

test('liveCategories offers only what is switched on, in display order', () => {
  assert.deepEqual(liveCategories(['gel', 'wax']).map(c => c.slug), ['wax', 'gel']);
  assert.deepEqual(liveCategories(['cream', 'gelwax']).map(c => c.slug), ['gel-wax', 'cream-gel']);

  // An unpriced category is an empty page. Neither a kind nobody sells nor a
  // slug mistaken for a kind may open one.
  assert.deepEqual(liveCategories([]), []);
  assert.deepEqual(liveCategories(['cologne']).map(c => c.slug), ['cologne']);
  assert.deepEqual(liveCategories(['cream-gel', 'gel-wax']), []);
  for (const junk of [null, undefined, 'wax', 42]) assert.deepEqual(liveCategories(junk), []);
});

test('the nav submenu is generated, not a hand-written pair of links', async () => {
  // Wax and gel were the whole shop once, so the submenu named them literally.
  // The range grew to four live categories and gel wax and cream gel were then
  // reachable only by guessing the URL - /shop knew about them, the sitemap
  // knew about them, and the nav did not. Read as text: Chrome.js is a server
  // component that imports next/link and the database.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const src = readFileSync(join(root, 'app/_components/Chrome.js'), 'utf8');

  assert.ok(src.includes('liveCategories'), 'the nav no longer asks which categories are live');
  assert.doesNotMatch(src, /['"`]\/shop\/(wax|gel)['"`]/,
    'a category is hard-coded into the nav or the footer again');
});

test('the quick view is one state-driven dialog wired onto every card', async () => {
  // The quick view opens a product without leaving /shop. The whole point of the
  // shape is that there is exactly one dialog for the grid, not one per card, so
  // this holds the parts that quietly regress into sixty-three modals or a
  // trigger that navigates instead of opening: the grid is wrapped in the
  // provider that owns the single dialog, the trigger is a sibling of the card
  // link rather than a child of it, and the dialog carries the accessibility a
  // modal needs. Read as text - QuickView is a client component that imports
  // next/link, and view.js is a server component that imports the database.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const read = rel => readFileSync(join(root, rel), 'utf8');

  const view = read('app/shop/view.js');
  const qv = read('app/_components/QuickView.js');
  const css = read('app/_components/quickview.css');

  // The grid is wrapped in the provider, and the trigger renders on the card.
  const provOpen = view.indexOf('<QuickViewProvider');
  const gridAt = view.indexOf('className="grid"');
  assert.ok(provOpen !== -1 && gridAt !== -1 && provOpen < gridAt,
    'the single-dialog provider does not wrap the shop grid');
  assert.ok(view.includes('<QuickViewButton'), 'no quick view trigger renders on the card');

  // The trigger must be a sibling of the card <Link>, not inside it: nested in
  // the anchor a click would navigate to the product page instead of opening
  // the dialog. So a </Link> must close between the card link and the trigger.
  const cardHit = view.indexOf('card-hit');
  const triggerAt = view.indexOf('<QuickViewButton');
  assert.ok(cardHit !== -1 && triggerAt > cardHit, 'the trigger is not placed after the card link');
  assert.ok(view.slice(cardHit, triggerAt).includes('</Link>'),
    'the quick view trigger sits inside the card <Link>, so opening it would navigate away');

  // A client component.
  assert.match(qv, /^['"]use client['"]/, 'QuickView is not a client component');

  // One dialog, mounted once and returning null while closed rather than a modal
  // per product: the provider renders a single <QuickViewModal>.
  assert.match(qv, /<QuickViewModal\b/, 'the provider does not render a single dialog');
  const modalTags = (qv.match(/<QuickViewModal\b/g) || []).length;
  assert.equal(modalTags, 1, 'more than one dialog instance is rendered');

  // The dialog is a labelled modal dialog.
  assert.match(qv, /role=["']dialog["']/, 'the dialog has no dialog role');
  assert.match(qv, /aria-modal=["']true["']/, 'the dialog is not marked modal');
  assert.match(qv, /aria-labelledby=/, 'the dialog is not labelled by its title');

  // Esc closes, Tab is trapped, the page behind is scroll-locked, and focus
  // returns to the trigger on close.
  assert.match(qv, /['"]Escape['"]/, 'Esc does not close the dialog');
  assert.match(qv, /['"]Tab['"]/, 'focus is not trapped on Tab');
  assert.match(qv, /\.style\.overflow\s*=/, 'the page behind is not scroll-locked while open');
  assert.match(qv, /triggerRef\.current[\s\S]{0,140}\.focus\(\)/,
    'focus does not return to the trigger when the dialog closes');

  /*
   * Two states, and the dialog must reach them through the SHARED helper
   * rather than re-deriving them from the price.
   *
   * It used to test `product.price > 0` itself, which is how it drifted from
   * the card behind it. lib/product-state.js owns the rule now, and asserting
   * the IMPORT rather than the comparison is what stops the next screen
   * quietly inventing its own version of it. The WhatsApp ask that used to be
   * a third outcome is gone, and stays gone: 23 of 63 live products were in
   * it, each one a message for the owner to answer by hand about a product
   * nobody had costed.
   */
  assert.match(qv, /from '\.\.\/\.\.\/lib\/product-state\.js'/,
    'the dialog decides availability for itself instead of using the shared rule');
  assert.doesNotMatch(qv, /Number\(product\.price\)\s*>\s*0/,
    'the dialog re-derives "is it priced" locally, which is how it drifted from the card last time');
  assert.match(qv, /AddButton/, 'a priced product cannot be added to cart from the dialog');
  assert.doesNotMatch(qv, /wa\.me/, 'the dialog still sends shoppers to WhatsApp about a price');
  assert.match(qv, /خلص من المخزن/, 'the dialog cannot say a product is unavailable');

  // The full-details link is language-aware, so the English dialog links the
  // English page. It goes through the localePath helper, aliased L here.
  assert.match(qv, /localePath/, 'the dialog does not import localePath for language-aware links');
  assert.match(qv, /L\(\s*`\/product\//, 'the full details link is not built through the locale helper');

  // Reduced motion is honoured, and only in the stylesheet.
  assert.match(css, /prefers-reduced-motion/, 'the quick view ignores prefers-reduced-motion');
});

test('shopCopy returns the same shape for a category and for the full line', () => {
  /*
   * The /shop fallback used to omit `body` and `faq` entirely, because those
   * were added to the category branch only. app/shop/view.js reads
   * `c.faq.length` unconditionally, so /shop and /en/shop threw
   * "Cannot read properties of undefined" during prerender and took the whole
   * production build down with them. The category pages were fine, which is
   * exactly why it was missed.
   */
  for (const lang of ['ar', 'en']) {
    const full = shopCopy(null, lang);
    const cat = shopCopy('gel', lang);
    assert.deepEqual(Object.keys(full).sort(), Object.keys(cat).sort(),
      `shopCopy(null, '${lang}') and shopCopy('gel', '${lang}') return different shapes`);
    assert.ok(Array.isArray(full.faq), 'the full line has no faq array to read length from');
    assert.equal(typeof full.body, 'string', 'the full line has no body string');
  }
});
