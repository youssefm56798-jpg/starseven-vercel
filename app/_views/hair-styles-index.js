import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { sql, hasDb } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { HAIR_STYLES, finishOf, rankForStyle } from '../../lib/hairstyles.js';
import { sellable } from '../../lib/hairtypes.js';
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
  // finishOf rather than FINISH, so a clay or a pomade the client switches on
  // appears in this table on the same rules as the eight SKUs with a
  // photographed panel. Anything with no rating at all is still left out - the
  // table's whole claim is that every row in it carries a published finish.
  const grid = products
    .filter(p => finishOf(p))
    .map(p => {
      const fronts = leads.get(p.sku);
      return {
        sku: p.sku,
        slug: p.slug,
        name: ar ? p.name_ar : p.name_en,
        hold: Number(p.hold_level),
        shine: shineWord(finishOf(p).shine),
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
        ? 'الكلاي واكس والبوماد اتعملوا خلاص، بس لسه منزلوش على الموقع — وهما الاتنين المطفيين. لحد ما ينزلوا، مفيش حاجة على الموقع بتدي شكل ناشف، وده اللي الفرنش كروب كله قايم عليه.'
        : 'The clay wax and the pomade are made but not listed yet, and they are the two matte formats. Until they land, nothing on the shop gives a dry finish — and a dry finish is the whole basis of the textured crop.')
      : null,
    ar
      ? 'كريمات التصفيف وكريم الكيرلي وفوم الكيرلي والليڤ-إن كلهم تحت التنفيذ دلوقتي. دول اللي بيخدموا الكيرتن والكيرلي المظبوط.'
      : 'The styling creams, the curl cream, the curl foam and the leave-in are all in production now. Those are the ones that serve the curtains and defined curls.',
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
      <main id="content">

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'ستايلات الشعر' : 'Hair styles' }]} />
          <h1>{ar ? 'ستايلات الشعر' : 'Hair styles'}</h1>
          <p>
            {ar
              ? 'اختار الشكل اللي عايزه، ونقولك بأنهي منتج توصله وإزاي بالظبط — وفي حالتين نقولك إن المنتج المظبوط لسه منزلش على الموقع.'
              : 'Pick the look you want and we will tell you which product gets you there and exactly how — and in two cases, that the right product is not on the shop yet.'}
          </p>
          <div className="phead-cta">
            <Link className="btn btn-red" href={L('/shop')}>
              {ar ? 'اتفرج على المنتجات' : 'Shop the range'}
            </Link>
          </div>
        </div>
      </div>

      <div className="wrap hs">
        {/* --------------------------------------------- how the finder works */}
        <section className="hs-why">
          <h2>{ar ? 'الاستايل بيتحدد بحاجتين بس' : 'A style is decided by two things'}</h2>

          {/* The two axes as two scales, not as two paragraphs.
              What was here said exactly this and buried it: five lines of body
              copy in which the reader had to assemble a scale out of a sentence
              - "the gels are 5, Pro X and Pro are 4, and Shea, Argan and Black
              are 3" - while the thing being described is a ladder and reads as
              one instantly when it is drawn as one. Every product named here is
              still named; it is the prose around them that has gone.
              Mirrors .ht-axes on /hair-types. The two finders are the same
              instrument pointed at two questions, and they should not teach
              their reader two different shapes. */}
          <div className="hs-axes">
            <div className="hs-axis">
              <span className="hs-axis-k">{ar ? 'المحور الأول · التثبيت' : 'Axis one · Hold'}</span>
              <p>{ar ? 'الشكل هيقعد قد إيه.' : 'How long the shape lasts.'}</p>
              <dl>
                <div>
                  <dt>{ar ? '٥ · جل' : '5 · Gel'}</dt>
                  <dd>{ar ? 'أعلى تثبيت في التشكيلة — بينشف على الشكل' : 'The highest hold in the range — it sets on the shape'}</dd>
                </div>
                <div>
                  <dt>{ar ? '٤ · برو إكس وبرو' : '4 · Pro X and Pro'}</dt>
                  <dd>{ar ? 'تثبيت قوي بتكستشر' : 'Firm hold with texture'}</dd>
                </div>
                <div>
                  <dt>{ar ? '٣ · شيا وأرجان وبلاك' : '3 · Shea, Argan, Black'}</dt>
                  <dd>{ar ? 'متوسط ومرن — تعدّله في أي وقت' : 'Medium and flexible — rework it whenever'}</dd>
                </div>
              </dl>
            </div>

            <div className="hs-axis">
              <span className="hs-axis-k">{ar ? 'المحور التاني · اللمعة' : 'Axis two · Shine'}</span>
              <p>{ar ? 'هيبان لامع ولا ناشف.' : 'Whether it reads wet or dry.'}</p>
              <dl>
                <div>
                  <dt>{ar ? 'عالية' : 'High'}</dt>
                  <dd>{ar ? 'برو إكس، برو، أرجان، بلاك، والجل الأزرق' : 'Pro X, Pro, Argan, Black and the Blue gel'}</dd>
                </div>
                <div>
                  <dt>{ar ? 'متوسطة' : 'Medium'}</dt>
                  <dd>{ar ? 'الشيا، والجل الجولدن والأخضر' : 'Shea, and the Golden and Green gels'}</dd>
                </div>
                <div>
                  <dt>{ar ? 'مطفي' : 'Matte'}</dt>
                  {/* Gated on the same count as every other matte claim on this
                      page. The row itself always shows - matte is a real rung
                      of the scale and hiding it would misdescribe the axis -
                      but what it says about availability has to follow the
                      catalogue rather than this file. */}
                  <dd>{counts.matte === 0
                    ? (ar ? 'الكلاي والبوماد — لسه مش على الموقع' : 'The clay wax and the pomade — not on the shop yet')
                    : (ar ? 'الكلاي والبوماد' : 'The clay wax and the pomade')}</dd>
                </div>
              </dl>
            </div>
          </div>

          <p className="hs-why-note">
            {ar
              ? 'التثبيت سلّم واحد من ١ لـ ٥ على التشكيلة كلها، واللمعة تصنيف المصنع نفسه لكل منتج — مش تقديرنا. الجدول اللي تحت هو التشكيلة كلها على المحورين.'
              : 'Hold is one scale from 1 to 5 across the whole range, and the shine ratings are the manufacturer’s own, per product — not our estimate. The table below is the whole range on both axes.'}
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
                ? 'اللي على الموقع دلوقتي كله واكس وجل، ومفيش فيه حاجة مطفية. يعني من الستة اللي تحت، اتنين هنوصلك لنصهم بس — الكروب والكيرتن. الاتنين مكتوب عليهم وليه.'
                : 'Everything on the shop right now is wax and gel, and none of it is matte. So of the six styles below, two we can only get you halfway — the crop and the curtains. Both are marked, and both say why.'}
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
              const matches = rankForStyle(sellable(products), s, 3);
              const best = matches[0] || null;
              const alts = matches.slice(1);
              const gap = styleGap(s.slug, lang);

              return (
                <article className="hs-card" key={s.slug}
                  style={{ '--c': s.color }}>
                  {/* The render, given room to be looked at. The 46px masked
                      drawing this replaces was too small to tell one cut from
                      another - which is the single job a style tile has.
                      The hold figure lives inside this block so the head can
                      stand in front of it; dir="ltr" because a bare digit is a
                      Latin run and reorders inside an Arabic line without it. */}
                  <div className="hs-shot">
                    <span className="hs-hold" dir="ltr" aria-hidden="true">{s.hold}</span>
                    <img src={`/${s.photo}`} alt="" loading="lazy" width="760" height="760" />
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

                  {/* look, why and avoid used to sit here as three more
                      paragraphs, and all three are already on the style's own
                      page - "The look", "Why this product", "What to avoid".
                      A card carrying twelve blocks and standing 1100px tall is
                      not a card, it is the page it links to, and two of them
                      never fitted on one screen. What is left is the five
                      things that decide whether you click: the cut, its name,
                      one line of orientation, the product that gets you there,
                      and the way in. */}

                  {best ? (
                    <div className="hs-pick">
                      <Link className="hs-pick-main" href={L(`/product/${best.slug}`)}>
                        <img src={imageUrl(best.image)} alt={ar ? best.name_ar : best.name_en}
                          width="120" height="120" loading="lazy" />
                        <span>
                          <b className="hs-pick-lbl">
                            {/* A look the shop cannot serve properly is not
                                offered an answer. It gets the closest thing
                                that exists, named as exactly that — and below,
                                no alternates, because there is no second-best
                                for a look we have just graded ourselves down
                                on. See the same pair in app/_views/hair-style.js
                                for why this reads "not yes" and not "no". */}
                            {s.served !== 'yes'
                              ? (ar ? 'أقرب حاجة عندنا' : 'The closest we have')
                              : (ar ? 'اللي هيوصلك له' : 'What gets you there')}
                          </b>
                          <b className="hs-pick-name">{ar ? best.name_ar : best.name_en}</b>
                          <bdi className="hs-pick-price">
                            {whole(best.price)} <small>{currencyLabel(lang)}</small>
                          </bdi>
                        </span>
                      </Link>

                      {s.served === 'yes' && alts.length > 0 && (
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
          <h2>{ar ? 'منتجات تحت التنفيذ' : 'In production now'}</h2>
          <p className="hs-lead">
            {ar
              ? 'نفس اللي مكتوب في صفحة أنواع الشعر، بس من ناحية الاستايل. الترشيحات اللي فوق هي أحسن حاجة على الموقع النهارده.'
              : 'The same list as the hair-types page, read from the style end. The picks above are the best that is on the shop today.'}
          </p>
          <ul className="hs-gaplist">
            {gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
          <Link className="btn btn-ink" href={L(`/hair-types`)}>
            {ar ? 'اعرف نوع شعرك كمان ←' : 'Find your hair type too →'}
          </Link>
        </section>
      </div>

      </main>
      <Footer lang={lang} />
    </Dir>
  );
}
