'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { addToCart, readCart, setQty as writeQty } from '../../lib/cart.js';
import { cartTotals } from '../../lib/pricing.js';
import { rankProducts } from '../../lib/hairtypes.js';

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
    shop_p: 'كل لون تركيبة مختلفة. نفس التثبيت الميجا، ونفس البرطمان اللي مش هيسيبك في نص اليوم.',
    tabs: [['all', 'الكل'], ['wax', 'واكس'], ['gel', 'جل']],
    buy: 'ضيف للسلة', added: 'اتضاف ✓', details: 'التفاصيل',
    sold: 'خلص', empty_grid: 'المنتجات في الطريق.',
    hair_a: 'شعرك', hair_b: 'نوعه إيه؟',
    hair_p: 'مش كل شعر بياخد نفس المنتج. اختار نوع شعرك وهنقولك بالظبط أنهي واحد ليك — وليه.',
    hair_k: 'اختيارك', hair_pick: 'الاختيار الصح لشعرك', hair_alt: 'كمان يناسبك:',
    hold_a: 'اختار', hold_b: 'تثبيتك',
    hold_p: 'مش عارف تبدأ منين؟ دوس على اللي يناسبك وهنوريك منتجاته.',
    holds: [
      { en: 'GEL', h: 'جل بريميوم', lvl: 3, p: 'لمعة ويت لوك وتحكم يومي. للشغل والجامعة — يتغسل بسهولة.', go: 'شوف الجل ←', filter: 'gel', c: 'var(--blue)' },
      { en: 'CREAM', h: 'كريم جل', lvl: 4, p: 'تحكم + ترطيب في نفس الوقت. اختيار الحلاقين للاستخدام اليومي.', go: 'شوف التشكيلة ←', filter: 'all', c: 'var(--green)' },
      { en: 'WAX', h: 'واكس بريميوم', lvl: 5, p: 'ميجا هولد. الستايل بيقعد مكانه مهما اليوم طال — شيا، أرجان، أو برو إكس.', go: 'شوف الواكس ←', filter: 'wax', c: 'var(--red-ui)' },
    ],
    or_h: 'اطلب في', or_h_red: 'دقيقة',
    or_p: 'من غير تسجيل حساب ومن غير تعقيد. اختار منتجك، ضيفه للسلة، واكمل الأوردر — الدفع عند الاستلام.',
    os: ['اختار منتجك وضيفه للسلة', 'اكتب اسمك وعنوانك في الشيك أوت', 'استلم وادفع عند الباب'],
    or_cta: 'ابدأ التسوق',
    bb_h: 'الجودة اللي', bb_h_red: 'الأسطى', bb_h2: 'بيثق فيها',
    bb_p: 'نفس نوعية المنتجات اللي بيشتغل بيها الحلاقين — بتوصلك لحد باب البيت.',
    annc: ['التوصيل لحد باب البيت', 'الدفع عند الاستلام', 'اطلب في دقيقة من الموقع'],
    px_k: 'نجم التشكيلة ★ برو إكس', px_h: 'الأحمر اللي', px_h_red: 'مبيهزرش',
    px_p: 'واكس برو إكس — تركيبة Wave & Groom بتثبيت ميجا هولد. شعرك يفضل مظبوط زي ما سبته الصبح لحد ما ترجع البيت.',
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
    shop_p: 'Every colour is a different formula. Same mega hold, same jar that will not quit halfway through your day.',
    tabs: [['all', 'All'], ['wax', 'Wax'], ['gel', 'Gel']],
    buy: 'Add to cart', added: 'Added ✓', details: 'Details',
    sold: 'Sold out', empty_grid: 'Products are on the way.',
    hair_a: 'WHAT’S YOUR', hair_b: 'HAIR TYPE?',
    hair_p: 'Not every head takes the same product. Pick your hair type and we’ll tell you exactly which one is yours — and why.',
    hair_k: 'Your type', hair_pick: 'The right one for you', hair_alt: 'Also works for you:',
    hold_a: 'PICK', hold_b: 'YOUR HOLD',
    hold_p: 'Not sure where to start? Tap the one that fits and we’ll show you its products.',
    holds: [
      { en: 'GEL', h: 'Premium Gel', lvl: 3, p: 'Wet-look shine and daily control. For work and campus — washes out easy.', go: 'See gels →', filter: 'gel', c: 'var(--blue)' },
      { en: 'CREAM', h: 'Cream Gel', lvl: 4, p: 'Control + conditioning at once. The barber’s pick for daily use.', go: 'See the range →', filter: 'all', c: 'var(--green)' },
      { en: 'WAX', h: 'Premium Wax', lvl: 5, p: 'Mega hold. The style stays put no matter how long the day runs — Shea, Argan or Pro X.', go: 'See waxes →', filter: 'wax', c: 'var(--red-ui)' },
    ],
    or_h: 'Order in', or_h_red: 'one minute',
    or_p: 'No account, no maze. Pick your product, add it to the cart, and finish checkout — cash on delivery.',
    os: ['Pick your product & add to cart', 'Enter your name & address at checkout', 'Receive & pay at your door'],
    or_cta: 'Start shopping',
    bb_h: 'The quality', bb_h_red: 'barbers', bb_h2: 'trust',
    bb_p: 'The same grade of product barbers work with — delivered to your door.',
    annc: ['Delivery to your door', 'Cash on delivery', 'Order in a minute on the site'],
    px_k: 'Star of the line ★ Pro X', px_h: 'The red that', px_h_red: 'means it',
    px_p: 'Pro X wax — the Wave & Groom formula with mega hold. Your hair stays exactly where you set it in the morning, until you are back home.',
    px_s: ['Hold strength', 'Jar size', 'In the formula'],
    cart_t: 'Your cart', cart_close: 'Close',
    cart_empty: 'Your cart is empty', cart_empty_p: 'Add a product to start your order.',
    cart_shop: 'Shop the line', cart_sub: 'Subtotal', cart_ship: 'Delivery',
    cart_free: 'Free', cart_tot: 'Total', cart_checkout: 'Checkout →',
    cod: 'Cash on delivery',
  },
};

