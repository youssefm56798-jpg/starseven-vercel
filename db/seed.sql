-- =====================================================================
--  NEW STAR SEVEN — seed data (Postgres / Neon)
--  Run AFTER schema.sql:   npm run db:setup
--  Safe to re-run: every statement upserts on its natural key.
--
--  Ported from the MySQL seeds of the PHP build:
--    ON DUPLICATE KEY UPDATE -> ON CONFLICT (key) DO UPDATE SET ... EXCLUDED
--    SET NAMES utf8mb4       -> dropped (Postgres is UTF-8 already)
--    NOW() + INTERVAL 365 DAY-> now() + interval '365 days'
--    tinyint 1/0             -> TRUE/FALSE
--
--  hair_types is a CSV in priority order — the FIRST slug listed is the
--  primary recommendation for that hair type. The three gels are 'straight'
--  only, on purpose: the wavy tile tells the customer to avoid hard gels, so
--  wavy must never be ranked into one. tests/hairtypes.test.mjs guards this.
-- =====================================================================

INSERT INTO products
  (sku, slug, kind, name_ar, name_en, sub_ar, sub_en, chip_ar, chip_en, price, compare_at, color, image, size_ml, hold_level, hair_types, stock, active, sort)
VALUES
  ('S7-WAX-RED','premium-wax-pro-x','wax',
   'واكس بريميوم برو إكس','Premium Wax Pro X',
   'ويف آند جروم · 120 مل · أحمر','Wave & Groom · 120ml · Red',
   'ميجا هولد','Mega Hold',
   45.00, 55.00, '#D7291D', 'assets/wax-red.webp', 120, 5, 'wavy,thick', 200, TRUE, 1),

  ('S7-WAX-PUR','premium-wax-shea','wax',
   'واكس بريميوم بزبدة الشيا','Premium Wax Shea Butter',
   'ملمس ناعم · 120 مل · موف','Soft touch · 120ml · Purple',
   'زبدة الشيا','Shea Butter',
   45.00, NULL, '#8B4DC9', 'assets/wax-purple.webp', 120, 4, 'coily,curly,thick', 200, TRUE, 2),

  ('S7-WAX-BLU','premium-wax-argan','wax',
   'واكس بريميوم بالأرجان','Premium Wax Argan',
   'مغذي للشعر · 120 مل · أزرق','Nourishing · 120ml · Blue',
   'زيت أرجان','Argan Oil',
   45.00, NULL, '#2A6DE8', 'assets/wax-blue.webp', 120, 4, 'curly,coily,wavy', 200, TRUE, 3),

  ('S7-WAX-BLK','premium-wax-black','wax',
   'واكس بريميوم بلاك','Premium Wax Black',
   'من غير لمعة · 120 مل · أسود','No shine · 120ml · Black',
   'مطفي','Matte',
   45.00, NULL, '#55524A', 'assets/wax-black.webp', 120, 5, 'fine,straight', 200, TRUE, 4),

  ('S7-WAX-YEL','premium-wax-pro','wax',
   'واكس بريميوم برو','Premium Wax Pro',
   'قوي لليومي · 120 مل · أصفر','Daily strong · 120ml · Yellow',
   'برو هولد','Pro Hold',
   45.00, NULL, '#D9A81E', 'assets/wax-yellow.webp', 120, 5, 'thick,straight,wavy', 200, TRUE, 5),

  ('S7-GEL-YEL','premium-gel-golden','gel',
   'جل بريميوم — جولدن','Premium Gel - Golden',
   'ويت لوك · 250 مل','Wet look · 250ml',
   'جولدن','Golden',
   40.00, NULL, '#D9A81E', 'assets/gel-yellow.webp', 250, 3, 'straight', 200, TRUE, 6),

  ('S7-GEL-GRN','premium-gel-green','gel',
   'جل بريميوم — أخضر','Premium Gel - Green',
   'ريحة نضيفة · 250 مل','Clean scent · 250ml',
   'فريش','Fresh',
   40.00, NULL, '#5E9C2B', 'assets/gel-green.webp', 250, 3, 'straight', 200, TRUE, 7),

  ('S7-GEL-BLU','premium-gel-blue','gel',
   'جل بريميوم — أزرق','Premium Gel - Blue',
   'طول اليوم · 250 مل','All day · 250ml',
   'كلاسيك','Classic',
   40.00, NULL, '#2A6DE8', 'assets/gel-blue.webp', 250, 3, 'straight', 200, TRUE, 8)
