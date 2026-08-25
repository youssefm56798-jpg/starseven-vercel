import { site } from './config.js';

/**
 * Questions people actually ask before buying hair wax online, answered from
 * how this shop really works.
 *
 * Brand-level rather than per-product on purpose: the answers are about
 * delivery, payment and returns, which are identical for every jar. Keeping
 * one copy means they cannot drift out of sync across eight product pages,
 * and the delivery figures come from configuration rather than being typed
 * into prose that goes stale the day the fee changes.
 *
 * Deliberately absent: anything about results, safety or skin reactions. Those
 * are claims only the manufacturer can stand behind.
 */
export function productFaq(lang) {
  const ar = lang !== 'en';
  const fee = site.shipping;
  const free = site.freeOver;

  const freeLine = ar
    ? free > 0
      ? ` والتوصيل مجاني لو الأوردر ${free} جنيه أو أكتر.`
      : ''
    : free > 0
      ? ` Delivery is free on orders of ${free} EGP or more.`
      : '';

  return ar
    ? [
        {
          q: 'الدفع بيتم إزاي؟',
          a: `الدفع عند الاستلام — كاش لما الأوردر يوصلك. مفيش دفع أونلاين دلوقتي، يعني إحنا مش بناخد أي بيانات بطاقة أو حساب بنكي خالص.`,
        },
        {
          q: 'التوصيل بياخد قد إيه، وبكام؟',
          a: `رسوم التوصيل ${fee} جنيه وبتظهرلك في الشيك أوت قبل ما تأكد.${freeLine} بنكلمك على الموبايل نأكد الأوردر قبل ما يتشحن.`,
        },
        {
          q: 'لازم أعمل حساب عشان أطلب؟',
          a: 'لأ. اختار المنتج، ضيفه للسلة، واكتب اسمك وعنوانك ورقم موبايلك في الشيك أوت. خلاص.',
        },
        {
          q: 'لو المنتج وصلني غلط أو تالف؟',
          a: `كلّمنا على واتساب خلال ٤٨ ساعة على ${site.whatsapp.replace(/^20/, '0')} وهنحلّها. تفاصيل الإرجاع كلها في صفحة الشروط والأحكام.`,
        },
        {
          q: 'أعرف إزاي أنهي منتج مناسب لشعري؟',
          a: 'في صفحة "نوع شعرك" تدوس على نوعك ويقولك أنهي منتج ليك وليه، ومن أنهي منتج تبعد — وفيها كمان صفحة لكل نوع بتشرح المشكلة والحل. كل منتج مكتوب عليه درجة تثبيته من ٥.',
        },
      ]
    : [
        {
          q: 'How do I pay?',
          a: 'Cash on delivery — you pay when the order reaches you. There is no online payment yet, which means we never collect card or bank details at all.',
        },
        {
          q: 'How long does delivery take, and what does it cost?',
          a: `Delivery is ${fee} EGP and is shown at checkout before you confirm.${freeLine} We call you to confirm the order before it ships.`,
        },
        {
          q: 'Do I need an account to order?',
          a: 'No. Pick a product, add it to the cart, and enter your name, address and mobile number at checkout. That is the whole process.',
        },
        {
          q: 'What if it arrives damaged or wrong?',
          a: `Message us on WhatsApp within 48 hours on ${site.whatsapp.replace(/^20/, '0')} and we will make it right. The full returns terms are on the Terms page.`,
        },
        {
          q: 'How do I know which product suits my hair?',
          a: 'The Hair types page lets you pick your type and tells you which product is yours, why, and what to avoid — with a page per type going into the detail. Every product also lists its hold strength out of 5.',
        },
      ];
}

/** FAQPage structured data for the same questions. */
export function faqJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
