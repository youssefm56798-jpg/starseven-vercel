-- =====================================================================
--  NEW STAR SEVEN — seed data (Postgres / Neon)
--  Run AFTER schema.sql:   npm run db:setup
--  Safe to re-run: every statement upserts on its natural key.
--
--  These are INSERT ... ON CONFLICT DO NOTHING, not upserts. The seed is
--  initial data only: once a row exists, the shop owner owns it. An upsert
--  here would silently revert prices, stock and wording edited in the admin
--  every time the project is deployed. New long-form copy still lands, via
--  the guarded UPDATE at the end of this file, but only into empty fields.
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
ON CONFLICT (sku) DO NOTHING;

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
ON CONFLICT (code) WHERE code <> '' DO NOTHING;

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
 -- Bare slug, not '-ar': twins share a slug now. Left as '-ar' this row was
 -- re-inserted on every deploy right after the migration renamed the real
 -- one, resurrecting the duplicate the migration had just removed.
 'choose-hair-product-by-hair-type', 'ar', 'choose-by-type',
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
 'make-your-style-last-all-day', 'ar', 'last-all-day',
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
-- (slug, lang), not (slug): slug alone is no longer unique now that an
-- article and its translation share one.
ON CONFLICT (slug, lang) DO NOTHING;


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


-- ---------------------------------------------------------------------------
--  Articles, second wave (8)
--
--  Written against measured search demand, in Egyptian colloquial Arabic with
--  English twins where the English SERP is worth contesting. Twins share a slug
--  and a group_key, so /article/wax-or-gel and /en/article/wax-or-gel are the
--  same article in two languages and the language toggle has something to
--  switch on.
--
--  ON CONFLICT (slug, lang) DO UPDATE here, not DO NOTHING: two of these are
--  rewrites of articles that already exist and are 116 and 151 words long. The
--  body is the whole point of the rewrite, so it has to land.
-- ---------------------------------------------------------------------------
INSERT INTO articles
  (slug, lang, group_key, title, excerpt, body, cover, cover_alt, hair_type, sku,
   status, published_at)
