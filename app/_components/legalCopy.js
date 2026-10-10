/**
 * Privacy and Terms copy.
 *
 * NOTE FOR THE OWNER: this describes how the store actually works today, and
 * it was rewritten because the previous version had stopped being true. It said
 * email was optional when checkout requires it, and it said there was no
 * tracking while Vercel Analytics ran on every page. A privacy policy that
 * contradicts the site it is published on is worse than a short one: anybody
 * can check it against the page source in half a minute.
 *
 * Three of the facts below are computed rather than typed, and that is the
 * point of them. The retention periods come from lib/retention.js, which is the
 * job that enforces them; the hold windows in the terms come from lib/config.js,
 * which is what actually cancels the order; and the Google Analytics paragraph
 * appears only when NEXT_PUBLIC_GA_ID is set, the same build-time gate that
 * decides whether the script loads at all. A number in this document cannot
 * drift from the code that implements it, because it IS the code that
 * implements it.
 *
 * Verified brand and contact details only. Outstanding business identity and
 * cross-border legal questions stay in docs/LEGAL-BRIEF.md. No invented numbers.
 *
 * It is not legal advice. What it is, is accurate — every claim below was
 * checked against the code, and the places where the law is unsettled say so
 * rather than guessing.
 */
import { DAYS } from '../../lib/retention.js';
import { site, orderHoldHours, orderWarnedHoldHours } from '../../lib/config.js';

/** Five years reads better than 1825 days, and the policy is for reading. */
const years = Math.round(DAYS.orderIdentity / 365);

/**
 * The Google Analytics paragraph, which exists only when GA does.
 *
 * NEXT_PUBLIC_GA_ID gates the <Script> tags in app/_components/Telemetry.js and
 * the Google hosts in the CSP in next.config.mjs. It gates this too, so setting
 * the variable cannot quietly turn a truthful policy into a false one: the day
 * GA4 starts loading is the day this paragraph starts being published, and both
 * are decided by the same build.
 *
 * It is worth saying why this is separate from the Vercel sentence rather than
 * one line covering "analytics". Vercel Web Analytics sets no cookie. GA4 sets
 * `_ga`, and the section immediately below tells the reader that customers get
 * no cookies. Without this the two would contradict each other on the same page.
 */
const gaOn = Boolean((process.env.NEXT_PUBLIC_GA_ID || '').trim());

const GA_NOTE = {
  ar: gaOn
    ? `

بعد موافقتك بس، بنستخدم **Google Analytics 4** لقياس الزيارات، وبيحطّ كوكيز (\`_ga\`) على متصفحك. بيانات نموذج الطلب مش بتتبعت لجوجل.`
    : '',
  en: gaOn
    ? `

Only after your permission, we use **Google Analytics 4** to measure visits. It sets cookies (\`_ga\`) in your browser. Checkout form details are not sent to Google.`
    : '',
};

/**
 * The automatic-cancellation clause, which exists only when the sweep does.
 *
 * ORDER_HOLD_HOURS at 0 turns /api/cron/release off entirely and restores the
 * old behaviour, where an unconfirmed order holds its stock for ever. A term
 * describing a deadline that no longer expires would be worse than no term, so
 * the clause goes when the sweep does.
 */
const clarityOn = Boolean((process.env.NEXT_PUBLIC_CLARITY_ID || '').trim());
const CLARITY_NOTE = {
  ar: clarityOn ? `

بعد موافقتك بس، بنستخدم **Microsoft Clarity** لتسجيل تفاعلات التصفح وعمل خرائط النقر والتمرير لتحسين الاستخدام. بيانات نموذج الطلب مخفية عن التسجيل. Clarity ممكن يستخدم كوكيز \`_clck\` و\`_clsk\` للتحليلات؛ بنرسل موافقة للتحليلات ورفض لتخزين الإعلانات. Microsoft بيعالج البيانات وفق [سياسة خصوصيته](https://privacy.microsoft.com/privacystatement). التسجيل مقفول على صفحات الإدارة ومتابعة الطلب.` : '',
  en: clarityOn ? `

Only after your permission, we use **Microsoft Clarity** for browsing interaction recordings and click/scroll heatmaps to improve usability. Checkout form details are masked. Clarity may set \`_clck\` and \`_clsk\` analytics cookies; we grant analytics storage and deny advertising storage. Microsoft processes data under its [privacy statement](https://privacy.microsoft.com/privacystatement). Recordings are disabled on admin and order-status pages.` : '',
};

