'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { localePath } from '../../lib/urls.js';
import Link from 'next/link';
import { addToCart, readCart, setQty as writeQty } from '../../lib/cart.js';
import { cartTotals } from '../../lib/pricing.js';
import { rankProducts } from '../../lib/hairtypes.js';
import { currencyLabel, whole, discountPercent } from '../../lib/money.js';
import { runDir } from '../hair-types/lib.js';

/**
 * The landing page.
 *
 * Ported from the original single-page site, with three deliberate changes:
 *   - every looping decoration is a CSS animation rather than a JavaScript one,
 *     so the browser can composite it and stop it off-screen (the JS versions
 *     ran forever and burned about three CPU cores on an idle tab);
 *   - the jars and cards are links to real product pages;
 *   - ordering finishes at /checkout. WhatsApp is support only.
 */

const T = {
  ar: {
    h1: ['امسك', 'ستايلك', 'طول اليوم'],
    hero_sub_a: 'واكس وجل شعر بريميوم مصنوع في مصر. ',
    hero_sub_b: 'تثبيت ميجا من الصبح لآخر اليوم',
    hero_sub_c: ' — من غير قشرة ومن غير دهون. ستايل الصالون من غير ما تروح الصالون.',
    hero_cta1: 'اتفرج على المنتجات', hero_cta2: 'اعرف نوع شعرك',
    tag_note: 'توصيل + دفع عند الاستلام', egp: 'جنيه',
    shop_a: 'اختار', shop_b: 'لونك',
    shop_p: 'كل لون تركيبة مختلفة ودرجة تثبيت مختلفة — من واكس مرن تعدّله طول اليوم، لحد جل بيقفل الشكل ومش بيسيبك.',
    tabs: [['all', 'الكل'], ['wax', 'واكس'], ['gel', 'جل']],
    // Ranges the home page does not carry. These are links to the shop, not
    // filters — the home grid is a shortlist and they are not in it.
    moreTabs: [['gel-wax', 'جل واكس'], ['cream-gel', 'كريم جل']],
    shop_all: 'شوف التشكيلة كلها ←',
    buy: 'ضيف للسلة', added: 'اتضاف ✓', details: 'التفاصيل',
    sold: 'خلص', empty_grid: 'المنتجات في الطريق.',
    hair_a: 'شعرك', hair_b: 'نوعه إيه؟',
    hair_p: 'مش كل شعر بياخد نفس المنتج. اختار نوع شعرك وهنقولك بالظبط أنهي واحد ليك — وليه.',
    hair_k: 'اختيارك', hair_pick: 'الاختيار الصح لشعرك', hair_alt: 'كمان يناسبك:',
    hold_a: 'اختار', hold_b: 'تثبيتك',
    hold_p: 'مش عارف تبدأ منين؟ دوس على اللي يناسبك وهنوريك منتجاته.',
    hold_tab: 'تثبيت', clear: 'شيل الفلتر',
    // The four bands, top of the range downwards, with the two waxes next to
    // each other so the stronger and the softer one read as a pair. Each tile
    // names its own format as well as its band — see `inFilter` — because the
    // hold scale runs across the whole catalogue now, so a band on its own is
    // a dozen products from five different formats.
    holds: [
      { en: 'GEL', h: 'جل بريميوم', lvl: 5, p: 'أقوى تثبيت في التشكيلة كلها ولمعة ويت لوك. الشكل بيفضل مكانه لآخر اليوم وبيتغسل بسهولة.', go: 'شوف المنتجات ←', pick: 'gel:5', c: 'var(--blue)' },
      { en: 'GEL WAX', h: 'جل واكس', lvl: 3, p: 'الاتنين مع بعض: تحكم الواكس ولمعة الجل. لو الواكس تقيل عليك والجل ناشف أوي.', go: 'شوف المنتجات ←', href: '/shop/gel-wax', c: 'var(--purple)' },
      { en: 'WAX PRO', h: 'واكس برو', lvl: 4, p: 'أقوى واكس عندنا — برو إكس وبرو. تثبيت قوي بتكستشر، وتقدر تشتغل على شعرك طول اليوم.', go: 'شوف المنتجات ←', pick: 'wax:4', c: 'var(--red-ui)' },
      { en: 'WAX CARE', h: 'واكس مغذي', lvl: 3, p: 'تثبيت متوسط ومرن مع ترطيب — زبدة الشيا والأرجان والبلاك. تقدر تظبط شعرك تاني في أي وقت.', go: 'شوف المنتجات ←', pick: 'wax:3', c: 'var(--green)' },
    ],
    or_h: 'اطلب في', or_h_red: 'دقيقة',
    or_p: 'من غير تسجيل حساب ومن غير تعقيد. اختار منتجك، ضيفه للسلة، واكمل الأوردر — الدفع عند الاستلام.',
    os: ['اختار منتجك وضيفه للسلة', 'اكتب اسمك وعنوانك في الشيك أوت', 'استلم وادفع عند الباب'],
    or_cta: 'ابدأ التسوق',
    bb_h: 'الجودة اللي', bb_h_red: 'الأسطى', bb_h2: 'بيثق فيها',
    bb_p: 'نفس نوعية المنتجات اللي بيشتغل بيها الحلاقين — بتوصلك لحد باب البيت.',
    px_k: 'نجم التشكيلة ★ برو إكس', px_h: 'الأحمر اللي', px_h_red: 'مبيهزرش',
    px_p: 'واكس برو إكس — تركيبة Wave & Groom بتثبيت قوي، أقوى واكس في التشكيلة. شعرك يفضل مظبوط زي ما سبته الصبح لحد ما ترجع البيت.',
    px_s: ['قوة التثبيت', 'حجم البرطمان', 'في التركيبة'],
    cart_t: 'سلة الطلبات', cart_close: 'إغلاق',
    cart_empty: 'السلة لسه فاضية', cart_empty_p: 'ضيف منتج وابدأ الأوردر.',
    cart_shop: 'اتفرج على المنتجات', cart_sub: 'المجموع', cart_ship: 'التوصيل',
    cart_free: 'مجاني', cart_tot: 'الإجمالي', cart_checkout: 'إتمام الطلب ←',
    cod: 'الدفع عند الاستلام',
  },
  en: {
    h1: ['HOLD', 'YOUR STYLE', 'ALL DAY'],
    hero_sub_a: 'Premium hair wax & gel made in Egypt. ',
    hero_sub_b: 'Mega hold from morning till midnight',
    hero_sub_c: ' — no flakes, no grease. Salon styling without the salon chair.',
    hero_cta1: 'Shop the line', hero_cta2: 'Find your hair type',
    tag_note: 'Delivery + cash on receipt', egp: 'EGP',
    shop_a: 'PICK', shop_b: 'YOUR COLOR',
    shop_p: 'Every colour is a different formula, and a different hold — from a wax you can rework all day to a gel that sets the shape and will not quit halfway through it.',
    tabs: [['all', 'All'], ['wax', 'Wax'], ['gel', 'Gel']],
    moreTabs: [['gel-wax', 'Gel Wax'], ['cream-gel', 'Cream Gel']],
    shop_all: 'See the whole range →',
    buy: 'Add to cart', added: 'Added ✓', details: 'Details',
    sold: 'Sold out', empty_grid: 'Products are on the way.',
    hair_a: 'WHAT’S YOUR', hair_b: 'HAIR TYPE?',
    hair_p: 'Not every head takes the same product. Pick your hair type and we’ll tell you exactly which one is yours — and why.',
    hair_k: 'Your type', hair_pick: 'The right one for you', hair_alt: 'Also works for you:',
    hold_a: 'PICK', hold_b: 'YOUR HOLD',
    hold_p: 'Not sure where to start? Tap the one that fits and we’ll show you its products.',
    hold_tab: 'Hold', clear: 'Clear filter',
    // Kept in step with the Arabic array above, tile for tile: same order, same
    // levels, same picks. They are two renderings of one shortlist, and a level
    // that drifts between them is a level one language is telling wrong.
    holds: [
      { en: 'GEL', h: 'Premium Gel', lvl: 5, p: 'The strongest hold in the whole range, with a wet-look finish. Stays where you put it all day and washes straight out.', go: 'See the products →', pick: 'gel:5', c: 'var(--blue)' },
      { en: 'GEL WAX', h: 'Gel Wax', lvl: 3, p: 'Both at once: the control of a wax with the shine of a gel. For when wax feels heavy and gel sets too hard.', go: 'See the products →', href: '/shop/gel-wax', c: 'var(--purple)' },
      { en: 'WAX PRO', h: 'Pro Wax', lvl: 4, p: 'The strongest wax we make — Pro X and Pro. Firm hold with texture, and it stays workable in your hands all day.', go: 'See the products →', pick: 'wax:4', c: 'var(--red-ui)' },
      { en: 'WAX CARE', h: 'Nourishing Wax', lvl: 3, p: 'Medium hold that stays flexible, with conditioning — shea butter, argan and black. Rework your hair at any point in the day.', go: 'See the products →', pick: 'wax:3', c: 'var(--green)' },
    ],
    or_h: 'Order in', or_h_red: 'one minute',
    or_p: 'No account, no maze. Pick your product, add it to the cart, and finish checkout — cash on delivery.',
    os: ['Pick your product & add to cart', 'Enter your name & address at checkout', 'Receive & pay at your door'],
    or_cta: 'Start shopping',
    bb_h: 'The quality', bb_h_red: 'barbers', bb_h2: 'trust',
    bb_p: 'The same grade of product barbers work with — delivered to your door.',
    px_k: 'Star of the line ★ Pro X', px_h: 'The red that', px_h_red: 'means it',
    px_p: 'Pro X wax — the Wave & Groom formula with a strong hold, the strongest wax in the line. Your hair stays exactly where you set it in the morning, until you are back home.',
    px_s: ['Hold strength', 'Jar size', 'In the formula'],
    cart_t: 'Your cart', cart_close: 'Close',
    cart_empty: 'Your cart is empty', cart_empty_p: 'Add a product to start your order.',
    cart_shop: 'Shop the line', cart_sub: 'Subtotal', cart_ship: 'Delivery',
    cart_free: 'Free', cart_tot: 'Total', cart_checkout: 'Checkout →',
    cod: 'Cash on delivery',
  },
};