ON CONFLICT (sku) DO UPDATE SET
  slug       = EXCLUDED.slug,
  kind       = EXCLUDED.kind,
  name_ar    = EXCLUDED.name_ar,
  name_en    = EXCLUDED.name_en,
  sub_ar     = EXCLUDED.sub_ar,
  sub_en     = EXCLUDED.sub_en,
  chip_ar    = EXCLUDED.chip_ar,
  chip_en    = EXCLUDED.chip_en,
  price      = EXCLUDED.price,
  compare_at = EXCLUDED.compare_at,
  color      = EXCLUDED.color,
  image      = EXCLUDED.image,
  size_ml    = EXCLUDED.size_ml,
  hold_level = EXCLUDED.hold_level,
  hair_types = EXCLUDED.hair_types,
  sort       = EXCLUDED.sort;

-- A first live offer so the newsletter section has something to show.
-- offers.code is unique only where it is non-empty (partial index), so the
-- conflict target has to name that same predicate.
INSERT INTO offers
  (title_ar, title_en, body_ar, body_en, code, discount_type, discount_value,
   min_total, starts_at, ends_at, active)
VALUES
  ('خصم 10% على أول أوردر','10% off your first order',
   'اشترك في النشرة واستلم كود خصم 10% على أول أوردر — والعروض توصلك قبل ما تنزل للناس.',
   'Subscribe and get 10% off your first order - plus every sale before it goes public.',
   'STAR10','percent',10,80, now(), now() + interval '365 days', TRUE)
ON CONFLICT (code) WHERE code <> '' DO UPDATE SET
  title_ar       = EXCLUDED.title_ar,
  title_en       = EXCLUDED.title_en,
  body_ar        = EXCLUDED.body_ar,
  body_en        = EXCLUDED.body_en,
  discount_type  = EXCLUDED.discount_type,
  discount_value = EXCLUDED.discount_value,
  min_total      = EXCLUDED.min_total,
  active         = EXCLUDED.active;

-- Starter articles. group_key pairs the Arabic and English versions of the
-- same piece so each page can advertise the other with hreflang.
INSERT INTO articles
  (slug, lang, group_key, title, excerpt, body, cover, cover_alt, hair_type, sku, status, published_at)
