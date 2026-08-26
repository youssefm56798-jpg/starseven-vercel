import { alternatesForLang } from '../../lib/urls.js';

/**
 * The pure part of the shop pages — categories, their copy and their URLs.
 *
 * Separated from view.js so it can be tested. The view is JSX and imports
 * React components; a node:test file cannot load it, and the thing worth
 * guarding here is the copy and the addresses, not the markup.
 *
 * A category's URL slug is deliberately not the same string as its `kind`
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
      ar: 'الواكس بيدي تكستشر وتثبيت من غير ما يلزّق الشعر ولا يعمل قشرة. كل لون تركيبة مختلفة — بس التثبيت واحد.',
      en: 'Wax gives texture and hold without gluing hair down or going crunchy. Every colour is a different formula; the hold is the constant.',
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
      ar: 'الجل هو أعلى تثبيت عندنا، وأنسب حاجة للشعر الناعم المفرود اللي مش بيمسك شكل — وللاستايل المحدد اللي عايزه يفضل مكانه.',
      en: 'Gel is the highest hold we make, and the right answer for straight hair that refuses to hold a shape — or any style you want to stay exactly where you put it.',
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
      ar: 'أخف شكل في التشكيلة وأسهله في التعامل. بيمشي مع كل أنواع الشعر، وبيرطّب وهو بيمسك.',
      en: 'The lightest and most forgiving format we make. It works across every hair type, and it conditions while it holds.',
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
      en: 'Not a replacement for wax or gel — the step after them. A pass at the end and the shape stays where you left it.',
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
      en: 'This is the hair-removal range — a different thing entirely from the styling wax above.',
    },
  },
];

const BY_SLUG = new Map(CATEGORIES.map(c => [c.slug, c]));

/** Category URL slugs, in display order. */
export const KINDS = CATEGORIES.map(c => c.slug);

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
    };
  }

  return {
    crumb: ar ? 'المنتجات' : 'Shop',
    h1: ar ? 'كل التشكيلة' : 'The full line',
    title: ar ? 'المنتجات — واكس وجل شعر' : 'Shop — hair wax & gel',
    desc: ar
      ? 'كل تشكيلة نيو ستار سفن: واكس وجل شعر بريميوم للرجالة، تثبيت ميجا، بسعر مظبوط. توصيل ودفع عند الاستلام.'
      : 'The full New Star Seven line: premium men’s hair wax and gel, mega hold, priced right. Delivery and cash on receipt.',
    lead: ar
      ? 'كل لون تركيبة مختلفة. نفس التثبيت الميجا. اختار منتجك أو دوس عليه تشوف تفاصيله.'
      : 'Every colour is a different formula, same mega hold. Pick a product or open it for the full detail.',
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