function Card({ p, lang, d, L, onAdd }) {
  const [added, setAdded] = useState(false);
  const t = p[lang];
  const out = p.stock <= 0;
  const off = discountPercent(p.price, p.compare_at);

  return (
    <div className="card" style={{ '--c': p.color }}>
      <Link className="card-hit" href={L(`/product/${p.slug}`)}>
        {t.chip && <span className="chip">{t.chip}</span>}
        <img src={`/${p.img}`} alt={t.name} loading="lazy" width="300" height="300" />
        <h3>{t.name}</h3>
        <div className="sub">{t.sub}</div>
      </Link>
      <div className="row">
        <div className="price">
          <bdi>{whole(p.price)} <small>{d.egp}</small></bdi>
          {off != null && (
            <>
              <bdi className="was">{whole(p.compare_at)}</bdi>
              <span className="save" dir="ltr">−{off}%</span>
            </>
          )}
        </div>
        <button
          className="buy"
          style={{ '--c': p.color }}
          disabled={out}
          onClick={() => {
            onAdd(p.sku);
            setAdded(true);
            setTimeout(() => setAdded(false), 1300);
          }}
        >
          {out ? d.sold : added ? d.added : d.buy}
        </button>
      </div>
    </div>
  );
}

function Drawer({ open, close, lines, lang, d, L, shipping, freeOver, onQty }) {
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const t = cartTotals(subtotal, 0, shipping, freeOver);
  const money = v => `${Math.round(v * 100) / 100} ${d.egp}`;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', esc);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={d.cart_t}>
        <div className="drawer-head">
          <h3>{d.cart_t}</h3>
          <button className="x" onClick={close} aria-label={d.cart_close}>×</button>
        </div>

        {lines.length === 0 ? (
          <div className="drawer-body">
            <div className="cart-empty">
              <span>★</span>
              <b style={{ display: 'block', color: 'var(--ink)', fontSize: 17, marginBottom: 6 }}>
                {d.cart_empty}
              </b>
              {d.cart_empty_p}
              <div style={{ marginTop: 20 }}>
                <a className="btn btn-red" href="#shop" onClick={close}>{d.cart_shop}</a>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="drawer-body">
              {lines.map(l => (
                <div className="citem" key={l.sku}>
                  <Link href={L(`/product/${l.slug}`)} onClick={close}>
                    <img src={`/${l.img}`} alt={l[lang].name} />
                  </Link>
                  <div>
                    <h4><Link href={L(`/product/${l.slug}`)} onClick={close}>{l[lang].name}</Link></h4>
                    <div className="pr">{l.price} {d.egp}</div>
                  </div>
                  <div className="qty">
                    <button onClick={() => onQty(l.sku, l.qty - 1)} aria-label="-">−</button>
                    <span>{l.qty}</span>
                    <button onClick={() => onQty(l.sku, l.qty + 1)} aria-label="+">+</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="drawer-foot">
              <div className="crow"><span>{d.cart_sub}</span><span>{money(t.subtotal)}</span></div>
              <div className="crow">
                <span>{d.cart_ship}</span>
                <span className={t.shipping === 0 ? 'free' : ''}>
                  {t.shipping === 0 ? d.cart_free : money(t.shipping)}
                </span>
              </div>
              <div className="crow tot"><span>{d.cart_tot}</span><span>{money(t.total)}</span></div>
              <Link className="btn btn-red btn-full" href={L(`/checkout`)}>{d.cart_checkout}</Link>
              <div className="cart-cod">{d.cod}</div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

export default function Landing({ lang, products, hairTypes, shipping, freeOver }) {
  const d = T[lang] || T.ar;
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const [filter, setFilter] = useState('all');
  const [hair, setHair] = useState('wavy');
  const [cart, setCart] = useState([]);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    window.addEventListener('s7cart', sync);
    return () => window.removeEventListener('s7cart', sync);
  }, []);

  // Animation budget. The looping decorations are CSS animations, so they can be
  // paused by toggling a class — no JavaScript runs per frame either way.
  //   .s7-bg     the tab is in the background: pause everything
  //   .hero-idle the hero has scrolled away: pause its rings, orbits and stamp
  //   .in-view   the order panel is on screen: let its sheen run
  const root = useRef(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;

    const onVis = () => el.classList.toggle('s7-bg', document.hidden);
    document.addEventListener('visibilitychange', onVis);
    onVis();

    let io;
    if (typeof IntersectionObserver === 'function') {
      const hero = el.querySelector('.hero');
      const panel = el.querySelector('.order');
      io = new IntersectionObserver(
        entries => {
          for (const e of entries) {
            if (e.target === hero) el.classList.toggle('hero-idle', !e.isIntersecting);
            if (e.target === panel) e.target.classList.toggle('in-view', e.isIntersecting);
          }
        },
        { rootMargin: '80px' }
      );
      if (hero) io.observe(hero);
      if (panel) io.observe(panel);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, []);

  const add = useCallback(sku => { addToCart(sku); setDrawer(true); }, []);
  const qty = useCallback((sku, n) => { writeQty(sku, n); }, []);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  // Cart rows joined to the catalogue. These prices are for display only — the
  // order route recomputes every figure from the database before it writes.
  const lines = cart
    .map(c => {
      const p = products.find(x => x.sku === c.sku);
      return p ? { ...p, qty: c.qty } : null;
    })
    .filter(Boolean);

  // A filter is one of four things: 'all', a product kind ('wax'), a hold band
  // across every format ('hold:N'), or a kind and a band together ('wax:3').
  //
  // The compound form exists because hold is a single range-wide scale now
  // rather than a per-format one, which makes a bare band far too coarse to
  // stand behind a tile. 'hold:3' is not "the nourishing waxes" — it is every
  // gel wax, every cream gel and the whole 135ml wax shelf as well, a dozen
  // products the tile's own copy never mentions. Naming the format alongside
  // the band is the only way a tile can say "the softer end of the wax" and
  // then show exactly that.
  //
  // Anything that does not match the shape selects nothing at all. Every
  // filter here is authored in this file, so an unrecognised one is a typo,
  // and a typo that fell through to "match everything" would quietly put the
  // entire catalogue under a heading promising one strength — which is the
  // failure this whole section exists to prevent.
  const FILTER = /^([a-z]+)(?::([1-5]))?$/;
  const inFilter = (f, p) => {
    if (f === 'all') return true;
    const m = FILTER.exec(f);
    if (!m) return false;
    const [, name, band] = m;
    if (!band) return p.kind === name;
    if (name === 'hold') return p.hold === Number(band);
    return p.kind === name && p.hold === Number(band);
  };

  // The home grid is a shortlist, not the catalogue. With 32 products live it
  // buried the ones the brand leads with, and it made the page enormous.
  // `featured` is set in the admin; if nobody has chosen yet, fall back to the
  // first eight in sort order rather than rendering an empty shop section.
  const featured = products.some(p => p.featured)
    ? products.filter(p => p.featured)
    : products.slice(0, 8);

  const shown = featured.filter(p => inFilter(filter, p));

  // Only offer a band that has something in it — the old picker advertised a
  // "cream" line with no SKUs behind it and quietly showed the whole shop.
  // A tile with an href points at a shop category and is always offered — the
  // home page does not stock that range, so counting it against `products`
  // would hide it. A tile with a `pick` filters the shortlist and is only shown
  // when the shortlist actually contains something for it.
  const holdTiles = d.holds
    .map(h => (h.href ? { ...h, n: 1 } : { ...h, n: products.filter(p => inFilter(h.pick, p)).length }))
    .filter(h => h.n > 0);

  // The band showing in the "Hold 4/5 ×" chip, read out of whichever form of
  // filter is live. It has to understand the compound form too: none of the
  // kind tabs light up for 'wax:3', so without the chip the grid would sit
  // there filtered with nothing on screen saying so and no way back to all.
  const holdFilter = FILTER.exec(filter)?.[2] || null;
  const hero = products.find(p => p.sku === 'S7-WAX-RED') || products[0];

  const tile = hairTypes.find(t => t.slug === hair) || hairTypes[0];
  const copy = tile[lang] || tile.ar;
  const matches = rankProducts(
    products.map(p => ({ ...p, hair_types: p.hair.join(','), hold_level: p.hold })),
    tile.slug,
    3
  );
  const best = matches[0];
  const alts = matches.slice(1);

  // Records which hair types visitors report, for the admin dashboard. The
  // finder itself works whether or not this call succeeds.
  function pickHair(slug) {
    setHair(slug);
    fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hair_type: slug, lang }),
    }).catch(() => {});
  }

  function pickHold(f) {
    setFilter(f);
    document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="s7home" ref={root}>
      {/* ----------------------------------------------------------- hero */}
      <header className="hero" id="top">
        <div className="wrap">
          <div>
            <h1 className={'hero-title' + (ar ? '' : ' en-display')}>
              <span className="row"><span>{d.h1[0]}</span></span>
              <span className="row red"><span>{d.h1[1]}</span></span>
              <span className="row stroke"><span>{d.h1[2]}</span></span>
            </h1>
            <p className="hero-sub">
              {d.hero_sub_a}<b>{d.hero_sub_b}</b>{d.hero_sub_c}
            </p>
            <div className="hero-ctas">
              <a className="btn btn-red" href="#shop">{d.hero_cta1}</a>
              <a className="btn btn-line" href="#hair">{d.hero_cta2}</a>
            </div>
          </div>

          <div className="stage">
            <div className="disc" />
            <div className="ring" />
            <div className="ring r2" />
            <div className="halfstar">★</div>
            <div className="orbit"><i>★</i></div>
            <div className="orbit o2"><i>★</i></div>

            <Link className="jar-wrap" href={L(`/product/premium-wax-pro-x`)} aria-label="Premium Wax Pro X">
              <img src="/assets/wax-red.webp" alt="Star Seven Premium Wax Pro X" width="390" height="390" />
            </Link>

            <Link className="float-jar j1" href={L(`/product/premium-gel-blue`)} aria-label="Premium Gel Blue">
              <img src="/assets/gel-blue.webp" alt="Star Seven Premium Gel" width="140" height="140" />
            </Link>
            <Link className="float-jar j2" href={L(`/product/premium-wax-shea`)} aria-label="Premium Wax Shea Butter">
              <img src="/assets/wax-purple.webp" alt="Star Seven Shea Wax" width="112" height="112" />
            </Link>

            <div className="hero-stamp" aria-hidden="true">
              <svg viewBox="0 0 100 100">
                <defs>
                  <path id="circ" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
                </defs>
                <text><textPath href="#circ">★ MEGA HOLD ★ MADE IN EGYPT ★ SINCE DAY ONE</textPath></text>
              </svg>
            </div>

            {hero && (
              <Link className="price-tag" href={L(`/product/${hero.slug}`)}>
                <span className="pt-num">{hero.price} <small>{d.egp}</small></span>
                <small>{d.tag_note}</small>
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {/* dir="ltr": every phrase here is Latin. In the Arabic page they
              would otherwise read back to front — "120 ML" became "ML 120". */}
          {[0, 1].map(k => (
            <span key={k} dir="ltr">
              <span>MEGA HOLD</span><span>WAVE &amp; GROOM</span><span>VITAMIN E</span>
              <span>120 ML</span><span>PREMIUM PRO X</span><span>NEW STAR SEVEN</span>
            </span>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------------- shop */}
      <section className="shop" id="shop">
        <div className="wrap">
          <div className="shead">
            <h2 className="en-display">
              <span>{d.shop_a}</span> <span className="red">{d.shop_b}</span>
            </h2>
            <p>{d.shop_p}</p>
          </div>

          <div className="tabs">
            {d.tabs.map(([k, label]) => (
              <button key={k} className={'tab' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
            {holdFilter && (
              <button className="tab on" onClick={() => setFilter('all')} title={d.clear}>
                {d.hold_tab} <span dir="ltr">{holdFilter}/5</span> ×
              </button>
            )}
            {/* Ranges the home page does not carry. Links, not filters: there
                is nothing here to filter to, and pretending otherwise would
                show an empty grid. */}
            {(d.moreTabs || []).map(([slug, label]) => (
              <Link key={slug} className="tab tab-out" href={L(`/shop/${slug}`)}>
                {label}
              </Link>
            ))}
          </div>

          {shown.length === 0 ? (
            <p style={{ color: 'var(--grey)', fontWeight: 600 }}>{d.empty_grid}</p>
          ) : (
            <div className="grid">
              {shown.map(p => <Card key={p.sku} p={p} lang={lang} d={d} L={L} onAdd={add} />)}
            </div>
          )}

          <p className="shop-all">
            <Link className="btn btn-line" href={L('/shop')}>{d.shop_all}</Link>
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- Pro X */}
      {hero && (
        <section className="prox" id="prox">
          <div className="wrap">
            <div className="prox-copy">
              <div className="k">{d.px_k}</div>
              <h2 className="en-display">
                {d.px_h} <span className="red">{d.px_h_red}</span>
              </h2>
              <p>{d.px_p}</p>
              {/* The hold badge reads STRONG, not MEGA. Ovanza rate Pro X
                  Strong, which is why the jar lost its "Mega Hold" chip in the
                  database — and a badge here saying otherwise would contradict
                  the chip and the 4-of-5 meter on the product's own page. Mega
                  is still fair for the range, where the gels sit above this;
                  it is no longer fair for this jar. */}
              <div className="spec">
                {[['STRONG', d.px_s[0]], ['120ml', d.px_s[1]], ['VIT E', d.px_s[2]]].map(([b, s]) => (
                  <div key={b}><b dir="ltr">{b}</b><span>{s}</span></div>
                ))}
              </div>
              <Link className="btn btn-red" href={L(`/product/${hero.slug}`)}>
                {d.details} — {hero.price} {d.egp}
              </Link>
            </div>
            <div className="prox-visual">
              <div className="big-star" aria-hidden="true">7</div>
              <Link className="jar" href={L(`/product/${hero.slug}`)}>
                <img src="/assets/wax-red.webp" alt="Premium Wax Pro X" width="420" height="420" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ hair-type finder */}
      <section className="hair" id="hair">
        <div className="wrap">
          <div className="shead">
            <h2 className="en-display">
              <span>{d.hair_a}</span> <span className="red">{d.hair_b}</span>
            </h2>
            <p>{d.hair_p}</p>
          </div>

          <div className="hair-grid">
            {hairTypes.map(x => {
              const c = x[lang] || x.ar;
              return (
                // An anchor, not a button. The click still filters in place —
                // that is the whole point of the finder — but the tile now
                // carries a real href, so the six hair-type pages are linked
                // from the home page instead of being reachable only from the
                // nav. A crawler follows the href; a mouse never sees it.
                <Link
                  key={x.slug}
                  href={L(`/hair-types/${x.slug}`)}
                  className={'htile' + (x.slug === tile.slug ? ' on' : '')}
                  style={{ '--c': x.color }}
                  onClick={e => { e.preventDefault(); pickHair(x.slug); }}
                  aria-current={x.slug === tile.slug ? 'true' : undefined}
                >
                  <span className="walker" dir={runDir(ar ? x.walker : x.walkerEn)}>
                    {ar ? x.walker : x.walkerEn}
                  </span>
                  <span className="medal">
                    <img src={`/${x.icon}`} alt="" loading="lazy" width="76" height="76" />
                  </span>
                  <b>{c.name}</b>
                  <span>{c.short}</span>
                </Link>
              );
            })}
          </div>

          <div className="hres" style={{ '--c': tile.color }} key={tile.slug}>
            <div className="hres-in">
              <div>
                <div className="k">
                  {d.hair_k} <i>{copy.name}</i> <i dir={runDir(ar ? tile.walker : tile.walkerEn)}>{ar ? tile.walker : tile.walkerEn}</i>
                </div>
                <h3>{copy.short}</h3>
                <p className="prob">{copy.problem}</p>
                <div className="ans">{copy.answer}</div>
                <div className="avoid">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5v5.5" strokeLinecap="round" />
                    <path d="M12 16.4v.2" strokeLinecap="round" />
                  </svg>
                  <span>{copy.avoid}</span>
                </div>
                {/* Both are inline-level, so left to themselves they land on
                    one line separated by a single space - the guide read as
                    stuck to the pill, which needs clearance for its 30px cap
                    radius. A flex row spaces them and wraps cleanly. */}
                <div className="hres-cta">
                  {best && (
                    <Link className="btn btn-red" href={L(`/product/${best.slug}`)}>
                      {best[lang].name} — {best.price} {d.egp}
                    </Link>
                  )}
                  {/* The panel shows an abridged version of what the type page
                      says at length. Without this link the longer page is the
                      one nobody reaches, and the two compete for the same
                      query. */}
                  <Link className="hres-guide" href={L(`/hair-types/${tile.slug}`)}>
                    {ar ? `كل تفاصيل الشعر ${copy.name} ←` : `The full ${copy.name.toLowerCase()} hair guide →`}
                  </Link>
                </div>
              </div>

              {best && (
                <div className="hres-pick">
                  <span className="badge">{d.hair_pick}</span>
                  <Link href={L(`/product/${best.slug}`)}>
                    <img src={`/${best.img}`} alt={best[lang].name} loading="lazy" width="200" height="200" />
                  </Link>
                  <h4>{best[lang].name}</h4>
                  <div className="sub">{best[lang].sub}</div>
                  <div className="p">{best.price} <small>{d.egp}</small></div>
                  {alts.length > 0 && (
                    <div className="hres-alt">
                      <span className="alt-lbl">{d.hair_alt}</span>
                      {alts.map(a => (
                        <Link key={a.sku} href={L(`/product/${a.slug}`)}>{a[lang].name}</Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- hold picker */}
      <section className="hold" id="hold">
        <div className="wrap">
          <div className="shead">
            <h2 className="en-display">
              <span>{d.hold_a}</span> <span className="red">{d.hold_b}</span>
            </h2>
            <p>{d.hold_p}</p>
          </div>
          <div className="hold-grid">
            {holdTiles.map(h => {
              const body = (
                <>
                  <div className="en">{h.en}</div>
                  <h3>{h.h}</h3>
                  <div className="lvl" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= h.lvl ? 'on' : ''} />)}
                  </div>
                  <p className="use">{h.p}</p>
                  <span className="go">{h.go}</span>
                </>
              );
              return h.href ? (
                <Link className="hcard" key={h.en} style={{ '--c': h.c }} href={L(h.href)}>
                  {body}
                </Link>
              ) : (
                <button className="hcard" key={h.en} style={{ '--c': h.c }} onClick={() => pickHold(h.pick)}>
                  {body}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- barber */}
      <section className="barber">
        <div className="bgwrap">
          <img className="bg" src="/assets/barbershop.jpg" alt="" loading="lazy" />
          <div className="tint" />
        </div>
        <div className="shade" />
        <div className="wrap">
          <h2 className="en-display">
            {d.bb_h} <span className="red">{d.bb_h_red}</span> {d.bb_h2}
          </h2>
          <p>{d.bb_p}</p>
        </div>
      </section>

      {/* --------------------------------------------------------- order */}
      <section className="order" id="order">
        <div className="wrap">
          <div className="order-panel">
            <div className="bigstar" aria-hidden="true">★</div>
            <h2 className="en-display">
              {d.or_h} <span className="red">{d.or_h_red}</span>
            </h2>
            <p>{d.or_p}</p>
            <div className="order-steps">
              {d.os.map((s, i) => (
                <div className="ostep" key={i}>
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  <span>{s}</span>
                </div>
              ))}
            </div>
            <a className="btn btn-red" style={{ fontSize: 17, padding: '17px 38px' }} href="#shop">
              {d.or_cta}
            </a>
          </div>
        </div>
      </section>

      <Drawer
        open={drawer}
        close={closeDrawer}
        lines={lines}
        lang={lang}
        d={d}
        L={L}
        shipping={shipping}
        freeOver={freeOver}
        onQty={qty}
      />
    </div>
  );
}