const HOLD_CLAUSE = {
  ar: orderHoldHours
    ? `
- **الأوردر اللي محدش أكّده مش بيستنى للأبد.** بنكلمك نأكد الأوردر؛ لو ملقيناكش، بيتلغى تلقائياً بعد **${orderHoldHours} ساعة** والكمية بترجع للبيع. ولو بعتنالك رسالة تأكيد على الواتساب ووصلت لموبايلك ومردّتش، المدة بتبقى **${orderWarnedHoldHours} ساعة**. مفيش أي مبلغ بيتدفع في الحالتين، وتقدر تطلب تاني عادي في أي وقت.`
    : '',
  en: orderHoldHours
    ? `
- **An order nobody has confirmed does not wait for ever.** We call to confirm; if we cannot reach you, it is cancelled automatically after **${orderHoldHours} hours** and the stock goes back on sale. If we sent a WhatsApp confirmation and it reached your phone and you did not answer, that window is **${orderWarnedHoldHours} hours**. Nothing is charged either way, and you are free to order again.`
    : '',
};

export const LEGAL = {
  privacy: {
    ar: {
      title: 'سياسة الخصوصية',
      body: `آخر تحديث: أكتوبر 2026

نيو ستار سفن علامة تابعة لـ **أوفانزا كوزمتيكس**. الصفحة دي بتشرح إيه البيانات اللي بنجمعها لتشغيل الموقع وتنفيذ الطلبات، ليه، وفين بتتخزن. للتواصل بخصوص الخصوصية: واتساب أو تليفون 01028282216.

## البيانات اللي بنجمعها

- **بيانات الأوردر:** اسمك، رقم موبايلك، عنوان التوصيل، والمحافظة، وأي ملاحظات بتكتبها. دي البيانات اللي بنوصّل بيها ونكلمك نأكد.
- **الإيميل (إلزامي في الشيك أوت):** الإيميل مطلوب عشان نبعتلك لينك تتابع بيه أوردرك — ده اللينك الوحيد اللي بيفتحلك أوردرك، ومفيش حسابات على الموقع. بنستخدمه كمان في إشعارات حالة الأوردر (اتأكد، خرج مع المندوب، اتسلّم، اتلغى).
- **موافقة العروض (اختيارية تماماً):** لو علّمت على المربع في الشيك أوت، أو اشتركت في النشرة، بنضيف **إيميلك** لقايمة العروض. العروض بتتبعت على الإيميل وبس — رقمك بيتخزن مع البيانات لكن مش بنستخدمه في الدعاية. تقدر تلغي من أي رسالة، وإلغاؤك بيفضل محترم.
- **إجابات اختبار نوع الشعر:** لو استخدمت "اعرف نوع شعرك" أو "لاقي ستايلك"، بنحتفظ بالإجابة والمنتج اللي ترشّح — من غير اسم أو رقم. بنستخدمها نعرف إيه اللي الناس محتاجاه.
- **بيانات تقنية:** عنوان الـ IP بتاعك بيتسجل مع الأوردر، ومع الاشتراك في النشرة، ومع إجابة الاختبار، وفي جدول تحديد معدل الطلبات — عشان نحمي الموقع من الإساءة ونقدر نرجع لحادثة لو حصلت.

## إحنا مش بنعمل إيه

- مفيش دفع أونلاين — الدفع **عند الاستلام**، فإحنا **مبناخدش ولا بنشوف أي بيانات بطاقة أو حساب بنكي إطلاقاً**.
- مبنبيعش بياناتك ولا بنأجّرها لأي حد.
- مفيش حسابات عملاء، يعني مفيش باسورد بتاعك عندنا.

## الكوكيز والتحليلات

بموافقتك بس، بنستخدم **Vercel Web Analytics** و**Vercel Speed Insights** لقياس الصفحات وسرعة التحميل. الأدوات دي من غير كوكيز، لكنها بتستقبل بيانات استخدام تقنية. التحليلات الاختيارية مقفولة لحد ما توافق.${GA_NOTE.ar}${CLARITY_NOTE.ar}

صفحات الإدارة ومتابعة الطلب مستبعدة من التحليلات الاختيارية. بيانات نموذج الطلب مش بتتبعت كأحداث تحليلات، وروابط الدخول السرية وأرقام الطلبات بتتشال من عناوين الصفحات اللي بتتقاس.

- **التخزين الضروري في متصفحك:** السلة، ومفتاح إعادة محاولة الطلب، واختيارك للخصوصية. ده لتشغيل الطلب وحفظ اختيارك، ومش موافقة على الدعاية.
- **اختيار التحليلات:** تقدر تقبل أو ترفض بنفس السهولة وتغيّر اختيارك من «إعدادات الخصوصية» في آخر الصفحة. الرفض مش بيمنع الشراء. بنحفظ الاختيار على جهازك لمدة 180 يوم وبعدها بنطلبه تاني. سحب الموافقة بيوقف التتبع الجديد وبيمسح كوكيز التحليلات اللي يقدر الموقع يمسحها، لكنه مش بيمسح تلقائياً بيانات اتجمعت قبل كده. لطلب حذفها تواصل معانا.
- **الكوكيز:** ${gaOn || clarityOn ? 'كوكيز التحليلات المذكورة فوق بتشتغل بعد الموافقة بس.' : 'التحليلات المفعّلة حالياً من غير كوكيز.'} كوكيز الدخول والتحقق بخطوتين والحماية خاصة بالإدارة ومحصورة على /admin.

## فين بتتخزن بياناتك

قاعدة البيانات بتاعتنا شغالة على **Neon** في **فرانكفورت بألمانيا**، والموقع مستضاف على **Vercel**، والإيميلات بتتبعت عن طريق **Resend**. يعني بياناتك بتتنقل وبتتخزن برّه مصر.

## مدة الاحتفاظ

في مهمة بتشتغل كل يوم بالليل وبتمسح اللي عدّى ميعاده. دي المدد الفعلية، مش نوايا:

- **الأوردر:** بيتحفظ للمحاسبة والضرايب. بعد **${years} سنين** اسمك ورقمك وعنوانك وملاحظاتك وإيميلك بيتشالوا منه، ويفضل سطر في الدفاتر من غير أي حد وراه.
- **الـ IP بتاع الأوردر أو الاشتراك في النشرة:** **${DAYS.orderIp} يوم**.
- **الـ IP بتاع إجابة الاختبار:** **${DAYS.quizIp} يوم**. الإجابة نفسها بتفضل، من غير أي حاجة مربوطة بيها.
- **سجل إعادة محاولة الشيك أوت** (فيه رقم الأوردر ورقم الموبايل): **${DAYS.idempotency} يوم**.
- **سجل إرسال الإيميلات:** العنوان بيتشال بعد **${DAYS.emailRecipient} يوم**؛ اللي بيفضل إن رسالة اتبعتت في اليوم ده.
- **عدّادات تحديد معدل الطلبات:** **${DAYS.rateLimit} أيام**.
- **قايمة العروض:** لحد ما تلغي الاشتراك.

## حقوقك

تقدر تطلب نسخة من بياناتك أو تصحيحها أو حذفها أو تلغي العروض. كلّمنا واتساب أو تليفون على 01028282216، وهنرد خلال 30 يوم. ممكن نطلب التحقق من هويتك ونحتفظ بالبيانات المطلوبة قانوناً. اختيار التحليلات منفصل عن موافقة العروض الاختيارية في الطلب.

## تواصل

أوفانزا كوزمتيكس / نيو ستار سفن — واتساب وتليفون 01028282216.`,
    },

    en: {
      title: 'Privacy Policy',
      body: `Last updated: October 2026

New Star Seven is a brand of **Ovanza Cosmetics**. This policy explains how we handle data to operate the site and fulfil orders. For privacy enquiries, contact us by WhatsApp or telephone on 01028282216.

## What we collect

- **Order details:** your name, mobile number, delivery address, governorate, and any notes you write. This is what we deliver on and what we call you about.
- **Email (required at checkout):** we need it to send you the link that opens your order. That link is the only way in — there are no accounts on this site. We also use it for status notices: confirmed, on its way, delivered, cancelled.
- **Marketing consent (entirely optional):** if you tick the box at checkout, or sign up to the newsletter, we add your **email address** to the offers list. Offers are sent by email and only by email — your mobile number is stored alongside it but is not used for marketing. You can unsubscribe from any message, and once you have, you stay unsubscribed.
- **Hair quiz answers:** if you use the hair-type or hair-style finder, we keep the answer and what it recommended — with no name or number attached. It tells us what people are looking for.
- **Technical data:** your IP address is recorded with an order, with a newsletter signup, with a quiz answer, and in our rate-limiting table — to protect the site from abuse and to be able to investigate an incident.

## What we do not do

- There is no online payment. Payment is **cash on delivery**, so we **never take or see card or bank details at all**.
- We do not sell or rent your data to anyone.
- There are no customer accounts, so we hold no password of yours.

## Cookies and analytics

Only with your permission, we use **Vercel Web Analytics** and **Vercel Speed Insights** to measure pages and loading speed. These tools are cookieless, but receive technical browsing data. All optional analytics remain disabled until you accept.${GA_NOTE.en}${CLARITY_NOTE.en}

Admin and order-status pages are excluded from optional analytics. Checkout form details are not sent as analytics events, and secret access tokens and order references are removed from measured page addresses.

- **Necessary browser storage:** your cart, a checkout retry key and your privacy choice. These support shopping and remember your choice; they do not constitute marketing consent.
- **Your analytics choice:** accept or reject with equal ease, and change your choice through Privacy settings in the footer. Rejecting does not prevent purchases. The choice is stored on your device for 180 days, then requested again. Withdrawal stops new tracking and removes analytics cookies accessible to this site; it does not automatically erase previously collected data. Contact us to request deletion.
- **Cookies:** ${gaOn || clarityOn ? 'analytics cookies described above are used only after consent.' : 'currently enabled analytics tools are cookieless.'} Admin login, two-factor and CSRF cookies are necessary for the back office and scoped to /admin.

## Where your data is stored

Our database runs on **Neon** in **Frankfurt, Germany**. The site is hosted by **Vercel**, and email is sent through **Resend**. Your data therefore leaves Egypt and is stored abroad.

## How long we keep it

A job runs every night and removes whatever is past its date. These are the actual periods, not intentions:

- **Your order:** kept for accounting and tax. After **${years} years** your name, phone number, address, notes and email are wiped from it, and what remains is an anonymous line in the books.
- **The IP address on an order or a newsletter signup:** **${DAYS.orderIp} days**.
- **The IP address on a quiz answer:** **${DAYS.quizIp} days**. The answer itself stays, with nothing attached to it.
- **The checkout retry record**, which holds your reference and phone number: **${DAYS.idempotency} days**.
- **The email send log:** the address is removed after **${DAYS.emailRecipient} days**; that a message of that kind was sent on that day remains.
- **Rate-limiting counters:** **${DAYS.rateLimit} days**.
- **Marketing list:** until you unsubscribe.

## Your rights

You can request a copy, correction or deletion of your data, or stop offers. Contact us by WhatsApp or telephone on 01028282216; we will respond within 30 days. We may verify your identity and retain records required by law. Analytics consent is separate from optional email marketing at checkout.

## Contact

Ovanza Cosmetics / New Star Seven — WhatsApp and telephone 01028282216.`,
    },
  },

  terms: {
    ar: {
      title: 'الشروط والأحكام',
      body: `آخر تحديث: أكتوبر 2026

الشروط دي بتنظم استخدام موقع نيو ستار سفن والشراء منه. نيو ستار سفن علامة تابعة لأوفانزا كوزمتيكس. للاستفسار أو الشكاوى: واتساب أو تليفون 01028282216. تأكيد الطلب قبول لشروط الشراء، لكنه مش موافقة على التحليلات أو العروض.

## الأوردر والدفع

- كل الأسعار بالجنيه المصري وشاملة الضريبة حيثما تنطبق.
- الدفع **عند الاستلام**. بنكلمك نأكد الأوردر قبل ما يخرج.
- ممكن نرفض أو نلغي أي أوردر (مثلاً لو المنتج خلص من المخزن أو العنوان مش صحيح) — وساعتها مش هتدفع حاجة.

## التوصيل

- رسوم التوصيل **${site.shipping} جنيه** على أي أوردر${site.freeOver > 0 ? `، **ومجاني** لو الأوردر ${site.freeOver} جنيه أو أكتر` : ''}. الرقم بيبان في الشيك أوت قبل ما تأكد.
- بنبعتلك على الإيميل ميعاد وصول تقريبي بعد ما نأكد الأوردر. ده تقدير مش وعد قاطع.

## إلغاء الأوردر وتعديله

- قبل ما الأوردر يخرج مع المندوب، تقدر **تلغيه بنفسك** من لينك المتابعة اللي في إيميل التأكيد — فوراً ومن غير ما تستنى حد.
- بعد ما يخرج مع المندوب، تقدر تطلب الإلغاء من نفس اللينك وهنكلمك نظبطها.
- لو عايز تغيّر الكمية أو العنوان بعد الطلب، كلّمنا وإحنا نعدّلها، وهيوصلك إيميل بالتفاصيل الجديدة.${HOLD_CLAUSE.ar}

## الاسترجاع والاستبدال

- **الاستبدال والاسترجاع خلال 14 يوم:** من حقك تطلب استبدال المنتج أو استرجاعه خلال 14 يوم من تاريخ الاستلام، بشرطين: يكون المنتج في حالته الأصلية ومتستخدمش، والعلبة الأصلية وكل الملحقات بحالتها الكاملة.
- **المنتج المعيب خلال 30 يوم:** من حقك تطلب استبداله أو استرجاع قيمته خلال 30 يوم من الاستلام من غير تكلفة إضافية. كلّمنا على 01028282216، وهنعالج الاستبدال أو الاسترداد خلال أسبوع من طلبك وفق القانون. لو وصلك منتج غلط، هنصحح الطلب على حسابنا.
- استرجاع تغيير الرأي بيخضع للاستثناءات اللي القانون بيسمح بيها لو طبيعة المنتج أو حالته أو تغليفه تمنع إرجاعه لحالته الأصلية. فتح العبوة مش بيلغي حقوقك لو المنتج معيب. مفيش بند هنا بيقلل حقوقك القانونية كمستهلك.

## أكواد الخصم

- الأكواد ليها شروط (حد أدنى للأوردر، تاريخ انتهاء، عدد استخدامات) وممكن توقف في أي وقت.

## الملكية الفكرية

- كل المحتوى والصور والعلامة التجارية ملك **أوفانزا كوزمتيكس**.

## الشكاوى

- أي شكوى: واتساب أو تليفون 01028282216. لو المشكلة متحلتش، من حقك تتقدم بشكوى لجهاز حماية المستهلك.

## القانون الواجب التطبيق

- الشروط دي بتخضع للقانون المصري.`,
    },

    en: {
      title: 'Terms & Conditions',
      body: `Last updated: October 2026

These terms govern the New Star Seven storefront and purchases from it. New Star Seven is a brand of Ovanza Cosmetics. For enquiries or complaints, contact us by WhatsApp or telephone on 01028282216. Placing an order accepts the purchase terms; it does not grant analytics or marketing consent.

## Orders & payment

- All prices are in Egyptian pounds, inclusive of tax where applicable.
- Payment is **cash on delivery**. We call to confirm every order before it is dispatched.
- We may refuse or cancel any order (for example, out of stock or an invalid address) — and you pay nothing in that case.

## Delivery

- Delivery is **${site.shipping} EGP** on any order${site.freeOver > 0 ? `, and **free** on orders of ${site.freeOver} EGP or more` : ''}. The figure is shown at checkout before you confirm.
- After we confirm your order we email you an estimated arrival window. It is an estimate, not a guarantee.

## Cancelling and changing an order

- Before your order leaves with the courier you can **cancel it yourself**, immediately, from the tracking link in your confirmation email — no need to wait for anyone.
- Once it is with the courier you can request cancellation from the same link and we will call you to sort it out.
- If you want to change quantities or the address after ordering, tell us and we will amend it. You will get an email showing the new details.${HOLD_CLAUSE.en}

## Returns & exchanges

- **Exchange or return within 14 days:** you may ask to exchange or return a product within 14 days of receiving it, on two conditions: it is in its original condition and unused, and the original box and all accessories are complete.
- **Defective products within 30 days:** request replacement or a refund within 30 days of receiving a defective product, at no additional cost. Contact 01028282216; we will handle replacement or refund within one week of your request as required by law. If we send the wrong item, we will correct the order at our cost.
- Change-of-mind returns are subject to legally permitted exceptions where the product's nature, condition or packaging prevents restoration to its original state. Opening packaging does not remove your rights for a defective product. Nothing in these terms limits your statutory consumer rights.

## Discount codes

- Codes carry conditions (minimum order, expiry, a limit on how many times they can be used) and may be withdrawn at any time.

## Intellectual property

- All content, images and the brand belong to **Ovanza Cosmetics**.

## Complaints

- Contact us by WhatsApp or telephone on 01028282216. If your complaint is not resolved, you may contact the Egyptian Consumer Protection Agency.

## Governing law

- These terms are governed by Egyptian law.`,
    },
  },
};
