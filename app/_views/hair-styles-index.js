import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { sql, hasDb } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { HAIR_STYLES, FINISH, rankForStyle } from '../../lib/hairstyles.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import {
  ld, styleLabel, finishCounts, styleGap, styleIndexLd, styleBreadcrumbLd,
} from '../hair-styles/lib.js';
import '../hair-styles/hairstyles.css';
import { imageUrl } from '../../lib/product-image.js';

/**
 * The hair-style index, rendered once and mounted at both addresses.
 *
 * Two route files hand this view its language as a compile-time constant, the
 * way app/_views/hair-types-index.js is mounted at /hair-types and
 * /en/hair-types. Nothing here learns anything about the request: reading
 * `searchParams` or `headers()` is a dynamic API, and awaiting one opts the
 * route out of static generation and zeroes the revalidate window on the way
 * out, which is how a page can declare a cache window and cache nothing.
 *
 * hairstyles.css is imported here rather than in either route file so both
 * addresses pull it from one place and neither can be left without it.
 */

/**
 * The catalogue, or an empty list.
 *
 * This page's job is the editorial content; the product picks are the payoff,
 * not the page. A database that is missing or unhappy therefore degrades to a
 * guide with no jars on it rather than a 500 — the six tiles, the steps and the
 * honest limits all still render.
 */
async function loadProducts() {
  if (!hasDb()) return [];
  try {
    return await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;
  } catch {
    return [];
  }
}

