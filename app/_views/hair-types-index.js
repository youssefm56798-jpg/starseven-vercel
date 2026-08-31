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
 * guide with no jars on it rather than a 500 — the seven tiles, the reasoning
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
  //
  // Three states, not two. A count is the answer whenever the shop has one, and
  // "no" whenever the brand does not make the format at all — but the clay wax
  // and the pomade are neither: the factory makes both and the shop has not
  // listed either, because the photographs and the prices had not arrived. Both
  // of the two-state answers would have been a lie in a different direction, so
  // the cell says what is true. It stops saying it, on its own, the moment
  // `counts` finds one — which is why `soon` still asks the same question the
  // other rows do rather than being a hard-coded string.
  const no = ar ? 'لأ' : 'No';
  const soon = ar ? 'قريب على الموقع' : 'Coming to the shop';
  const count = (n, unitAr, unitEn) => (ar ? `${n} ${unitAr}` : `${n} ${unitEn}`);
  const yes = (n, unitAr, unitEn) => (n > 0 ? count(n, unitAr, unitEn) : no);
  const made = (n, unitAr, unitEn) => (n > 0 ? count(n, unitAr, unitEn) : soon);

  const have = {
    gel: yes(counts.gel, 'جل', counts.gel === 1 ? 'gel' : 'gels'),
    wax: yes(counts.wax, 'واكس', counts.wax === 1 ? 'wax' : 'waxes'),
    cream: yes(counts.cream, 'كريم جل', counts.cream === 1 ? 'cream gel' : 'cream gels'),
    clay: made(counts.clay, 'كلاي واكس', counts.clay === 1 ? 'clay wax' : 'clay waxes'),
    pomade: made(counts.pomade, 'بوماد', counts.pomade === 1 ? 'pomade' : 'pomades'),
    none: no,
    soon,
  };

  // Shine is the column the customer is really reading, and two rows in it were
  // wrong. The gel row said "wet", which is a look rather than a level — it is
  // the highest shine on the shelf and the table now says so. The pomade row
  // said high, which is true of the classic oil-based pomade and not of the one
  // this brand makes: theirs finishes matte, and the shiny version of that idea
  // is sold separately as the gel wax. Both corrections come from the
  // manufacturer.
  const formats = ar
    ? [
        ['جل', 'عالي جداً', 'لمعة عالية', 'استايل محدد، فرق جانبي، وتعريف الكيرلة', 'اللي عايز شكل طبيعي — بينشف ومش هتعدله بعد كده', have.gel],
        ['واكس', 'متوسط لعالي', 'طبيعية', 'الشعر القصير والمتوسط، التكستشر، وتعريف الشعر الخشن', 'الشعر الطويل — بيقع تحت وزنه', have.wax],
        ['كلاي (طين)', 'عالي', 'مطفي', 'الشعر الخفيف اللي عايز حجم، والكروب المكركب', 'الكيرلي والأفرو — بينشّفهم', have.clay],
        ['كريم', 'خفيف', 'قليلة', 'أسهل شكل في التعامل، بيشتغل مع كل الأنواع', 'اللي محتاج تثبيت حقيقي', have.cream],
        ['بوماد', 'متوسط لعالي', 'من غير لمعة', 'الشعر المتوسط والكثيف، السليك باك والفرق الجانبي', 'الشعر الخفيف — تقيل عليه', have.pomade],
      ]
    : [
        ['Gel', 'Very high', 'High shine', 'Structured styles, sharp side parts, curl definition', 'Anyone wanting a natural look — it sets hard, no restyling', have.gel],
        ['Wax', 'Medium–high', 'Natural', 'Short to medium hair, texture, defining coarse hair', 'Long hair — it sags under its own weight', have.wax],
        ['Clay', 'High', 'Matte', 'Fine or thin hair that needs volume, and the choppy crop', 'Very curly or coily hair — too drying', have.clay],
        ['Cream', 'Light', 'Low', 'The most forgiving format, works across every type', 'Anyone needing real structure', have.cream],
        ['Pomade', 'Medium–high', 'No shine', 'Medium to thick hair, slick-backs and side parts', 'Thin or fine hair — too heavy', have.pomade],
      ];

  // Four products the factory is making now, not four holes in the range.
  //
  // This list used to be derived from the live catalogue, because every line in
  // it was a claim about something absent and a claim that quietly rots is
  // worse than no claim at all. Two of those lines have since been overtaken —
  // the cream gel landed, and so did the clay — and what is left is a
  // production schedule rather than an admission, so it is written out rather
  // than counted. The rule the derivation existed to enforce still stands: the
  // day one of these four is on the shop, its line comes off this list.
  const gaps = [
    ar
      ? 'ليڤ-إن — المنتج اللي بيتحط على الشعر المبلول وبيفضل فيه، وأكتر حاجة بتفرق مع الشعر الأفرو والخشن.'
      : 'A leave-in — the one that goes on wet hair and stays there. The single biggest difference-maker for coily and coarse hair.',
    ar
      ? 'كريم كيرلي — للترطيب وتعريف الكيرلة مع بعض، من غير ما يفرد الكيرلة.'
      : 'A curl cream — moisture and curl definition at the same time, without flattening the curl.',
    ar
      ? 'فوم كيرلي — بيدي حجم وتعريف للكيرلي من غير وزن.'
      : 'A curl foam — volume and definition for curly hair with none of the weight.',
    ar
      ? 'كريمات تصفيف — أخف تثبيت في التشكيلة، لليومي ولحد لسه بيجرب.'
      : 'Styling creams — the lightest hold in the line, for daily use and for anyone still finding their product.',
  ];

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
          <div className="phead-cta">
            <Link className="btn btn-red" href={L('/shop')}>
              {ar ? 'اتفرج على المنتجات' : 'Shop the range'}
            </Link>
          </div>
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

        {/* ------------------------------------------------- the seven tiles */}
        <section className="ht-tiles" id="types">
          <h2>{ar ? 'السبع حالات' : 'The seven cases'}</h2>

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
              ? 'قبل ما تختار نوع شعرك، دي الأشكال اللي بتتباع في السوق وبتعمل إيه فعلاً — وأنهي واحد فيهم تقدر تشتريه من هنا النهارده وأنهي واحد لسه في الطريق.'
              : 'Before you pick a type, here is what each format on the market actually does — and which of them you can buy here today, and which is still on its way.'}
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
                    <td>
                      <bdi className={
                        ours === have.none ? 'ht-no' : ours === have.soon ? 'ht-soon' : 'ht-yes'
                      }>{ours}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------------------------------------------------- gaps */}
        <section className="ht-gaps">
          <h2>{ar ? 'منتجات تحت التنفيذ' : 'In production now'}</h2>
          <p className="ht-lead">
            {ar
              ? 'دي المنتجات اللي تحت الإنتاج دلوقتي وهتنزل قريب. لسه مش على الموقع، فالترشيح اللي فوق هو أحسن اختيار من اللي موجود فعلاً النهارده.'
              : 'These are in production now and land soon. They are not on the shop yet, so the picks above are the best answer that exists here today.'}
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