function Card({ p, lang, d, q, onAdd }) {
  const [added, setAdded] = useState(false);
  const t = p[lang];
  const out = p.stock <= 0;

  return (
    <div className="card" style={{ '--c': p.color }}>
      <Link className="card-hit" href={`/product/${p.slug}${q}`}>
        {t.chip && <span className="chip">{t.chip}</span>}
        <img src={`/${p.img}`} alt={t.name} loading="lazy" width="300" height="300" />
        <h3>{t.name}</h3>
        <div className="sub">{t.sub}</div>
      </Link>
      <div className="row">
        <div className="price">{p.price} <small>{d.egp}</small></div>
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

function Drawer({ open, close, lines, lang, d, q, shipping, freeOver, onQty }) {
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
                  <Link href={`/product/${l.slug}${q}`} onClick={close}>
                    <img src={`/${l.img}`} alt={l[lang].name} />
                  </Link>
                  <div>
                    <h4><Link href={`/product/${l.slug}${q}`} onClick={close}>{l[lang].name}</Link></h4>
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
              <Link className="btn btn-red btn-full" href={`/checkout${q}`}>{d.cart_checkout}</Link>
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
  const q = ar ? '' : '?lang=en';

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

  const shown = products.filter(p => filter === 'all' || p.kind === filter);
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
      <div className="annc">
        <div className="annc-in">
          {d.annc.map((x, i) => (
            <span key={i}>{i > 0 && <i>★</i>}<b>{x}</b></span>
          ))}
        </div>
      </div>

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

            <Link className="jar-wrap" href={`/product/premium-wax-pro-x${q}`} aria-label="Premium Wax Pro X">
              <img src="/assets/wax-red.webp" alt="Star Seven Premium Wax Pro X" width="390" height="390" />
            </Link>

            <Link className="float-jar j1" href={`/product/premium-gel-blue${q}`} aria-label="Premium Gel Blue">
              <img src="/assets/gel-blue.webp" alt="Star Seven Premium Gel" width="140" height="140" />
            </Link>
            <Link className="float-jar j2" href={`/product/premium-wax-shea${q}`} aria-label="Premium Wax Shea Butter">
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
              <Link className="price-tag" href={`/product/${hero.slug}${q}`}>
                <span className="pt-num">{hero.price} <small>{d.egp}</small></span>
                <small>{d.tag_note}</small>
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[0, 1].map(k => (
            <span key={k}>
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
          </div>

          {shown.length === 0 ? (
            <p style={{ color: 'var(--grey)', fontWeight: 600 }}>{d.empty_grid}</p>
          ) : (
            <div className="grid">
              {shown.map(p => <Card key={p.sku} p={p} lang={lang} d={d} q={q} onAdd={add} />)}
            </div>
          )}
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
              <div className="spec">
                {[['MEGA', d.px_s[0]], ['120ml', d.px_s[1]], ['VIT E', d.px_s[2]]].map(([b, s]) => (
                  <div key={b}><b dir="ltr">{b}</b><span>{s}</span></div>
                ))}
              </div>
              <Link className="btn btn-red" href={`/product/${hero.slug}${q}`}>
                {d.details} — {hero.price} {d.egp}
              </Link>
            </div>
            <div className="prox-visual">
              <div className="big-star" aria-hidden="true">7</div>
              <Link className="jar" href={`/product/${hero.slug}${q}`}>
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
                <button
                  key={x.slug}
                  className={'htile' + (x.slug === tile.slug ? ' on' : '')}
                  style={{ '--c': x.color }}
                  onClick={() => pickHair(x.slug)}
                  aria-pressed={x.slug === tile.slug}
                >
                  <span className="walker" dir="ltr">{ar ? x.walker : x.walkerEn}</span>
                  <span className="medal">
                    <img src={`/${x.icon}`} alt="" loading="lazy" width="76" height="76" />
                  </span>
                  <b>{c.name}</b>
                  <span>{c.short}</span>
                </button>
              );
            })}
          </div>

          <div className="hres" style={{ '--c': tile.color }} key={tile.slug}>
            <div className="hres-in">
              <div>
                <div className="k">
                  {d.hair_k} <i>{copy.name}</i> <i dir="ltr">{ar ? tile.walker : tile.walkerEn}</i>
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
                {best && (
                  <Link className="btn btn-red" href={`/product/${best.slug}${q}`}>
                    {best[lang].name} — {best.price} {d.egp}
                  </Link>
                )}
              </div>

              {best && (
                <div className="hres-pick">
                  <span className="badge">{d.hair_pick}</span>
                  <Link href={`/product/${best.slug}${q}`}>
                    <img src={`/${best.img}`} alt={best[lang].name} loading="lazy" width="200" height="200" />
                  </Link>
                  <h4>{best[lang].name}</h4>
                  <div className="sub">{best[lang].sub}</div>
                  <div className="p">{best.price} <small>{d.egp}</small></div>
                  {alts.length > 0 && (
                    <div className="hres-alt">
                      <span className="alt-lbl">{d.hair_alt}</span>
                      {alts.map(a => (
                        <Link key={a.sku} href={`/product/${a.slug}${q}`}>{a[lang].name}</Link>
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
            {d.holds.map(h => (
              <button className="hcard" key={h.en} style={{ '--c': h.c }} onClick={() => pickHold(h.filter)}>
                <div className="en">{h.en}</div>
                <h3>{h.h}</h3>
                <div className="lvl" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= h.lvl ? 'on' : ''} />)}
                </div>
                <p className="use">{h.p}</p>
                <span className="go">{h.go}</span>
              </button>
            ))}
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
        q={q}
        shipping={shipping}
        freeOver={freeOver}
        onQty={qty}
      />
    </div>
  );
}