export default async function HairStylesIndexView({ lang }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const products = await loadProducts();
  const counts = finishCounts(products);

  // The two-axis table is built from the live catalogue and from the
  // manufacturer's published finish ratings, so it can only ever describe
  // products that are actually on sale. A product the client switches off
  // leaves the table on the next revalidate rather than sitting in it as a
  // recommendation nobody can buy.
  const shineWord = s => (ar
    ? { 1: 'مطفي', 2: 'لمعة متوسطة', 3: 'لمعة عالية' }[s] || '—'
    : { 1: 'Matte', 2: 'Medium shine', 3: 'High shine' }[s] || '—');

  const leads = new Map(HAIR_STYLES.map(s => [s.needs.lead, s]));
  const grid = products
    .filter(p => FINISH[p.sku])
    .map(p => {
      const fronts = leads.get(p.sku);
      return {
        sku: p.sku,
        slug: p.slug,
        name: ar ? p.name_ar : p.name_en,
        hold: Number(p.hold_level),
        shine: shineWord(FINISH[p.sku].shine),
        fronts: fronts ? (ar ? fronts.ar.name : fronts.en.name) : null,
        frontsSlug: fronts ? fronts.slug : null,
      };
    });

  // Generated, not typed. The matte line is only true while nothing in the
  // catalogue is rated matte, and the finisher line only while no spray is
  // priced and switched on — both of which are things the client can change
  // from the admin without anyone remembering to edit this page.
  const gaps = [
    counts.matte === 0
      ? (ar
        ? 'مفيش حاجة مطفية في التشكيلة كلها. كل الواكس شمع وفازلين ومفيهاش سيليكا ولا نشا ولا كلاي، يعني مفيش أي مكوّن يقدر يطفي اللمعة أصلاً. عشان كده الفرنش كروب — أكتر قصة الناس بتطلبها دلوقتي — مش هنعرف نعمله لك.'
        : 'Nothing in the range is matte. Every wax is wax and petrolatum with no silica, no starch and no clay — there is no ingredient in any of them that could take the shine off. That is why we cannot give you a textured crop, the cut most men are asking for right now.')
      : null,
    ar
      ? 'مفيش موس ولا منتج بيتحط قبل الاستشوار. الكويف بيبدأ من الاستشوار مش من العلبة، والحاجة اللي بتبني الارتفاع نفسه مش عندنا.'
      : 'No mousse and no pre-styling primer. A quiff starts at the dryer, not at the jar, and the product that builds the height is not one we make.',
    counts.spray === 0
      ? (ar
        ? 'ومفيش سبراي شعر شغال دلوقتي. ده اللي بيقفل الكويف والسلك باك في آخر الخطوة، ولسه مش متسعّر.'
        : 'And no hair spray on sale yet. That is the finisher that would close a quiff or a slick back at the last step, and it is not priced.')
      : null,
  ].filter(Boolean);

  return (
    <Dir lang={lang}>
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(styleIndexLd({ lang, siteUrl: site.url })) }} />
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(styleBreadcrumbLd({ tile: null, lang, siteUrl: site.url })) }} />
      <Nav lang={lang} path="hair-styles" />

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'ستايلات الشعر' : 'Hair styles' }]} />
          <h1>{ar ? 'ستايلات الشعر' : 'Hair styles'}</h1>
          <p>
            {ar
              ? 'اختار الشكل اللي عايزه، ونقولك بأنهي منتج توصله وإزاي بالظبط — وفي حالة واحدة نقولك إننا مش بنعمل اللي إنت محتاجه.'
              : 'Pick the look you want and we will tell you which product gets you there and exactly how — and in one case, that we do not make what you need.'}
          </p>
        </div>
      </div>

      <div className="wrap hs">
        {/* --------------------------------------------- how the finder works */}
        <section className="hs-why">
          <h2>{ar ? 'الاستايل بيتحدد بحاجتين بس' : 'A style is decided by two things'}</h2>

          <p>
            {ar
              ? 'التثبيت واللمعة. التثبيت بيقول الشكل هيقعد قد إيه، واللمعة بتقول هيبان لامع ولا ناشف. حط أي استايل رجالي على الاتنين دول، والمنتج هيبان لوحده.'
              : 'Hold and shine. Hold is how long the shape lasts, shine is how wet or dry it looks. Put any men’s style on those two and the product picks itself.'}
          </p>

          <p>
            {ar
              ? 'التثبيت عندنا سلّم واحد من ١ لـ ٥ على التشكيلة كلها: الجل ٥، برو إكس وبرو ٤، والشيا والأرجان والبلاك ٣. واللمعة دي أرقام المصنع نفسه لكل منتج على حدة — مش تقديرنا إحنا. الجدول اللي تحت هو التشكيلة كلها على المحورين.'
              : 'Hold here is one scale from 1 to 5 across the whole range: the gels are 5, Pro X and Pro are 4, and Shea, Argan and Black are 3. The shine ratings are the manufacturer’s own, per product — not our estimate. The table below is the whole range on both axes.'}
          </p>

          {/* Gated on the same count the generated gap line above is gated on,
              and for the same reason that comment gives: a hard-coded "we make
              nothing matte" is true today and becomes a lie on the day a clay
              is stocked. This aside states the claim twice as forcefully as the
              generated line does, so leaving it ungated would have let the
              claim survive exactly the change the gating exists to catch. The
              second paragraph rests on the same fact — one style we cannot
              serve, a second we can half serve — so the whole aside moves
              together rather than leaving a dangling consequence behind. */}
          {counts.matte === 0 && (
          <aside className="hs-honest">
            <h3>{ar ? 'قبل ما تبدأ' : 'Before you start'}</h3>
            {/* One short paragraph, not the three-sentence essay this used to
                be. The claim and its consequence are the only two facts here
                that change what a reader does next, and a block long enough to
                look like an article gets skipped by the person it is meant to
                warn - which is the one outcome an honesty notice cannot afford. */}
            <p>
              {ar
                ? 'مفيش حاجة عندنا مطفية — كلها شمع وفازلين، من غير كلاي ولا سيليكا. يعني من الستة اللي تحت، واحد مش هنعرف نوصلك له وواحد هنوصلك لنصه. الاتنين مكتوب عليهم.'
                : 'Nothing we make is matte — it is all wax and petrolatum, with no clay or silica. So of the six styles below, one we cannot get you and one only halfway. Both are marked.'}
            </p>
          </aside>
          )}
        </section>

        {/* --------------------------------------------------- the six tiles */}
        <section className="hs-tiles" id="styles">
          <h2>{ar ? 'الستة استايلات' : 'The six styles'}</h2>

          <div className="hs-grid">
            {HAIR_STYLES.map(s => {
              const c = ar ? s.ar : s.en;
              const label = styleLabel(s, lang);
              const matches = rankForStyle(products, s, 3);
              const best = matches[0] || null;
              const alts = matches.slice(1);
              const gap = styleGap(s.slug, lang);

              return (
                <article className="hs-card" key={s.slug}
                  style={{ '--c': s.color, '--m': `url(/${s.icon})` }}>
                  {/* dir="ltr": a bare digit is a Latin run and reorders inside
                      an Arabic line without it. */}
                  <span className="hs-hold" dir="ltr" aria-hidden="true">{s.hold}</span>

                  {/* The render, given room to be looked at. The 46px masked
                      drawing this replaces was too small to tell one cut from
                      another - which is the single job a style tile has. The
                      mask stays in the markup below for the small marks, where
                      a tinted glyph still reads better than a photograph. */}
                  <div className="hs-shot">
                    <img src={`/${s.photo}`} alt="" loading="lazy" width="720" height="720" />
                  </div>

                  <div className="hs-card-head">
                    <div>
                      <h3>
                        <Link href={L(`/hair-styles/${s.slug}`)}>{c.name}</Link>
                      </h3>
                      <span className="hs-label" dir={label.dir}>{label.text}</span>
                      <p className="hs-short">{c.short}</p>
                    </div>
                  </div>

                  <p className="hs-look">{c.look}</p>
                  <p className="hs-why-line">{c.why}</p>

                  <p className="hs-avoid">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7.5v5.5" strokeLinecap="round" />
                      <path d="M12 16.4v.2" strokeLinecap="round" />
                    </svg>
                    <span>{c.avoid}</span>
                  </p>

                  {best ? (
                    <div className="hs-pick">
                      <Link className="hs-pick-main" href={L(`/product/${best.slug}`)}>
                        <img src={imageUrl(best.image)} alt={ar ? best.name_ar : best.name_en}
                          width="120" height="120" loading="lazy" />
                        <span>
                          <b className="hs-pick-lbl">
                            {/* A look the range cannot serve is not offered an
                                answer. It gets the closest thing that exists,
                                named as exactly that — and below, no
                                alternates, because there is no second-best for
                                something we have already said we cannot do. */}
                            {s.served === 'no'
                              ? (ar ? 'أقرب حاجة عندنا' : 'The closest we have')
                              : (ar ? 'اللي هيوصلك له' : 'What gets you there')}
                          </b>
                          <b className="hs-pick-name">{ar ? best.name_ar : best.name_en}</b>
                          <bdi className="hs-pick-price">
                            {whole(best.price)} <small>{currencyLabel(lang)}</small>
                          </bdi>
                        </span>
                      </Link>

                      {s.served !== 'no' && alts.length > 0 && (
                        <p className="hs-alts">
                          <span>{ar ? 'ينفع كمان:' : 'Also works:'}</span>
                          {alts.map(a => (
                            <Link key={a.sku} href={L(`/product/${a.slug}`)}>
                              {ar ? a.name_ar : a.name_en}
                            </Link>
                          ))}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="hs-empty">
                      {ar
                        ? 'المنتجات مش ظاهرة دلوقتي — جرّب صفحة المنتجات.'
                        : 'Products are not loading right now — try the shop page.'}
                    </p>
                  )}

                  {gap && <p className="hs-gapnote">{gap}</p>}

                  <Link className="hs-more" href={L(`/hair-styles/${s.slug}`)}>
                    {ar ? `خطوات الـ${c.name} بالتفصيل ←` : `The full ${c.name.toLowerCase()} guide →`}
                  </Link>
                </article>
              );
            })}
          </div>
        </section>

        {/* ------------------------------------------------------ the grid */}
        <section className="hs-grid-sec">
          <h2>{ar ? 'التشكيلة كلها على المحورين' : 'The whole range on both axes'}</h2>
          <p className="hs-lead">
            {ar
              ? 'التثبيت من قاعدة البيانات، واللمعة من تصنيف المصنع نفسه لكل منتج. كل جل بيقود استايل واحد بس، ومفيش حاجة مكررة.'
              : 'Hold comes from the catalogue, shine from the manufacturer’s own per-product rating. Each gel fronts exactly one style, and nothing here doubles up.'}
          </p>

          {grid.length > 0 ? (
            <div className="hs-tablewrap">
              <table className="hs-table">
                <thead>
                  <tr>
                    <th>{ar ? 'المنتج' : 'Product'}</th>
                    <th>{ar ? 'التثبيت' : 'Hold'}</th>
                    <th>{ar ? 'اللمعة' : 'Shine'}</th>
                    <th>{ar ? 'بيقود استايل' : 'Fronts'}</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map(r => (
                    <tr key={r.sku}>
                      <th scope="row">
                        <Link href={L(`/product/${r.slug}`)}>{r.name}</Link>
                      </th>
                      <td><bdi dir="ltr">{r.hold}/5</bdi></td>
                      <td>{r.shine}</td>
                      <td>
                        {r.fronts
                          ? <Link className="hs-yes" href={L(`/hair-styles/${r.frontsSlug}`)}>{r.fronts}</Link>
                          : <span className="hs-no">{ar ? '—' : '—'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hs-empty">
              {ar
                ? 'المنتجات مش ظاهرة دلوقتي. الاستايلات فوق ثابتة مهما كان.'
                : 'Products are not loading right now. The styles above still stand.'}
            </p>
          )}
        </section>

        {/* ---------------------------------------------------------- gaps */}
        <section className="hs-gaps">
          <h2>{ar ? 'حاجات لسه مبنعملهاش' : 'What we do not make yet'}</h2>
          <p className="hs-lead">
            {ar
              ? 'نفس الكلام المكتوب في صفحة أنواع الشعر، بس من ناحية تانية. الترشيحات اللي فوق هي أحسن حاجة موجودة عندنا فعلاً.'
              : 'Same admission as the hair-types page, from the other end. The picks above are the best we have got.'}
          </p>
          <ul className="hs-gaplist">
            {gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
          <Link className="btn btn-ink" href={L(`/hair-types`)}>
            {ar ? 'اعرف نوع شعرك كمان ←' : 'Find your hair type too →'}
          </Link>
        </section>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