VALUES
(
 'choose-hair-product-by-hair-type', 'en', 'choose-by-type',
 'How to choose a hair product for your hair type',
 'Straight, wavy, curly or coily — the format that works on one fights the next. Here is the short version of which is which, and why.',
 '## Start with your hair, not the jar

Most men buy on the label. The faster route is to start from what your hair actually does, because the **format** — gel, wax, cream, clay — matters more than the brand on the tin.

## The four curl families

- **Straight** loses shape fast and oils up soonest. It needs high hold with no weight — a **gel** is the only format with enough grip to hold a shape on hair that resists holding one.
- **Wavy** resists styling and frizzes. It wants a medium-high hold that defines the wave instead of flattening it — a natural-finish **wax**.
- **Curly** needs definition and moisture at once. A light, penetrating oil like **argan** softens coarse curls without weighing them down. Skip clay here; it is too drying.
- **Coily** is the driest and most fragile. **Shea butter** seals moisture into the strand.

## Then adjust for density

Fine hair needs volume, so anything heavy or shiny kills it — a **matte** finish is the pick. Thick hair is the one type that can carry a heavy product without going limp, so it can take the strongest hold you own.

Not sure where you land? The [hair-type finder](/#hair) on the homepage walks you through it in one tap.',
 'assets/barbershop.jpg', 'Barber styling a client',
 'wavy', 'S7-WAX-RED', 'published', '2026-08-10 10:00:00'
),
(
 'choose-hair-product-by-hair-type-ar', 'ar', 'choose-by-type',
 'إزاي تختار منتج شعر على حسب نوع شعرك',
 'ناعم، متموج، كيرلي ولا خشن — المنتج اللي بيظبط واحد ممكن يبوّظ التاني. ده الدليل المختصر.',
 '## ابدأ من شعرك، مش من البرطمان

أغلب الناس بتشتري على اسم المنتج. الأسرع إنك تبدأ من اللي شعرك بيعمله فعلاً، لأن **نوع المنتج** — جل، واكس، كريم، طين — أهم من الماركة نفسها.

## أنواع الشعر الأربعة

- **الناعم المفرود** بيسيب الاستايل بسرعة وبيدهن بدري. محتاج تثبيت عالي من غير وزن — **الجل** هو الوحيد اللي بيمسك شكل على شعر أصلاً مش ماسك.
- **المتموج** بيقاوم التصفيف وبينفش. محتاج تثبيت متوسط لعالي بيعرّف الموجة بدل ما يفردها — **واكس** بلمعة طبيعية.
- **الكيرلي** محتاج تعريف وترطيب مع بعض. زيت خفيف زي **الأرجان** بيلين الكيرلة الخشنة من غير ما يتقّلها. ابعد عن الطين هنا، بينشّف.
- **الخشن/الأفرو** هو أنشف نوع وأكتره هشاشة. **زبدة الشيا** بتقفل الرطوبة جوه الشعرة.

## بعد كده ظبط على الكثافة

الشعر الخفيف محتاج حجم، فأي حاجة تقيلة أو لامعة بتقتله — اختار تركيبة **مطفية**. الشعر الكثيف هو الوحيد اللي يشيل منتج تقيل من غير ما يقع.

مش عارف نوع شعرك؟ [محدد نوع الشعر](/#hair) في الصفحة الرئيسية بيوصّلك في دوسة واحدة.',
 'assets/barbershop.jpg', 'حلاق بيصفف شعر زبون',
 'wavy', 'S7-WAX-RED', 'published', '2026-08-10 10:00:00'
),
(
 'make-your-style-last-all-day', 'en', 'last-all-day',
 'Make your style last from morning till midnight',
 'A great product on damp hair with the wrong amount is a wasted morning. Four things that decide whether your style survives the day.',
 '## 1. Dry first, mostly

Wax and clay grip best on hair that is almost dry — towel-dry, then a minute with a dryer on low. Gel is the exception: it works on damp hair for a wet look.

## 2. Less than you think

Start with a pea-sized amount, warm it between your palms until it turns clear, and work it from the back forward. You can always add more; you cannot take it out.

## 3. Roots, not just tips

Hold comes from the root. Push the product in at the base and lift, rather than smoothing it over the surface where it only adds shine.

## 4. Match the hold to the day

A level-3 gel is plenty for the office. A full day of heat and movement wants a level-5 wax like [Pro X](/product/premium-wax-pro-x). If your style drops by lunch, the fix is usually a stronger hold, not more product.',
 '', '',
 'thick', 'S7-WAX-YEL', 'published', '2026-08-18 10:00:00'
),
(
 'make-your-style-last-all-day-ar', 'ar', 'last-all-day',
 'خلي ستايلك يقعد من الصبح لآخر اليوم',
 'منتج كويس على شعر مبلول وبكمية غلط = صباح ضايع. أربع حاجات بيتوقف عليها إن الستايل يعيش اليوم كله.',
 '## ١. نشّف الأول، وشعرك شبه ناشف

الواكس والطين بيمسكوا أحسن على شعر شبه ناشف — نشّفه بالفوطة، وبعدين دقيقة سشوار على درجة خفيفة. الجل هو الاستثناء: بيشتغل على الشعر المبلول عشان الويت لوك.

## ٢. كمية أقل مما تتخيل

ابدأ بحجم حبة الحمص، دفّيها بين إيديك لحد ما تبقى شفافة، وابدأ من ورا لقدام. تقدر تزود بعدين؛ مش هتقدر تشيل.

## ٣. من الجذور، مش من الأطراف

التثبيت بييجي من الجذر. ادفع المنتج عند القاعدة وارفع، بدل ما تمسح بيه على السطح وتطلع لمعة بس.

## ٤. ظبط التثبيت على يومك

جل درجة ٣ يكفي للمكتب. يوم كامل حر وحركة عايز واكس درجة ٥ زي [برو إكس](/product/premium-wax-pro-x). لو الستايل بيقع بالظهر، الحل غالباً تثبيت أقوى، مش كمية أكبر.',
 '', '',
 'thick', 'S7-WAX-YEL', 'published', '2026-08-18 10:00:00'
)
ON CONFLICT (slug) DO UPDATE SET
  lang         = EXCLUDED.lang,
  group_key    = EXCLUDED.group_key,
  title        = EXCLUDED.title,
  excerpt      = EXCLUDED.excerpt,
  body         = EXCLUDED.body,
  cover        = EXCLUDED.cover,
  cover_alt    = EXCLUDED.cover_alt,
  hair_type    = EXCLUDED.hair_type,
  sku          = EXCLUDED.sku,
  status       = EXCLUDED.status,
  published_at = EXCLUDED.published_at,
  updated_at   = now();


-- ---------------------------------------------------------------------------
--  Product page copy (added after the first release)
--
--  Filled in only where the column is still empty, so re-running this file
--  never overwrites wording the owner has edited in the admin. To restore the
--  original text for a product, blank the field in the admin and re-run.
--
--  howto_* and highlights_* are one item per line. long_* goes through
--  lib/markdown.js, so **bold** works and nothing else is interpreted.
-- ---------------------------------------------------------------------------
UPDATE products p SET
  long_ar       = CASE WHEN p.long_ar       = '' THEN v.long_ar       ELSE p.long_ar       END,
  long_en       = CASE WHEN p.long_en       = '' THEN v.long_en       ELSE p.long_en       END,
  howto_ar      = CASE WHEN p.howto_ar      = '' THEN v.howto_ar      ELSE p.howto_ar      END,
  howto_en      = CASE WHEN p.howto_en      = '' THEN v.howto_en      ELSE p.howto_en      END,
  highlights_ar = CASE WHEN p.highlights_ar = '' THEN v.highlights_ar ELSE p.highlights_ar END,
  highlights_en = CASE WHEN p.highlights_en = '' THEN v.highlights_en ELSE p.highlights_en END
FROM (VALUES
    ('S7-WAX-RED',
     'برو إكس هو نجم التشكيلة. تركيبة **ويف آند جروم** اتعملت للشعر المتموج والتخين — النوع اللي بيقاوم التصفيف وبتتفلت موجته بسرعة. الواكس هنا بيعرّف الموجة بدل ما يفردها.

التثبيت ميجا هولد، ٥ من ٥ — أعلى درجة في التشكيلة كلها. اللمعة طبيعية مش زجاجية، والملمس بيفضل مرن، فتقدر تعدّل الاستايل بإيدك في نص اليوم من غير ما تغسل شعرك.',
     'Pro X is the star of the line. The **Wave & Groom** formula was built for wavy and thick hair — the type that fights styling and loses its shape by midday. This wax defines the wave instead of flattening it.

Hold is mega, 5 out of 5 — the strongest in the range. The finish is natural rather than glassy, and the texture stays pliable, so you can reshape with your hands mid-day without washing.',
     'خد كمية بحجم حبة الفول على طرف صوابعك
افركها بين إيديك لحد ما تدفى وتبقى شفافة
وزّعها على شعر ناشف أو نص ناشف من الجذور للأطراف
ظبّط الاستايل بإيدك أو بمشط واسع السنون',
     'Take a pea-sized amount on your fingertips
Rub it between your palms until it warms and turns clear
Work it through dry or towel-dried hair, roots to ends
Shape with your hands or a wide-tooth comb',
     'تثبيت ميجا هولد — ٥ من ٥
تركيبة ويف آند جروم للشعر المتموج والتخين
لمعة طبيعية، مش زجاجية
برطمان ١٢٠ مل',
     'Mega hold — 5 out of 5
Wave & Groom formula for wavy and thick hair
Natural finish, not glassy
120ml jar'),
    ('S7-WAX-PUR',
     'الشعر الكيرلي والمجعّد بيفقد رطوبته أسرع من أي نوع تاني، وأغلب أنواع الواكس بتزوّد الجفاف. عشان كده التركيبة دي مبنية على **زبدة الشيا** — ملمس أنعم وتثبيت أقل قسوة.

التثبيت ٤ من ٥: قوي كفاية إن الكيرل يفضل مظبوط، ومرن كفاية إنك تعدّله من غير ما تكسر شكل الخصلة.',
     'Curly and coily hair loses moisture faster than any other type, and most waxes make that worse. This one is built around **shea butter** instead — a softer texture and a gentler hold.

Hold is 4 out of 5: firm enough to keep the curl in shape, flexible enough to reshape without breaking the pattern.',
     'خد كمية صغيرة وافركها بين إيديك لحد ما تدفى
حطها على شعر نص ناشف عشان توزّع أحسن
اشتغل من الأطراف ناحية الجذور عشان متثقّلش الكيرل
عرّف الخصل بصوابعك',
     'Take a small amount and warm it between your palms
Apply to towel-dried hair — it spreads more evenly
Work from the ends up so you do not weigh the curl down
Define the strands with your fingers',
     'زبدة الشيا في التركيبة
تثبيت ٤ من ٥ — مرن مش ناشف
للشعر الكيرلي والمجعّد والتخين
برطمان ١٢٠ مل',
     'Shea butter in the formula
Hold 4 out of 5 — flexible, not crunchy
For curly, coily and thick hair
120ml jar'),
    ('S7-WAX-BLU',
     '**زيت الأرجان** موجود في العناية بالشعر من زمان، وهو أساس التركيبة دي. الفكرة إنك تظبط الاستايل وتدّي الشعر ملمس أنعم في نفس الخطوة، بدل ما تعمل الاتنين بمنتجين.

التثبيت ٤ من ٥ — مناسب للشعر المجعّد والمتموج اللي محتاج تحكم من غير ما يبقى ناشف أو متكتّل.',
     '**Argan oil** has been in hair care for a long time, and it is the base of this formula. The idea is to shape the style and leave a softer feel in the same step, instead of using two products for the two jobs.

Hold is 4 out of 5 — right for curly and wavy hair that needs control without ending up dry or clumped.',
     'كمية بحجم حبة الفول بين إيديك
وزّعها على شعر نص ناشف
اشتغل من الأطراف ناحية الجذور
ظبّط بصوابعك أو بمشط واسع السنون',
     'A pea-sized amount between your palms
Spread it through towel-dried hair
Work from the ends up
Finish with your fingers or a wide-tooth comb',
     'زيت أرجان في التركيبة
تثبيت ٤ من ٥
للشعر المجعّد والمتموج
برطمان ١٢٠ مل',
     'Argan oil in the formula
Hold 4 out of 5
For curly and wavy hair
120ml jar'),
    ('S7-WAX-BLK',
     'الشعر الناعم والمفرود مشكلته مع أغلب المنتجات إن أي لمعة بتخليه يبان أقل كثافة وبيوصل لشكل الدهون بدري. بلاك تركيبة **مطفية تماماً** — صفر لمعة.

التثبيت ٥ من ٥ من غير وزن زيادة، فالشعر بيفضل واقف ومظبوط طول اليوم بدل ما يقع بعد ساعتين.',
     'Fine, straight hair has one problem with most products: any shine makes it read thinner and look greasy sooner. Black is a fully **matte** formula — no shine at all.

Hold is 5 out of 5 with no added weight, so the style stays up through the day instead of dropping after two hours.',
     'كمية صغيرة جداً — الشعر الناعم مش محتاج كتير
افركها كويس بين إيديك لحد ما تختفي
حطها على شعر ناشف تماماً عشان أعلى تثبيت
ارفع من الجذور وإنت بتوزّع',
     'A very small amount — fine hair needs less than you think
Rub it in well until it disappears on your palms
Apply to fully dry hair for maximum hold
Lift from the roots as you work it through',
     'ملمس مطفي — صفر لمعة
تثبيت ٥ من ٥ من غير وزن
للشعر الناعم والمفرود
برطمان ١٢٠ مل',
     'Matte finish — no shine
Hold 5 out of 5 with no added weight
For fine and straight hair
120ml jar'),
    ('S7-WAX-YEL',
     'برو هو الواكس اليومي في التشكيلة: تثبيت ٥ من ٥ بتركيبة سهلة التوزيع تنفع لأنواع شعر كتير — تخين، مفرود، أو متموج.

لو بتدوّر على برطمان واحد تمد إيدك عليه كل يوم الصبح من غير ما تفكر، ده هو.',
     'Pro is the everyday wax in the line: 5-out-of-5 hold in a formula that spreads easily and suits a range of hair — thick, straight or wavy.

If you want one jar you reach for every morning without thinking about it, this is the one.',
     'خد كمية بحجم حبة الفول
افركها بين إيديك لحد ما تدفى
وزّعها على شعر ناشف أو نص ناشف
ظبّط الاستايل بإيدك',
     'Take a pea-sized amount
Rub it between your palms until it warms
Work it through dry or towel-dried hair
Shape with your hands',
     'تثبيت ٥ من ٥
سهل التوزيع
يناسب الشعر التخين والمفرود والمتموج
برطمان ١٢٠ مل',
     'Hold 5 out of 5
Spreads easily
Suits thick, straight and wavy hair
120ml jar'),
    ('S7-GEL-YEL',
     'الجل ده للـ**ويت لوك** — اللمعة المبلولة اللي بتدي الشعر شكل مرتب وكثافة أعلى. أنسب حاجة للشعر الناعم المفرود اللي بيقع بسرعة ومحتاج حاجة تمسكه من غير وزن.

التثبيت ٣ من ٥: تحكم يومي بيتغسل بسهولة. عبوة ٢٥٠ مل.',
     'This gel is for the **wet look** — the polished shine that makes hair read tidier and fuller. It suits fine, straight hair that drops quickly and needs hold without weight.

Hold is 3 out of 5: daily control that washes out easily. 250ml bottle.',
     'حط كمية على شعر نص مبلول — الجل بيتوزّع أحسن كده
مشّط للخلف أو للجنب حسب الاستايل اللي عايزه
سيبه ينشف لوحده عشان تاخد أعلى لمعة
لو عايز شكل أنعم، مشّطه تاني وهو نص ناشف',
     'Apply to damp hair — gel spreads best that way
Comb it back or to the side, whichever style you want
Let it dry on its own for the most shine
For a softer finish, comb it again while it is half dry',
     'ويت لوك — لمعة عالية
تثبيت ٣ من ٥
للشعر الناعم المفرود
عبوة ٢٥٠ مل',
     'Wet look — high shine
Hold 3 out of 5
For fine, straight hair
250ml bottle'),
    ('S7-GEL-GRN',
     'نفس تثبيت الجل بريميوم، ٣ من ٥، بريحة نضيفة خفيفة بتفضل معاك من غير ما تزاحم البارفان بتاعك.

للشعر الناعم المفرود: تحكم يومي للشغل أو الجامعة، وبيتغسل بسهولة في آخر اليوم. عبوة ٢٥٠ مل.',
     'The same Premium Gel hold, 3 out of 5, with a light clean scent that stays with you without fighting your fragrance.

For fine, straight hair: daily control for work or campus, and it washes out easily at the end of the day. 250ml bottle.',
     'حط كمية على شعر نص مبلول — الجل بيتوزّع أحسن كده
مشّط للخلف أو للجنب حسب الاستايل اللي عايزه
سيبه ينشف لوحده عشان تاخد أعلى لمعة
لو عايز شكل أنعم، مشّطه تاني وهو نص ناشف',
     'Apply to damp hair — gel spreads best that way
Comb it back or to the side, whichever style you want
Let it dry on its own for the most shine
For a softer finish, comb it again while it is half dry',
     'ريحة نضيفة خفيفة
تثبيت ٣ من ٥
للشعر الناعم المفرود
عبوة ٢٥٠ مل',
     'Light, clean scent
Hold 3 out of 5
For fine, straight hair
250ml bottle'),
    ('S7-GEL-BLU',
     'الأزرق هو الكلاسيك: تثبيت ٣ من ٥ بيفضل ثابت من الصبح لآخر اليوم من غير ما يسيب قشرة بيضا.

للشعر الناعم المفرود اللي محتاج حاجة يعتمد عليها كل يوم، من غير تجربة ولا مفاجآت. عبوة ٢٥٠ مل.',
     'Blue is the classic: 3-out-of-5 hold that stays put from morning to the end of the day without leaving white flakes.

For fine, straight hair that needs something dependable every day — no experimenting, no surprises. 250ml bottle.',
     'حط كمية على شعر نص مبلول — الجل بيتوزّع أحسن كده
مشّط للخلف أو للجنب حسب الاستايل اللي عايزه
سيبه ينشف لوحده عشان تاخد أعلى لمعة
لو عايز شكل أنعم، مشّطه تاني وهو نص ناشف',
     'Apply to damp hair — gel spreads best that way
Comb it back or to the side, whichever style you want
Let it dry on its own for the most shine
For a softer finish, comb it again while it is half dry',
     'تثبيت ثابت طول اليوم
من غير قشرة بيضا
للشعر الناعم المفرود
عبوة ٢٥٠ مل',
     'Holds all day
No white flakes
For fine, straight hair
250ml bottle')
) AS v(sku, long_ar, long_en, howto_ar, howto_en, highlights_ar, highlights_en)
WHERE p.sku = v.sku;