VALUES
  ('hold-levels-guide', 'ar', 'hold-levels',
   'تثبيت ٣ ولا ٤ ولا ٥؟ دليل درجات تثبيت الواكس والجل للرجالة',
   'كل منتج في التشكيلة مكتوب عليه درجة تثبيت من ٥. الدليل ده بيوضح يعني إيه الرقم ده، والفرق بين ٣ و٤ و٥، وأنهي رقم تشتري بيه.',
   'بتقف قدام الرف، وكل حاجة مكتوب عليها «تثبيت قوي». بتشتري، وبعد ساعتين الشعر واقع زي ما هو.

المشكلة إن كلمة «قوي» مش رقم. عشان كده إحنا بنكتب على كل منتج في تشكيلة تصفيف الشعر للرجالة درجة تثبيت من ٥ — ٨ منتجات، ٣ درجات، وكل درجة ليها شغلانة مختلفة. الدليل ده هيخليك تشتري بالرقم مش بالكلام.

## يعني إيه درجة تثبيت

درجة التثبيت رقم إحنا اللي بنكتبه على كل منتج، وبيقول حاجة واحدة بس: المنتج ماسك الشكل بقوة قد إيه، وبيقاوم رجوع الشعر لشكله الطبيعي قد إيه. مش أكتر من كده ولا أقل.

وأربع حاجات لازم تكون واضحة قبل ما تكمل:

- **الرقم مش تقييم جودة.** تثبيت ٣ مش «أوحش» من ٥. ده وصف لشغلانة مختلفة، وهتشوف تحت إن في شعر شكله بيبوظ من درجة ٥ ومحتاج ٣.
- **التثبيت مش اللمعة.** دول محورين منفصلين خالص. عندنا منتج تثبيت ٥ من غير أي لمعة (بلاك)، ومنتج تثبيت ٣ لمعته عالية جداً (جولدن). متختارش على أساس إن اللمعة دليل على القوة.
- **الرقم مش عدد ساعات.** إحنا مش بنقول لك «تثبيت ٤٨ ساعة» لأن ده كلام مش بنقيسه. اللي بنكتبه هو الدرجة من ٥، وخلاص.
- **الرقم مش السعر.** كل الواكس عندنا بنفس السعر ونفس الحجم، وكل الجل بنفس السعر ونفس الحجم. يعني لو رحت لدرجة أعلى مش هتدفع زيادة، ولو رحت لدرجة أقل مش هتوفر. الفلوس خرجت من المعادلة تماماً.

## تلات خطوات تختار بيهم رقمك

الناس بتبدأ من الرقم، وده أصلاً آخر خطوة مش أولها. الترتيب الصح كده:

- **ابدأ من الشكل اللي في دماغك.** عايز الشعر يبان مبلول ولامع؟ ولا مطفي وطبيعي كأنك مش حاطط حاجة؟ ولا موجة مفتوحة ومعرّفة؟ الشكل ده بيحدد النهاية، والنهاية بتقفل عليك نص التشكيلة على طول.
- **بعدين حدد الفورمات: واكس ولا جل.** الجل بيتحط على شعر مبلول وبينشف على الشكل. الواكس بيتحط على شعر ناشف أو نص ناشف وبيفضل ماشي مع إيدك. ده الفرق العملي اللي هتحسه كل يوم الصبح.
- **وبعد كده بس شوف الرقم.** لأن الرقم جوه كل فورمات بقى اختيار ضيق: الجل كله على ٣، والواكس بين ٤ و٥. يعني لما توصل للخطوة دي بتبقى فاضل قدامك حاجتين تلاتة مش تمنية.

ولو نوع شعرك نفسه مش واضح لك، ابدأ من [دليل أنواع الشعر](/hair-types) الأول وبعدين ارجع للرقم.

## تثبيت ٣ — الجل اليومي (٣ ألوان)

تلات جل، كلهم ٢٥٠ مل، كلهم ٤٠ جنيه، وكلهم تثبيت ٣ من ٥، ومتسجلين على [الشعر الناعم المفرود](/hair-types/straight).

درجة ٣ معناها إن الشكل ماسك بس لسه بيمشي معاك. تقدر تعدل بإيدك بعد ما ينشف من غير ما الشعر يتكسر أو يبان متقفل. ودي بالظبط الحاجة اللي بتخلي درجة ٣ اختيار مقصود مش تنازل: في ناس عايزة تظبط الشكل تاني في نص اليوم، ودرجة ٥ مش بتسمح بده.

والتلاتة على نفس الرقم بالظبط، فالاختيار بينهم مش اختيار قوة خالص — هو اختيار لمعة وريحة:

- **[جل جولدن](/product/premium-gel-golden)** — ويت لوك، لمعة عالية. ده الاختيار لو عايز الشكل المبلول اللامع.
- **[جل جرين](/product/premium-gel-green)** — ريحة نضيفة، تثبيت هادي طول اليوم.
- **[جل بلو](/product/premium-gel-blue)** — الكلاسيك اللي بيقعد لآخر اليوم.

شوف [تشكيلة الجل كلها](/shop/gel) لو مستقر على الفورمات ده.

## تثبيت ٤ — الواكس المغذي (شيا وأرجان)

الاتنين دول ١٢٠ مل و٤٥ جنيه، وتثبيت ٤ من ٥.

الفرق بينهم وبين درجة ٥ مش إنهم «أضعف». الفرق إن شغلانتهم متقسمة على حاجتين مع بعض: تثبيت كويس + تليين للشعرة الخشنة الناشفة. لو شعرك ناشف ومحتاج تعريف مش قفل، درجة ٤ هي اللي انت عايزها، ودرجة ٥ هتديك إمساك أعلى بس الشكل هيبان أجمد وأقل حركة.

- **[واكس زبدة الشيا](/product/premium-wax-shea)** — نهاية ناعمة، متسجل على [الشعر الخشن/الأفرو](/hair-types/coily) و[الكيرلي](/hair-types/curly) و[الكثيف](/hair-types/thick).
- **[واكس الأرجان](/product/premium-wax-argan)** — تركيبة مغذية، متسجلة على الكيرلي والخشن و[المتموج](/hair-types/wavy).

خد بالك إن الشيا متسجل على الشعر الكثيف برضه. يعني الكثيف مش محكوم عليه بدرجة ٥ إجبارياً — ٤ خيار حقيقي معاه لو عايز نهاية أنعم.

## تثبيت ٥ — الميجا (برو إكس، بلاك، برو)

تلاتة، كلهم ١٢٠ مل و٤٥ جنيه، وكلهم تثبيت ٥ من ٥ — أعلى رقم في التشكيلة كلها.

درجة ٥ معناها إن الشكل بيتقفل ومش بيمشي معاك بسهولة بعد ما ينشف. ده مكسب ولا خسارة على حسب انت عايز إيه: مكسب لو عايز تحط الشكل الصبح وتنساه، وخسارة لو من النوع اللي بيعدل شعره بإيده كل ساعة.

- **[واكس برو إكس](/product/premium-wax-pro-x)** — تركيبة Wave & Groom، نهاية طبيعية، للشعر المتموج والكثيف. كان بـ٥٥ جنيه، بقى ٤٥.
- **[واكس بلاك](/product/premium-wax-black)** — تثبيت ٥ من غير أي لمعة خالص، نهاية مطفية (مات)، متسجل على [الشعر الخفيف](/hair-types/fine) والناعم المفرود.
- **[واكس برو](/product/premium-wax-pro)** — التثبيت العالي اليومي، للشعر الكثيف والمفرود والمتموج.

التلاتة على نفس الرقم، فالاختيار بينهم كله بالنهاية: طبيعية (برو إكس)، مطفية خالص (بلاك)، ولا يومي عام (برو). كل [تشكيلة الواكس](/shop/wax) هنا.

## المقارنة الكاملة: ٨ منتجات بالتثبيت والحجم والسعر

التشكيلة كلها في مكان واحد، مرتبة من أعلى تثبيت لأقل:

- **[برو إكس](/product/premium-wax-pro-x)** — واكس · تثبيت ٥/٥ · ١٢٠ مل · ٤٥ جنيه (كان ٥٥) · متموج وكثيف · نهاية طبيعية
- **[بلاك](/product/premium-wax-black)** — واكس · تثبيت ٥/٥ · ١٢٠ مل · ٤٥ جنيه · خفيف ومفرود · مطفي بدون لمعة
- **[برو](/product/premium-wax-pro)** — واكس · تثبيت ٥/٥ · ١٢٠ مل · ٤٥ جنيه · كثيف ومفرود ومتموج · يومي
- **[زبدة الشيا](/product/premium-wax-shea)** — واكس · تثبيت ٤/٥ · ١٢٠ مل · ٤٥ جنيه · خشن وكيرلي وكثيف · نهاية ناعمة
- **[الأرجان](/product/premium-wax-argan)** — واكس · تثبيت ٤/٥ · ١٢٠ مل · ٤٥ جنيه · كيرلي وخشن ومتموج · مغذي
- **[جولدن](/product/premium-gel-golden)** — جل · تثبيت ٣/٥ · ٢٥٠ مل · ٤٠ جنيه · مفرود · ويت لوك ولمعة عالية
- **[جرين](/product/premium-gel-green)** — جل · تثبيت ٣/٥ · ٢٥٠ مل · ٤٠ جنيه · مفرود · ريحة نضيفة
- **[بلو](/product/premium-gel-blue)** — جل · تثبيت ٣/٥ · ٢٥٠ مل · ٤٠ جنيه · مفرود · كلاسيك طول اليوم

كل الواكس ١٢٠ مل و٤٥ جنيه، وكل الجل ٢٥٠ مل و٤٠ جنيه. يعني الاختيار بينهم مش مسألة فلوس — هو مسألة نوع شعر ودرجة تثبيت وبس.

## أنهي رقم متسجل على أنهي نوع شعر

دي مجرد خريطة سريعة للأرقام. كل نوع عنده صفحة بتشرح مشكلته بالتفصيل وإيه اللي يبعد عنه:

- [ناعم مفرود](/hair-types/straight) — تثبيت ٣، أو ٥ مطفي.
- [متموج](/hair-types/wavy) — تثبيت ٤ أو ٥ واكس.
- [كيرلي](/hair-types/curly) — تثبيت ٤.
- [خشن/أفرو](/hair-types/coily) — تثبيت ٤.
- [خفيف](/hair-types/fine) — تثبيت ٥ مطفي.
- [كثيف](/hair-types/thick) — تثبيت ٥، ومعاه ٤ كخيار أنعم.

## التثبيت العالي بيأذي الشعر؟

الرقم اللي إحنا بنكتبه بيتكلم عن الإمساك، مش عن صحة الشعر. مش بنقول إن درجة أعلى «أأمن» ولا «أخطر»، ومش بنبيع علاج ولا حل لمشكلة في الفروة. دي منتجات تصفيف، وبس، وده كل اللي بنقوله عنها — تقدر تقرا أكتر عن التشكيلة في [صفحة البراند](/brand).

اللي فعلاً بيفرق في التجربة اليومية هو الكمية وطريقة الحط — والاتنين دول تحت إيدك انت، مش تحت الرقم.

## الكمية: أهم حاجة بعد الرقم

لو حسيت الشعر تقيل أو بيبان دهون بدري، غالباً المشكلة في الكمية مش في الدرجة. الرقم بيحدد قد إيه المنتج ماسك، لكن انت اللي بتحدد قد إيه المنتج موجود على الشعرة.

- **ابدأ بحاجة قد الحمصة.** دوّبها بين إيديك الأول لحد ما تتوزع، وبعدين ادخل بيها من ورا لقدام مش من قدام على طول. لو حسيت إن الشكل مش ماسك كفاية، زوّد شوية تاني. الزيادة تقدر تحطها، لكن اللي اتحط مش هينزل تاني من غير غسيل.
- **ابعد عن جذور الشعر.** الشكل بيتعمل من نص الشعرة لفوق. أي منتج بيتحط على الفروة نفسها مش بيزود التثبيت، بس بيخلي الشعر يبان تقيل وملزوق أسرع بكتير.
- **الجل يتحط على شعر مبلول.** ده اللي بيديك التوزيع المتساوي والشكل اللي بيقعد. لو حطيته على شعر ناشف تماماً هيبقى صعب يتوزع، وهتحتاج كمية أكبر من اللازم عشان تغطي.

## أسئلة بتتسأل كتير

**أقوى منتج عندكم إيه؟**
تلاتة على نفس الدرجة: برو إكس وبلاك وبرو، كلهم تثبيت ٥ من ٥. الاختيار بينهم مش بالقوة — هو بالنهاية اللي عايزها ونوع شعرك: برو إكس نهاية طبيعية للمتموج والكثيف، بلاك مطفي بدون أي لمعة للخفيف والمفرود، برو للتثبيت اليومي على الشعر الكثيف والمفرود والمتموج.

**تثبيت ٣ يعني الجل ضعيف؟**
لأ. يعني الشكل ماسك بس لسه مرن وتقدر تعدله بإيدك بعد ما ينشف. لناس كتير دي الدرجة الصح مش تنازل، خصوصاً لو بتعدل شعرك أكتر من مرة في اليوم.

**الفرق بين تثبيت ٤ و٥ كبير؟**
مش قفزة ضخمة، لكنه محسوس. ٤ بيسيب للشعر حركة وشكل أنعم، ٥ بيقفل الشكل ومش بيمشي معاك بسهولة. ولو انت متردد بين الاتنين، فكر بالنهاية اللي عايزها مش بالقوة: الشيا والأرجان نهايتهم أنعم، وبرو وبرو إكس وبلاك نهايتهم أثبت.

**ينفع أستعمل جل وواكس مع بعض؟**
ينفع تحط جل على شعر مبلول وتسيبه ينشف، وبعدين تاخد كمية صغيرة جداً واكس لتحديد الأطراف. بس ابدأ بكمية أقل من المعتاد من الاتنين — دي أسرع طريقة لشعر تقيل ولبقايا بيضا من المنتج على الشعر.

**عندكم كريم أو طين (clay) بتثبيت أقل؟**
لأ. التشكيلة ٨ منتجات بس: ٥ واكس و٣ جل. مفيش عندنا كريم ولا طين ولا بوميد ولا شامبو ولا كولونيا. لو محتاج تثبيت خفيف مرن، أقرب حاجة عندنا هي الجل بدرجة ٣.

**السعر والتوصيل؟**
الواكس ٤٥ جنيه لـ١٢٠ مل، الجل ٤٠ جنيه لـ٢٥٠ مل. التوصيل ٣٠ جنيه، ومجاني فوق ٣٠٠ جنيه. الدفع عند الاستلام، والشحن جوه مصر بس. شوف [كل المنتجات](/shop) أو [تشكيلة الواكس](/shop/wax).',
   'assets/gel-blue.webp', 'Star Seven Premium Gel', '', '',
   'published', now()),
  ('how-much-wax-to-use', 'ar', 'dosage',
   'كمية الواكس الصح لتصفيف الشعر للرجالة — من غير ما يبان',
   'أغلب مشاكل الواكس سببها الكمية مش المنتج. الكمية الصح في تصفيف الشعر، الواكس على ناشف والجل على مبلول، وليه بيطلع أبيض.',
   'بتحط واكس، وبعد شوية تلاقي الشعر تقيل ولازق وشكله دهون، أو تلاقي قشور بيضا في الجذور. في أغلب الحالات المشكلة مش في المنتج نفسه — المشكلة في الكمية وفي ترتيب خطوات التصفيف.

الحتة دي محدش بيشرحها. أي علبة واكس هتلاقي عليها اسم ودرجة تثبيت وخلاص، ومحدش بيقولك تاخد قد إيه ولا تحطه إمتى. وده بالظبط اللي بيخلي واحد يقول "الواكس ده مش كويس" وهو أصلاً بياخد كمية أكبر بكتير من اللي محتاجه.

## القاعدة: قد الحمصة، وبعدين زوّد

ابدأ بكمية صغيرة، وزوّد لو احتجت. العكس مستحيل — مفيش طريقة تشيل بيها واكس زيادة من على شعرك من غير ما تغسله.

- **شعر قصير (كابلي أو أقصر):** قد الحمصة.
- **شعر متوسط:** قد البندقة.
- **شعر طويل أو كثيف جدا:** قد البندقة، وبعدين قد الحمصة تانية لو الشعر لسه مش ماسك.

الكمية التانية دي بتتحط بعد ما توزّع الأولى وتشوف النتيجة، مش مع بعض من الأول. لو حطيت الاتنين مرة واحدة مش هتعرف كان محتاج قد إيه أصلا.

وفي حتة تجارية بصراحة: علبة الواكس عندنا ١٢٠ مل بـ٤٥ جنيه. لو بتاخد قد الحمصة، العلبة هتلاقيها بتخلص أبطأ بكتير من لو بتغرف بإصبعين كل يوم الصبح. الكمية الزيادة مش بتديك تثبيت أعلى — بتديك شكل دهون وفلوس بتضيع.

## سخّنه في إيدك الأول

دي أهم خطوة وأكتر واحدة بتتنسي. الواكس وهو خارج من العلبة بيبقى متماسك وتقيل، ولو حطيته على شعرك على طول هيتوزّع كتل مش طبقة.

افرك الكمية بين كفوفك من عشرة لخمستاشر تانية، لحد ما تحس إنها بقت طبقة رفيعة على إيدك كلها، من غير أي تكتلات. لما يبقى موزّع على كفوفك كده، هيتوزّع على شعرك بنفس الشكل.

لو الجو برد والواكس ناشف شوية، افرك أكتر. مش تزوّد كمية.

## واكس على ناشف، جل على مبلول

ده الفرق العملي بين النوعين، وهتحسه بنفسك من أول مرة:

- **الواكس** على شعر مبلول بيتوزّع وحش، وبتحس إن التثبيت قلّ فجأة والشكل مش ماسك زي المعتاد. حطه على شعر **ناشف تماما أو فيه رطوبة خفيفة جدا** بعد ما تنشّف بالفوطة كويس.
- **الجل** بيتوزّع أحسن بكتير على شعر **مبلول أو نص ناشف**، وده الوضع اللي بيديك أنضف شكل منه.

يعني لو خارج من الحمام مستعجل، [الجل](/shop/gel) هو اللي هيشتغل معاك دلوقتي حالا — التلات ألوان (جولدن، أخضر، أزرق) تثبيت ٣ من ٥، ٢٥٠ مل بـ٤٠ جنيه. ولو عايز الشكل المبلول اللامع، [جل جولدن](/product/premium-gel-golden) هو المخصص لده.

ولو مستني على [الواكس](/shop/wax)، نشّف شعرك الأول واستنى شوية. الفرق ده لوحده بيحل نص شكاوى التثبيت.

## ابدأ من ورا والجذور آخر حاجة

الطبيعي إن إيدك تروح على قدام وفوق الأول، وده بالظبط سبب إن القدام بيبقى تقيل والورا مفيهوش حاجة.

الترتيب اللي بيوزّع صح:

- ابدأ من **ورا الراس**، وإيدك مفتوحة والصوابع متباعدة.
- بعدين **الجوانب**.
- بعدين **فوق**.
- **القدام والغرة آخر حاجة**، بالباقي اللي فضل على إيدك — والباقي ده أقل مما تتخيل، وده مظبوط.
- الجذور تيجي في الآخر خالص. المنتج في الجذور بيوقّع الشعر ومبيدّيش شكل.

بعد ما توزّع، مشّط بصوابعك من الجذور لبرّه عشان تفتح الخصل، وبعدها اظبط الشكل. لو حسيت إن الشعر لسه مش ماسك، **دلوقتي** بس تاخد الكمية الصغيرة التانية.

## ليه بيطلع أبيض

القشور البيضا اللي بتبان في الجذور أو على الكتف مش عيب في المنتج. ليها تلات أسباب واقعية:

- **كمية زيادة** — الواكس اللي مش لاقي شعر يمسك فيه بيقعد فوق السطح وينشف أبيض.
- **مسخنتوش في إيدك** — الكتلة الصغيرة بتفضل كتلة.
- **حطيته على شعر مبلول** — التوزيع بيبوظ فبيتجمّع في حتت.

الحل هو نفسه في التلات حالات: كمية أقل، فرك أكتر في الكف، وشعر ناشف. جرّب كده مرة قبل ما تغيّر المنتج.

وحاجة تانية بتتخلط بالبياض: اللمعة. لو مضايق إن شعرك بيبان لامع من الواكس، ده مش كمية — ده نوع التركيبة. [بلاك مات](/product/premium-wax-black) تثبيت ٥ من ٥ ومن غير أي لمعة خالص، ومعمول للشعر الناعم والمفرود.

## علامات إنك زوّدت الكمية

من غير ما تقف قدام المراية تحلل، في حاجات بتقولك على طول:

- تدفع الشعر بإيدك ومبيتحركش خالص ولا بيرجع مكانه — دي كمية زيادة، مش تثبيت عالي.
- إيدك لسه فيها واكس بعد ما خلصت التوزيع كله.
- الشعر اتلزق في خصل عريضة بدل الخصل الرفيعة، وبان أغمق من لونه.
- بتحس بالمنتج بإصبعك وإنت بتلمس الفروة.

لو حصل ده، مش لازم تغسل شعرك كله. بلّل فوطة شوية وامسح بيها الجذور، ومشّط بصوابعك من الجذور لبرّه عشان تفك اللزق. وبكرة ابدأ بنص الكمية اللي حطيتها النهاردة.

## ٣ غلطات بتخلي شعرك يبان دهون

- **تبدأ بالجذور.** الجذور هي أول حتة بتلمسها إيدك وهي مليانة، فبتاخد أكبر كمية وهي أصلا أكتر حتة فيها دهون. خليها آخر حاجة.
- **تزوّد الكمية بدل ما تعيد التوزيع.** لو حاسس إن حتة مش واخدة، وزّع اللي على إيدك تاني قبل ما تفتح العلبة.
- **تحط فوق واكس امبارح.** طبقة على طبقة على شعر مغسولش = دهون مضمونة. ده أسرع طريق لشكل تقيل وميت.

## لو شعرك خفيف: نص الكمية

الفرق الأساسي عندك هو الكمية نفسها: خد **نص اللي فوق** — أقل من الحمصة — وسخّنها في إيدك أكتر من العادي لحد ما تبقى طبقة رفيعة أوي.

- حط من **فوق ومن بره** بس، ومتقربش من الجذور خالص — الجذور هي اللي بتدي الحجم وأول حاجة بتضيّعه.
- لو حسيت إنه محتاج زيادة، متزوّدش النهاردة. زوّد شوية بكرة لحد ما توصل للكمية بتاعتك إنت.
- بعد التوزيع، مشّط بصوابعك من تحت لفوق مش من فوق لتحت، عشان متوقّعش الشعر بإيدك.

أنهي تركيبة تحديدا تناسب الشعر الخفيف، واللمعة والوزن وإيه اللي تبعد عنه — ده كله متشرح في صفحة [الشعر الخفيف](/hair-types/fine).

وعلى العكس، لو شعرك كثيف، الكمية بتاعتك أكبر من دي بمراحل، بس القاعدة تفضل هي هي: قد البندقة، وزّع، وبعدين شوف. أنهي درجة تثبيت تناسبك موجودة في صفحة [الشعر الكثيف](/hair-types/thick)، ولو عايز تشوف الاختيارات على طول: [برو إكس](/product/premium-wax-pro-x) تثبيت ٥ من ٥ بتركيبة Wave & Groom، و[برو](/product/premium-wax-pro) تثبيت ٥ من ٥ لليومي.

## أسئلة بتتسأل كتير

**أحط الواكس على شعر مبلول ولا ناشف؟**
ناشف. على شعر مبلول التوزيع بيبوظ وبتحس إن التثبيت قلّ. لو خارج من الحمام، نشّف بالفوطة واستنى شوية — أو استخدم جل، ده اللي بيشتغل على المبلول.

**الواكس بيخلص بسرعة، ده طبيعي؟**
غالبا لأ. العلبة ١٢٠ مل، ولو الكمية اليومية قد الحمصة مش هتخلص بالسرعة دي. اللي بيستهلك علبة بسرعة عادةً بياخد كمية أكبر من اللي محتاجها، وبيعوّض بكمية زيادة عن إنه مش بيسخّن الواكس في إيده.

**أقدر أستخدم واكس وجل مع بعض؟**
ينفع، بس بترتيب: جل على الشعر المبلول الأول، تستنى يجف، وبعدين كمية صغيرة أوي واكس عشان تعرّف الشكل. ده مفيد للشعر الكثيف اللي بيقع تحت وزنه. غير الحالة دي، واحد بس بالكمية الصح بيكفي.

**الكمية بتتغير لما الشعر يطول؟**
أيوه. كل ما الشعر يطول، الكمية اللي بتوصل لآخر الخصلة بتقل، فهتحتاج تزوّد شوية. بس زوّد بالتدريج زي ما قلنا — حمصة زيادة، مش ضعف الكمية.

**عندكم كريم أو طين (clay) أو بوميد؟**
لأ. التشكيلة عندنا ٥ واكس ١٢٠ مل و٣ جل ٢٥٠ مل، وخلاص. لو محتاج طين أو كريم، مش هتلاقيه عندنا، وأحسن نقولها من الأول.

**الأسعار والتوصيل؟**
الواكس ٤٥ جنيه، الجل ٤٠ جنيه. التوصيل ٣٠ جنيه، ومجاني فوق ٣٠٠ جنيه. الدفع كاش عند الاستلام، وداخل مصر بس. تقدر تشوف [التشكيلة كلها](/shop) والأسعار قبل ما تطلب.',
   'assets/wax-yellow.webp', 'Star Seven Premium Wax Pro', '', 'premium-wax-pro-x',
   'published', now()),
  ('how-to-remove-wax', 'ar', 'removal',
   'إزاي تشيل واكس تصفيف الشعر من شعرك من غير ما تأذيه — للرجالة',
   'واكس التثبيت مش بيروح بالمية لوحدها. الترتيب الصح — زيت الأول، مية دافية بعدين، وغسلتين خفاف بدل فركة واحدة بقوة.',
   'بتقف قدام المراية آخر اليوم، شعرك لسه متكتل ولازق، وبتغسله مرة واتنين والواكس مكانه. الحكاية مش إنك بتغسل غلط ولا إن المنتج وحش — واكس التصفيف من الأصل مش بيروح بالمية لوحدها.

هنا الترتيب اللي بيشيل واكس التثبيت من شعر الرجالة من غير ما تفرك شعرك ولا تفضل تغسل خمس مرات.

## ليه الواكس صعب يتشال

جرّبها بنفسك ومتصدقنيش: حط شعرك تحت الدش من غير أي حاجة تانية، هتلاقي المية بتعدي من فوق وتنزل، ولما الشعر ينشف تلاقيه لسه تقيل ومتلزق من الجذور. الواكس مش زي العرق ولا التراب اللي بينزلوا بشطفة — ده بيحتاج مجهود زيادة عشان يتشال.

الجل حكايته أسهل خالص. [الجل بيروح بغسلة عادية](/shop/gel) ومش محتاج أي حركة قبلها ولا بعدها. ده فرق حقيقي بين الاتنين لازم تعرفه وإنت بتختار، وشرحناه بالتفصيل في [الفرق بين الواكس والجل](/article/wax-or-gel).

وحاجة تانية: كل ما الكمية اللي حطيتها تكون أكبر، كل ما الشيل يبقى أصعب. اقرا [كمية الواكس الصح وإزاي تحطه](/article/how-much-wax-to-use) وهتلاقي نص المشكلة اتحلت من غير ما تعمل حاجة في الحمام أصلاً.

## الترتيب الصح: زيت الأول، مية بعدين

الترتيب اللي بيوفر عليك المجهود بسيط — زيت الأول، وبعدين المية والشامبو.

- **ابدأ والشعر ناشف.** متبلّش شعرك الأول. لو بللته، المية هتقف بين الزيت والواكس والزيت مش هيوصل.
- **حط شوية زيت في إيدك** — أي زيت موجود عندك في البيت، زيت زيتون، جوز هند، أو زيت أطفال. إحنا مبنبيعش زيت ولا شامبو، فمش هنبيعلك حاجة هنا. اللي عندك يكفي.
- **دلّك بأطراف صوابعك دقيقة أو اتنين**، تركيزك على الأماكن المتكتلة وعلى الجذور.
- **بعدين بس** روح على المية والشامبو اللي بتستعمله عادي.

الزيت بيرخّي الواكس ويخليه يتحرك، والشامبو بعده بيشيله. من غير الخطوة دي إنت بتفرك في حاجة واقفة مكانها.

## مية دافية مش سخنة

المية الدافية بتلين الواكس فبيتحرك بسهولة. المية السخنة جداً مش هتشيل أكتر — كل اللي هتعمله إنها تسيب شعرك ناشف وهايش، وتخليك تفرك أكتر.

خليها دافية على قد ما إيدك مستحملة براحتها، مش أكتر. وفي آخر شطفة نزّل حرارة المية شوية — بتساعد الشعر يبان أنعم لما ينشف.

## مرتين غسيل أحسن من مرة بقوة

أكتر غلطة بتأذي الشعر هنا مش الواكس، دي الفركة. الناس بتحاول تشيل كل حاجة في غسلة واحدة بالضوافر وبقوة، والنتيجة تقصيف وهيشان.

الطريقة الأريح:

- **غسلة أولى خفيفة** — كمية شامبو صغيرة، دلّك بأطراف الصوابع مش بالضوافر، اشطف.
- **غسلة تانية أخف** — دي اللي بتنضف فعلاً بعد ما الأولى شالت الزيت والواكس.
- **متستخدمش فوطة بقسوة.** اضغط على الشعر بالفوطة بدل ما تدعكه.

غسلتين هادئين بيشيلوا أكتر من غسلة واحدة عنيفة، وبتوصل لنفس النتيجة بنص المجهود.

لو شعرك [ناعم مفرود](/hair-types/straight)، أي واكس فاضل بيبان من تاني يوم — فالغسلتين الخفاف هنا بالذات هما الفرق. ولو شعرك [تقيل](/hair-types/thick)، خد وقتك في الزيت أكتر شوية عشان يوصل لكل الطبقات مش للطبقة اللي فوق بس.

## لو لسه حاسس بيه بعد الغسيل

قبل ما تعيد الغسيل مرة تالتة بقوة، بص على اللي حصل:

- **تقيل من الجذور بس؟** الزيت غالباً مكنش وصل للجذور. المرة الجاية دلّك من تحت لفوق، مش من فوق بس.
- **باين بياض أو قشور صغيرة؟** دي كمية زيادة اتحطت من الأول وموزعتش كويس. الحل في الكمية مش في الغسيل.
- **الشعر لازق في بعضه وقاسي؟** ده فرك زيادة بمية سخنة. سيبه ينشف لوحده النهاردة ومتكملش فرك.

وأهم حاجة: متعيدش الغسيل بعنف تلات وأربع مرات في نفس اليوم. سيبه لبكرة، وابدأ بالزيت من الأول.

## إمتى تسيبه لليوم اللي بعده

مش لازم تشيله كل يوم.

لو حطيت كمية صغيرة ومكنتش بره طول اليوم في تراب أو عرق، تقدر تسيبه وتعيد تشكيل شعرك تاني يوم: بلّل إيدك بشوية مية، مررها في شعرك، وشكّله من جديد. الواكس اللي فاضل بيرجع يشتغل.

بس سيبه لليوم اللي بعده بس لو:

- الكمية كانت قليلة من الأصل.
- شعرك مش بيحك ولا بيبان تقيل.
- مقضتش يومك في شغل بره أو رياضة.

ولو حسيت إن شعرك تقيل، أو لزق في الفروة، أو باين عليه بياض — اغسله. متراكمش يومين على تلاتة.

## وإنت بتشتري واكس جديد

اللي بيسهّل الشيل من الأول هو إنك تحط الكمية الصح من واكس تثبيته يكفيك، بدل ما تحط كتير من واكس مش ماسك. [برو إكس](/product/premium-wax-pro-x) تثبيت ٥ من ٥ بشكل ناتشورال، و[بلاك مات](/product/premium-wax-black) نفس درجة التثبيت بس من غير أي لمعة خالص. الاتنين ١٢٠ مل بـ٤٥ جنيه، وتقدر تقارن [الواكس كله](/shop/wax) وتشوف كل واحد مناسب لأنهي نوع شعر.

الشحن ٣٠ جنيه ومجاني فوق ٣٠٠ جنيه، والدفع عند الاستلام، وبنوصل مصر كلها.

## أسئلة بتتسأل كتير

**الواكس بيتشال بالمية لوحدها؟**
لأ. المية لوحدها مش بتنزّله. محتاج زيت الأول وبعدين شامبو، أو على الأقل غسلتين شامبو خفاف ورا بعض.

**لازم أغسل شعري كل يوم لو بحط واكس؟**
لأ. لو الكمية صغيرة تقدر تعيد التشكيل تاني يوم بشوية مية. بس متسيبهوش يتراكم أكتر من كده.

**الجل أسهل في الشيل من الواكس؟**
أيوة، وبفرق واضح. [الجل بيروح بغسلة عادية](/shop/gel)، والواكس محتاج مجهود زيادة. لو ده يفرق معاك في روتينك اليومي، خد باله وإنت بتختار.

**الخل أو عصير الليمون ينفع في الشيل؟**
مش محتاجه. الزيت بيعمل الشغل ده وهو أبسط وموجود في كل بيت.

**الواكس بيسبب مشاكل للشعر أو للفروة؟**
إحنا مش دكاترة ومش هنتكلم في حاجة طبية. اللي نقدر نقوله: دي منتجات تصفيف وتثبيت بس، ومن الآخر — متسيبش أي منتج تصفيف متراكم على شعرك أيام ورا بعض. ولو عندك مشكلة في شعرك أو فروة رأسك، ده كلام دكتور مش كلام موقع بيبيع واكس.',
   'assets/gel-green.webp', 'Star Seven Premium Gel', '', 'S7-WAX-RED',
   'published', now()),
  ('make-your-style-last-all-day', 'ar', 'lasts-all-day',
   'الستايل بيقع بعد ساعتين من التصفيف — إزاي تثبت شعرك لآخر اليوم',
   'الستايل بيقع بعد ساعتين من التصفيف؟ المشكلة مش الكمية — المشكلة درجة التثبيت. دليل عملي للرجالة في مصر.',
   'بتقف قدام المراية الصبح، تظبط شعرك، تخرج وكل حاجة تمام. الساعة عشرة ونص بتبص في مراية العربية تلاقي التصفيف وقع خالص والتثبيت سابك، كإنك معملتش حاجة من الأصل.

ده مش سوء حظ ومش لأن شعرك "صعب". في سبب واضح ليه الستايل مبيثبتش معاك، وفي حل عملي للرجالة — والاتنين ملهمش علاقة بإنك تحط كمية أكبر.

## السبب مش المنتج — السبب درجة التثبيت

أول ما الستايل بيقع، أغلب الناس بتعمل حاجة من اتنين: يحطوا كمية أكبر من نفس المنتج، أو يغيّروا المنتج بالكامل ويجربوا حاجة تانية على أمل إنها تمسك.

الاتنين غالباً غلط.

الكمية الزيادة مبتزودش التثبيت — بتزود الوزن بس. والشعر التقيل بيقع أسرع، مش أبطأ. يعني انت بتعالج المشكلة بحاجة بتكبّرها.

اللي بيحدد الشكل اللي هيقعد حاجة واحدة: **درجة التثبيت**. إحنا بنكتب الدرجة دي بالرقم من ٥ على كل منتج، عشان تشوفها بعينك قبل ما تشتري:

- [الجل](/shop/gel) — جولدن، أخضر، وأزرق: تثبيت ٣ من ٥
- [واكس زبدة الشيا](/product/premium-wax-shea) و[واكس الأرجان](/product/premium-wax-argan): تثبيت ٤ من ٥
- [واكس برو إكس](/product/premium-wax-pro-x)، و[بلاك](/product/premium-wax-black)، و[برو](/product/premium-wax-pro): تثبيت ٥ من ٥

لو انت ماشي بدرجة ٣ والستايل مش قاعد معاك، الحل إنك تطلع لدرجة أعلى — مش إنك تحط كمية أكبر من نفس الدرجة. الرقم هو اللي بيفرق.

## يعني إيه ٣ و٤ و٥ عملياً

الرقم ده ترتيب بين منتجاتنا إحنا، مش مقياس عالمي. بنشره عشان تعرف انت بتشتري إيه بالظبط بدل كلام زي "تثبيت قوي" اللي كل حد بيكتبه.

- **٣ من ٥** — شكل مظبوط وطبيعي، وتقدر تعدّل فيه بإيدك بعد ما تحطه. ده مستوى كل [الجل](/shop/gel) عندنا.
- **٤ من ٥** — أعلى شوية، ومعاه فينيش أنعم. [زبدة الشيا](/product/premium-wax-shea) و[الأرجان](/product/premium-wax-argan) في الدرجة دي.
- **٥ من ٥** — أعلى حاجة عندنا. بيمسك الشكل من أول مرة، وبيحتاج منك كمية أقل عشان كده. [برو إكس](/product/premium-wax-pro-x) و[بلاك](/product/premium-wax-black) و[برو](/product/premium-wax-pro).

لو عمرك ما جربت غير درجة واحدة، انت متعرفش الفرق أصلاً — والفرق بين ٣ و٥ أوضح بكتير من الفرق بين كمية وكميتين من نفس المنتج.

## واكس ولا جل — الفرق الحقيقي

مش مسألة أنهي أحسن. الاتنين شغالين بطريقة مختلفة تماماً.

**[الواكس](/shop/wax)** — ١٢٠ مل بـ ٤٥ جنيه. بيتحط على شعر شبه ناشف، وبيدي تكستشر وشكل تقدر تعدّله. الفينيش بيختلف من واحد للتاني: [برو إكس](/product/premium-wax-pro-x) بتركيبة Wave & Groom بلمعة طبيعية (وكان بـ ٥٥ وبقى ٤٥)، [بلاك](/product/premium-wax-black) مطفي بصفر لمعة، [زبدة الشيا](/product/premium-wax-shea) بفينيش ناعم، [الأرجان](/product/premium-wax-argan) مغذي، و[برو](/product/premium-wax-pro) لليومي.

**[الجل](/shop/gel)** — ٢٥٠ مل بـ ٤٠ جنيه، وكله تثبيت ٣ من ٥، وكله متسجل عندنا للشعر المفرود. بيتحط على شعر مبلول. الفرق بين التلاتة في الشكل والريحة مش في الدرجة:

- [جل جولدن](/product/premium-gel-golden) — ويت لوك ولمعة عالية
- [جل أخضر](/product/premium-gel-green) — ريحة نضيفة
- [جل أزرق](/product/premium-gel-blue) — الكلاسيك، الوصف بتاعه عندنا "لطول اليوم"

## اعرف نوع شعرك الأول

قبل ما تختار درجة، لازم تعرف انت بتتكلم عن أنهي شعر. نفس المنتج بالظبط اللي بيمسك تمام مع واحد ممكن يوقّع شعر التاني في نص ساعة — والفرق مش في المنتج، الفرق في الشعر نفسه.

الحكاية مش بس مفرود ولا كيرلي. الكثافة كمان بتفرق، وأحياناً بتفرق أكتر:

- [الشعر الناعم المفرود](/hair-types/straight) — ليه اختيار مختلف تماماً عن باقي الأنواع، وشرحناه بالتفصيل هناك
- [الشعر الخفيف](/hair-types/fine) — الكلام هنا عن الحجم أكتر من التثبيت
- [الشعر الكثيف](/hair-types/thick) — الكثافة لوحدها بتغيّر الدرجة اللي محتاجها
- [الشعر المتموج](/hair-types/wavy) و[الكيرلي](/hair-types/curly) و[الخشن](/hair-types/coily) — كل واحد ليه تركيبة مختلفة

كل صفحة فيهم مكتوب فيها المشكلة الأساسية للنوع ده، والمنتج المناسب ليه، والحاجة اللي تبعد عنها. لو مش متأكد انت مين فيهم، ابدأ من [أنواع الشعر](/hair-types) واقرا الوصف — أغلب الرجالة بيعرفوا نفسهم من أول سطرين.

## تثبيت ٥ إمتى يبقى ضروري

مش كل يوم محتاج درجة ٥. لو يومك مكتب ومكيف وقاعد، جل درجة ٣ هيكفيك تماماً وهيبقى أخف على شعرك.

بس في حالات تستاهل إنك تطلع لأعلى درجة عندك:

- **يوم طويل بره البيت** — من الصبح لبعد المغرب، بين الشمس والمواصلات
- **[شعر كثيف](/hair-types/thick)** — الكثافة نفسها بتحتاج درجة أعلى
- **شغل فيه حركة أو وقوف** — العرق والحركة بيرخّوا الستايل
- **مناسبة أو تصويرة** — لما مينفعش الشكل يقع في نص اليوم
- **شعر عنيد بيرجع لشكله الأصلي** — محتاج تثبيت يغلبه من أول مرة

القاعدة البسيطة: **لو الستايل بيقع عندك بالظهر، الحل تثبيت أقوى — مش كمية أكبر.**

كل [الواكس](/shop/wax) عندنا ١٢٠ مل بـ ٤٥ جنيه، وكل [الجل](/shop/gel) ٢٥٠ مل بـ ٤٠ جنيه. يعني إنك تجرب درجة أعلى مش قرار غالي.

## الروتين اللي بيخلي الستايل يقعد

المنتج الصح بيوصلك نص الطريق. النص التاني طريقة الحط نفسها — وده اللي أغلب الناس بتغلط فيه.

**١. نشّف الأول، وشعرك شبه ناشف**

الواكس بيمسك أحسن بكتير على شعر شبه ناشف. نشّفه بالفوطة، وبعدين دقيقة سشوار على درجة خفيفة. الجل هو الاستثناء الوحيد: بيتحط على الشعر المبلول.

**٢. كمية أقل مما تتخيل**

ابدأ بحجم حبة الحمص. دفّيها بين إيديك لحد ما تبقى شفافة، وابدأ من ورا لقدام. تقدر تزود بعدين — بس مش هتقدر تشيل.

**٣. من الجذور، مش من الأطراف**

التثبيت بييجي من الجذر. ادفع المنتج عند القاعدة وارفع لفوق، بدل ما تمسح بيه على السطح وتطلع لمعة وخلاص. الشعر بيقع من عند الجذر، فلو الجذر مش مثبت، الباقي مش هيفرق.

**٤. سيبه يستقر ومتلعبش فيه**

بعد ما تخلص، سيب إيدك من شعرك. كل مرة بتعدّي إيدك في شعرك على مدار اليوم بتفك التثبيت وبتنقل زيت إيدك للشعر. ده لوحده بيوقّع الستايل بدري.

## لو الجو حر ورطوبة

الصيف في مصر امتحان حقيقي لأي تصفيف، وأي كلام عن التثبيت مبيحسبش حساب الحر ده كلام نظري.

العرق بينزل من الفروة وبيرخّي المنتج من عند الجذر — من نفس المكان اللي هو المفروض ماسك منه. والرطوبة العالية بتخلي الشعر المتموج والكيرلي ينفش حتى لو كان مثبت.

اللي بيشتغل فعلاً في الجو ده:

- **اطلع درجة فوق في الصيف**. لو الشتا ماشي معاك بـ ٤، جرب ٥.
- **ابعد عن اللمعة الزيادة**. الشعر اللامع + العرق = منظر دهون. لو يومك بره وحر، [واكس بلاك](/product/premium-wax-black) المطفي بصفر لمعة بيريحك من الحتة دي.
- **متحطش كمية تانية فوق الأولى في نص اليوم**. المنتج اللي على شعرك اتخلط بالعرق والزيت — لو زودت فوقه هيبقى تقيل ولزج، مش مثبت.
- **قلل السشوار الحامي**. الشعر اللي طالع من حرارة عالية بيمتص رطوبة الجو أسرع.
- **اغسل الشعر قبل ما تحط تاني**. المنتج بيتراكم مع العرق، والبداية النضيفة بتفرق أكتر من أي كمية زيادة.

## أسئلة بتتسأل كتير

**ليه الستايل بيقع بعد ساعتين من التصفيف؟**

غالباً لواحد من تلاتة: درجة التثبيت أقل من اللي شعرك محتاجه، أو حاطط كمية كبيرة فبقى تقيل وواقع بوزنه، أو حاطط واكس على شعر مبلول والواكس مش مصمم للمبلول. جرب درجة أعلى بكمية أقل الأول — ده بيحل أغلب الحالات.

**أزود الكمية ولا أغير المنتج؟**

غيّر لدرجة تثبيت أعلى. الكمية الزيادة بتزود الوزن مش المسك، والشعر التقيل بيقع أسرع. الفرق بين تثبيت ٣ وتثبيت ٥ أكبر بكتير من الفرق بين كمية وكميتين.

**عندكم كريم أو طين (clay) أو بوميد؟**

لأ. عندنا ٥ أنواع واكس و٣ أنواع جل بس — مفيش كريم، ولا طين، ولا بوميد، ولا شامبو. بنفضل نقولها بدل ما نبيعلك حاجة على إنها حاجة تانية. لو محتاج تكستشر مطفي بدل الطين، [واكس بلاك](/product/premium-wax-black) أقرب حاجة ليه عندنا.

**إيه أقوى منتج عندكم في التثبيت؟**

تلاتة كلهم تثبيت ٥ من ٥: [برو إكس](/product/premium-wax-pro-x) للمتموج والكثيف بلمعة طبيعية، [بلاك](/product/premium-wax-black) للناعم والخفيف بصفر لمعة، و[برو](/product/premium-wax-pro) للكثيف والمفرود لليومي. الاختيار بينهم بيعتمد على [نوع شعرك](/hair-types) والفينيش اللي عايزه، مش على قوة أكتر.

**الطلب والتوصيل شغالين إزاي؟**

الدفع عند الاستلام، وبنوصل داخل مصر بس. الشحن ٣٠ جنيه، ومجاني لو الطلب فوق ٣٠٠ جنيه. تقدر تشوف [كل التشكيلة](/shop) وتطلب من الموقع على طول.',
   'assets/wax-black.webp', 'Star Seven Premium Wax Black', '', 'premium-wax-pro-x',
   'published', now()),
  ('make-your-style-last-all-day', 'en', 'lasts-all-day',
   'Your style drops after two hours — here is why, and how to fix it',
   'Your style drops two hours after you style it? The problem is not how much you used — it is the hold level. A practical guide for men in Egypt.',
   'You stand in front of the mirror in the morning, get your hair exactly where you want it, and walk out happy. By half past ten you catch yourself in a car mirror and the whole thing has dropped — flat on the forehead, sides gone soft, as if you never touched it.

That is not bad luck, and it is not because your hair is "difficult". There is a clear reason a style does not hold, and the fix is not using more product.

## The problem is not the product — it is the hold level

When a style drops, most men do one of two things: use a bigger scoop of the same product, or buy something else and hope the next one grips. Both are usually wrong.

A bigger scoop does not add hold. It adds weight — and heavy hair falls faster, not slower. You end up making the problem worse.

One thing decides whether the shape survives the day: **the hold level**. We publish it as a number out of 5 on every product, so you can see it before you buy instead of guessing at phrases like "strong hold":

- [Our gels](/shop/gel) — Golden, Green and Blue: hold 3 out of 5
- [Shea Butter wax](/product/premium-wax-shea) and [Argan wax](/product/premium-wax-argan): hold 4 out of 5
- [Pro X](/product/premium-wax-pro-x), [Black Matte](/product/premium-wax-black) and [Pro](/product/premium-wax-pro): hold 5 out of 5

If you are on a 3 and the style will not stay, move up a level — do not use twice as much of the same level. If you are still choosing between the two formats, [wax and gel work differently](/article/wax-or-gel) and that is worth reading first.

## Work out your hair type first

Before you pick a level, know what you are working with. The exact same product that holds one man''s hair all day drops another man''s in half an hour, and the difference is the hair, not the product.

It is not only straight versus curly either. Density matters just as much:

- [Straight hair](/hair-types/straight) — a different choice from every other type
- [Fine hair](/hair-types/fine) — about volume more than grip
- [Thick hair](/hair-types/thick) — density alone changes the level you need
- [Wavy](/hair-types/wavy), [curly](/hair-types/curly) and [coily](/hair-types/coily) hair — each has its own texture to work with

Every one of those pages says what the main problem is for that type, which product suits it, and what to stay away from. Not sure which you are? Start at [hair types](/hair-types) — most men recognise themselves in the first two lines.

## Fine hair: why it drops faster than anything else

Fine hair is the type that disappoints people most. Each strand is thinner, so there is less for product to hold on to, and any given scoop is proportionally much heavier on fine hair than on thick hair. Weight is the whole problem.

That is why the usual instinct backfires here. More product means flat by noon, and shiny product reads as greasy rather than styled.

What works is a small amount of something with a high hold number and no shine. [Black Matte](/product/premium-wax-black) is hold 5 out of 5 with zero shine, and it is the one we list for [fine](/hair-types/fine) and straight hair. The high number lets you use less, and the matte finish keeps hair looking like hair.

## Thick hair: it collapses under its own weight

Thick hair has the opposite problem. There is plenty for product to grip, but the mass itself is heavy and gravity works on it all day. A hold 3 gel can shape thick hair beautifully at 8am and simply cannot carry it past lunchtime.

This is the clearest case for the top of the range. [Pro X](/product/premium-wax-pro-x) is hold 5 out of 5 with a natural finish, listed for wavy and [thick](/hair-types/thick) hair. [Pro](/product/premium-wax-pro) is also 5 out of 5, listed for thick, straight and wavy. For a softer finish, [Shea Butter](/product/premium-wax-shea) sits at 4 out of 5 and is listed for coily, curly and thick hair.

## When you actually need hold 5

Not every day needs a 5. In an air-conditioned office, mostly sitting, a hold 3 gel is genuinely enough and feels lighter on your hair.

Some days earn the top of the range:

- **A long day out** — morning until well after sunset, between the sun and the commute
- **[Thick hair](/hair-types/thick)** — the density on its own needs a higher level
- **A job with movement or standing** — sweat and motion loosen a style
- **An event, or photos** — days where the shape cannot drop halfway through
- **Stubborn hair** that springs back to its natural shape

The simple rule: **if your style drops by midday, go up a hold level — not up in quantity.**

Every [wax](/shop/wax) is 120ml at 45 EGP and every [gel](/shop/gel) is 250ml at 40 EGP, so trying a level up is not an expensive experiment.

## The routine that makes a style stay

The right product gets you halfway. The other half is how you put it in.

**1. Dry first, mostly**

Wax grips far better on hair that is almost dry. Towel it off, then a minute of low heat. Gel is the exception: it goes on damp, because the water is part of how it spreads and sets.

**2. Less than you think**

Start with a pea-sized amount and warm it between your palms until it turns clear, then work from the back forward. You can always add more; you cannot take it out. There is more on [how much wax to use](/article/how-much-wax-to-use) if you want the detail.

**3. Roots, not just tips**

Hold lives at the base. Push the product in at the roots and lift as you go, instead of smoothing it across the surface, which only gives you shine. Hair falls from the root — if the root has nothing in it, the rest will not save you.

**4. Set it, then leave it alone**

Once you are done, hands out. Every pass of your fingers breaks the shape and moves oil from your hands into your hair. That habit alone drops styles early.

## Egyptian summer: heat and humidity

Summer here is a real test, and advice about hold that ignores the heat is theory. Sweat comes off the scalp and loosens product right at the root — the exact place the hold comes from. High humidity puffs up wavy and curly hair even when it is held.

What actually helps:

- **Go up one level in summer.** If a 4 carries you through winter, try a 5.
- **Cut the shine.** Shiny hair plus sweat looks greasy, not styled. Outdoors on a hot day, the zero-shine [Black Matte](/product/premium-wax-black) takes that off the table.
- **Do not add a second layer at midday.** What is on your hair has mixed with sweat and oil; adding more makes it heavy and sticky, not held.
- **Go easier on hot blow-drying.** Hair coming off high heat takes up moisture from the air faster.
- **Wash before you restyle.** A clean start beats any extra scoop.

## Common questions

**Why does my style drop two hours after I style it?**

Usually one of three things: the hold level is below what your hair needs, you used too much and it is falling under its own weight, or you put wax on wet hair, which it is not designed for. Try a higher level with a smaller amount first.

**Should I use more, or switch product?**

Switch to a higher hold level. More product adds weight, not grip. The gap between hold 3 and hold 5 is far bigger than the gap between one scoop and two.

**Do you sell cream, clay or pomade?**

No. We make 5 waxes and 3 gels, and that is the whole range — no cream, no clay, no pomade, no shampoo, no cologne. We would rather say so than sell you one thing as another. If you want a matte texture instead of clay, [Black Matte](/product/premium-wax-black) is the closest thing we have.

**What is your strongest product?**

Three share the top level, all hold 5 out of 5: [Pro X](/product/premium-wax-pro-x) for wavy and thick hair with a natural finish, [Black Matte](/product/premium-wax-black) for fine and straight hair with zero shine, and [Pro](/product/premium-wax-pro) for thick and straight hair. Choosing between them comes down to [your hair type](/hair-types) and the finish you want, not to more strength.

**How do ordering and delivery work?**

Cash on delivery, and we deliver inside Egypt only. Shipping is 30 EGP, free on orders over 300 EGP. You can see [the full range](/shop) and order straight from the site, or read [who we are](/brand) first.',
   'assets/wax-black.webp', 'Star Seven Premium Wax Black', '', 'premium-wax-pro-x',
   'published', now()),
  ('matte-or-shine', 'ar', 'matte-or-shine',
   'واكس مطفي ولا لامع للرجالة؟ اختار على حسب شكلك',
   'الفرق بين الواكس المطفي (المات) واللمعة والويت لوك، ومين فيهم يناسبك — بلاك بتثبيت ٥ من ٥ من غير لمعة، والجل الجولدن للمعة العالية.',
   'تصفيف الشعر للرجالة مش قرار واحد، ده قرارين. بتحط الواكس الصبح وتخرج، وبعد ساعتين تبص في المراية تلاقي شعرك بيلمع لمعة مالكش دعوة بيها — أو العكس تمامًا: عايز اللمعة دي بالظبط، وكل حاجة بتجربها بتطلع باهتة وشكلها ناشف.

المشكلة مش في إيدك ولا في طريقة اللف. المشكلة إنك بتختار المنتج على أساس قوة التثبيت بس، وسايب نص القرار التاني: النهاية — مطفي ولا لامع. ودي الحاجة اللي بتحدد شكلك في الشارع أكتر من رقم التثبيت نفسه.

## مطفي يعني إيه ومين محتاجه

المطفي — والناس بتقول عليه **مات** كمان، والاتنين نفس الحاجة — معناه إن المنتج مبيعكسش الضوء. تحط، تسرّح، والشعر يفضل شكله طبيعي كإنك مش حاطط حاجة أصلًا، مع إنه مثبّت.

خلي بالك من نقطة مهمة: مطفي مش معناه ناشف. الشعر بيفضل لين ولمسته عادية، اللي راح بس هو اللمعان.

ومين محتاجه بالظبط؟

- اللي شغله رسمي أو قدام ناس طول اليوم ومش عايز منظر "لسه خارج من الحمام"
- اللي عايز تكستشر وشكل مبعثر مظبوط، مش شكل مسرّح ولامع
- اللي شعره بيتدهّن بدري واللمعة الزيادة بتفضحه
- اللي بيصوّر نفسه كتير — الفلاش والنور القوي بيكبّروا أي لمعة

لو انت من دول، الواكس [بلاك المطفي](/product/premium-wax-black) هو اللي عليه الدور — تثبيت ٥ من ٥ ولمعة صفر، ١٢٠ مل بـ ٤٥ جنيه.

## اللمعة بتعمل إيه في شكل الشعر

اللمعة مش صفة مكتوبة على العلبة وخلاص، دي طريقة الضوء بيترد بيها من على شعرك. السطح اللامع بيرجّع الضوء في اتجاه واحد، فالعين بتشوف الشعر كأنه قطعة واحدة مصمتة ومرتبة. السطح المطفي بيبعتر الضوء، فالعين بتفرّق بين الشعرة واللي جنبها — وده بالظبط اللي بنسميه تكستشر.

وعشان كده نفس التسريحة بالظبط ممكن تبان مرتبة ولامعة، وممكن تبان مبعثرة وفيها تكستشر — من غير ما تغيّر حاجة في قوة التثبيت. القرار في النهاية بس.

وكل نوع شعر بيتفاعل مع القاعدة دي بشكل مختلف: الكثافة وشكل الكيرلة هما اللي بيقرروا اللمعة تبقى في صفك ولا ضدك. لو مش متأكد من نوع شعرك أو من المنتج المتظبط ليه، ابدأ من [أنواع الشعر](/hair-types) — كل نوع ليه صفحة بتحسم الاختيار، زي [الشعر الخفيف](/hair-types/fine) اللي ليه قواعد مختلفة تمامًا عن غيره.

## اللمعة والويت لوك: مين تناسبه

مش كل الناس عايزة مطفي، ومفيش حاجة غلط في اللمعة. اللوك المرتّب اللامع — الويت لوك — لسه هو اللوك الرسمي الأول في مصر: فرح، شغل، مناسبة، سشوار جنب مظبوط.

اللمعة بتناسب:

- التسريحات الكلاسيك بفرق جنب
- الشعر اللي عايزه يبان ملموم ومحدد الخط
- المناسبات اللي عايز فيها شكل واضح إنك مصفف شعرك

بس اعرف حاجة: لو شعرك بيتدهّن بسرعة، اللمعة هتخلي الدهون تبان أسرع، لأن العين مش هتفرق بين لمعة المنتج ولمعة الزيت. في الحالة دي إما تروح على المطفي، أو تقلل الكمية وتبعد عن الجذور خالص.

اللي بيدي الويت لوك عندنا هو [الجل الجولدن](/product/premium-gel-golden) — ٢٥٠ مل بـ ٤٠ جنيه، تثبيت ٣ من ٥ ولمعة عالية.

وفيه سؤال بيتكرر هنا: أنا شعري مفرود، آخد بلاك ولا جولدن؟ الاتنين متظبطين للشعر المفرود، فالحسم مش في نوع الشعر — الحسم في النهاية اللي انت عايزها. عايز مرتّب ولامع؟ جولدن. عايز مطفي وفيه تكستشر؟ بلاك. ولو عايز الصورة الكاملة للشعر المفرود من ناحية التثبيت والوزن، [صفحة الشعر المفرود](/hair-types/straight) هي اللي بتشرحها.

## بلاك مقابل الجل الجولدن

الفرق بينهم مش في القوة بس، دول منتجين مختلفين في كل حاجة:

- **الشكل النهائي** — بلاك مطفي تمامًا بدون أي لمعة. الجولدن لمعة عالية وويت لوك واضح.
- **التثبيت** — بلاك ٥ من ٥. الجولدن ٣ من ٥.
- **نوع الشعر** — بلاك للشعر الخفيف والمفرود. الجولدن للشعر المفرود.
- **النوع والحجم والسعر** — بلاك واكس ١٢٠ مل بـ ٤٥ جنيه. الجولدن جل ٢٥٠ مل بـ ٤٠ جنيه.

يعني ببساطة: عايز تكستشر وحجم من غير ما حد يعرف إنك حاطط حاجة؟ بلاك. عايز شكل مرتّب لامع؟ جولدن.

ونصيحة من عندنا، مش مواصفة مكتوبة على المنتج: ابدأ بكمية صغيرة قوي وزوّد بعد كده لو محتاج. الرجوع من كمية قليلة سهل، لكن لما تزوّد من الأول مفيش حل غير إنك تغسل وتبدأ تاني. ولو لسه محتار بين النوعين أصلًا، اتفرج على [الواكس كله](/shop/wax) و[الجل كله](/shop/gel) وقارن التثبيت والنهاية جنب بعض.

## بصراحة: الطين والمعجون لسه مش عندنا

كتير بيسأل: عندكم كلاي (طين) ولا بيست؟ الرد: لأ.

عندنا ٥ أنواع واكس و٣ أنواع جل، وخلاص. مفيش كلاي، مفيش معجون، مفيش كريم، ومفيش بوميد. مش هنقولك إن الواكس ده "كلاي" عشان نبيع، ومش هنخترع اسم لمنتج مش موجود.

واللي بيسأل على الكلاي، لما نسأله عايزه ليه، الرد اللي بيتكرر هو نفسه: عايز شكل مطفي وفيه تكستشر. لو ده اللي انت وراه فعلًا، أقرب حاجة عندنا هي بلاك المطفي — تثبيت ٥ من ٥ ولمعة صفر — بس هو واكس، مش طين. ولو مصمم على كلاي بالذات، عادي، مش عندنا.

## أسئلة بتتسأل كتير

**المطفي والمات نفس الحاجة؟**

أيوة. مطفي هي الكلمة العربي، ومات هي الكلمة الإنجليزي (matte) اللي دخلت العامية. الاتنين معناهم منتج مبيلمعش.

**ممكن أخلي الواكس اللامع مطفي؟**

مش بجد. تقدر تقلل اللمعة شوية لو قلّلت الكمية، بس اللمعة جزء من التركيبة نفسها ومش هتشيلها. لو عايز مطفي فعلًا، اشتري منتج مطفي من الأول.

**أقدر أحط واكس وجل مع بعض؟**

مفيش مانع، وناس بتعمل كده عشان تجمع بين تثبيت وشكل. بس خد بالك من حاجة واحدة: لو الجولدن داخل في المعادلة، لمعته هتفضل باينة — فمش هتوصل لشكل مطفي. لو هدفك المطفي، خليك على بلاك لوحده.

**شعري كثيف وعايز مطفي، أعمل إيه؟**

بلاك متظبط للشعر الخفيف والمفرود، مش للكثيف. لو شعرك كثيف، ابدأ من [صفحة أنواع الشعر](/hair-types) وقارن التثبيت والتركيبة قبل ما تختار.

**الشحن والدفع بيتم إزاي؟**

الشحن ٣٠ جنيه، ومجاني فوق ٣٠٠ جنيه. الدفع عند الاستلام كاش، والتوصيل داخل مصر.',
   'assets/wax-black.webp', 'Star Seven Premium Wax Black', '', 'premium-wax-black',
   'published', now()),
  ('wax-or-gel', 'en', 'wax-or-gel',
   'Hair wax or gel for styling men''s hair — the real difference',
   'Wax stays flexible and gives texture. Gel dries into a cast and locks one shape. How to pick for styling men''s hair, by hold level and finish.',
   'You bought something to style your hair, and by the afternoon the style was gone — or it set so hard that touching it cracked it into pieces. That is not bad luck. It is almost always the wrong format: styling wax where you needed gel, or gel where you needed wax.

This is the difference between hair styling wax and hair gel for men, said plainly, with nothing sold in between.

## The short answer

Wax is flexible. You can put your hands back through it, push a piece somewhere else, and it goes. It sits on the hair and adds texture and a little weight, and it stays workable all day.

Gel sets. It picks one shape, dries into it, and defends that shape. You do not restyle gel — you re-wet it or you wash it out.

So the question is not which one is better. The question is what you want your hair to do for the rest of the day:

- **Texture and separation you can still adjust at four in the afternoon** — wax.
- **One shape, set and then left alone, especially slicked back or slicked to the side** — gel.
- **Grip and body without a hard shell on top** — wax.
- **Hold on hair that has never held anything** — gel.

Which of the two suits you personally depends on your hair, and that decision is made properly on the [hair types guide](/hair-types), where each of the six types gets its own answer and its own product. This article is about the two formats themselves — what they do, what they cost, and how to use them without wasting half the tub.

## What wax actually does

Wax coats the strand. That coating does three jobs at once: it adds grip, so pieces of hair hold on to each other instead of sliding apart; it adds a small amount of weight, so the shape stays where you put it; and it adds texture, so the hair reads as styled rather than merely combed.

The important part is what it never does. Wax does not fully harden. An hour after you styled it, the product is still negotiable — you can move a piece, flatten a bit that stuck up, or rebuild the whole front with your fingers and no water.

That is the entire appeal of the format, and it is also its limit. Wax will never give you a mirror-flat slick, because it was not built to lock anything down. It was built to hold a shape loosely enough that you can keep editing it.

## What gel actually does

Gel goes on wet, spreads through the hair, and dries. What you have once it dries is a cast — a thin shell holding every strand exactly where it was at the moment it set. That is why gel wins on slick styles and on hair that otherwise refuses to stay put.

It also has one property wax cannot match: once dry, it adds no meaningful weight. You get hold without anything sitting on top of the hair pressing it down.

Gel is the more forgiving format to apply, too, because you are working on damp hair and you can comb the whole thing into place before anything sets. Wax asks you to get it right the first time.

The trade-off is honest: once gel is dry, that shape is the shape. Run your hands through it and you have broken the cast. Some men love that certainty. Some men cannot stand it. Better to know which one you are before you spend the money.

## Hold level is the number that matters

Every product we sell publishes a hold level out of 5. It is the most useful number on the page and far more honest than any adjective.

- **Level 5** — the strongest hold we make: [Pro X](/product/premium-wax-pro-x), [Black Matte](/product/premium-wax-black) and [Pro](/product/premium-wax-pro), all in the [wax range](/shop/wax).
- **Level 4** — strong, but softer and easier to reshape: [Shea Butter](/product/premium-wax-shea) and [Argan](/product/premium-wax-argan).
- **Level 3** — all three [gels](/shop/gel): [Golden](/product/premium-gel-golden), [Green](/product/premium-gel-green) and [Blue](/product/premium-gel-blue).

Read those numbers within a format, not across them. The five waxes are numbered against the other waxes; the three gels are numbered against the other gels. The level tells you where a product sits inside its own format, and that is all it is telling you.

## Finish is a separate decision from hold

Two products can have the same hold level and look completely different in daylight, so pick the finish on purpose rather than by accident.

- **Zero shine, matte** — [Black Matte](/product/premium-wax-black). Nothing in the range is more matte. If you want the style to look like hair rather than like product, this is the one.
- **Natural finish** — [Pro X](/product/premium-wax-pro-x), built on the Wave & Groom formula.
- **Soft finish** — [Shea Butter](/product/premium-wax-shea).
- **Nourishing** — [Argan](/product/premium-wax-argan).
- **High shine, wet look** — [Golden gel](/product/premium-gel-golden). This is a deliberate wet look, not an accident of application.
- **Classic, all day** — [Blue gel](/product/premium-gel-blue). [Green gel](/product/premium-gel-green) is the same hold with a clean scent.

Finish is the part that photographs lie about. Under a shop light almost everything looks glossy. In daylight, the gap between matte and high shine is the gap between looking styled and looking wet, and that gap is bigger than any one hold level.

## Size and price, and why the two formats differ

Every wax is 120ml at 45 EGP. Every gel is 250ml at 40 EGP. [Pro X](/product/premium-wax-pro-x) was 55 EGP and is currently 45 EGP like the rest of the waxes.

The gel comes in the bigger jar at the lower price, and that is not a discount — it is how the two formats get used. Gel is spread through wet hair across the whole head in one go. Wax is warmed between the palms and worked into specific sections a little at a time. Different jars for different handfuls.

If you want to see everything side by side: [all the waxes](/shop/wax), [all the gels](/shop/gel), or [the full wax and gel range](/shop).

## What we do not sell — and why we are telling you

We sell five waxes and three gels. That is the entire catalogue. There is no cream, no clay, no pomade, no shampoo, no cologne.

If a grooming article tells you your hair needs a clay, we do not have one, and we would rather say that than sell you a wax with a clay-shaped description on it. A short range you can actually understand beats a long one you cannot. What the brand does and does not carry is set out on [the brand page](/brand).

## How to use it without wasting half the tub

- Wax goes on **dry or towel-dry** hair. Warm a small amount between your palms first — cold wax drags and lands in clumps.
- Gel goes on **damp** hair. Comb it into shape, then leave it alone while it sets.
- Start with less than you think you need. You can always add more. You cannot take it back out without washing.
- Work from the back forward and from the roots outwards, instead of dumping everything onto the front and running out before you reach the crown.
- Do not restyle gel once it has dried. Wet the hair again first, or you are just breaking the cast and losing the hold you paid for.

## When people blame the product and it was the method

Four things go wrong far more often than a bad tub does.

**Too much product.** More is not more hold. Past a certain point you are adding weight rather than grip, and weight pulls a style down instead of holding it up.

**The wrong wetness.** Wax on soaking hair slides around and never grabs. Gel on dry hair goes on patchy and flakes off later.

**Restyling a dry cast.** Gel breaking when you rake your fingers through it at lunchtime is gel behaving exactly as described, not gel failing.

**Buying by the picture.** The photo on the tub shows a model''s hair on a photographer''s day. The hold level and the finish line on the product page will tell you more about your morning than the picture ever will.

## Frequently asked questions

**Can I use wax and gel together?**

Yes, and it is a common move: gel at the roots and sides to lock the base, then a small amount of wax through the top for texture and separation. Do the gel first, while the hair is still damp, and add the wax once it has set.

**Which is the strongest hold you sell?**

Three waxes are level 5 out of 5: Pro X, Black Matte and Pro. Shea Butter and Argan are level 4. All three gels are level 3. Those are the numbers the brand publishes per product, and we do not dress them up beyond that.

**What size are they and how much do they cost?**

Every wax is 120ml at 45 EGP. Every gel is 250ml at 40 EGP. Pro X was 55 EGP and is currently 45 EGP.

**How does delivery work?**

Delivery is 30 EGP anywhere in Egypt, and it is free on orders over 300 EGP. Payment is cash on delivery only, and we ship inside Egypt only.

**My hair always looks greasy by the afternoon. Does that rule out wax?**

Not by itself — greasy-looking is usually a finish question before it is a format question. The high-shine and softer options will read as wet on you fastest, and the matte option will read as hair. That is a comment on how a finish looks once it is on your head, not scalp advice. If it is your scalp itself that is bothering you, that is a question for a doctor and not for a hair-wax shop.',
   'assets/wax-red.webp', 'Star Seven Premium Wax Pro X', '', '',
   'published', now()),
  ('wax-or-gel', 'ar', 'wax-or-gel',
   'واكس ولا جل؟ الفرق الحقيقي وأنهي واحد لتصفيف شعرك',
   'مقارنة صريحة بين الواكس والجل لتصفيف شعر الرجالة — الفرق في التثبيت، في اللمعة، ودرجات التثبيت بالأرقام لكل منتج في التشكيلة.',
   'انت واقف قدام المراية، حاطط منتج على شعرك، وبعد ساعتين الاستايل وقع خالص — أو العكس، الشعر بقى ملزوق ومرصوص وكإنه حاجة تانية. المشكلة مش إن المنتج "وحش"، المشكلة إنك مستخدم النوع الغلط لتصفيف شعرك، أو استخدمت النوع الصح بكمية غلط.

المقال ده بيحل السؤال ده مرة واحدة: الواكس والجل الفرق بينهم إيه فعلاً، ومين فيهم يثبّت شعرك انت بالذات. مش كلام عام — إحنا بنعمل النوعين الاتنين، وبننشر درجة التثبيت بالرقم على كل منتج، فنقدر نتكلم بأرقام مش بوعود.

## الفرق العملي بين الواكس والجل

الفرق مش في العلبة ولا في الاسم. الفرق في اللي بيحصل بعد ما تحط المنتج وتمشي.

**الواكس بيفضل طري.** تقدر ترجع تعدّل الاستايل بإيدك بعد ساعة والشعر يستجيب معاك. الشكل مش مقفول، وانت اللي ماسكه لآخر اليوم.

**الجل بيقفل.** بيمسك الشكل وهو بينشف، ولما ينشف يبقى خلاص. لو رجعت تحرّك فيه بإيدك، الاستايل بيتفك ومش بيرجع زي ما كان من غير ما تبلّل الشعر تاني.

النتيجة العملية للفرق ده:

- **الواكس** = قابل للتعديل طول اليوم، بيدي تقل وتكستشر وحجم.
- **الجل** = شكل واحد بالظبط ومرصوص، ما بيزوّدش تقل على الشعرة، بس مش رجعة فيه.

عشان كده الواكس بييجي **120 مل** والجل بييجي **250 مل** — مش عشوائي. الواكس بتاخد منه حبة قد نص فصّ الفول، الجل بتاخد منه أكتر. لو حسبتها بالسعر: [الجل](/shop/gel) بـ 40 جنيه لـ 250 مل، و[الواكس](/shop/wax) بـ 45 جنيه لـ 120 مل. الجل أرخص في المللي، الواكس أطول في العمر عشان الكمية اللي بتستهلكها منه أقل بكتير.

## التثبيت مقابل اللمعة — مش نفس الحاجة

دي أكتر نقطة الناس بتخلط فيها. حد يقول لك "الجل ده تثبيته جامد" وهو أصلاً بيتكلم عن اللمعة، مش عن التثبيت.

**التثبيت** = قد إيه الاستايل هيفضل في مكانه. ده رقم — من ١ لـ ٥، وإحنا كاتبينه على كل منتج.

**اللمعة** = قد إيه الشعر هيبان لامع أو مطفي. دي حاجة تانية خالص وملهاش أي علاقة بالتثبيت.

ممكن يكون عندك منتج تثبيته ٥ من ٥ ومطفي تماماً (زي [واكس بلاك](/product/premium-wax-black)). وممكن يكون عندك منتج لمعته عالية جداً وتثبيته ٣ من ٥ (زي [جل جولدن](/product/premium-gel-golden)). اللمعة العالية بتخدع العين وبتخلي الشعر يبان "متماسك" أكتر مما هو فعلاً — وبعد ساعتين تكتشف إن اللمعة لسه موجودة والاستايل راح.

يعني لما تختار، اختار على محورين مش محور واحد: **التثبيت اللي محتاجه** و**الشكل النهائي اللي عايزه**.

## درجات التثبيت في التشكيلة كلها: ٣ و٤ و٥

دي التشكيلة بالكامل بالأرقام، من غير لف ودوران:

- **[برو إكس](/product/premium-wax-pro-x) — واكس — تثبيت ٥ من ٥** — تركيبة Wave & Groom، شكل نهائي طبيعي. للشعر المتموج والكثيف. 45 جنيه بدل 55.
- **[واكس بلاك](/product/premium-wax-black) — تثبيت ٥ من ٥** — لمعة صفر، مطفي بالكامل. للشعر الخفيف والناعم المفرود.
- **[واكس برو](/product/premium-wax-pro) — تثبيت ٥ من ٥** — لليومي. للشعر الكثيف والمفرود والمتموج.
- **[واكس زبدة الشيا](/product/premium-wax-shea) — تثبيت ٤ من ٥** — شكل نهائي طري. للشعر الخشن والكيرلي والكثيف.
- **[واكس الأرجان](/product/premium-wax-argan) — تثبيت ٤ من ٥** — مغذّي. للكيرلي والخشن والمتموج.
- **[جل جولدن](/product/premium-gel-golden) — تثبيت ٣ من ٥** — مظهر مبلول ولمعة عالية.
- **[جل أخضر](/product/premium-gel-green) — تثبيت ٣ من ٥** — ريحة نضيفة.
- **[جل أزرق](/product/premium-gel-blue) — تثبيت ٣ من ٥** — كلاسيك، لطول اليوم.

الواكس كله 120 مل بـ 45 جنيه. الجل كله 250 مل بـ 40 جنيه.

من الليستة دي تلات ملاحظات تستاهل تتقال بصوت عالي:

**واحد: مفيش منتج جل عندنا تثبيته فوق ٣.** وده مقصود، مش نقص. لو محتاج تثبيت ٥، انت محتاج واكس مش جل. مفيش جل هنبيعهولك ونقول لك إنه هيثبّت زي الواكس.

**اتنين: [واكس بلاك](/product/premium-wax-black) هو الواكس الوحيد المطفي بلمعة صفر** في التشكيلة كلها. ده مش المنتج الوحيد للشعر المفرود — [واكس برو](/product/premium-wax-pro) كمان للمفرود — بس هو الوحيد اللي بيديك تثبيت ٥ من ٥ من غير أي لمعة على الإطلاق.

**تلاتة: مفيش عندنا كريم ولا طين (clay) ولا بوميد ولا شامبو ولا كولونيا.** التشكيلة تمن منتجات بس، خمس واكس وتلات جل، وخلاص. لو انت جاي تدوّر على طين، خلّيك عارف من دلوقتي إنه مش موجود هنا.

## نوع شعرك هو اللي بيحسم في الآخر

المحور اللي كل حاجة بتترتب عليه واحد: **قد إيه شعرك يستحمل وزن**. فيه شعر بياخد منتج له تقل ويستفيد منه، وفيه شعر بيتأثر من أول جرام زيادة ويقع على طول. الفرق ده هو اللي بيقرر واكس ولا جل قبل أي حاجة تانية — قبل اللمعة، وقبل الرقم اللي على العلبة.

بس مش هنلخّص لك نوعك في سطرين هنا وننهي الموضوع، لأن ده مش عدل. كل نوع ليه صفحة كاملة فيها المشكلة بتاعته بالظبط، والحاجة اللي المفروض تبعد عنها، والمنتج اللي بيتظبط معاه: [ناعم مفرود](/hair-types/straight) · [متموج](/hair-types/wavy) · [كيرلي](/hair-types/curly) · [خشن وأفرو](/hair-types/coily) · [خفيف](/hair-types/fine) · [كثيف](/hair-types/thick).

ولو نوع شعرك نفسه مش واضح لك، ابدأ من [صفحة أنواع الشعر](/hair-types) واختار اللي شبهك من الصور — دقيقة واحدة وتطلع بإجابة أوضح من أي مقارنة عامة.

## الكمية هي الفرق بين شكل حلو وشكل وحش

ده الجزء اللي محدش بيقوله لك: أغلب الشكاوى من منتجات التصفيف مش سببها المنتج، سببها إن الكمية أكتر من اللازم.

المنتج الزيادة ما بيتوزعش، فبيفضل قاعد على السطح. النتيجة شعر بيبان تقيل ومرصوص من نص اليوم، وواكس بيلمع أكتر مما انت عايز، وجل بيبان طبقة على الشعر بدل ما يبان استايل.

الحل مش تغيّر المنتج. الحل تقلل الكمية:

- **الواكس**: حبة قد نص فصّ الفول للشعر القصير، فصّ فول كامل للطويل. دوّبها بين إيديك الاتنين الأول لحد ما تبقى شفافة تقريباً، وبعدين حطها من نص الشعرة للأطراف.
- **الجل**: بيتوزع أحسن بكتير على شعر مبلول شوية. على شعر ناشف تماماً بيتجمّع في أماكن ويسيب أماكن.
- **في الحالتين**: ابدأ بكمية أقل من اللي في دماغك. تقدر تزوّد، مش هتقدر ترجّع.

ولازم نقولها بصراحة: [التشكيلة](/shop) بتاعتنا منتجات تصفيف وبس — شكل وتثبيت ولمعة. مش منتجات علاج ولا بنبيعها على إنها كده.

## إزاي تختار في ٣٠ ثانية

جاوب على تلات أسئلة:

**١. شعرك بياخد وزن ولا لأ؟** كيرلي، خشن، متموج، أو كثيف؟ روح على [الواكس](/shop/wax) على طول. ناعم مفرود؟ الجل مفتوح لك والواكس كمان — كمّل. شعر خفيف؟ روح على المطفي، يعني [واكس بلاك](/product/premium-wax-black).

**٢. عايز ترجع تعدّل الاستايل خلال اليوم؟** أيوة؟ واكس. لأ، عايز شكل واحد يقفل ويفضل؟ [جل](/shop/gel).

**٣. عايز لمعة ولا لأ؟** لمعة عالية ومظهر مبلول = [جل جولدن](/product/premium-gel-golden). لمعة صفر ومطفي = [واكس بلاك](/product/premium-wax-black). شكل طبيعي بينهم = [برو إكس](/product/premium-wax-pro-x).

تلات إجابات وتكون وصلت. ولو الإجابات وقعت على منتجين، خد الأرخص في الأول وجرّب — [إحنا](/brand) بنبيع كاش عند الاستلام عشان بالظبط السبب ده.

## أسئلة بتتسأل كتير

**أقدر أستخدم الواكس والجل مع بعض؟**

ينفع، بس مش مخلوطين في إيدك. الترتيب المنطقي: جل على الشعر المبلول عشان يبني الأساس والشكل، وبعد ما ينشف تماماً حبة واكس صغيرة جداً بين الصوابع للأطراف عشان التعريف. لو خلطتهم قبل ما تحطهم، النتيجة هتبقى كتلة مش هتتوزع كويس. ولو انت لسه بتجرب، ابدأ بواحد بس عشان تعرف مين اللي عمل الفرق.

**الواكس تثبيته ٥ يعني أقوى من الجل تثبيته ٣ في كل الحالات؟**

الرقم بيقول التثبيت، مش المناسبة. على شعر كثيف أو خشن، أيوة — الـ ٥ هيصمد والـ ٣ لأ. لكن على شعر ما بيستحملش وزن، الواكس التقيل ممكن يوقّع الشعر فتحس إن التثبيت أقل، والجل بتثبيت ٣ يطلع أحسن عملياً. الرقم مهم، بس نوع شعرك بيجي الأول — وده اللي [صفحات أنواع الشعر](/hair-types) بتحسمه.

**الجل هيسيب شعري ناشف؟**

الجل بينشف على الشعر — ده بالظبط اللي بيمسك بيه الشكل. الإحساس ده جزء من طريقة شغله، مش عيب فيه. لو مش مريحك، الواكس هو اللي يناسبك عشان بيفضل طري وما بينشفش على الشعرة.

**الجل عندكم ليه كله تثبيت ٣ من ٥؟**

عشان دي درجة التثبيت اللي بننشرها للتلاتة فعلاً، ومش هنكتب رقم أعلى عشان الليستة تبقى شكلها أحسن. [جولدن](/product/premium-gel-golden) و[الأخضر](/product/premium-gel-green) و[الأزرق](/product/premium-gel-blue) نفس التثبيت — الفرق بينهم في اللمعة والريحة والمظهر النهائي، مش في القوة.

**التوصيل بكام والدفع إزاي؟**

التوصيل 30 جنيه، ومجاني لو الطلب فوق 300 جنيه. الدفع كاش عند الاستلام بس. الشحن جوه مصر بس.',
   'assets/wax-red.webp', 'Star Seven Premium Wax Pro X', '', '',
   'published', now())
ON CONFLICT (slug, lang) DO UPDATE SET
  group_key    = EXCLUDED.group_key,
  title        = EXCLUDED.title,
  excerpt      = EXCLUDED.excerpt,
  body         = EXCLUDED.body,
  cover        = EXCLUDED.cover,
  cover_alt    = EXCLUDED.cover_alt,
  hair_type    = EXCLUDED.hair_type,
  sku          = EXCLUDED.sku,
  status       = EXCLUDED.status,
  updated_at   = now();
