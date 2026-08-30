import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { sql, hasDb } from '../../lib/db.js';
import { site } from '../../lib/config.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { HAIR_TYPES, rankProducts } from '../../lib/hairtypes.js';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import {
  ld, typeRange, formatCounts, gapNote, indexLd, breadcrumbLd,
} from '../hair-types/lib.js';
import '../hair-types/hairtypes.css';
import { imageUrl } from '../../lib/product-image.js';

/**
 * The hair-type index, rendered once and mounted at both addresses.
 *
 * This body used to sit in app/hair-types/page.js and take its language from
 * `searchParams`, because middleware rewrote /en/hair-types onto
 * /hair-types?lang=en and that query string was the only channel carrying the
 * locale into the page. Reading it cost the page its prerender: `searchParams`
 * is a dynamic API, so awaiting it opted the route out of static generation and
 * zeroed the `revalidate` window on the way out. Now that /en is a real path
 * segment there are two route files, each handing this view its own language as
 * a constant, and nothing here learns anything about the request.
 *
 * hairtypes.css is imported here rather than in either route file so both
 * addresses pull it from one place and neither can be left without it.
 */

/**
 * The catalogue, or an empty list.
 *
 * This page's job is the editorial content; the product picks are the payoff,
 * not the page. A database that is missing or unhappy therefore degrades to a
 * guide with no jars on it rather than a 500 — the six tiles, the reasoning
 * and the honest limits all still render.
 */
async function loadProducts() {
  if (!hasDb()) return [];
  try {
    return await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;
  } catch {
    return [];
  }
}

