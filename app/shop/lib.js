import { alternatesForLang } from '../../lib/urls.js';

/**
 * The pure part of the shop pages — categories, their copy and their URLs.
 *
 * Separated from view.js so it can be tested. The view is JSX and imports
 * React components; a node:test file cannot load it, and the thing worth
 * guarding here is the copy and the addresses, not the markup.
 */

export const KINDS = ['wax', 'gel'];

/** The path a category lives at — /shop for the whole line. */
export const shopPath = kind => (KINDS.includes(kind) ? `/shop/${kind}` : '/shop');

/** Everything language- and category-specific, in one place. */
export function shopCopy(kind, lang) {
  const ar = lang === 'ar';

  if (kind === 'wax') {
    return {
      crumb: ar ? 'واكس' : 'Wax',
      h1: ar ? 'واكس شعر للرجالة' : 'Men’s hair wax',
      title: ar
        ? 'واكس شعر للرجالة — تثبيت قوي بلمعة طبيعية'
        : 'Men’s hair wax — strong hold, natural finish',
      desc: ar
        ? 'واكس شعر نيو ستار سفن للرجالة: تثبيت متوسط لعالي بلمعة طبيعية، مظبوط للشعر القصير والمتوسط وللتكستشر. توصيل لكل مصر والدفع عند الاستلام.'
        : 'New Star Seven men’s hair wax: medium-high hold with a natural finish, built for short to medium hair and texture. Delivered across Egypt, cash on receipt.',
      lead: ar
        ? 'الواكس بيدي تكستشر وتثبيت من غير ما يلزّق الشعر ولا يعمل قشرة. كل لون تركيبة مختلفة — بس التثبيت واحد.'
        : 'Wax gives texture and hold without gluing hair down or going crunchy. Every colour is a different formula; the hold is the constant.',
    };
  }

  if (kind === 'gel') {
    return {
      crumb: ar ? 'جل' : 'Gel',
      h1: ar ? 'جل شعر للرجالة' : 'Men’s hair gel',
      title: ar
        ? 'جل شعر للرجالة — أعلى تثبيت من غير قشرة'
        : 'Men’s hair gel — highest hold, no flaking',
      desc: ar
        ? 'جل شعر نيو ستار سفن للرجالة: أعلى تثبيت عندنا، بيمسك الاستايل المحدد طول اليوم من غير قشرة. توصيل لكل مصر والدفع عند الاستلام.'
        : 'New Star Seven men’s hair gel: our highest hold, holding a defined style all day without flaking. Delivered across Egypt, cash on receipt.',
      lead: ar
        ? 'الجل هو أعلى تثبيت عندنا، وأنسب حاجة للشعر الناعم المفرود اللي مش بيمسك شكل — وللاستايل المحدد اللي عايزه يفضل مكانه.'
        : 'Gel is the highest hold we make, and the right answer for straight hair that refuses to hold a shape — or any style you want to stay exactly where you put it.',
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

export function shopMeta(kind, lang) {
  const c = shopCopy(kind, lang);
  return {
    title: c.title,
    description: c.desc,
    alternates: alternatesForLang(shopPath(kind), lang),
  };
}
