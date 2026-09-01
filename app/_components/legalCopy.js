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
 * Three things still need YOU, and they are marked [[...]] in the text so they
 * are impossible to miss and easy to grep for:
 *   - the registered company name, address, commercial register and tax number
 *   - a real privacy contact address, rather than only a WhatsApp number
 *   - a lawyer, on the two questions in docs/LEGAL-BRIEF.md
 *
 * It is not legal advice. What it is, is accurate — every claim below was
 * checked against the code, and the places where the law is unsettled say so
 * rather than guessing.
 */
import { DAYS } from '../../lib/retention.js';
import { orderHoldHours, orderWarnedHoldHours } from '../../lib/config.js';

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

كمان الموقع بيشغّل **Google Analytics 4**. ده منتج جوجل، يعني زيارتك بتتقاس عند جوجل مش عندنا بس، وبيحطّ كوكيز خاصة بيه (\`_ga\`) على متصفحك.`
    : '',
  en: gaOn
    ? `

This site also runs **Google Analytics 4**. It is a Google product, so your visit is measured by Google as well as by us, and it sets its own cookies (\`_ga\`) in your browser.`
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
      body: `آخر تحديث: أغسطس 2026

نيو ستار سفن (علامة تابعة لـ **أوفانزا كوزمتيكس** — [[الاسم القانوني المسجل]]، [[العنوان]]، سجل تجاري [[رقم]]، بطاقة ضريبية [[رقم]]) بتحترم خصوصيتك. الصفحة دي بتشرح بالظبط إيه اللي بنجمعه، ليه، وفين بيتخزن.

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

نكون صرحاء معاك: الموقع بيستخدم **Vercel Web Analytics** و**Vercel Speed Insights**. دول بيقيسوا الصفحات اللي بتتفتح وسرعة التحميل. مبيستخدموش كوكيز إعلانية ومفيش إعلانات على الموقع، لكنهم برضه أدوات طرف تالت — وده حقك تعرفه.${GA_NOTE.ar}

قبل ما أي عنوان صفحة يتبعت لأي أداة تحليلات، بنشيل منه توكن الدخول بتاع الأوردر. يعني اللينك اللي بيفتح أوردرك عمره ما بيوصل لجوجل ولا لـ Vercel.

- **تخزين محلي في متصفحك:** السلة، ومفتاح بيمنع تكرار الأوردر لو دوست مرتين. البيانات دي بتفضل على جهازك.
- **الكوكيز:** العميل ${gaOn ? 'بياخد كوكيز جوجل أناليتكس المذكورة فوق وبس' : 'مبياخدش أي كوكي من الموقع'}. لوحة التحكم ليها كوكيز خاصة بيها — كوكي دخول وكوكي حماية — ومحصورة على مسار /admin، يعني عمرها ما بتتبعت لعميل.

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

تقدر تطلب نسخة من بياناتك، أو تصححها، أو تمسحها، أو تلغي العروض. ابعتلنا على [[إيميل الخصوصية]] أو كلّمنا واتساب على 01028282216، وهنرد عليك في مدة أقصاها 30 يوم.

## تواصل

[[الاسم القانوني المسجل]] — [[العنوان]] — [[إيميل الخصوصية]] — واتساب 01028282216.`,
    },

    en: {
      title: 'Privacy Policy',
      body: `Last updated: August 2026

New Star Seven (a brand of **Ovanza Cosmetics** — [[registered legal name]], [[address]], commercial register [[number]], tax card [[number]]) respects your privacy. This page explains exactly what we collect, why, and where it is stored.

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

Plainly: this site runs **Vercel Web Analytics** and **Vercel Speed Insights**. They measure which pages are opened and how fast they load. They set no advertising cookies and there are no ads on this site — but they are third-party tools, and you are entitled to know that.${GA_NOTE.en}

Before any page address is reported to any analytics tool, the order access token is stripped out of it. The link that opens your order never reaches Google or Vercel.

- **Local storage in your browser:** your cart, and a key that stops a double tap creating two orders. Both stay on your device.
- **Cookies:** ${gaOn ? 'the Google Analytics cookies described above, and nothing else' : 'customers are given none at all'}. The admin panel sets its own — a login cookie and a CSRF cookie — and they are scoped to /admin, so a customer is never sent one.

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

You can ask for a copy of your data, correct it, delete it, or stop the offers. Write to [[privacy email]] or message WhatsApp 01028282216, and we will respond within 30 days.

## Contact

[[registered legal name]] — [[address]] — [[privacy email]] — WhatsApp 01028282216.`,
    },
  },

  terms: {
    ar: {
      title: 'الشروط والأحكام',
      body: `آخر تحديث: أغسطس 2026

باستخدامك موقع نيو ستار سفن والطلب منه، إنت موافق على الشروط دي. البايع هو [[الاسم القانوني المسجل]]، [[العنوان]]، سجل تجاري [[رقم]]، بطاقة ضريبية [[رقم]].

## الأوردر والدفع

- كل الأسعار بالجنيه المصري وشاملة الضريبة حيثما تنطبق.
- الدفع **عند الاستلام**. بنكلمك نأكد الأوردر قبل ما يخرج.
- ممكن نرفض أو نلغي أي أوردر (مثلاً لو المنتج خلص من المخزن أو العنوان مش صحيح) — وساعتها مش هتدفع حاجة.

## التوصيل

- مصاريف ومدة التوصيل بتبان في الشيك أوت وبتختلف حسب المحافظة.
- بنبعتلك على الإيميل ميعاد وصول تقريبي بعد ما نأكد الأوردر. ده تقدير مش وعد قاطع.

## إلغاء الأوردر وتعديله

- قبل ما الأوردر يخرج مع المندوب، تقدر **تلغيه بنفسك** من لينك المتابعة اللي في إيميل التأكيد — فوراً ومن غير ما تستنى حد.
- بعد ما يخرج مع المندوب، تقدر تطلب الإلغاء من نفس اللينك وهنكلمك نظبطها.
- لو عايز تغيّر الكمية أو العنوان بعد الطلب، كلّمنا وإحنا نعدّلها، وهيوصلك إيميل بالتفاصيل الجديدة.${HOLD_CLAUSE.ar}

## الاسترجاع

- **حقك في الاسترجاع خلال 14 يوم:** طبقاً لقانون حماية المستهلك المصري، من حقك ترجّع المنتج خلال 14 يوم من الاستلام. المنتج لازم يكون بحالته وما اتفتحش استخدام. [[يراجع المحامي: المدة والاستثناءات لمنتجات التجميل]]
- **لو وصلك تالف أو غلط:** كلّمنا على 01028282216 وإحنا نظبطها على حسابنا.
- المنتجات اللي بتتفتح وتتستعمل ممكن يكون ليها استثناء لأسباب صحية — [[يراجع المحامي]].

## أكواد الخصم

- الأكواد ليها شروط (حد أدنى للأوردر، تاريخ انتهاء، عدد استخدامات) وممكن توقف في أي وقت.

## الملكية الفكرية

- كل المحتوى والصور والعلامة التجارية ملك **أوفانزا كوزمتيكس**.

## الشكاوى

- أي شكوى: [[إيميل الشكاوى]] أو واتساب 01028282216. لو مرضيتش، من حقك تتقدم بشكوى لجهاز حماية المستهلك.

## القانون الواجب التطبيق

- الشروط دي بتخضع للقانون المصري.`,
    },

    en: {
      title: 'Terms & Conditions',
      body: `Last updated: August 2026

By using the New Star Seven site and ordering from it, you agree to these terms. The seller is [[registered legal name]], [[address]], commercial register [[number]], tax card [[number]].

## Orders & payment

- All prices are in Egyptian pounds, inclusive of tax where applicable.
- Payment is **cash on delivery**. We call to confirm every order before it is dispatched.
- We may refuse or cancel any order (for example, out of stock or an invalid address) — and you pay nothing in that case.

## Delivery

- Delivery fees and times are shown at checkout and vary by governorate.
- After we confirm your order we email you an estimated arrival window. It is an estimate, not a guarantee.

## Cancelling and changing an order

- Before your order leaves with the courier you can **cancel it yourself**, immediately, from the tracking link in your confirmation email — no need to wait for anyone.
- Once it is with the courier you can request cancellation from the same link and we will call you to sort it out.
- If you want to change quantities or the address after ordering, tell us and we will amend it. You will get an email showing the new details.${HOLD_CLAUSE.en}

## Returns

- **Your 14-day right to return:** under Egyptian consumer protection law you may return a product within 14 days of receiving it. It must be in its original condition and unused. [[for the lawyer: confirm the period and any cosmetics exemption]]
- **If it arrives damaged or wrong:** call 01028282216 and we will put it right at our cost.
- Opened and used products may be exempt for hygiene reasons — [[for the lawyer]].

## Discount codes

- Codes carry conditions (minimum order, expiry, a limit on how many times they can be used) and may be withdrawn at any time.

## Intellectual property

- All content, images and the brand belong to **Ovanza Cosmetics**.

## Complaints

- Any complaint: [[complaints email]] or WhatsApp 01028282216. If you are not satisfied, you have the right to complain to the Consumer Protection Agency.

## Governing law

- These terms are governed by Egyptian law.`,
    },
  },
};