export default async function HairTypesIndexView({ lang }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const products = await loadProducts();
  const counts = formatCounts(products);

  // The formats table only claims what the live catalogue holds, so it can
  // never advertise a range we stopped stocking.
  const no = ar ? 'لأ' : 'No';
  const yes = (n, unitAr, unitEn) =>
    n > 0 ? (ar ? `${n} ${unitAr}` : `${n} ${unitEn}`) : no;

  const have = {
    gel: yes(counts.gel, 'جل', counts.gel === 1 ? 'gel' : 'gels'),
    wax: yes(counts.wax, 'واكس', counts.wax === 1 ? 'wax' : 'waxes'),
    cream: yes(counts.cream, 'كريم جل', counts.cream === 1 ? 'cream gel' : 'cream gels'),
    none: no,
  };

  const formats = ar
    ? [
        ['جل', 'عالي جداً', 'مبلولة', 'استايل محدد، فرق جانبي، وتعريف الكيرلة', 'اللي عايز شكل طبيعي — بينشف ومش هتعدله بعد كده', have.gel],
        ['واكس', 'متوسط لعالي', 'طبيعية', 'الشعر القصير والمتوسط، التكستشر، وتعريف الشعر الخشن', 'الشعر الطويل — بيقع تحت وزنه', have.wax],
        ['طين (clay)', 'عالي', 'مطفي', 'الشعر الخفيف اللي عايز حجم', 'الكيرلي والأفرو — بينشّفهم', have.none],
        ['كريم', 'خفيف', 'قليلة', 'أسهل شكل في التعامل، بيشتغل مع كل الأنواع', 'اللي محتاج تثبيت حقيقي', have.cream],
        ['بوميد', 'متوسط لعالي', 'عالية', 'الشعر المتوسط والكثيف، السليك باك والفرق الجانبي', 'الشعر الخفيف — تقيل عليه', have.none],
      ]
    : [
        ['Gel', 'Very high', 'Wet', 'Structured styles, sharp side parts, curl definition', 'Anyone wanting a natural look — it sets hard, no restyling', have.gel],
        ['Wax', 'Medium–high', 'Natural', 'Short to medium hair, texture, defining coarse hair', 'Long hair — it sags under its own weight', have.wax],
        ['Clay', 'High', 'Matte', 'Fine or thin hair that needs volume', 'Very curly or coily hair — too drying', have.none],
        ['Cream', 'Light', 'Low', 'The most forgiving format, works across every type', 'Anyone needing real structure', have.cream],
        ['Pomade', 'Medium–high', 'High', 'Medium to thick hair, slick-backs and side parts', 'Thin or fine hair — too heavy', have.none],
      ];

  // Generated from the live catalogue, not typed. The cream line was true when
  // the range was five waxes and three gels; it stopped being true the moment
  // a cream gel was stocked, and a claim that quietly rots is worse than no
  // claim at all.
  const gaps = [
    ar
      ? 'مفيش طين (clay) ولا معجون مطفي. ده أوضح نقص: الشعر الخفيف اللي عايز حجم أنسب حاجة ليه طين، وإحنا بنرشحله أقرب حل موجود عندنا — مش منتج متعمل للحالة دي مخصوص.'
      : 'No clay and no matte paste. That is the clearest gap: fine hair that needs volume is best served by a clay, and we point it at the closest thing that exists here — not at a product built for the job.',
    counts.cream === 0
      ? (ar
        ? 'مفيش كريم. الكريم أخف شكل وأسهله، وهو أنسب بداية لصاحب الشعر الكيرلي أو الأفرو اللي شايف الواكس تقيل عليه.'
        : 'No cream. Cream is the lightest and most forgiving format, and the better starting point for curly or coily hair that finds wax too much.')
      : null,
    ar
      ? 'مفيش ليڤ-إن ولا منتج بيتحط قبل التصفيف للشعر الأفرو.'
      : 'No leave-in or pre-styler for coily hair.',
  ].filter(Boolean);

  return (
    <Dir lang={lang}>
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(indexLd({ lang, siteUrl: site.url })) }} />
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(breadcrumbLd({ tile: null, lang, siteUrl: site.url })) }} />
      <Nav lang={lang} path="hair-types" />
      <main id="content">

      <div className="phead">
        <div className="wrap">
          <Crumb lang={lang} trail={[{ label: ar ? 'أنواع الشعر' : 'Hair types' }]} />
          <h1>{ar ? 'أنواع الشعر' : 'Hair types'}</h1>
          <p>
            {ar
              ? 'مش كل شعر بياخد نفس المنتج. اعرف نوع شعرك، واعرف أنهي واكس أو جل هيمسك معاك — وليه، ومن إيه تبعد.'
              : 'Not every head takes the same product. Find your type, then the wax or gel that actually holds on it — and why, and what to avoid.'}
          </p>
        </div>
      </div>

      <div className="wrap ht">
        {/* ------------------------------------------------ why type matters */}
        <section className="ht-why">
          <h2>{ar ? 'ليه نوع الشعر هو اللي بيحدد المنتج' : 'Why hair type decides the product'}</h2>

          <p>
            {ar
              ? 'الموضوع كله وزن: وزن المنتج لازم يقابل كثافة الشعرة. زيت الأرجان خفيف وبيدخل جوه الشعرة نفسها، فبيلين ويلمع من غير ما يتقّل. زبدة الشيا العكس — تقيلة وبتقعد على السطح وبتقفل الرطوبة جوه، وده اللي محتاجه الشعر الخشن بالظبط، وهو نفسه اللي بيوقّع الشعر الخفيف على الفروة.'
              : 'It comes down to weight: the weight of the product has to match the density of the hair. Argan oil is light and penetrates the shaft, so it softens and adds shine without dragging hair down. Shea butter does the opposite — it is heavy, sits on the surface and seals moisture in, which is exactly what coarse hair wants and exactly what flattens fine hair against the scalp.'}
          </p>

          <p>
            {ar
              ? 'وشكل المنتج نفسه بيفرق زي ما التركيبة بتفرق. الجل تثبيته أعلى حاجة ولمعته مبلولة، بيمسك شكل محدد لكنه بينشف ومش بتعرف تعدّله بعد كده. الواكس تثبيته متوسط لعالي ولمعته طبيعية، بيدي تكستشر من غير ما يلزّق. عشان كده نفس المنتج ينفع مع واحد ويبوّظ شكل التاني — مش مسألة ذوق.'
              : 'The format matters as much as the formula. Gel has the highest hold and a wet finish: it holds a defined shape, but it dries hard and there is no restyling afterwards. Wax has medium-high hold and a natural finish: texture without the glued-down look. That is why one product suits one man and ruins the next — it is not a matter of taste.'}
          </p>

        </section>

        {/* --------------------------------------------------- the six tiles */}
        <section className="ht-tiles" id="types">
          <h2>{ar ? 'الستة أنواع' : 'The six types'}</h2>

          <div className="ht-grid">
            {HAIR_TYPES.map(t => {
              const c = ar ? t.ar : t.en;
              const range = typeRange(t, lang);
              const matches = rankProducts(products, t.slug, 3);
              const best = matches[0] || null;
              const alts = matches.slice(1);
              const gap = gapNote(t.slug, lang);

              return (
                <article className="ht-card" key={t.slug} style={{ '--c': t.color }}>
                  <div className="ht-card-head">
                    <span className="ht-medal">
                      <img src={`/${t.icon}`} alt="" width="76" height="76" loading="lazy" />
                    </span>
                    <div>
                      <h3>
                        <Link href={L(`/hair-types/${t.slug}`)}>{c.name}</Link>
                      </h3>
                      <span className="ht-range" dir={range.dir}>{range.text}</span>
                      <p className="ht-short">{c.short}</p>
                    </div>
                  </div>

                  <p className="ht-prob">{c.problem}</p>
                  <p className="ht-ans">{c.answer}</p>

                  <p className="ht-avoid">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7.5v5.5" strokeLinecap="round" />
                      <path d="M12 16.4v.2" strokeLinecap="round" />
                    </svg>
                    <span>{c.avoid}</span>
                  </p>

                  {best ? (
                    <div className="ht-pick">
                      <Link className="ht-pick-main" href={L(`/product/${best.slug}`)}>
                        <img src={imageUrl(best.image)} alt={ar ? best.name_ar : best.name_en}
                          width="120" height="120" loading="lazy" />
                        <span>
                          <b className="ht-pick-lbl">{ar ? 'الاختيار الصح' : 'The right one'}</b>
                          <b className="ht-pick-name">{ar ? best.name_ar : best.name_en}</b>
                          <bdi className="ht-pick-price">
                            {whole(best.price)} <small>{currencyLabel(lang)}</small>
                          </bdi>
                        </span>
                      </Link>

                      {alts.length > 0 && (
                        <p className="ht-alts">
                          <span>{ar ? 'كمان يناسبه:' : 'Also works:'}</span>
                          {alts.map(a => (
                            <Link key={a.sku} href={L(`/product/${a.slug}`)}>
                              {ar ? a.name_ar : a.name_en}
                            </Link>
                          ))}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="ht-empty">
                      {ar
                        ? 'المنتجات مش ظاهرة دلوقتي — جرّب صفحة المنتجات.'
                        : 'Products are not loading right now — try the shop page.'}
                    </p>
                  )}

                  {gap && <p className="ht-gapnote">{gap}</p>}

                  <Link className="ht-more" href={L(`/hair-types/${t.slug}`)}>
                    {ar ? `كل تفاصيل شعر ${c.name} ←` : `Everything about ${c.name.toLowerCase()} hair →`}
                  </Link>
                </article>
              );
            })}
          </div>
        </section>

        {/* ------------------------------------------------------- formats */}
        <section className="ht-formats">
          <h2>{ar ? 'الأشكال الخمسة وبتعمل إيه' : 'The five formats, and what each does'}</h2>
          <p className="ht-lead">
            {ar
              ? 'قبل ما تختار نوع شعرك، دي الأشكال اللي بتتباع في السوق وبتعمل إيه فعلاً — وأنهي واحد فيهم موجود عندنا وأنهي واحد لأ.'
              : 'Before you pick a type, here is what each format on the market actually does — and which of them we make.'}
          </p>

          <div className="ht-tablewrap">
            <table className="ht-table">
              <thead>
                <tr>
                  <th>{ar ? 'الشكل' : 'Format'}</th>
                  <th>{ar ? 'التثبيت' : 'Hold'}</th>
                  <th>{ar ? 'اللمعة' : 'Shine'}</th>
                  <th>{ar ? 'قوي في' : 'Strong for'}</th>
                  <th>{ar ? 'ابعد عنه مع' : 'Avoid on'}</th>
                  <th>{ar ? 'عندنا؟' : 'We make it?'}</th>
                </tr>
              </thead>
              <tbody>
                {formats.map(([name, hold, shine, good, bad, ours]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{hold}</td>
                    <td>{shine}</td>
                    <td>{good}</td>
                    <td>{bad}</td>
                    <td><bdi className={ours === have.none ? 'ht-no' : 'ht-yes'}>{ours}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------------------------------------------------- gaps */}
        <section className="ht-gaps">
          <h2>{ar ? 'حاجات لسه مبنعملهاش' : 'What we do not make yet'}</h2>
          <p className="ht-lead">
            {ar
              ? 'التشكيلة كلها واكس وجل. الأشكال اللي تحت دي بيوصّي بيها البحث لحالات معينة، ومش عندنا منها حاجة لحد دلوقتي — والترشيح اللي فوق هو أحسن اختيار من اللي موجود فعلاً، مش أكتر ولا أقل.'
              : 'The whole range is wax and gel. The formats below are what the research recommends for certain cases, and we make none of them — so the picks above are the best answer that exists here, no more and no less.'}
          </p>
          <ul className="ht-gaplist">
            {gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
          <Link className="btn btn-ink" href={L(`/shop`)}>
            {ar ? 'شوف اللي بنعمله فعلاً ←' : 'See what we do make →'}
          </Link>
        </section>
      </div>

      </main>
      <Footer lang={lang} />
    </Dir>
  );
}
