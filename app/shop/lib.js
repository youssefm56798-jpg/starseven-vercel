import { alternatesForLang } from '../../lib/urls.js';

/**
 * The pure part of the shop pages — categories, their copy and their URLs.
 *
 * Separated from view.js so it can be tested. The view is JSX and imports
 * React components; a node:test file cannot load it, and the thing worth
 * guarding here is the copy and the addresses, not the markup.
 *
 * A category’s URL slug is deliberately not the same string as its `kind`
 * column. The column is a short internal enum ('gelwax', 'cream'); the URL is
 * what a person types and what Google indexes, so it spells the product out
 * ('/shop/gel-wax', '/shop/cream-gel'). Keeping the two apart means the
 * database can stay terse and the URL can stay legible.
 */

/** Every category, in the order the chips and the nav show them. */
export const CATEGORIES = [
  {
    slug: 'wax', kind: 'wax',
    crumb: { ar: 'واكس', en: 'Wax' },
    h1: { ar: 'واكس شعر للرجالة', en: 'Men’s hair wax' },
    title: {
      ar: 'واكس شعر للرجالة — تثبيت قوي بلمعة طبيعية',
      en: 'Men’s hair wax — strong hold, natural finish',
    },
    desc: {
      ar: 'واكس شعر نيو ستار سفن للرجالة: تثبيت متوسط لعالي بلمعة طبيعية، مظبوط للشعر القصير والمتوسط وللتكستشر. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven men’s hair wax: medium-high hold with a natural finish, built for short to medium hair and texture. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'الواكس بيدي تكستشر وتثبيت من غير ما يلزّق الشعر ولا يعمل قشرة. كل لون تركيبة مختلفة وتثبيت مختلف: برو وبرو إكس أقوى واحد فيهم، والشيا والأرجان والبلاك أمرن ومرجّعين للشكل.',
      en: 'Wax gives texture and hold without gluing hair down or going crunchy. Every colour is a different formula and a different hold. Pro and Pro X are the strongest here; Shea, Argan and Black are the ones that stay workable.',
    },
  },
  {
    slug: 'gel', kind: 'gel',
    crumb: { ar: 'جل', en: 'Gel' },
    h1: { ar: 'جل شعر للرجالة', en: 'Men’s hair gel' },
    title: {
      ar: 'جل شعر للرجالة — أعلى تثبيت من غير قشرة',
      en: 'Men’s hair gel — highest hold, no flaking',
    },
    desc: {
      ar: 'جل شعر نيو ستار سفن للرجالة: أعلى تثبيت عندنا، بيمسك الاستايل المحدد طول اليوم من غير قشرة. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven men’s hair gel: our highest hold, holding a defined style all day without flaking. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'جل شعر رجالي بأعلى تثبيت عندنا — أنسب حاجة للشعر الناعم المفرود اللي مش بيمسك شكل، وللاستايل المحدد اللي عايزه يفضل مكانه.',
      en: 'Men’s hair gel at the highest hold we make. The right answer for straight hair that refuses to hold a shape, and for any style you want to stay exactly where you put it.',
    },

    /*
     * The long copy under the grid.
     *
     * The category pages carried twenty words each, which is nothing for a
     * page meant to answer "which gel do I buy". This is written for the
     * question rather than for a keyword: what gel is, which size, and the two
     * things men actually worry about - flaking, and whether it washes out.
     */
    body: {
      ar: `## الجل ولا الواكس؟

الفرق مش في القوة، الفرق في طريقة الشغل. **الجل بيتحط على شعر مبلول وبينشف على الشكل** اللي حطيته وبيفضل فيه. **الواكس بيتحط على شعر ناشف** أو نص ناشف وبيفضل ماشي مع إيدك طول اليوم، تقدر تعدّل فيه أي وقت.

يعني لو عايز شكل محدد يقف مكانه من الصبح للّيل — الجل. ولو عايز شعر طبيعي تقدر تلعب فيه — الواكس. ولو مش متأكد، [اعرف نوع شعرك](/hair-types) الأول.

الجل كمان هو الحل الوحيد للشعر الناعم المفرود. الشعر ده بيقع بسرعة ومبيمسكش شكل، والواكس بوزنه بيوقّعه أكتر. الجل بينشف عليه وبيمسكه من غير وزن.

## أنواع جل شعر رجالي عندنا

عندنا خطين، والفرق بينهم الحجم والسعر مش الجودة:

- **جل بريميوم ٢٥٠ مل — ٨٠ جنيه.** خمس ألوان: أسود، أبيض، أزرق، أخضر، جولدن. ده اللي تبدأ بيه لو بتجرب الماركة لأول مرة.
- **جل تثبيت الشعر ٤٠٠ مل — ٦٠ جنيه.** أربع ألوان. أرخص علبة عندنا وأكتر حاجة بتتباع.
- **٦٥٠ مل — ٨٠ جنيه** و **٨٥٠ مل — ١٠٠ جنيه.** نفس الجل، علبة أكبر. لو بتستعمل جل كل يوم، الـ٨٥٠ بتطلع أرخص بكتير على الاستعمالة.

كل الجل عندنا **تثبيته ٥ من ٥**. اللي بيفرق بين اللون والتاني هو اللمعة: الجولدن أعلى لمعة، والأبيض أهدى واحد.

## بيعمل قشرة؟

القشرة البيضا اللي بتنزل على الكتف مش قشرة فروة رأس — دي الجل نفسه بينشف ويتكسر. بتحصل لما تحط كتير، أو تحط على شعر ناشف بدل مبلول.

الجل بتاعنا تركيبته مائية ومصممة إنها متتكسرش، وده مكتوب على كل علبة. بس التطبيق برضه بيفرق: **قد فصّة إيدك على شعر مبلول** كفاية لشعر متوسط الطول.

## بيتشال بالمياه؟

أيوة، من غير شامبو. تركيبة مائية يعني بتذوب في المياه لوحدها — تحط راسك تحت الدش ودلّك بإيدك وخلاص.

## صنع في مصر

نيو ستار سفن ماركة مصرية من إنتاج **أوفانزا كوزمتيكس**، مصنّعة هنا من ٢٠١٢. أغلب الجل اللي هتلاقيه على الرف مستورد وسعره ضعف ده. إحنا بنصنّعه محلي، والتوصيل لكل محافظات مصر **والدفع عند الاستلام**.`,

      en: `## Gel or wax?

The difference is not strength, it is how each one works. **Gel goes on wet hair and dries into the shape** you put it in, then stays there. **Wax goes on dry or half-dry hair** and stays movable all day, so you can rework it whenever you like.

So: a defined shape that holds from morning to night is gel. Natural hair you can run your hands through is wax. If you are not sure, [find your hair type](/en/hair-types) first.

Gel is also the only real answer for fine, straight hair. That hair drops fast and will not hold a shape, and wax only weighs it down further. Gel dries onto it and holds it with no weight at all.

## The gels we make

Two lines. The difference between them is size and price, not quality:

- **Premium Gel 250ml — 80 EGP.** Five colours: black, white, blue, green and golden. Start here if you are trying the brand for the first time.
- **Styling Gel 400ml — 60 EGP.** Four colours. Our cheapest jar and our best seller.
- **650ml — 80 EGP** and **850ml — 100 EGP.** The same gel in a bigger jar. If you use gel daily, the 850ml works out far cheaper per use.

Every gel we make is **hold 5 of 5**. What separates the colours is shine: golden is the highest, white the quietest.

## Does it flake?

The white dust that lands on your shoulder is not scalp flaking — it is the gel itself drying and cracking. It happens when you use too much, or apply to dry hair instead of wet.

Ours is a water-based formula built not to crack, and that claim is printed on every jar. Application still matters: **a fingertip-sized amount on wet hair** is enough for medium-length hair.

## Does it wash out?

Yes, without shampoo. Water-based means it dissolves in water on its own — put your head under the shower, work it through with your fingers, done.

## Made in Egypt

New Star Seven is an Egyptian brand made by **Ovanza Cosmetics**, manufacturing here since 2012. Most gel on the shelf is imported and costs twice this. We make ours locally, deliver to every governorate, and you **pay cash when it arrives**.`,
    },

    /*
     * Five questions, and each one is a real search rather than a thing we
     * wanted to say. They render as a disclosure list and as FAQPage JSON-LD,
     * so the answers can also appear directly in a result.
     */
    faq: {
      ar: [
        { q: 'إيه الفرق بين الجل والواكس؟',
          a: 'الجل بيتحط على شعر مبلول وبينشف على الشكل وبيفضل ثابت. الواكس بيتحط على شعر ناشف وبيفضل ماشي مع إيدك طول اليوم. الجل للشكل المحدد، الواكس للشعر الطبيعي اللي بتلعب فيه.' },
        { q: 'الجل بيعمل قشرة؟',
          a: 'القشرة البيضا دي الجل نفسه بينشف ويتكسر، مش قشرة فروة رأس. تركيبتنا مائية ومصممة إنها متتكسرش، وبتقل أكتر لما تحط قد فصّة إيدك على شعر مبلول مش ناشف.' },
        { q: 'الجل بيتشال إزاي؟',
          a: 'بالمياه لوحدها من غير شامبو. التركيبة مائية يعني بتذوب في المياه — تحط راسك تحت الدش وتدلّك بإيدك.' },
        { q: 'أنهي حجم أشتري؟',
          a: 'لو بتجرب لأول مرة خد ٢٥٠ مل بـ٨٠ جنيه أو ٤٠٠ مل بـ٦٠ جنيه. لو بتستعمل جل كل يوم، ٨٥٠ مل بـ١٠٠ جنيه بتطلع أرخص بكتير على الاستعمالة.' },
        { q: 'الجل بيقع الشعر؟',
          a: 'لأ. الجل بيقعد على الشعرة نفسها مش على الفروة، وبيتشال بالمياه. اللي بيأذي الشعر هو الشد والتمشيط وهو ناشف، مش الجل.' },
      ],
      en: [
        { q: 'What is the difference between gel and wax?',
          a: 'Gel goes on wet hair, dries into the shape and holds it. Wax goes on dry hair and stays movable all day. Gel is for a defined shape; wax is for natural hair you can run your hands through.' },
        { q: 'Does hair gel cause flaking?',
          a: 'The white dust is the gel drying and cracking, not scalp flaking. Our formula is water-based and built not to crack, and it happens far less when you use a fingertip-sized amount on wet rather than dry hair.' },
        { q: 'How do I wash gel out?',
          a: 'Plain water, no shampoo needed. A water-based formula dissolves in water on its own — put your head under the shower and work it through with your fingers.' },
        { q: 'Which size should I buy?',
          a: 'Trying the brand: 250ml at 80 EGP or 400ml at 60 EGP. Using gel daily: the 850ml at 100 EGP is far cheaper per use.' },
        { q: 'Does hair gel cause hair loss?',
          a: 'No. Gel sits on the hair shaft rather than the scalp and rinses out with water. What damages hair is pulling and combing it while it is dry and set, not the gel itself.' },
      ],
    },
  },
  {
    slug: 'gel-wax', kind: 'gelwax',
    crumb: { ar: 'جل واكس', en: 'Gel Wax' },
    h1: { ar: 'جل واكس للشعر', en: 'Hair gel wax' },
    title: {
      ar: 'جل واكس للشعر — تثبيت الواكس مع لمعة الجل',
      en: 'Hair gel wax — wax control with gel shine',
    },
    desc: {
      ar: 'جل واكس نيو ستار سفن ١٤٠ مل: تركيبة هجينة بتجمع تحكّم الواكس مع لمعة الجل، بزيوت مختلفة لكل نوع شعر. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven gel wax, 140ml: a hybrid that pairs the control of a wax with the shine of a gel, in a different oil for each hair type. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'لو الواكس تقيل عليك والجل ناشف أوي — ده اللي بينهم. تحكّم الواكس مع لمعة الجل في تركيبة واحدة.',
      en: 'If wax feels heavy and gel sets too hard, this is the one in between: the control of a wax with the finish of a gel.',
    },
  },
  {
    slug: 'cream-gel', kind: 'cream',
    crumb: { ar: 'كريم جل', en: 'Cream Gel' },
    h1: { ar: 'كريم جل للشعر', en: 'Hair cream gel' },
    title: {
      ar: 'كريم جل للشعر — تحكّم مع ترطيب لليومي',
      en: 'Hair cream gel — control with conditioning',
    },
    desc: {
      ar: 'كريم جل نيو ستار سفن ٢٥٠ مل: مفضّل الحلاقين — تحكّم بمظهر مبلول مع ترطيب الكريم، للاستخدام اليومي. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven cream gel, 250ml: the barber’s pick — wet-look control with cream conditioning, built for daily use. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'كريم بيثبّت الشعر: قوامه خفيف زي الكريم، وبيدي لمعان بسيط مش لمعة جل. أخف شكل في التشكيلة وأسهله في التعامل، بيمشي مع كل أنواع الشعر، وبيرطّب وهو بيمسك.',
      en: 'A cream that holds. Light in the hand like a cream, and it leaves a soft shine rather than a gel gloss. It’s the most forgiving thing we make, it works on every hair type, and it conditions while it holds.',
    },
  },
  {
    // Two formats the range gained in Aug 2026, and the first two matte ones.
    // They sit here rather than at the end because the chip row is read as a
    // shelf and these belong next to the wax, not after the depilatory.
    //
    // No rows are seeded for either: the manufacturer catalogue had not arrived
    // when they were added, so the client fills them from the admin. Until then
    // liveCategories leaves both chips off the nav, the footer and the sitemap
    // on their own — a category with nothing live is a page that 404s, and
    // linking to it would cost a crawl and a customer.
    slug: 'clay-wax', kind: 'clay',
    crumb: { ar: 'كلاي واكس', en: 'Clay Wax' },
    h1: { ar: 'كلاي واكس للشعر', en: 'Hair clay wax' },
    title: {
      ar: 'كلاي واكس للشعر — تثبيت قوي بشكل مطفي',
      en: 'Hair clay wax — firm hold, matte finish',
    },
    desc: {
      ar: 'كلاي واكس نيو ستار سفن: تثبيت قوي بخلاصة مطفية، بيدي حجم وتكستشر من غير لمعة. مظبوط للشعر الخفيف وللفرنش كروب. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven clay wax: firm hold with a matte finish, giving volume and texture without shine. Built for fine hair and for the textured crop. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'الحاجة الوحيدة عندنا اللي بتخلي الشعر يبان ناشف. الكلاي بيدي حجم وتكستشر من غير لمعة — وده اللي الشعر الخفيف والكروب المكركب محتاجينه.',
      en: 'The only thing we make that leaves hair looking dry. Clay gives volume and texture without the shine, which is exactly what fine hair and a choppy crop are asking for.',
    },
  },
  {
    slug: 'pomade', kind: 'pomade',
    crumb: { ar: 'بوماد', en: 'Pomade' },
    h1: { ar: 'بوماد للشعر', en: 'Hair pomade' },
    title: {
      ar: 'بوماد للشعر — تثبيت متوسط لعالي من غير لمعة',
      en: 'Hair pomade — medium-high hold, no shine',
    },
    desc: {
      ar: 'بوماد نيو ستار سفن: تثبيت متوسط لعالي بشكل مطفي، للسليك باك والفرق الجانبي على الشعر المتوسط والكثيف. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven pomade: medium-high hold with a matte finish, for slick-backs and side parts on medium to thick hair. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'بوماد من غير لمعة — والفرق بينه وبين الجل واكس هو اللمعة بالظبط. لو عايز نفس الفكرة بس لامعة، الجل واكس هو ده.',
      en: 'A pomade with no shine, and shine is the whole difference between this and the gel wax. If you want the same idea with a gloss on it, the gel wax is that product.',
    },
  },
  {
    slug: 'hair-spray', kind: 'spray',
    crumb: { ar: 'سبراي', en: 'Hair Spray' },
    h1: { ar: 'سبراي مثبت للشعر', en: 'Hair spray' },
    title: {
      ar: 'سبراي مثبت للشعر — يقفل الاستايل في الآخر',
      en: 'Hair spray — lock the style at the end',
    },
    desc: {
      ar: 'سبراي مثبت نيو ستار سفن ٥٠٠ مل بدرجتين تثبيت: الخطوة الأخيرة اللي بتقفل الاستايل بعد الواكس أو الجل. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven hair spray, 500ml, in two hold strengths: the last step that locks a style after the wax or the gel. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'مش بديل للواكس ولا الجل — ده اللي بييجي بعدهم. رشة في الآخر بتخلي الشكل ثابت لآخر اليوم.',
      en: 'Not a replacement for wax or gel. It’s the step after them: one pass at the end and the shape stays where you left it.',
    },
  },
  {
    slug: 'cologne', kind: 'cologne',
    crumb: { ar: 'كولونيا', en: 'Cologne' },
    h1: { ar: 'كولونيا بعد الحلاقة', en: 'After-shave cologne' },
    title: {
      ar: 'كولونيا بعد الحلاقة — كلاسيك الحلاق المصري',
      en: 'After-shave cologne — the Egyptian barber classic',
    },
    desc: {
      ar: 'كولونيا بعد الحلاقة نيو ستار سفن ١٨٠ مل بستة روائح: كلاسيك الحلاق المصري بروح عصرية. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven after-shave cologne, 180ml, in six scents: the Egyptian barber classic, modernised. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'الحاجة اللي بتقفل بيها الحلاقة. ستة روائح، كلها ١٨٠ مل.',
      en: 'The thing you finish a cut with. Six scents, all 180ml.',
    },
  },
  {
    slug: 'shampoo', kind: 'shampoo',
    crumb: { ar: 'شامبو', en: 'Shampoo' },
    h1: { ar: 'شامبو وبلسم للشعر', en: 'Shampoo & conditioner' },
    title: {
      ar: 'شامبو وبلسم للشعر — ينظف من غير ما ينشّف',
      en: 'Shampoo & conditioner — cleans without drying out',
    },
    desc: {
      ar: 'شامبو نيو ستار سفن ٨٠٠ مل: شامبو وبلسم ٢×١ للشعر الجاف والعادي، وشامبو ضد القشرة. بيشيل كل منتجات التصفيف بسهولة ويحافظ على رطوبة الشعر. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'New Star Seven shampoo, 800ml: a 2-in-1 shampoo and conditioner for dry or normal hair, and an anti-dandruff. Washes styling products out without drying the hair. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'اللي بيشيل الواكس والجل في آخر اليوم. تلات عبوات ٨٠٠ مل: ٢×١ للشعر الجاف، ٢×١ للشعر العادي، وواحد ضد القشرة — وكلهم بيغسلوا منتجات نيو ستار سفن من غير ما ينشّفوا الشعر.',
      en: 'What takes the wax and the gel back out at the end of the day. Three 800ml bottles: a 2-in-1 for dry hair, a 2-in-1 for normal hair and an anti-dandruff, and all three wash New Star Seven products out without drying the hair.',
    },
  },
  {
    slug: 'depilatory', kind: 'depilatory',
    crumb: { ar: 'إزالة الشعر', en: 'Hair Removal' },
    h1: { ar: 'منتجات إزالة الشعر', en: 'Hair removal' },
    title: {
      ar: 'منتجات إزالة الشعر — شمع وعجينة ورول',
      en: 'Hair removal — wax, paste and roll-on',
    },
    desc: {
      ar: 'تشكيلة إزالة الشعر من نيو ستار سفن: قوالب شمع ٤٠٠ جم، رول ١٠٠ مل، وعجينة ١٠٠ جم بروائح مختلفة. توصيل لكل مصر والدفع عند الاستلام.',
      en: 'The New Star Seven hair-removal range: 400g wax blocks, 100ml roll-ons and 100g pastes in a spread of scents. Delivered across Egypt, cash on receipt.',
    },
    lead: {
      ar: 'دي تشكيلة إزالة الشعر — حاجة تانية خالص عن واكس التصفيف اللي فوق.',
      en: 'This is the hair-removal range, a different thing entirely from the styling wax above.',
    },
  },
];

const BY_SLUG = new Map(CATEGORIES.map(c => [c.slug, c]));

/** Category URL slugs, in display order. */
export const KINDS = CATEGORIES.map(c => c.slug);

/**
 * The categories a set of live `kind` values actually fills, in display order.
 *
 * The shop chips, the sitemap and the nav all have to answer the same
 * question, and it is not "what does the catalogue contain" — it is "what has
 * the client priced and switched on". A category with nothing live is an empty
 * page that 404s, so linking to it costs a crawl and a customer.
 *
 * Pure, so the callers can each fetch their own counts however they like.
 */
export function liveCategories(kinds) {
  const have = new Set(Array.isArray(kinds) ? kinds : []);
  return CATEGORIES.filter(c => have.has(c.kind));
}

/** The `kind` column value a category filters on. */
export const kindColumn = slug => BY_SLUG.get(slug)?.kind || null;

/** The path a category lives at — /shop for the whole line. */
export const shopPath = slug => (BY_SLUG.has(slug) ? `/shop/${slug}` : '/shop');

/** Everything language- and category-specific, in one place. */
export function shopCopy(slug, lang) {
  const ar = lang === 'ar';
  const pick = f => (ar ? f.ar : f.en);
  const c = BY_SLUG.get(slug);

  if (c) {
    return {
      crumb: pick(c.crumb), h1: pick(c.h1),
      title: pick(c.title), desc: pick(c.desc), lead: pick(c.lead),
      // Written for one category at a time. A category with nothing written
      // yet returns the empty forms, and the page renders as it always did
      // rather than showing an empty heading.
      body: c.body ? pick(c.body) : '',
      faq: c.faq ? pick(c.faq) : [],
    };
  }

  return {
    crumb: ar ? 'المنتجات' : 'Shop',
    h1: ar ? 'كل التشكيلة' : 'The full line',
    title: ar ? 'المنتجات — واكس وجل شعر' : 'Shop — hair wax & gel',
    desc: ar
      ? 'كل تشكيلة نيو ستار سفن: واكس وجل شعر بريميوم للرجالة، من تثبيت متوسط لحد أولترا سترونج، بسعر مظبوط. توصيل ودفع عند الاستلام.'
      : 'The full New Star Seven line: premium men’s hair wax and gel, medium hold up to ultra strong, priced right. Delivery and cash on receipt.',
    lead: ar
      ? 'كل لون تركيبة مختلفة، وكل شكل تثبيت مختلف. اختار منتجك أو دوس عليه تشوف تفاصيله.'
      : 'Every colour is a different formula, every format a different hold. Pick a product or open it for the full detail.',
  };
}

export function shopMeta(slug, lang) {
  const c = shopCopy(slug, lang);
  return {
    title: c.title,
    description: c.desc,
    alternates: alternatesForLang(shopPath(slug), lang),
  };
}
