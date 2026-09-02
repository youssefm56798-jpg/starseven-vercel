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
   'تثبيت قوي','Strong Hold',
   45.00, 55.00, '#D7291D', 'assets/wax-red.webp', 120, 4, 'wavy,thick', 200, TRUE, 1),

  ('S7-WAX-PUR','premium-wax-shea','wax',
   'واكس بريميوم بزبدة الشيا','Premium Wax Shea Butter',
   'ملمس ناعم · 120 مل · موف','Soft touch · 120ml · Purple',
   'زبدة الشيا','Shea Butter',
   45.00, NULL, '#8B4DC9', 'assets/wax-purple.webp', 120, 3, 'coily,curly,thick', 200, TRUE, 2),

  ('S7-WAX-BLU','premium-wax-argan','wax',
   'واكس بريميوم بالأرجان','Premium Wax Argan',
   'مغذي للشعر · 120 مل · أزرق','Nourishing · 120ml · Blue',
   'زيت أرجان','Argan Oil',
   45.00, NULL, '#2A6DE8', 'assets/wax-blue.webp', 120, 3, 'curly,coily,wavy', 200, TRUE, 3),

  ('S7-WAX-BLK','premium-wax-black','wax',
   'واكس بريميوم بلاك','Premium Wax Black',
   'بيغطي الشيب · 120 مل · أسود','Covers grey · 120ml · Black',
   'يغطي الشيب','Covers Grey',
   45.00, NULL, '#55524A', 'assets/wax-black.webp', 120, 3, 'white,wavy,thick', 200, TRUE, 4),

  ('S7-WAX-YEL','premium-wax-pro','wax',
   'واكس بريميوم برو','Premium Wax Pro',
   'قوي لليومي · 120 مل · أصفر','Daily strong · 120ml · Yellow',
   'برو هولد','Pro Hold',
   45.00, NULL, '#D9A81E', 'assets/wax-yellow.webp', 120, 4, 'thick,straight,wavy,fine', 200, TRUE, 5),

  ('S7-GEL-YEL','premium-gel-golden','gel',
   'جل بريميوم — جولدن','Premium Gel - Golden',
   'ويت لوك · 250 مل','Wet look · 250ml',
   'جولدن','Golden',
   40.00, NULL, '#D9A81E', 'assets/gel-yellow.webp', 250, 5, 'straight', 200, TRUE, 6),

  ('S7-GEL-GRN','premium-gel-green','gel',
   'جل بريميوم — أخضر','Premium Gel - Green',
   'ريحة نضيفة · 250 مل','Clean scent · 250ml',
   'فريش','Fresh',
   40.00, NULL, '#5E9C2B', 'assets/gel-green.webp', 250, 5, 'straight', 200, TRUE, 7),

  ('S7-GEL-BLU','premium-gel-blue','gel',
   'جل بريميوم — أزرق','Premium Gel - Blue',
   'طول اليوم · 250 مل','All day · 250ml',
   'كلاسيك','Classic',
   40.00, NULL, '#2A6DE8', 'assets/gel-blue.webp', 250, 5, 'straight', 200, TRUE, 8)
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

التثبيت قوي، ٤ من ٥ — أقوى واكس في التشكيلة. اللمعة طبيعية مش زجاجية، والملمس بيفضل مرن، فتقدر تعدّل الاستايل بإيدك في نص اليوم من غير ما تغسل شعرك.',
     'Pro X is the star of the line. The **Wave & Groom** formula was built for wavy and thick hair — the type that fights styling and loses its shape by midday. This wax defines the wave instead of flattening it.

Hold is strong, 4 out of 5 — the strongest of the waxes. The finish is natural rather than glassy, and the texture stays pliable, so you can reshape with your hands mid-day without washing.',
     'خد كمية بحجم حبة الفول على طرف صوابعك
افركها بين إيديك لحد ما تدفى وتبقى شفافة
وزّعها على شعر ناشف أو نص ناشف من الجذور للأطراف
ظبّط الاستايل بإيدك أو بمشط واسع السنون',
     'Take a pea-sized amount on your fingertips
Rub it between your palms until it warms and turns clear
Work it through dry or towel-dried hair, roots to ends
Shape with your hands or a wide-tooth comb',
     'تثبيت قوي — ٤ من ٥
تركيبة ويف آند جروم للشعر المتموج والتخين
لمعة طبيعية، مش زجاجية
برطمان ١٢٠ مل',
     'Strong hold — 4 out of 5
Wave & Groom formula for wavy and thick hair
Natural finish, not glassy
120ml jar'),
    ('S7-WAX-PUR',
     'الشعر الكيرلي والمجعّد بيفقد رطوبته أسرع من أي نوع تاني، وأغلب أنواع الواكس بتزوّد الجفاف. عشان كده التركيبة دي مبنية على **زبدة الشيا** — ملمس أنعم وتثبيت أقل قسوة.

التثبيت ٣ من ٥: قوي كفاية إن الكيرل يفضل مظبوط، ومرن كفاية إنك تعدّله من غير ما تكسر شكل الخصلة.',
     'Curly and coily hair loses moisture faster than any other type, and most waxes make that worse. This one is built around **shea butter** instead — a softer texture and a gentler hold.

Hold is 3 out of 5: firm enough to keep the curl in shape, flexible enough to reshape without breaking the pattern.',
     'خد كمية صغيرة وافركها بين إيديك لحد ما تدفى
حطها على شعر نص ناشف عشان توزّع أحسن
اشتغل من الأطراف ناحية الجذور عشان متثقّلش الكيرل
عرّف الخصل بصوابعك',
     'Take a small amount and warm it between your palms
Apply to towel-dried hair — it spreads more evenly
Work from the ends up so you do not weigh the curl down
Define the strands with your fingers',
     'زبدة الشيا في التركيبة
تثبيت ٣ من ٥ — مرن مش ناشف
للشعر الكيرلي والمجعّد والتخين
برطمان ١٢٠ مل',
     'Shea butter in the formula
Hold 3 out of 5 — flexible, not crunchy
For curly, coily and thick hair
120ml jar'),
    ('S7-WAX-BLU',
     '**زيت الأرجان** موجود في العناية بالشعر من زمان، وهو أساس التركيبة دي. الفكرة إنك تظبط الاستايل وتدّي الشعر ملمس أنعم في نفس الخطوة، بدل ما تعمل الاتنين بمنتجين.

التثبيت ٣ من ٥ — مناسب للشعر المجعّد والمتموج اللي محتاج تحكم من غير ما يبقى ناشف أو متكتّل.',
     '**Argan oil** has been in hair care for a long time, and it is the base of this formula. The idea is to shape the style and leave a softer feel in the same step, instead of using two products for the two jobs.

Hold is 3 out of 5 — right for curly and wavy hair that needs control without ending up dry or clumped.',
     'كمية بحجم حبة الفول بين إيديك
وزّعها على شعر نص ناشف
اشتغل من الأطراف ناحية الجذور
ظبّط بصوابعك أو بمشط واسع السنون',
     'A pea-sized amount between your palms
Spread it through towel-dried hair
Work from the ends up
Finish with your fingers or a wide-tooth comb',
     'زيت أرجان في التركيبة
تثبيت ٣ من ٥
للشعر المجعّد والمتموج
برطمان ١٢٠ مل',
     'Argan oil in the formula
Hold 3 out of 5
For curly and wavy hair
120ml jar'),
    ('S7-WAX-BLK',
     'بلاك هو البرطمان الوحيد في التشكيلة اللي بيعمل حاجة زيادة على التصفيف: بيغطي الشيب. الصبغة الوحيدة في التركيبة هي **CI 77266** — الأسود — فالواكس بيسيب لون أسود لامع على الشعرة وإنت بتوزّعه. باقي الألوان فيها خمس صبغات بتلوّن البرطمان بس.

التثبيت ٣ من ٥ بمرونة عالية ولمعة عالية، ومعاه **زيت حبة البركة**. يعني ده مش واكس مطفي — لو انت بتدوّر على شكل مات من غير لمعة، ده مش هو.',
     'Black is the one jar in the line that does something besides styling: it covers grey. The only colourant in the formula is **CI 77266** — black — so the wax leaves a glossy black tone on the strand as you work it in. The other colours carry a five-pigment set that only colours the jar.

Hold is 3 out of 5, with high flexibility, high shine and **black seed oil** in the base. So it is not a matte wax. If a matte, no-shine finish is what you are after, this is not it.',
     'خد كمية صغيرة وافركها بين إيديك لحد ما تدفى
حطها على شعر ناشف أو نص ناشف
وزّعها على الأماكن اللي فيها شيب الأول
مشّط أو ظبّط بصوابعك — التركيبة مرنة وتقدر تعدّلها في أي وقت',
     'Take a small amount and warm it between your palms
Work it through dry or towel-dried hair
Cover the greying areas first
Comb or shape with your fingers - the formula stays pliable, so you can rework it',
     'بيغطي الشيب — صبغة CI 77266 السودا
تثبيت ٣ من ٥ بمرونة عالية
لمعة عالية — مش واكس مطفي
زيت حبة البركة في التركيبة
برطمان ١٢٠ مل',
     'Covers grey - CI 77266 black
Hold 3 out of 5, high flexibility
High shine - not a matte wax
Black seed oil in the formula
120ml jar'),
    ('S7-WAX-YEL',
     'برو هو الواكس اليومي في التشكيلة: تثبيت ٤ من ٥ بتركيبة سهلة التوزيع تنفع لأنواع شعر كتير — تخين، مفرود، أو متموج، وحتى الخفيف لو كمية صغيرة.

لو بتدوّر على برطمان واحد تمد إيدك عليه كل يوم الصبح من غير ما تفكر، ده هو.',
     'Pro is the everyday wax in the line: 4-out-of-5 hold in a formula that spreads easily and suits a range of hair — thick, straight, wavy, and fine hair too if you keep the amount small.

If you want one jar you reach for every morning without thinking about it, this is the one.',
     'خد كمية بحجم حبة الفول
افركها بين إيديك لحد ما تدفى
وزّعها على شعر ناشف أو نص ناشف
ظبّط الاستايل بإيدك',
     'Take a pea-sized amount
Rub it between your palms until it warms
Work it through dry or towel-dried hair
Shape with your hands',
     'تثبيت ٤ من ٥
سهل التوزيع
يناسب الشعر التخين والمفرود والمتموج والخفيف
برطمان ١٢٠ مل',
     'Hold 4 out of 5
Spreads easily
Suits thick, straight, wavy and fine hair
120ml jar'),
    ('S7-GEL-YEL',
     'الجل ده للـ**ويت لوك** — اللمعة المبلولة اللي بتدي الشعر شكل مرتب وكثافة أعلى. أنسب حاجة للشعر الناعم المفرود اللي بيقع بسرعة ومحتاج حاجة تمسكه من غير وزن.

التثبيت ٥ من ٥: أقوى تثبيت عندنا، وبيتغسل بسهولة. عبوة ٢٥٠ مل.',
     'This gel is for the **wet look** — the polished shine that makes hair read tidier and fuller. It suits fine, straight hair that drops quickly and needs hold without weight.

Hold is 5 out of 5: the strongest hold we make, and it washes out easily. 250ml bottle.',
     'حط كمية على شعر نص مبلول — الجل بيتوزّع أحسن كده
مشّط للخلف أو للجنب حسب الاستايل اللي عايزه
سيبه ينشف لوحده عشان تاخد أعلى لمعة
لو عايز شكل أنعم، مشّطه تاني وهو نص ناشف',
     'Apply to damp hair — gel spreads best that way
Comb it back or to the side, whichever style you want
Let it dry on its own for the most shine
For a softer finish, comb it again while it is half dry',
     'ويت لوك — لمعة عالية
تثبيت ٥ من ٥
للشعر الناعم المفرود
عبوة ٢٥٠ مل',
     'Wet look — high shine
Hold 5 out of 5
For straight hair
250ml bottle'),
    ('S7-GEL-GRN',
     'نفس تثبيت الجل بريميوم، ٥ من ٥، بريحة نضيفة خفيفة بتفضل معاك من غير ما تزاحم البارفان بتاعك.

للشعر الناعم المفرود: تحكم يومي للشغل أو الجامعة، وبيتغسل بسهولة في آخر اليوم. عبوة ٢٥٠ مل.',
     'The same Premium Gel hold, 5 out of 5, with a light clean scent that stays with you without fighting your fragrance.

For straight hair: daily control for work or campus, and it washes out easily at the end of the day. 250ml bottle.',
     'حط كمية على شعر نص مبلول — الجل بيتوزّع أحسن كده
مشّط للخلف أو للجنب حسب الاستايل اللي عايزه
سيبه ينشف لوحده عشان تاخد أعلى لمعة
لو عايز شكل أنعم، مشّطه تاني وهو نص ناشف',
     'Apply to damp hair — gel spreads best that way
Comb it back or to the side, whichever style you want
Let it dry on its own for the most shine
For a softer finish, comb it again while it is half dry',
     'ريحة نضيفة خفيفة
تثبيت ٥ من ٥
للشعر الناعم المفرود
عبوة ٢٥٠ مل',
     'Light, clean scent
Hold 5 out of 5
For straight hair
250ml bottle'),
    ('S7-GEL-BLU',
     'الأزرق هو الكلاسيك: تثبيت ٥ من ٥ بيفضل ثابت من الصبح لآخر اليوم من غير ما يسيب قشرة بيضا.

للشعر الناعم المفرود اللي محتاج حاجة يعتمد عليها كل يوم، من غير تجربة ولا مفاجآت. عبوة ٢٥٠ مل.',
     'Blue is the classic: 5-out-of-5 hold that stays put from morning to the end of the day without leaving white flakes.

For straight hair that needs something dependable every day — no experimenting, no surprises. 250ml bottle.',
     'حط كمية على شعر نص مبلول — الجل بيتوزّع أحسن كده
مشّط للخلف أو للجنب حسب الاستايل اللي عايزه
سيبه ينشف لوحده عشان تاخد أعلى لمعة
لو عايز شكل أنعم، مشّطه تاني وهو نص ناشف',
     'Apply to damp hair — gel spreads best that way
Comb it back or to the side, whichever style you want
Let it dry on its own for the most shine
For a softer finish, comb it again while it is half dry',
     'أقوى تثبيت عندنا — ٥ من ٥
من غير قشرة بيضا
للشعر الناعم المفرود
عبوة ٢٥٠ مل',
     'Our strongest hold — 5 out of 5
No white flakes
For straight hair
250ml bottle')
) AS v(sku, long_ar, long_en, howto_ar, howto_en, highlights_ar, highlights_en)
WHERE p.sku = v.sku;


-- ---------------------------------------------------------------------------
--  Product page copy from the client catalogue, 31 Aug
--
--  Ovanza sent a 28-page product catalogue as a PDF. The text in it is baked
--  into the artwork rather than being selectable, so this was read off the
--  pages by eye: product name, size, and the four to six benefit bullets each
--  one carries.
--
--  Thirty products. Before this, forty-two of the fifty on the shop had an
--  empty long_ar and rendered as a bare photograph with a price.
--
--  Same CASE WHEN empty guard as the block above: this fills a blank and never
--  overwrites wording set in the admin. Blank the field in the panel to get
--  this text back on the next deploy.
--
--  Two judgement calls worth naming.
--
--  The catalogue shows Styling Gel at 400ml. The shop sells it at 250, 650 and
--  850 and has no 400 at all. The copy describes the formula and the hold, not
--  the pack, so it is applied to all three sizes with only the size line in
--  highlights differing. If the 400 is genuinely a different formula this is
--  the block to correct.
--
--  The catalogue shows the black seed cream wax at 135ml. The shop sells it as
--  S7-W125-BLACKS at 125ml. The size line here follows the shop, because that
--  is the pack being posted to customers - but one of the two is wrong and it
--  is worth asking which.
--
--  No prices and no ingredient lists are taken from the catalogue, because it
--  carries neither.
-- ---------------------------------------------------------------------------
UPDATE products p SET
  long_ar       = CASE WHEN p.long_ar       = '' THEN v.long_ar       ELSE p.long_ar       END,
  long_en       = CASE WHEN p.long_en       = '' THEN v.long_en       ELSE p.long_en       END,
  howto_ar      = CASE WHEN p.howto_ar      = '' THEN v.howto_ar      ELSE p.howto_ar      END,
  howto_en      = CASE WHEN p.howto_en      = '' THEN v.howto_en      ELSE p.howto_en      END,
  highlights_ar = CASE WHEN p.highlights_ar = '' THEN v.highlights_ar ELSE p.highlights_ar END,
  highlights_en = CASE WHEN p.highlights_en = '' THEN v.highlights_en ELSE p.highlights_en END
FROM (VALUES
    ('S7-CG250-BEESWA',
     'كريم جل بشمع العسل وشمع العسل. يمنح ثباتاً متوسطاً يدوم طوال اليوم مع كثافة ولمعان يدومان طويلاً.

يحتوي على شمع العسل لترطيب وتقوية الشعر. التركيبة مائية، فبتتغسل بسهولة وتقدر تعيد تصفيف شعرك في أي وقت من غير ما تسيب بقايا.',
     'A cream gel with beeswax and beeswax. Medium hold that lasts all day, with lasting thickness and shine.

Beeswax to moisturise and strengthen the hair. The formula is water-based, so it washes out easily and you can restyle any time without residue.',
     '',
     '',
     'ثبات متوسط يدوم طوال اليوم
بشمع العسل وشمع العسل
تركيبة مائية، سهلة الغسل وإعادة التصفيف.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ٢٥٠ مل',
     'Medium hold, all day
Beeswax and beeswax
Water-based, washes out easily
Works on dry or damp hair
250ml jar'),
    ('S7-CG250-JOJOBA',
     'كريم جل بشمع العسل وزيت الجوجوبا. يمنح ثباتاً متوسطاً يدوم طوال اليوم مع كثافة ولمعان يدومان طويلاً.

يحتوي على شمع العسل وزيت الجوجوبا الذي يقلل تساقط الشعر. التركيبة مائية، فبتتغسل بسهولة وتقدر تعيد تصفيف شعرك في أي وقت من غير ما تسيب بقايا.',
     'A cream gel with beeswax and jojoba oil. Medium hold that lasts all day, with lasting thickness and shine.

Beeswax and jojoba oil, which reduces hair fall. The formula is water-based, so it washes out easily and you can restyle any time without residue.',
     '',
     '',
     'ثبات متوسط يدوم طوال اليوم
بشمع العسل وزيت الجوجوبا
تركيبة مائية، سهلة الغسل وإعادة التصفيف.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ٢٥٠ مل',
     'Medium hold, all day
Beeswax and jojoba oil
Water-based, washes out easily
Works on dry or damp hair
250ml jar'),
    ('S7-CG250-BLACKS',
     'كريم جل بشمع العسل وحبة البركة السوداء. يمنح ثباتاً متوسطاً يدوم طوال اليوم مع كثافة ولمعان يدومان طويلاً.

يحتوي على شمع العسل وزيت حبة البركة السوداء، ويغطي لون الشعر الابيض والشيب. التركيبة مائية، فبتتغسل بسهولة وتقدر تعيد تصفيف شعرك في أي وقت من غير ما تسيب بقايا.',
     'A cream gel with beeswax and black seed oil. Medium hold that lasts all day, with lasting thickness and shine.

Beeswax and black seed oil. Covers white hair and greys. The formula is water-based, so it washes out easily and you can restyle any time without residue.',
     '',
     '',
     'ثبات متوسط يدوم طوال اليوم
بشمع العسل وحبة البركة السوداء
تركيبة مائية، سهلة الغسل وإعادة التصفيف.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ٢٥٠ مل',
     'Medium hold, all day
Beeswax and black seed oil
Water-based, washes out easily
Works on dry or damp hair
250ml jar'),
    ('S7-CG250-OLIVE',
     'كريم جل بشمع العسل وزيت الزيتون. يمنح ثباتاً متوسطاً يدوم طوال اليوم مع كثافة ولمعان يدومان طويلاً.

يحتوي على شمع العسل وزيت الزيتون الذي يغذي الشعر ويمنع التساقط. التركيبة مائية، فبتتغسل بسهولة وتقدر تعيد تصفيف شعرك في أي وقت من غير ما تسيب بقايا.',
     'A cream gel with beeswax and olive oil. Medium hold that lasts all day, with lasting thickness and shine.

Beeswax and olive oil, which feeds the hair and prevents fall. The formula is water-based, so it washes out easily and you can restyle any time without residue.',
     '',
     '',
     'ثبات متوسط يدوم طوال اليوم
بشمع العسل وزيت الزيتون
تركيبة مائية، سهلة الغسل وإعادة التصفيف.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ٢٥٠ مل',
     'Medium hold, all day
Beeswax and olive oil
Water-based, washes out easily
Works on dry or damp hair
250ml jar'),
    ('S7-CG250-ARGAN',
     'كريم جل بشمع العسل وزيت الارجان. يمنح ثباتاً متوسطاً يدوم طوال اليوم مع كثافة ولمعان يدومان طويلاً.

يحتوي على شمع العسل وزيت الارجان الذي يمنع الجفاف ويحميه من عوامل الجو. التركيبة مائية، فبتتغسل بسهولة وتقدر تعيد تصفيف شعرك في أي وقت من غير ما تسيب بقايا.',
     'A cream gel with beeswax and argan oil. Medium hold that lasts all day, with lasting thickness and shine.

Beeswax and argan oil, which prevents dryness and shields from the weather. The formula is water-based, so it washes out easily and you can restyle any time without residue.',
     '',
     '',
     'ثبات متوسط يدوم طوال اليوم
بشمع العسل وزيت الارجان
تركيبة مائية، سهلة الغسل وإعادة التصفيف.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ٢٥٠ مل',
     'Medium hold, all day
Beeswax and argan oil
Water-based, washes out easily
Works on dry or damp hair
250ml jar'),
    ('S7-GW140-JOJOBA',
     'جل واكس بـزيت الجوجوبا. يمنح الشعر شكل مبلل ولمعان طبيعي مع ثبات مرن تقدر تتحكم فيه في أي وقت.

من فوائد زيت الجوجوبا انه يرطّب الشعر وفروة الرأس ويقلل من تساقط الشعر والتقصف ويعزز نمو الشعر الصحي.',
     'A gel wax with jojoba oil. Gives a wet look and natural shine, with a flexible hold you can rework any time.

Jojoba oil moisturises the hair and scalp, reduces fall and breakage, and supports healthy growth.',
     '',
     '',
     'ثبات مرن — لمعان قوي
بـزيت الجوجوبا
حماية من عوامل الجو ومناسب لجميع أنواع الشعر.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ١٤٠ مل',
     'Flexible hold, strong shine
Jojoba oil
Suits every hair type
Dry or damp hair
140ml jar'),
    ('S7-GW140-ARGAN',
     'جل واكس بـزيت الارجان. يمنح الشعر شكل مبلل ولمعان طبيعي مع ثبات مرن تقدر تتحكم فيه في أي وقت.

من فوائد زيت الارجان انه يرطب الشعر ويمنع الجفاف ويحميه من الحرارة وعوامل الجو، لانه يحتوي على فيتامين E الذي يغذي الشعر بعمق ويمنحه لمعاناً وحماية فائقة.',
     'A gel wax with argan oil. Gives a wet look and natural shine, with a flexible hold you can rework any time.

Argan oil moisturises, prevents dryness and shields from heat and weather. Its vitamin E feeds the hair deeply and gives it shine.',
     '',
     '',
     'ثبات مرن — لمعان قوي
بـزيت الارجان
حماية من عوامل الجو ومناسب لجميع أنواع الشعر.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ١٤٠ مل',
     'Flexible hold, strong shine
Argan oil
Suits every hair type
Dry or damp hair
140ml jar'),
    ('S7-GW140-ALOEVE',
     'جل واكس بـالصبار. يمنح الشعر شكل مبلل ولمعان طبيعي مع ثبات مرن تقدر تتحكم فيه في أي وقت.

من فوائد الصبار انه يعزز نمو الشعر ويرطبه، حيث يحتوي على إنزيمات طبيعية وفيتامينات تحفّز بصيلات الشعر وتساعد على نموه بشكل صحي وقوي وتمنع التقصف.',
     'A gel wax with aloe vera. Gives a wet look and natural shine, with a flexible hold you can rework any time.

Aloe vera supports growth and moisture. Its natural enzymes and vitamins stimulate the follicles and prevent breakage.',
     '',
     '',
     'ثبات مرن — لمعان قوي
بـالصبار
حماية من عوامل الجو ومناسب لجميع أنواع الشعر.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ١٤٠ مل',
     'Flexible hold, strong shine
Aloe vera
Suits every hair type
Dry or damp hair
140ml jar'),
    ('S7-GW140-ROSEMA',
     'جل واكس بـزيت الروزماري. يمنح الشعر شكل مبلل ولمعان طبيعي مع ثبات مرن تقدر تتحكم فيه في أي وقت.

من فوائد زيت الروزماري انه يُنشّط الدورة الدموية في فروة الرأس، مما يعزز تغذية بصيلات الشعر ويساعد على نمو شعر أقوى وأكثر كثافة ويقلل من تساقط الشعر.',
     'A gel wax with rosemary oil. Gives a wet look and natural shine, with a flexible hold you can rework any time.

Rosemary oil stimulates circulation in the scalp, feeding the follicles for stronger, thicker hair and less fall.',
     '',
     '',
     'ثبات مرن — لمعان قوي
بـزيت الروزماري
حماية من عوامل الجو ومناسب لجميع أنواع الشعر.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ١٤٠ مل',
     'Flexible hold, strong shine
Rosemary oil
Suits every hair type
Dry or damp hair
140ml jar'),
    ('S7-GW140-SHEA',
     'جل واكس بـزبدة الشيا. يمنح الشعر شكل مبلل ولمعان طبيعي مع ثبات مرن تقدر تتحكم فيه في أي وقت.

من فوائد زبدة الشيا انها تشكل طبقة عازلة تحمي الشعر من عوامل الجو والحرارة وتمنحه رطوبة وتغذية فائقة تمنع الجفاف والتقصف.',
     'A gel wax with shea butter. Gives a wet look and natural shine, with a flexible hold you can rework any time.

Shea butter forms a barrier against weather and heat, and gives deep moisture that prevents dryness and breakage.',
     '',
     '',
     'ثبات مرن — لمعان قوي
بـزبدة الشيا
حماية من عوامل الجو ومناسب لجميع أنواع الشعر.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ١٤٠ مل',
     'Flexible hold, strong shine
Shea butter
Suits every hair type
Dry or damp hair
140ml jar'),
    ('S7-GW140-COCONU',
     'جل واكس بـزيت جوز الهند. يمنح الشعر شكل مبلل ولمعان طبيعي مع ثبات مرن تقدر تتحكم فيه في أي وقت.

من فوائد جوز الهند انه يتغلغل في أعماق الشعر، مما يساعد على ترطيبه وتنعيمه وتقليل الهيشان ويعالج التقصف وتساقط الشعر.',
     'A gel wax with coconut oil. Gives a wet look and natural shine, with a flexible hold you can rework any time.

Coconut oil penetrates deep into the hair, moisturising and smoothing it, cutting frizz and treating breakage and fall.',
     '',
     '',
     'ثبات مرن — لمعان قوي
بـزيت جوز الهند
حماية من عوامل الجو ومناسب لجميع أنواع الشعر.
يمكن استخدامه على الشعر الجاف او المبلل.
عبوة ١٤٠ مل',
     'Flexible hold, strong shine
Coconut oil
Suits every hair type
Dry or damp hair
140ml jar'),
    ('S7-W135-COCONU',
     'كريم واكس للشعر بـزيت جوز الهند. يحتوي على زيت جوز الهند الذي يساعد على الترطيب والتنعيم وتقليل هيشان الشعر ويعطيه لمعاناً مثالياً وعطراً جميلاً.

مرونة متوسطة ولمعان قوي، وسهل الاستخدام على كل أنواع الشعر.',
     'A cream wax with coconut oil. Coconut oil moisturises and smooths, cuts frizz, and leaves a clean shine and scent.

Medium flexibility with strong shine, and easy to use on any hair type.',
     '',
     '',
     'مرونة متوسطة — لمعان قوي
بـزيت جوز الهند
يمنح حماية قوية من عوامل الجو ولا يترك أي بقايا.
سهل الاستخدام ومناسب لجميع أنواع الشعر.
عبوة ١٣٥ مل',
     'Medium flex, strong shine
Coconut oil
Protects against the weather
Leaves no residue
135ml jar'),
    ('S7-W135-SHEA',
     'كريم واكس للشعر بـزبدة الشيا. يحتوي على زبدة الشيا التي تعالج وتغذي الشعر وتعطيه قوة وحيوية مثالية وملمساً رائعاً طول اليوم.

مرونة متوسطة ولمعان قوي، وسهل الاستخدام على كل أنواع الشعر.',
     'A cream wax with shea butter. Shea butter treats and feeds the hair, giving it strength and a good feel all day.

Medium flexibility with strong shine, and easy to use on any hair type.',
     '',
     '',
     'مرونة متوسطة — لمعان قوي
بـزبدة الشيا
يمنح حماية قوية من عوامل الجو ولا يترك أي بقايا.
سهل الاستخدام ومناسب لجميع أنواع الشعر.
عبوة ١٣٥ مل',
     'Medium flex, strong shine
Shea butter
Protects against the weather
Leaves no residue
135ml jar'),
    ('S7-W135-OLIVE',
     'كريم واكس للشعر بـزيت الزيتون. يحتوي على زيت الزيتون الذي يعالج تساقط الشعر والتقصف ويغذيه أيضاً لشعر أكثر صحة وقوة.

مرونة متوسطة ولمعان قوي، وسهل الاستخدام على كل أنواع الشعر.',
     'A cream wax with olive oil. Olive oil treats hair fall and breakage and feeds the hair for more strength.

Medium flexibility with strong shine, and easy to use on any hair type.',
     '',
     '',
     'مرونة متوسطة — لمعان قوي
بـزيت الزيتون
يمنح حماية قوية من عوامل الجو ولا يترك أي بقايا.
سهل الاستخدام ومناسب لجميع أنواع الشعر.
عبوة ١٣٥ مل',
     'Medium flex, strong shine
Olive oil
Protects against the weather
Leaves no residue
135ml jar'),
    ('S7-W135-ARGAN',
     'كريم واكس للشعر بـزيت الارجان. يحتوي على زيت الارجان الذي يعالج جفاف الشعر والتقصف ويغذيه لشعر أكثر صحة وقوة.

مرونة متوسطة ولمعان قوي، وسهل الاستخدام على كل أنواع الشعر.',
     'A cream wax with argan oil. Argan oil treats dryness and breakage and feeds the hair for more strength.

Medium flexibility with strong shine, and easy to use on any hair type.',
     '',
     '',
     'مرونة متوسطة — لمعان قوي
بـزيت الارجان
يمنح حماية قوية من عوامل الجو ولا يترك أي بقايا.
سهل الاستخدام ومناسب لجميع أنواع الشعر.
عبوة ١٣٥ مل',
     'Medium flex, strong shine
Argan oil
Protects against the weather
Leaves no residue
135ml jar'),
    ('S7-W125-BLACKS',
     'كريم واكس للشعر بـزيت حبة البركة. يحتوي على زيت حبة البركة لتغذية الشعر وإضفاء لمعان أسود جذاب، ويغطي لون الشعر الابيض والشيب بطريقة سهلة وبسيطة بفضل تركيبته المتطورة.

مرونة متوسطة ولمعان قوي، وسهل الاستخدام على كل أنواع الشعر.',
     'A cream wax with black seed oil. Black seed oil feeds the hair and adds a deep black shine. Its formula covers white hair and greys.

Medium flexibility with strong shine, and easy to use on any hair type.',
     '',
     '',
     'مرونة متوسطة — لمعان قوي
بـزيت حبة البركة
يمنح حماية قوية من عوامل الجو ولا يترك أي بقايا.
سهل الاستخدام ومناسب لجميع أنواع الشعر.
عبوة ١٢٥ مل',
     'Medium flex, strong shine
Black seed oil
Protects against the weather
Leaves no residue
125ml jar'),
    ('S7-G250-WHITE',
     'جل بريميوم أبيض. يمنح تغذية رائعة للشعر من الجذور ويحميه من تساقط الشعر بفضل تركيبته المتطورة مع فيتامين B5، وثبات قوي جداً يدوم حتى ٤٨ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا ولا يسبب القشرة.',
     'Premium gel, white. Feeds the hair from the root and guards against fall, thanks to a formula built around vitamin B5. Very strong hold, up to 48 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات قوي جداً — لمعان قوي
يدوم حتى ٤٨ ساعة
بفيتامين B5
مايسبش قشرة
عبوة ٢٥٠ مل',
     'Very strong hold, strong shine
Lasts up to 48 hours
With vitamin B5
No flakes
250ml jar'),
    ('S7-G250-BLACK',
     'جل بريميوم أسود. يمنح تغذية رائعة للشعر من الجذور ويحميه من تساقط الشعر بفضل تركيبته المتطورة مع فيتامين B5، وثبات قوي جداً يدوم حتى ٤٨ ساعة.

ويغطي الشعر الابيض بفضل تركيبته المتطورة ولونه الاسود الذي يعطي لمعاناً وتغطية متوسطة للشعر الابيض.',
     'Premium gel, black. Feeds the hair from the root and guards against fall, thanks to a formula built around vitamin B5. Very strong hold, up to 48 hours.

Its black tint gives medium coverage over white hair alongside the shine.',
     '',
     '',
     'ثبات قوي جداً — لمعان قوي
يدوم حتى ٤٨ ساعة
يغطي الشعر الابيض
بفيتامين B5
عبوة ٢٥٠ مل',
     'Very strong hold, strong shine
Lasts up to 48 hours
Covers white hair
With vitamin B5
250ml jar'),
    ('S7-SG250-WHITE',
     'ستايلينج جل أبيض. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, white. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات قوي — لمعان قوي
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 250 مل',
     'Strong hold, strong shine
Lasts up to 24 hours
No flakes
Suits every hair type
250ml jar'),
    ('S7-SG250-BLACK',
     'ستايلينج جل أسود. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.

ويغطي الشعر الابيض بفضل تركيبته المتطورة ولونه الاسود الذي يعطي تغطية متوسطة للشعر الابيض.',
     'Styling gel, black. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.

Its black tint also gives medium coverage over white hair.',
     '',
     '',
     'ثبات قوي — لمعان قوي
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 250 مل',
     'Strong hold, strong shine
Lasts up to 24 hours
No flakes
Suits every hair type
250ml jar'),
    ('S7-SG250-BLUE',
     'ستايلينج جل أزرق. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, blue. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات قوي — لمعان متوسط
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 250 مل',
     'Strong hold, medium shine
Lasts up to 24 hours
No flakes
Suits every hair type
250ml jar'),
    ('S7-SG250-YELLOW',
     'ستايلينج جل أصفر. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, yellow. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات متوسط — لمعان متوسط
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 250 مل',
     'Medium hold, medium shine
Lasts up to 24 hours
No flakes
Suits every hair type
250ml jar'),
    ('S7-SG650-WHITE',
     'ستايلينج جل أبيض. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, white. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات قوي — لمعان قوي
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 650 مل',
     'Strong hold, strong shine
Lasts up to 24 hours
No flakes
Suits every hair type
650ml jar'),
    ('S7-SG650-BLACK',
     'ستايلينج جل أسود. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.

ويغطي الشعر الابيض بفضل تركيبته المتطورة ولونه الاسود الذي يعطي تغطية متوسطة للشعر الابيض.',
     'Styling gel, black. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.

Its black tint also gives medium coverage over white hair.',
     '',
     '',
     'ثبات قوي — لمعان قوي
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 650 مل',
     'Strong hold, strong shine
Lasts up to 24 hours
No flakes
Suits every hair type
650ml jar'),
    ('S7-SG650-BLUE',
     'ستايلينج جل أزرق. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, blue. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات قوي — لمعان متوسط
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 650 مل',
     'Strong hold, medium shine
Lasts up to 24 hours
No flakes
Suits every hair type
650ml jar'),
    ('S7-SG650-YELLOW',
     'ستايلينج جل أصفر. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, yellow. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات متوسط — لمعان متوسط
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 650 مل',
     'Medium hold, medium shine
Lasts up to 24 hours
No flakes
Suits every hair type
650ml jar'),
    ('S7-SG850-WHITE',
     'ستايلينج جل أبيض. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, white. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات قوي — لمعان قوي
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 850 مل',
     'Strong hold, strong shine
Lasts up to 24 hours
No flakes
Suits every hair type
850ml jar'),
    ('S7-SG850-BLACK',
     'ستايلينج جل أسود. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.

ويغطي الشعر الابيض بفضل تركيبته المتطورة ولونه الاسود الذي يعطي تغطية متوسطة للشعر الابيض.',
     'Styling gel, black. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.

Its black tint also gives medium coverage over white hair.',
     '',
     '',
     'ثبات قوي — لمعان قوي
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 850 مل',
     'Strong hold, strong shine
Lasts up to 24 hours
No flakes
Suits every hair type
850ml jar'),
    ('S7-SG850-BLUE',
     'ستايلينج جل أزرق. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, blue. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات قوي — لمعان متوسط
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 850 مل',
     'Strong hold, medium shine
Lasts up to 24 hours
No flakes
Suits every hair type
850ml jar'),
    ('S7-SG850-YELLOW',
     'ستايلينج جل أصفر. تحكم مثالي وتثبيت قوي للشعر طوال اليوم حتى ٢٤ ساعة.

يعطي حماية من عوامل الجو ومناسب لجميع أنواع الشعر، ولا يترك أي بقايا على الشعر ولا يسبب القشرة.',
     'Styling gel, yellow. Firm control and strong hold all day, up to 24 hours.

Shields against the weather, suits every hair type, leaves no residue and does not cause flakes.',
     '',
     '',
     'ثبات متوسط — لمعان متوسط
يدوم حتى ٢٤ ساعة
مايسبش قشرة
مناسب لكل أنواع الشعر
عبوة 850 مل',
     'Medium hold, medium shine
Lasts up to 24 hours
No flakes
Suits every hair type
850ml jar')
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
- **التثبيت مش اللمعة.** دول محورين منفصلين خالص. عندنا جل تثبيته ٥ ولمعته عالية جداً (جولدن)، وواكس تثبيته ٣ ولمعته عالية برضه (بلاك)، وواكس تثبيته ٤ ولمعته طبيعية هادية (برو إكس). متختارش على أساس إن اللمعة دليل على القوة.
- **الرقم مش عدد ساعات.** إحنا مش بنقول لك «تثبيت ٤٨ ساعة» لأن ده كلام مش بنقيسه. اللي بنكتبه هو الدرجة من ٥، وخلاص.
- **الرقم مش السعر.** كل الواكس عندنا بنفس السعر ونفس الحجم، وكل الجل بنفس السعر ونفس الحجم. يعني لو رحت لدرجة أعلى مش هتدفع زيادة، ولو رحت لدرجة أقل مش هتوفر. الفلوس خرجت من المعادلة تماماً.

## تلات خطوات تختار بيهم رقمك

الناس بتبدأ من الرقم، وده أصلاً آخر خطوة مش أولها. الترتيب الصح كده:

- **ابدأ من الشكل اللي في دماغك.** عايز الشعر يبان مبلول ولامع؟ ولا طبيعي كأنك مش حاطط حاجة؟ ولا موجة مفتوحة ومعرّفة؟ الشكل ده بيحدد النهاية، والنهاية بتقفل عليك نص التشكيلة على طول.
- **بعدين حدد الفورمات: واكس ولا جل.** الجل بيتحط على شعر مبلول وبينشف على الشكل. الواكس بيتحط على شعر ناشف أو نص ناشف وبيفضل ماشي مع إيدك. ده الفرق العملي اللي هتحسه كل يوم الصبح.
- **وبعد كده بس شوف الرقم.** لأن الرقم جوه كل فورمات بقى اختيار ضيق: الجل كله على ٥، والواكس بين ٣ و٤. يعني لما توصل للخطوة دي بتبقى فاضل قدامك حاجتين تلاتة مش تمنية.

ولو نوع شعرك نفسه مش واضح لك، ابدأ من [دليل أنواع الشعر](/hair-types) الأول وبعدين ارجع للرقم.

## تثبيت ٣ — الواكس المرن (شيا، أرجان، بلاك)

تلاتة، كلهم ١٢٠ مل و٤٥ جنيه، وتثبيت ٣ من ٥ بمرونة عالية.

درجة ٣ معناها إن الشكل ماسك بس لسه بيمشي معاك. تقدر تعدل بإيدك في نص اليوم من غير ما الشعر يتكسر أو يبان متقفل. ودي بالظبط الحاجة اللي بتخلي درجة ٣ اختيار مقصود مش تنازل: في ناس عايزة تظبط الشكل تاني بعد الضهر، ودرجة أعلى مش بتسمح بده.

- **[واكس زبدة الشيا](/product/premium-wax-shea)** — نهاية ناعمة، متسجل على [الشعر الخشن/الأفرو](/hair-types/coily) و[الكيرلي](/hair-types/curly) و[الكثيف](/hair-types/thick).
- **[واكس الأرجان](/product/premium-wax-argan)** — تركيبة مغذية، متسجلة على الكيرلي والخشن و[المتموج](/hair-types/wavy).
- **[واكس بلاك](/product/premium-wax-black)** — ده الوحيد اللي بيعمل حاجة زيادة على التصفيف: بيغطي الشيب ويسيب لون أسود لامع. لمعته عالية، مش مطفي.

## تثبيت ٤ — الواكس القوي (برو إكس وبرو)

الاتنين دول ١٢٠ مل و٤٥ جنيه، وتثبيت ٤ من ٥ — أقوى واكس في التشكيلة.

الفرق بينهم وبين درجة ٣ إن الإمساك أعلى والشكل بيفضل مكانه أكتر، بس التركيبة لسه بتسمح لك تعدّل. لو شعرك كثيف أو موجته بتتفلت بسرعة، ده رقمك.

- **[واكس برو إكس](/product/premium-wax-pro-x)** — تركيبة Wave & Groom، نهاية طبيعية، للشعر المتموج والكثيف. كان بـ٥٥ جنيه، بقى ٤٥.
- **[واكس برو](/product/premium-wax-pro)** — التثبيت اليومي العام، للشعر الكثيف والمفرود والمتموج، وللشعر الخفيف كمان لو الكمية صغيرة.

كل [تشكيلة الواكس](/shop/wax) هنا.

## تثبيت ٥ — الجل (٣ ألوان)

تلات جل، كلهم ٢٥٠ مل، كلهم ٤٠ جنيه، وكلهم تثبيت ٥ من ٥ — أعلى رقم في التشكيلة كلها — ومتسجلين على [الشعر الناعم المفرود](/hair-types/straight).

درجة ٥ معناها إن الشكل بيتقفل ومش بيمشي معاك بسهولة بعد ما ينشف. ده مكسب ولا خسارة على حسب انت عايز إيه: مكسب لو عايز تحط الشكل الصبح وتنساه، وخسارة لو من النوع اللي بيعدل شعره بإيده كل ساعة. والشعر الناعم المفرود هو النوع اللي بيحتاج الرقم ده فعلاً، لأنه أصلاً مش ماسك شكل.

والتلاتة على نفس الرقم بالظبط، فالاختيار بينهم مش اختيار قوة خالص — هو اختيار لمعة وريحة:

- **[جل جولدن](/product/premium-gel-golden)** — ويت لوك، لمعة عالية. ده الاختيار لو عايز الشكل المبلول اللامع.
- **[جل جرين](/product/premium-gel-green)** — ريحة نضيفة، نفس التثبيت.
- **[جل بلو](/product/premium-gel-blue)** — الكلاسيك اللي بيقعد لآخر اليوم.

شوف [تشكيلة الجل كلها](/shop/gel) لو مستقر على الفورمات ده.

## المقارنة الكاملة: ٨ منتجات بالتثبيت والحجم والسعر

التشكيلة كلها في مكان واحد، مرتبة من أعلى تثبيت لأقل:

- **[جولدن](/product/premium-gel-golden)** — جل · تثبيت ٥/٥ · ٢٥٠ مل · ٤٠ جنيه · مفرود · ويت لوك ولمعة عالية
- **[جرين](/product/premium-gel-green)** — جل · تثبيت ٥/٥ · ٢٥٠ مل · ٤٠ جنيه · مفرود · ريحة نضيفة
- **[بلو](/product/premium-gel-blue)** — جل · تثبيت ٥/٥ · ٢٥٠ مل · ٤٠ جنيه · مفرود · كلاسيك طول اليوم
- **[برو إكس](/product/premium-wax-pro-x)** — واكس · تثبيت ٤/٥ · ١٢٠ مل · ٤٥ جنيه (كان ٥٥) · متموج وكثيف · نهاية طبيعية
- **[برو](/product/premium-wax-pro)** — واكس · تثبيت ٤/٥ · ١٢٠ مل · ٤٥ جنيه · كثيف ومفرود ومتموج وخفيف · يومي
- **[زبدة الشيا](/product/premium-wax-shea)** — واكس · تثبيت ٣/٥ · ١٢٠ مل · ٤٥ جنيه · خشن وكيرلي وكثيف · نهاية ناعمة
- **[الأرجان](/product/premium-wax-argan)** — واكس · تثبيت ٣/٥ · ١٢٠ مل · ٤٥ جنيه · كيرلي وخشن ومتموج · مغذي
- **[بلاك](/product/premium-wax-black)** — واكس · تثبيت ٣/٥ · ١٢٠ مل · ٤٥ جنيه · متموج وكثيف · بيغطي الشيب بلمعة عالية

كل الواكس ١٢٠ مل و٤٥ جنيه، وكل الجل ٢٥٠ مل و٤٠ جنيه. يعني الاختيار بينهم مش مسألة فلوس — هو مسألة نوع شعر ودرجة تثبيت وبس.

## أنهي رقم متسجل على أنهي نوع شعر

دي مجرد خريطة سريعة للأرقام. كل نوع عنده صفحة بتشرح مشكلته بالتفصيل وإيه اللي يبعد عنه:

- [ناعم مفرود](/hair-types/straight) — تثبيت ٥، يعني جل.
- [متموج](/hair-types/wavy) — تثبيت ٤ واكس، ومعاه ٣ كخيار أمرن.
- [كيرلي](/hair-types/curly) — تثبيت ٣.
- [خشن/أفرو](/hair-types/coily) — تثبيت ٣.
- [خفيف](/hair-types/fine) — تثبيت ٤ بكمية صغيرة جداً.
- [كثيف](/hair-types/thick) — تثبيت ٤.

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
الجل. التلاتة — جولدن وجرين وبلو — كلهم تثبيت ٥ من ٥، وده أعلى رقم في التشكيلة. أقوى واكس هو برو وبرو إكس بتثبيت ٤. والاختيار بين الجل والواكس مش اختيار قوة أصلاً: الجل بينشف ويقفل الشكل، والواكس بيفضل ماشي مع إيدك طول اليوم.

**تثبيت ٣ يعني الواكس ضعيف؟**
لأ. يعني الشكل ماسك بس لسه مرن وتقدر تعدله بإيدك بعد ما تحطه. لناس كتير دي الدرجة الصح مش تنازل، خصوصاً لو بتعدل شعرك أكتر من مرة في اليوم، أو لو شعرك ناشف ومحتاج تعريف مش قفل.

**الفرق بين تثبيت ٣ و٤ كبير؟**
مش قفزة ضخمة، لكنه محسوس. ٣ بيسيب للشعر حركة وشكل أنعم، ٤ بيمسك أكتر ويفضل مكانه لآخر اليوم. ولو انت متردد بين الاتنين، فكر بالنهاية اللي عايزها مش بالقوة: الشيا والأرجان والبلاك نهايتهم أنعم وأمرن، وبرو وبرو إكس أثبت.

**ينفع أستعمل جل وواكس مع بعض؟**
ينفع تحط جل على شعر مبلول وتسيبه ينشف، وبعدين تاخد كمية صغيرة جداً واكس لتحديد الأطراف. بس ابدأ بكمية أقل من المعتاد من الاتنين — دي أسرع طريقة لشعر تقيل ولبقايا بيضا من المنتج على الشعر.

**عندكم كلاي (طين) أو بوماد بتثبيت مطفي؟**
أيوة، الاتنين اتعملوا وهما المطفيين في التشكيلة — بس لسه منزلوش على الموقع. لحد ما ينزلوا، كل الواكس اللي معروض دلوقتي بينهي بلمعة، وأقل واحد فيهم لمعة هو الشيا بدرجة تثبيت ٣ وبكمية صغيرة.

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

يعني لو خارج من الحمام مستعجل، [الجل](/shop/gel) هو اللي هيشتغل معاك دلوقتي حالا — التلات ألوان (جولدن، أخضر، أزرق) تثبيت ٥ من ٥، ٢٥٠ مل بـ٤٠ جنيه. ولو عايز الشكل المبلول اللامع، [جل جولدن](/product/premium-gel-golden) هو المخصص لده.

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

وحاجة تانية بتتخلط بالبياض: اللمعة. لو مضايق إن شعرك بيبان لامع من الواكس، ده مش كمية — ده نوع التركيبة. وكل الواكس عندنا أساسه شمع وفازلين وبينهي بلمعة، فمفيش واحد فيهم هيديك شكل مطفي. اللي يقلل اللمعة فعلاً هو كمية أقل وشعر ناشف تماماً.

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

وعلى العكس، لو شعرك كثيف، الكمية بتاعتك أكبر من دي بمراحل، بس القاعدة تفضل هي هي: قد البندقة، وزّع، وبعدين شوف. أنهي درجة تثبيت تناسبك موجودة في صفحة [الشعر الكثيف](/hair-types/thick)، ولو عايز تشوف الاختيارات على طول: [برو إكس](/product/premium-wax-pro-x) تثبيت ٤ من ٥ بتركيبة Wave & Groom، و[برو](/product/premium-wax-pro) تثبيت ٤ من ٥ لليومي.

## أسئلة بتتسأل كتير

**أحط الواكس على شعر مبلول ولا ناشف؟**
ناشف. على شعر مبلول التوزيع بيبوظ وبتحس إن التثبيت قلّ. لو خارج من الحمام، نشّف بالفوطة واستنى شوية — أو استخدم جل، ده اللي بيشتغل على المبلول.

**الواكس بيخلص بسرعة، ده طبيعي؟**
غالبا لأ. العلبة ١٢٠ مل، ولو الكمية اليومية قد الحمصة مش هتخلص بالسرعة دي. اللي بيستهلك علبة بسرعة عادةً بياخد كمية أكبر من اللي محتاجها، وبيعوّض بكمية زيادة عن إنه مش بيسخّن الواكس في إيده.

**أقدر أستخدم واكس وجل مع بعض؟**
ينفع، بس بترتيب: جل على الشعر المبلول الأول، تستنى يجف، وبعدين كمية صغيرة أوي واكس عشان تعرّف الشكل. ده مفيد للشعر الكثيف اللي بيقع تحت وزنه. غير الحالة دي، واحد بس بالكمية الصح بيكفي.

**الكمية بتتغير لما الشعر يطول؟**
أيوه. كل ما الشعر يطول، الكمية اللي بتوصل لآخر الخصلة بتقل، فهتحتاج تزوّد شوية. بس زوّد بالتدريج زي ما قلنا — حمصة زيادة، مش ضعف الكمية.

**عندكم كريم أو كلاي (طين) أو بوماد؟**
الكريم أيوة: [كريم جل ٢٥٠ مل](/shop/cream-gel) و[جل واكس ١٤٠ مل](/shop/gel-wax). الكلاي والبوماد اتعملوا كمان، بس لسه منزلوش على الموقع — فلو انت جاي مخصوص عشان واحد فيهم، استنى شوية أو كلمنا على واتساب.

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

اللي بيسهّل الشيل من الأول هو إنك تحط الكمية الصح من واكس تثبيته يكفيك، بدل ما تحط كتير من واكس مش ماسك. [برو إكس](/product/premium-wax-pro-x) تثبيت ٤ من ٥ بشكل ناتشورال، و[برو](/product/premium-wax-pro) نفس درجة التثبيت لكن أسهل في التوزيع. الاتنين ١٢٠ مل بـ٤٥ جنيه، وتقدر تقارن [الواكس كله](/shop/wax) وتشوف كل واحد مناسب لأنهي نوع شعر.

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

- [واكس زبدة الشيا](/product/premium-wax-shea) و[واكس الأرجان](/product/premium-wax-argan) و[بلاك](/product/premium-wax-black): تثبيت ٣ من ٥
- [واكس برو إكس](/product/premium-wax-pro-x) و[برو](/product/premium-wax-pro): تثبيت ٤ من ٥
- [الجل](/shop/gel) — جولدن، أخضر، وأزرق: تثبيت ٥ من ٥

لو انت ماشي بدرجة ٣ والستايل مش قاعد معاك، الحل إنك تطلع لدرجة أعلى — مش إنك تحط كمية أكبر من نفس الدرجة. الرقم هو اللي بيفرق.

## يعني إيه ٣ و٤ و٥ عملياً

الرقم ده ترتيب بين منتجاتنا إحنا، مش مقياس عالمي. بنشره عشان تعرف انت بتشتري إيه بالظبط بدل كلام زي "تثبيت قوي" اللي كل حد بيكتبه.

- **٣ من ٥** — شكل مظبوط وطبيعي، وتقدر تعدّل فيه بإيدك بعد ما تحطه. [زبدة الشيا](/product/premium-wax-shea) و[الأرجان](/product/premium-wax-argan) و[بلاك](/product/premium-wax-black) في الدرجة دي.
- **٤ من ٥** — أعلى شوية، وبيفضل مكانه أكتر. [برو إكس](/product/premium-wax-pro-x) و[برو](/product/premium-wax-pro).
- **٥ من ٥** — أعلى حاجة عندنا، وده مستوى كل [الجل](/shop/gel). بيمسك الشكل من أول مرة، وبيحتاج منك كمية أقل عشان كده.

لو عمرك ما جربت غير درجة واحدة، انت متعرفش الفرق أصلاً — والفرق بين ٣ و٥ أوضح بكتير من الفرق بين كمية وكميتين من نفس المنتج.

## واكس ولا جل — الفرق الحقيقي

مش مسألة أنهي أحسن. الاتنين شغالين بطريقة مختلفة تماماً.

**[الواكس](/shop/wax)** — ١٢٠ مل بـ ٤٥ جنيه. بيتحط على شعر شبه ناشف، وبيدي تكستشر وشكل تقدر تعدّله. الفينيش بيختلف من واحد للتاني: [برو إكس](/product/premium-wax-pro-x) بتركيبة Wave & Groom بلمعة طبيعية (وكان بـ ٥٥ وبقى ٤٥)، [بلاك](/product/premium-wax-black) بيغطي الشيب بلمعة عالية، [زبدة الشيا](/product/premium-wax-shea) بفينيش ناعم، [الأرجان](/product/premium-wax-argan) مغذي، و[برو](/product/premium-wax-pro) لليومي.

**[الجل](/shop/gel)** — ٢٥٠ مل بـ ٤٠ جنيه، وكله تثبيت ٥ من ٥، وكله متسجل عندنا للشعر المفرود. بيتحط على شعر مبلول. الفرق بين التلاتة في الشكل والريحة مش في الدرجة:

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

مش كل يوم محتاج درجة ٥. لو يومك مكتب ومكيف وقاعد، واكس درجة ٣ هيكفيك تماماً وهيبقى أخف على شعرك.

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

- **اطلع درجة فوق في الصيف**. لو الشتا ماشي معاك بواكس ٣، جرب ٤، ولو ده مكفاش جرب [الجل](/shop/gel).
- **ابعد عن اللمعة الزيادة**. الشعر اللامع + العرق = منظر دهون. وكل الواكس عندنا بينهي بلمعة، فاللي بيقلّلها هو الكمية: نص اللي بتاخده، وشعر ناشف تماماً.
- **متحطش كمية تانية فوق الأولى في نص اليوم**. المنتج اللي على شعرك اتخلط بالعرق والزيت — لو زودت فوقه هيبقى تقيل ولزج، مش مثبت.
- **قلل السشوار الحامي**. الشعر اللي طالع من حرارة عالية بيمتص رطوبة الجو أسرع.
- **اغسل الشعر قبل ما تحط تاني**. المنتج بيتراكم مع العرق، والبداية النضيفة بتفرق أكتر من أي كمية زيادة.

## أسئلة بتتسأل كتير

**ليه الستايل بيقع بعد ساعتين من التصفيف؟**

غالباً لواحد من تلاتة: درجة التثبيت أقل من اللي شعرك محتاجه، أو حاطط كمية كبيرة فبقى تقيل وواقع بوزنه، أو حاطط واكس على شعر مبلول والواكس مش مصمم للمبلول. جرب درجة أعلى بكمية أقل الأول — ده بيحل أغلب الحالات.

**أزود الكمية ولا أغير المنتج؟**

غيّر لدرجة تثبيت أعلى. الكمية الزيادة بتزود الوزن مش المسك، والشعر التقيل بيقع أسرع. الفرق بين واكس ٣ وواكس ٤ — أو بين الواكس والجل ٥ — أكبر بكتير من الفرق بين كمية وكميتين.

**عندكم كريم أو كلاي (طين) أو بوماد؟**

الكريم أيوة: [كريم جل ٢٥٠ مل](/shop/cream-gel) و[جل واكس ١٤٠ مل](/shop/gel-wax). الكلاي واكس والبوماد اتعملوا برضه — وهما الاتنين المطفيين — بس لسه منزلوش على الموقع. يعني لو اللي انت وراه تحديداً هو التكستشر المطفي، اللي معروض دلوقتي كله بيلمع، وبنقولها بدل ما نبيعلك حاجة على إنها حاجة تانية.

**إيه أقوى منتج عندكم في التثبيت؟**

[الجل](/shop/gel) — التلات ألوان كلهم تثبيت ٥ من ٥، وده أعلى رقم عندنا. وأقوى واكس هو [برو إكس](/product/premium-wax-pro-x) و[برو](/product/premium-wax-pro) بتثبيت ٤. الاختيار بينهم بيعتمد على [نوع شعرك](/hair-types) والفينيش اللي عايزه، مش على قوة أكتر: الجل بينشف ويقفل الشكل، والواكس بيفضل ماشي مع إيدك.

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

- [Shea Butter](/product/premium-wax-shea), [Argan](/product/premium-wax-argan) and [Black](/product/premium-wax-black) wax: hold 3 out of 5
- [Pro X](/product/premium-wax-pro-x) and [Pro](/product/premium-wax-pro): hold 4 out of 5
- [Our gels](/shop/gel) — Golden, Green and Blue: hold 5 out of 5

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

What works is the smallest amount you can get away with, worked through dry hair. The clay wax is the product answer to the shine problem and it is not on the shop yet, so until it lands there is only a quantity answer: every wax listed today is petrolatum and wax, and every one of them finishes with shine. [Pro](/product/premium-wax-pro) at hold 4 is what we list for [fine](/hair-types/fine) hair in the meantime, because the higher number lets you use less, which is the whole trick.

## Thick hair: it collapses under its own weight

Thick hair has the opposite problem. There is plenty for product to grip, but the mass itself is heavy and gravity works on it all day. A hold 3 wax can shape thick hair beautifully at 8am and simply cannot carry it past lunchtime.

This is the clearest case for the top of the wax range. [Pro X](/product/premium-wax-pro-x) is hold 4 out of 5 with a natural finish, listed for wavy and [thick](/hair-types/thick) hair. [Pro](/product/premium-wax-pro) is also 4 out of 5, listed for thick, straight, wavy and fine. For a softer finish, [Shea Butter](/product/premium-wax-shea) sits at 3 out of 5 and is listed for coily, curly and thick hair.

## When you actually need the top of the range

Not every day needs a 5. In an air-conditioned office, mostly sitting, a hold 3 wax is genuinely enough and feels lighter on your hair.

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

- **Go up one level in summer.** If a 3 carries you through winter, try a 4, and if that is not enough, try [the gel](/shop/gel).
- **Cut the shine.** Shiny hair plus sweat looks greasy, not styled. Every wax we make finishes with shine, so the lever here is quantity: half what you normally take, on fully dry hair.
- **Do not add a second layer at midday.** What is on your hair has mixed with sweat and oil; adding more makes it heavy and sticky, not held.
- **Go easier on hot blow-drying.** Hair coming off high heat takes up moisture from the air faster.
- **Wash before you restyle.** A clean start beats any extra scoop.

## Common questions

**Why does my style drop two hours after I style it?**

Usually one of three things: the hold level is below what your hair needs, you used too much and it is falling under its own weight, or you put wax on wet hair, which it is not designed for. Try a higher level with a smaller amount first.

**Should I use more, or switch product?**

Switch to a higher hold level. More product adds weight, not grip. The gap between a hold 3 wax and a hold 4 - or between wax and a hold 5 gel - is far bigger than the gap between one scoop and two.

**Do you sell cream, clay or pomade?**

Cream, yes: there is a [cream gel](/shop/cream-gel) at 250ml and a [gel wax](/shop/gel-wax) at 140ml. The clay wax and the pomade are made too, and they are the two matte ones, but neither is on the shop yet. So if what you want specifically is the matte texture a clay gives you, nothing listed today does it - every wax here finishes with shine. We would rather say so than sell you one thing as another.

**What is your strongest product?**

[The gels](/shop/gel) - Golden, Green and Blue all sit at hold 5 out of 5, the top of the range. The strongest wax is [Pro X](/product/premium-wax-pro-x) and [Pro](/product/premium-wax-pro) at 4. Choosing between them comes down to [your hair type](/hair-types) and the finish you want rather than to strength: gel dries and locks the shape, wax stays workable in your hands all day.

**How do ordering and delivery work?**

Cash on delivery, and we deliver inside Egypt only. Shipping is 30 EGP, free on orders over 300 EGP. You can see [the full range](/shop) and order straight from the site, or read [who we are](/brand) first.',
   'assets/wax-black.webp', 'Star Seven Premium Wax Black', '', 'premium-wax-pro-x',
   'published', now()),
  ('matte-or-shine', 'ar', 'matte-or-shine',
   'واكس مطفي ولا لامع للرجالة؟ اختار على حسب شكلك',
   'الفرق بين المطفي (المات) واللمعة والويت لوك، ومين فيهم يناسبك — والمطفي عندنا كلاي واكس وبوماد، ولسه منزلوش على الموقع.',
   'تصفيف الشعر للرجالة مش قرار واحد، ده قرارين. بتحط الواكس الصبح وتخرج، وبعد ساعتين تبص في المراية تلاقي شعرك بيلمع لمعة مالكش دعوة بيها — أو العكس تمامًا: عايز اللمعة دي بالظبط، وكل حاجة بتجربها بتطلع باهتة وشكلها ناشف.

المشكلة مش في إيدك ولا في طريقة اللف. المشكلة إنك بتختار المنتج على أساس قوة التثبيت بس، وسايب نص القرار التاني: النهاية — مطفي ولا لامع. ودي الحاجة اللي بتحدد شكلك في الشارع أكتر من رقم التثبيت نفسه.

ونقولها من دلوقتي عشان متضيعش وقتك: **المطفي عندنا اسمه كلاي واكس وبوماد، والاتنين اتعملوا بس لسه منزلوش على الموقع.** كل اللي معروض دلوقتي واكس وجل، وأساسهم شمع وفازلين، ومفيش في أي تركيبة فيهم سيليكا ولا نشا ولا طين — ودول اللي بيعملوا المات. يعني لو انت جاي مخصوص تشتري مات النهارده، الصفحة دي هتقولك تعمل إيه لحد ما ينزلوا، مش هتبيعلك حاجة تانية باسمهم.

## مطفي يعني إيه ومين محتاجه

المطفي — والناس بتقول عليه **مات** كمان، والاتنين نفس الحاجة — معناه إن المنتج مبيعكسش الضوء. تحط، تسرّح، والشعر يفضل شكله طبيعي كإنك مش حاطط حاجة أصلًا، مع إنه مثبّت.

خلي بالك من نقطة مهمة: مطفي مش معناه ناشف. الشعر بيفضل لين ولمسته عادية، اللي راح بس هو اللمعان.

ومين محتاجه بالظبط؟

- اللي شغله رسمي أو قدام ناس طول اليوم ومش عايز منظر "لسه خارج من الحمام"
- اللي عايز تكستشر وشكل مبعثر مظبوط، مش شكل مسرّح ولامع
- اللي شعره بيتدهّن بدري واللمعة الزيادة بتفضحه
- اللي بيصوّر نفسه كتير — الفلاش والنور القوي بيكبّروا أي لمعة

لو انت من دول، اللي محتاجه هو **الكلاي واكس** — وهو متعمل، بس لسه منزلش على الموقع. أقرب حاجة تقدر تشتريها النهارده هي [واكس زبدة الشيا](/product/premium-wax-shea): لمعته أقل واحد في المعروض، وتثبيته ٣ من ٥ بمرونة عالية. بس هو لسه بيلمع — أقل، مش صفر.

## اللمعة بتعمل إيه في شكل الشعر

اللمعة مش صفة مكتوبة على العلبة وخلاص، دي طريقة الضوء بيترد بيها من على شعرك. السطح اللامع بيرجّع الضوء في اتجاه واحد، فالعين بتشوف الشعر كأنه قطعة واحدة مصمتة ومرتبة. السطح المطفي بيبعتر الضوء، فالعين بتفرّق بين الشعرة واللي جنبها — وده بالظبط اللي بنسميه تكستشر.

وعشان كده نفس التسريحة بالظبط ممكن تبان مرتبة ولامعة، وممكن تبان مبعثرة وفيها تكستشر — من غير ما تغيّر حاجة في قوة التثبيت. القرار في النهاية بس.

وكل نوع شعر بيتفاعل مع القاعدة دي بشكل مختلف: الكثافة وشكل الكيرلة هما اللي بيقرروا اللمعة تبقى في صفك ولا ضدك. لو مش متأكد من نوع شعرك أو من المنتج المتظبط ليه، ابدأ من [أنواع الشعر](/hair-types) — كل نوع ليه صفحة بتحسم الاختيار، زي [الشعر الخفيف](/hair-types/fine) اللي ليه قواعد مختلفة تمامًا عن غيره.

## تقلل اللمعة إزاي لحد ما الكلاي ينزل

اللمعة جزء من تركيبة الواكس ومش هتشيلها، بس تقدر تنزّلها بشكل محسوس بتلات حاجات:

- **نص الكمية.** ده أكبر فرق ممكن تعمله. حتة قد الحمصة بدل قد البندقة.
- **شعر ناشف تماماً.** المية بتزوّد اللمعة وبتخلي المنتج يقعد على السطح بدل ما يدخل.
- **بعّد عن الجذور.** اللمعة بتبان أكتر عند الفروة، وهناك بالظبط بتتخلط بالزيت الطبيعي وتقرا دهون.

التلاتة دول مع بعض بيوصلوك لشكل طبيعي معقول. مش مات، بس مش لامع لدرجة تزعجك.

## اللمعة والويت لوك: مين تناسبه

مش كل الناس عايزة مطفي، ومفيش حاجة غلط في اللمعة. اللوك المرتّب اللامع — الويت لوك — لسه هو اللوك الرسمي الأول في مصر: فرح، شغل، مناسبة، سشوار جنب مظبوط.

اللمعة بتناسب:

- التسريحات الكلاسيك بفرق جنب
- الشعر اللي عايزه يبان ملموم ومحدد الخط
- المناسبات اللي عايز فيها شكل واضح إنك مصفف شعرك

بس اعرف حاجة: لو شعرك بيتدهّن بسرعة، اللمعة هتخلي الدهون تبان أسرع، لأن العين مش هتفرق بين لمعة المنتج ولمعة الزيت. في الحالة دي قلل الكمية وابعد عن الجذور خالص.

واللي بيدي الويت لوك عندنا هو [الجل الجولدن](/product/premium-gel-golden) — ٢٥٠ مل بـ ٤٠ جنيه، تثبيت ٥ من ٥ ولمعة عالية.

## الشيا مقابل الجل الجولدن

لو الاختيار عندك بين أقل لمعة وأعلى لمعة في التشكيلة، دول الاتنين:

- **الشكل النهائي** — الشيا لمعته هادية وفينيشه ناعم. الجولدن لمعة عالية وويت لوك واضح.
- **التثبيت** — الشيا ٣ من ٥ ومرن، تقدر تعدّله طول اليوم. الجولدن ٥ من ٥ وبينشف على الشكل.
- **نوع الشعر** — الشيا للخشن والكيرلي والكثيف. الجولدن للمفرود.
- **النوع والحجم والسعر** — الشيا واكس ١٢٠ مل بـ ٤٥ جنيه. الجولدن جل ٢٥٠ مل بـ ٤٠ جنيه.

ونصيحة من عندنا، مش مواصفة مكتوبة على المنتج: ابدأ بكمية صغيرة قوي وزوّد بعد كده لو محتاج. الرجوع من كمية قليلة سهل، لكن لما تزوّد من الأول مفيش حل غير إنك تغسل وتبدأ تاني. ولو لسه محتار بين النوعين أصلًا، اتفرج على [الواكس كله](/shop/wax) و[الجل كله](/shop/gel) وقارن التثبيت والنهاية جنب بعض.

## وحاجة عن واكس بلاك بالذات

بلاك كان مكتوب عليه عندنا "مطفي" لفترة، وده كان غلط منّنا وصلّحناه. [واكس بلاك](/product/premium-wax-black) لمعته **عالية**، وتثبيته ٣ من ٥، وشغلانته الحقيقية حاجة تانية خالص: **بيغطي الشيب**. الصبغة الوحيدة في التركيبة هي CI 77266 السودا، فبيسيب لون أسود لامع على الشعرة وإنت بتوزّعه.

يعني لو انت جاي على بلاك عشان المات، ده مش هو. ولو عندك شيب وعايز تغطيه وإنت بتصفف، ده بالظبط هو.

## بصراحة: الكلاي والبوماد اتعملوا، ولسه منزلوش

كتير بيسأل: عندكم كلاي (طين) ولا بوماد؟ الرد: اتعملوا، بس لسه مش على الموقع.

المعروض دلوقتي واكس وجل وجل واكس وكريم جل، وكلهم بيلمعوا. الكلاي واكس والبوماد هما الاتنين المطفيين، وهما اللي هيدّوا الشكل الناشف اللي بتدور عليه — والاتنين في الطريق.

واللي بيسأل على الكلاي، لما نسأله عايزه ليه، الرد اللي بيتكرر هو نفسه: عايز شكل مطفي وفيه تكستشر. لو ده اللي انت وراه فعلًا، متشتريش واكس على أساس إنه هيعمله — إما تستنى الكلاي، وإما تجرّب الشيا بنص الكمية وانت عارف إنك بتقرّب من الشكل مش بتوصله. ومش هنقولك إن الواكس ده "كلاي" عشان نبيع.

## أسئلة بتتسأل كتير

**المطفي والمات نفس الحاجة؟**

أيوة. مطفي هي الكلمة العربي، ومات هي الكلمة الإنجليزي (matte) اللي دخلت العامية. الاتنين معناهم منتج مبيلمعش.

**ممكن أخلي الواكس اللامع مطفي؟**

مش بجد. تقدر تقلل اللمعة شوية لو قلّلت الكمية وحطيت على شعر ناشف، بس اللمعة جزء من التركيبة نفسها ومش هتشيلها.

**عندكم أي منتج مطفي خالص؟**

فيه اتنين — الكلاي واكس والبوماد — بس لسه مش معروضين على الموقع. كل اللي معروض النهارده أساسه شمع وفازلين وبينهي بلمعة، ومفيش في تركيبته أي مادة بتعمل مات.

**أقدر أحط واكس وجل مع بعض؟**

مفيش مانع، وناس بتعمل كده عشان تجمع بين تثبيت وشكل. بس خد بالك: الجل بيزوّد اللمعة، مش بيقللها. لو اللمعة مضايقاك، خليك على الواكس لوحده بكمية قليلة.

**شعري كثيف وعايز مطفي، أعمل إيه؟**

المات اللي جاي هو الكلاي واكس والبوماد، والبوماد بالذات متظبط للشعر المتوسط والكثيف. لحد ما ينزلوا، أقرب حاجة هي [الشيا](/product/premium-wax-shea) بكمية صغيرة على شعر ناشف — وهو متسجل على [الشعر الكثيف](/hair-types/thick) فعلاً.

**الشحن والدفع بيتم إزاي؟**

الشحن ٣٠ جنيه، ومجاني فوق ٣٠٠ جنيه. الدفع عند الاستلام كاش، والتوصيل داخل مصر.',
   'assets/wax-purple.webp', 'Star Seven Premium Wax Shea Butter', '', 'premium-wax-shea',
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

- **Level 5** — the strongest hold we make: all three [gels](/shop/gel), [Golden](/product/premium-gel-golden), [Green](/product/premium-gel-green) and [Blue](/product/premium-gel-blue).
- **Level 4** — the strongest of the waxes: [Pro X](/product/premium-wax-pro-x) and [Pro](/product/premium-wax-pro).
- **Level 3** — strong but softer and easier to rework: [Shea Butter](/product/premium-wax-shea), [Argan](/product/premium-wax-argan) and [Black](/product/premium-wax-black).

The numbers run across the whole range, not inside each format, which is why the gels sit above the waxes: a gel dries into a cast and a wax never fully sets. That is the same reason a level 3 wax can suit you better than a level 5 gel - the higher number is not the better product, it is the less forgiving one.

## Finish is a separate decision from hold

Two products can have the same hold level and look completely different in daylight, so pick the finish on purpose rather than by accident.

- **Lowest shine** — [Shea Butter](/product/premium-wax-shea). Nothing listed today is matte: the clay wax and the pomade are, and neither is on the shop yet. This is the closest of what you can buy now, and it is still a soft shine rather than none.
- **Natural finish** — [Pro X](/product/premium-wax-pro-x), built on the Wave & Groom formula.
- **Nourishing** — [Argan](/product/premium-wax-argan).
- **Covers grey** — [Black](/product/premium-wax-black). High shine, and the only colourant in it is CI 77266 black, so it leaves a glossy black tone as you work it in.
- **High shine, wet look** — [Golden gel](/product/premium-gel-golden). This is a deliberate wet look, not an accident of application.
- **Classic, all day** — [Blue gel](/product/premium-gel-blue). [Green gel](/product/premium-gel-green) is the same hold with a clean scent.

Finish is the part that photographs lie about. Under a shop light almost everything looks glossy. In daylight, the gap between a soft shine and a wet look is the gap between looking styled and looking wet, and that gap is bigger than any one hold level.

## Size and price, and why the two formats differ

Every wax is 120ml at 45 EGP. Every gel is 250ml at 40 EGP. [Pro X](/product/premium-wax-pro-x) was 55 EGP and is currently 45 EGP like the rest of the waxes.

The gel comes in the bigger jar at the lower price, and that is not a discount — it is how the two formats get used. Gel is spread through wet hair across the whole head in one go. Wax is warmed between the palms and worked into specific sections a little at a time. Different jars for different handfuls.

If you want to see everything side by side: [all the waxes](/shop/wax), [all the gels](/shop/gel), or [the full wax and gel range](/shop).

## What we do not sell — and why we are telling you

The shop lists wax, gel, gel wax and cream gel. The clay wax and the pomade are made but not listed yet, and there is no shampoo.

So if a grooming article tells you your hair needs a clay, you cannot buy one here today, and we would rather say that than sell you a wax with a clay-shaped description on it. A short range you can actually understand beats a long one you cannot. What the brand does and does not carry is set out on [the brand page](/brand).

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

The three gels are level 5 out of 5, the top of the range. Pro X and Pro are level 4, the strongest of the waxes. Shea Butter, Argan and Black are level 3. Those are the numbers the brand publishes per product, and we do not dress them up beyond that.

**What size are they and how much do they cost?**

Every wax is 120ml at 45 EGP. Every gel is 250ml at 40 EGP. Pro X was 55 EGP and is currently 45 EGP.

**How does delivery work?**

Delivery is 30 EGP anywhere in Egypt, and it is free on orders over 300 EGP. Payment is cash on delivery only, and we ship inside Egypt only.

**My hair always looks greasy by the afternoon. Does that rule out wax?**

Not by itself — greasy-looking is usually a finish question before it is a format question. The wet-look gel will read as greasy on you fastest, and the lowest-shine wax in a small amount on dry hair will read as hair. That is a comment on how a finish looks once it is on your head, not scalp advice. If it is your scalp itself that is bothering you, that is a question for a doctor and not for a hair-wax shop.',
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

ممكن يكون عندك منتج تثبيته ٣ من ٥ ولمعته عالية (زي [واكس بلاك](/product/premium-wax-black))، ومنتج تاني تثبيته ٥ من ٥ ولمعته عالية برضه (زي [جل جولدن](/product/premium-gel-golden)) — ومنتج تالت تثبيته ٣ ولمعته هادية (زي [الشيا](/product/premium-wax-shea)). اللمعة العالية بتخدع العين وبتخلي الشعر يبان "متماسك" أكتر مما هو فعلاً — وبعد ساعتين تكتشف إن اللمعة لسه موجودة والاستايل راح.

يعني لما تختار، اختار على محورين مش محور واحد: **التثبيت اللي محتاجه** و**الشكل النهائي اللي عايزه**.

## درجات التثبيت في التشكيلة كلها: ٣ و٤ و٥

دي التشكيلة بالكامل بالأرقام، من غير لف ودوران:

- **[جل جولدن](/product/premium-gel-golden) — تثبيت ٥ من ٥** — مظهر مبلول ولمعة عالية.
- **[جل أخضر](/product/premium-gel-green) — تثبيت ٥ من ٥** — ريحة نضيفة.
- **[جل أزرق](/product/premium-gel-blue) — تثبيت ٥ من ٥** — كلاسيك، لطول اليوم.
- **[برو إكس](/product/premium-wax-pro-x) — واكس — تثبيت ٤ من ٥** — تركيبة Wave & Groom، شكل نهائي طبيعي. للشعر المتموج والكثيف. 45 جنيه بدل 55.
- **[واكس برو](/product/premium-wax-pro) — تثبيت ٤ من ٥** — لليومي. للشعر الكثيف والمفرود والمتموج والخفيف.
- **[واكس زبدة الشيا](/product/premium-wax-shea) — تثبيت ٣ من ٥** — شكل نهائي طري وأقل لمعة في التشكيلة. للشعر الخشن والكيرلي والكثيف.
- **[واكس الأرجان](/product/premium-wax-argan) — تثبيت ٣ من ٥** — مغذّي. للكيرلي والخشن والمتموج.
- **[واكس بلاك](/product/premium-wax-black) — تثبيت ٣ من ٥** — بيغطي الشيب، لمعته عالية. للمتموج والكثيف.

الواكس كله 120 مل بـ 45 جنيه. الجل كله 250 مل بـ 40 جنيه.

من الليستة دي تلات ملاحظات تستاهل تتقال بصوت عالي:

**واحد: الجل فوق الواكس في الرقم، مش تحته.** الجل بينشف ويقفل الشكل، والواكس بيفضل ماشي مع إيدك — عشان كده الجل بياخد ٥ والواكس أقصاه ٤. الرقم الأعلى مش المنتج الأحسن، هو المنتج الأقل تسامح.

**اتنين: مفيش منتج مطفي معروض دلوقتي.** كل الواكس المعروض أساسه شمع وفازلين وبينهي بلمعة. أقل لمعة فيهم هي [زبدة الشيا](/product/premium-wax-shea)، وهي برضه مش مات. و[واكس بلاك](/product/premium-wax-black) — اللي كان مكتوب عليه مطفي عندنا لفترة وده كان غلط — لمعته عالية، وشغلانته الحقيقية إنه بيغطي الشيب.

**تلاتة: الكلاي والبوماد اتعملوا بس لسه منزلوش على الموقع.** الكريم موجود دلوقتي — في [كريم جل](/shop/cream-gel) و[جل واكس](/shop/gel-wax). فلو انت جاي تدوّر على كلاي، خلّيك عارف إنك مش هتقدر تشتريه من هنا النهارده.

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

**١. شعرك بياخد وزن ولا لأ؟** كيرلي، خشن، متموج، أو كثيف؟ روح على [الواكس](/shop/wax) على طول. ناعم مفرود؟ [الجل](/shop/gel) هو اللي ليك. شعر خفيف؟ [واكس برو](/product/premium-wax-pro) بكمية صغيرة جداً — وإحنا مبنعملش حاجة متظبطة مخصوص للخفيف، وبنقولها بصراحة في [صفحته](/hair-types/fine).

**٢. عايز ترجع تعدّل الاستايل خلال اليوم؟** أيوة؟ واكس. لأ، عايز شكل واحد يقفل ويفضل؟ [جل](/shop/gel).

**٣. عايز لمعة ولا لأ؟** لمعة عالية ومظهر مبلول = [جل جولدن](/product/premium-gel-golden). أقل لمعة ممكنة عندنا = [زبدة الشيا](/product/premium-wax-shea). شكل طبيعي بينهم = [برو إكس](/product/premium-wax-pro-x).

تلات إجابات وتكون وصلت. ولو الإجابات وقعت على منتجين، خد الأرخص في الأول وجرّب — [إحنا](/brand) بنبيع كاش عند الاستلام عشان بالظبط السبب ده.

## أسئلة بتتسأل كتير

**أقدر أستخدم الواكس والجل مع بعض؟**

ينفع، بس مش مخلوطين في إيدك. الترتيب المنطقي: جل على الشعر المبلول عشان يبني الأساس والشكل، وبعد ما ينشف تماماً حبة واكس صغيرة جداً بين الصوابع للأطراف عشان التعريف. لو خلطتهم قبل ما تحطهم، النتيجة هتبقى كتلة مش هتتوزع كويس. ولو انت لسه بتجرب، ابدأ بواحد بس عشان تعرف مين اللي عمل الفرق.

**الجل تثبيته ٥ يعني أحسن من الواكس تثبيته ٤ في كل الحالات؟**

الرقم بيقول التثبيت، مش المناسبة. على شعر ناعم مفرود مش ماسك شكل، أيوة — الـ ٥ هيصمد والـ ٤ لأ. لكن على شعر كيرلي أو خشن، الجل بينشف ويقفل الكيرلة ويخليها قشرة، والواكس بتثبيت ٣ يطلع أحسن عملياً. الرقم مهم، بس نوع شعرك بيجي الأول — وده اللي [صفحات أنواع الشعر](/hair-types) بتحسمه.

**الجل هيسيب شعري ناشف؟**

الجل بينشف على الشعر — ده بالظبط اللي بيمسك بيه الشكل. الإحساس ده جزء من طريقة شغله، مش عيب فيه. لو مش مريحك، الواكس هو اللي يناسبك عشان بيفضل طري وما بينشفش على الشعرة.

**الجل عندكم ليه كله تثبيت ٥ من ٥؟**

عشان التلاتة فعلاً نفس التركيبة بنفس درجة التثبيت — الفرق بينهم في اللمعة والريحة والمظهر النهائي، مش في القوة. [جولدن](/product/premium-gel-golden) و[الأخضر](/product/premium-gel-green) و[الأزرق](/product/premium-gel-blue) كلهم على نفس الرقم، ومش هنخترع فرق مش موجود عشان الليستة تبقى شكلها أحسن.

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

-- ---------------------------------------------------------------------------
--  Point the oldest two articles at the hub, not at a scroll position
--
--  'choose-hair-product-by-hair-type' is the short version of what /hair-types
--  says at length, and it closed by linking to '/#hair' — an anchor on the home
--  page. So the one article most likely to rank for "which product for my hair
--  type" sent its readers to a widget rather than to the page written to answer
--  that exact question, and the two competed for the same query with no link
--  between them to say which one Google should prefer.
--
--  Language-correct on purpose: English articles live under /en, so an English
--  body linking '/hair-types' would drop an English reader onto the Arabic hub.
--
--  This is an UPDATE rather than an edit to the INSERT above it because that
--  block is ON CONFLICT DO NOTHING — the rows already exist in production, so
--  changing the literal there would change nothing. Guarded by LIKE so it is a
--  no-op on every deploy after the first, and so it cannot touch a body an
--  admin has since rewritten.
-- ---------------------------------------------------------------------------
UPDATE articles
   SET body = replace(body, '](/#hair)', CASE WHEN lang = 'en' THEN '](/en/hair-types)' ELSE '](/hair-types)' END),
       updated_at = now()
 WHERE body LIKE '%](/#hair)%';


-- ---------------------------------------------------------------------------
--  The rest of the New Star Seven range (55 products)
--
--  Taken from the Ovanza catalogue: names in both languages, sizes, hero
--  ingredient and pack colour are all theirs. The eight the shop already sells
--  are deliberately absent — those rows belong to the client now.
--
--  Every row lands `active = FALSE` with `price = 0`. The manufacturer feed
--  carries no prices, and a guessed price on a cash-on-delivery shop becomes
--  an argument at the door. The client prices them in the admin and switches
--  them on; until then they are invisible to the storefront, the sitemap and
--  the feed.
--
--  (No apostrophes in this comment on purpose: db/seed.sql is split on
--  semicolons by a parser that tracks quote state, and a stray apostrophe in
--  a comment reads as an unterminated string literal.)
--
--  DO NOTHING, so re-running never resurrects a product the client has
--  deleted, nor reverts a price they have set.
-- ---------------------------------------------------------------------------
INSERT INTO products
  (sku, slug, kind, name_ar, name_en, sub_ar, sub_en, chip_ar, chip_en,
   price, color, image, size_ml, hold_level, hair_types, stock, active, sort)
VALUES
  ('S7-W120-COCONU', 'wax-120-coconut', 'wax',
   'واكس بريميوم نيو ستار سفن 120 ملل - بزيت جوزالهند', 'Premium Wax 120ml — Coconut Oil',
   '120 مل · زيت جوز الهند', '120ml · Coconut Oil',
   'زيت جوز الهند', 'Coconut Oil',
   0, '#E8E2D3', 'assets/catalog/wax-120-coconut.webp', 120, 3, '', 0, FALSE, 10),
  ('S7-W135-OLIVE', 'wax-135-olive', 'wax',
   'واكس شعر نيو ستار سفن 135 ملل - بزيت الزيتون', 'Hair Wax 135ml — Olive Oil',
   '135 مل · زيت الزيتون', '135ml · Olive Oil',
   'زيت الزيتون', 'Olive Oil',
   0, '#6E8B3D', 'assets/catalog/wax-135-olive.webp', 135, 3, '', 0, FALSE, 20),
  ('S7-W135-ARGAN', 'wax-135-argan', 'wax',
   'واكس شعر نيو ستار سفن 135 ملل - بزيت الأرجان', 'Hair Wax 135ml — Argan Oil',
   '135 مل · زيت الأرجان', '135ml · Argan Oil',
   'زيت الأرجان', 'Argan Oil',
   0, '#2A6DE8', 'assets/catalog/wax-135-argan.webp', 135, 3, '', 0, FALSE, 21),
  ('S7-W135-COCONU', 'wax-135-coconut', 'wax',
   'واكس شعر نيو ستار سفن 135 ملل - بزيت جوز الهند', 'Hair Wax 135ml — Coconut Oil',
   '135 مل · زيت جوز الهند', '135ml · Coconut Oil',
   'زيت جوز الهند', 'Coconut Oil',
   0, '#E8E2D3', 'assets/catalog/wax-135-coconut.webp', 135, 3, '', 0, FALSE, 22),
  ('S7-W135-SHEA', 'wax-135-shea', 'wax',
   'واكس شعر نيو ستار سفن 135 ملل - بزبدة الشيا', 'Hair Wax 135ml — Shea Butter',
   '135 مل · زبدة الشيا', '135ml · Shea Butter',
   'زبدة الشيا', 'Shea Butter',
   0, '#8B4DC9', 'assets/catalog/wax-135-shea.webp', 135, 3, '', 0, FALSE, 23),
  ('S7-W125-BLACKS', 'wax-125-black-seed', 'wax',
   'واكس شعر نيو ستار سفن 125 ملل - بحبة البركة السوداء', 'Hair Wax 125ml — Black Seed',
   '125 مل · حبة البركة', '125ml · Black Seed',
   'حبة البركة', 'Black Seed',
   0, '#3A3A3A', 'assets/catalog/wax-125-black-seed.webp', 125, 3, '', 0, FALSE, 30),
  ('S7-GW140-ARGAN', 'gel-wax-140-argan', 'gelwax',
   'جل واكس للشعر نيوستارسفن 140ملل - بزيت الأرجان', 'Gel Wax 140ml — Argan Oil',
   '140 مل · زيت الأرجان', '140ml · Argan Oil',
   'زيت الأرجان', 'Argan Oil',
   0, '#2A6DE8', 'assets/catalog/gel-wax-140-argan.webp', 140, 3, '', 0, FALSE, 40),
  ('S7-GW140-JOJOBA', 'gel-wax-140-jojoba', 'gelwax',
   'جل واكس للشعر نيوستارسفن 140ملل - بزيت الجوجوبا', 'Gel Wax 140ml — Jojoba Oil',
   '140 مل · زيت الجوجوبا', '140ml · Jojoba Oil',
   'زيت الجوجوبا', 'Jojoba Oil',
   0, '#C8A24A', 'assets/catalog/gel-wax-140-jojoba.webp', 140, 3, '', 0, FALSE, 41),
  ('S7-GW140-COCONU', 'gel-wax-140-coconut', 'gelwax',
   'جل واكس للشعر نيوستارسفن 140ملل - بزيت جوزالهند', 'Gel Wax 140ml — Coconut Oil',
   '140 مل · زيت جوز الهند', '140ml · Coconut Oil',
   'زيت جوز الهند', 'Coconut Oil',
   0, '#E8E2D3', 'assets/catalog/gel-wax-140-coconut.webp', 140, 3, '', 0, FALSE, 42),
  ('S7-GW140-ROSEMA', 'gel-wax-140-rosemary', 'gelwax',
   'جل واكس للشعر نيوستارسفن 140ملل - بزيت الروزماري', 'Gel Wax 140ml — Rosemary Oil',
   '140 مل · زيت الروزماري', '140ml · Rosemary Oil',
   'زيت الروزماري', 'Rosemary Oil',
   0, '#4E7A4E', 'assets/catalog/gel-wax-140-rosemary.webp', 140, 3, '', 0, FALSE, 43),
  ('S7-GW140-SHEA', 'gel-wax-140-shea', 'gelwax',
   'جل واكس للشعر نيوستارسفن 140ملل - بزبدة الشيا', 'Gel Wax 140ml — Shea Butter',
   '140 مل · زبدة الشيا', '140ml · Shea Butter',
   'زبدة الشيا', 'Shea Butter',
   0, '#8B4DC9', 'assets/catalog/gel-wax-140-shea.webp', 140, 3, '', 0, FALSE, 44),
  ('S7-GW140-ALOEVE', 'gel-wax-140-aloe-vera', 'gelwax',
   'جل واكس للشعر نيوستارسفن 140ملل - بخلاصة الصبار', 'Gel Wax 140ml — Aloe Vera',
   '140 مل · الصبار', '140ml · Aloe Vera',
   'الصبار', 'Aloe Vera',
   0, '#5E9C2B', 'assets/catalog/gel-wax-140-aloe-vera.webp', 140, 3, '', 0, FALSE, 45),
  ('S7-G250-WHITE', 'gel-250-white', 'gel',
   'جل نيوستارسفن بريميوم- ابيض', 'Premium Gel 250ml — White',
   '250 مل · أبيض', '250ml · White',
   'أبيض', 'White',
   0, '#E9E9E9', 'assets/catalog/gel-250-white.webp', 250, 5, '', 0, FALSE, 50),
  ('S7-G250-BLACK', 'gel-250-black', 'gel',
   'جل نيوستارسفن بريميوم- اسود', 'Premium Gel 250ml — Black',
   '250 مل · أسود', '250ml · Black',
   'أسود', 'Black',
   0, '#2A2A2A', 'assets/catalog/gel-250-black.webp', 250, 5, '', 0, FALSE, 51),
  ('S7-SG250-WHITE', 'styling-gel-250-white', 'gel',
   'جل نيوستارسفن لتثبيت الشعر- ابيض', 'Styling Gel 250ml — White',
   '250 مل · أبيض', '250ml · White',
   'أبيض', 'White',
   0, '#E9E9E9', 'assets/catalog/styling-gel-250-white.webp', 250, 4, '', 0, FALSE, 60),
  ('S7-SG250-BLACK', 'styling-gel-250-black', 'gel',
   'جل نيوستارسفن لتثبيت الشعر-اسود', 'Styling Gel 250ml — Black',
   '250 مل · أسود', '250ml · Black',
   'أسود', 'Black',
   0, '#2A2A2A', 'assets/catalog/styling-gel-250-black.webp', 250, 4, '', 0, FALSE, 61),
  ('S7-SG250-BLUE', 'styling-gel-250-blue', 'gel',
   'جل نيوستارسفن لتثبيت الشعر- ازرق', 'Styling Gel 250ml — Blue',
   '250 مل · أزرق', '250ml · Blue',
   'أزرق', 'Blue',
   0, '#2A6DE8', 'assets/catalog/styling-gel-250-blue.webp', 250, 4, '', 0, FALSE, 62),
  ('S7-SG250-YELLOW', 'styling-gel-250-yellow', 'gel',
   'جل نيوستارسفن لتثبيت الشعر- اصفر', 'Styling Gel 250ml — Yellow',
   '250 مل · أصفر', '250ml · Yellow',
   'أصفر', 'Yellow',
   0, '#D9A81E', 'assets/catalog/styling-gel-250-yellow.webp', 250, 4, '', 0, FALSE, 63),
  ('S7-SG650-WHITE', 'styling-gel-650-white', 'gel',
   'جل شعر نيو ستار سفن 650 ملل - أبيض', 'Styling Gel 650ml — White',
   '650 مل · أبيض', '650ml · White',
   'أبيض', 'White',
   0, '#E9E9E9', 'assets/catalog/styling-gel-650-white.webp', 650, 4, '', 0, FALSE, 70),
  ('S7-SG650-BLACK', 'styling-gel-650-black', 'gel',
   'جل شعر نيو ستار سفن 650 ملل - أسود', 'Styling Gel 650ml — Black',
   '650 مل · أسود', '650ml · Black',
   'أسود', 'Black',
   0, '#2A2A2A', 'assets/catalog/styling-gel-650-black.webp', 650, 4, '', 0, FALSE, 71),
  ('S7-SG650-BLUE', 'styling-gel-650-blue', 'gel',
   'جل شعر نيو ستار سفن 650 ملل - أزرق', 'Styling Gel 650ml — Blue',
   '650 مل · أزرق', '650ml · Blue',
   'أزرق', 'Blue',
   0, '#2A6DE8', 'assets/catalog/styling-gel-650-blue.webp', 650, 4, '', 0, FALSE, 72),
  ('S7-SG650-YELLOW', 'styling-gel-650-yellow', 'gel',
   'جل شعر نيو ستار سفن 650 ملل - أصفر', 'Styling Gel 650ml — Yellow',
   '650 مل · أصفر', '650ml · Yellow',
   'أصفر', 'Yellow',
   0, '#D9A81E', 'assets/catalog/styling-gel-650-yellow.webp', 650, 4, '', 0, FALSE, 73),
  ('S7-SG850-WHITE', 'styling-gel-850-white', 'gel',
   'جل شعر نيو ستار سفن 850 ملل - أبيض', 'Styling Gel 850ml — White',
   '850 مل · أبيض', '850ml · White',
   'أبيض', 'White',
   0, '#E9E9E9', 'assets/catalog/styling-gel-850-white.webp', 850, 4, '', 0, FALSE, 80),
  ('S7-SG850-BLACK', 'styling-gel-850-black', 'gel',
   'جل شعر نيو ستار سفن 850 ملل - أسود', 'Styling Gel 850ml — Black',
   '850 مل · أسود', '850ml · Black',
   'أسود', 'Black',
   0, '#2A2A2A', 'assets/catalog/styling-gel-850-black.webp', 850, 4, '', 0, FALSE, 81),
  ('S7-SG850-BLUE', 'styling-gel-850-blue', 'gel',
   'جل شعر نيو ستار سفن 850 ملل - أزرق', 'Styling Gel 850ml — Blue',
   '850 مل · أزرق', '850ml · Blue',
   'أزرق', 'Blue',
   0, '#2A6DE8', 'assets/catalog/styling-gel-850-blue.webp', 850, 4, '', 0, FALSE, 82),
  ('S7-SG850-YELLOW', 'styling-gel-850-yellow', 'gel',
   'جل شعر نيو ستار سفن 850 ملل - أصفر', 'Styling Gel 850ml — Yellow',
   '850 مل · أصفر', '850ml · Yellow',
   'أصفر', 'Yellow',
   0, '#D9A81E', 'assets/catalog/styling-gel-850-yellow.webp', 850, 4, '', 0, FALSE, 83),
  ('S7-GS20-SACHET', 'gel-sachet-20-sachets', 'gel',
   'جل شعر أكياس نيو ستار سفن 20 ملل', 'Styling Gel 20ml — Sachets',
   '20 مل · أكياس', '20ml · Sachets',
   'أكياس', 'Sachets',
   0, '#2A6DE8', 'assets/catalog/gel-sachet-20-sachets.webp', 20, 4, '', 0, FALSE, 90),
  ('S7-GS14-SACHET', 'gel-sachet-14-sachets', 'gel',
   'جل شعر أكياس نيو ستار سفن 14 ملل', 'Styling Gel 14ml — Sachets',
   '14 مل · أكياس', '14ml · Sachets',
   'أكياس', 'Sachets',
   0, '#2A6DE8', 'assets/catalog/gel-sachet-14-sachets.webp', 14, 4, '', 0, FALSE, 91),
  ('S7-CG250-BEESWA', 'cream-gel-250-beeswax', 'cream',
   'كريم جل نيو ستار سفن 250 ملل - بعسل النحل', 'Cream Gel 250ml — Beeswax',
   '250 مل · شمع العسل', '250ml · Beeswax',
   'شمع العسل', 'Beeswax',
   0, '#D9A81E', 'assets/catalog/cream-gel-250-beeswax.webp', 250, 3, '', 0, FALSE, 100),
  ('S7-CG250-OLIVE', 'cream-gel-250-olive', 'cream',
   'كريم جل نيو ستار سفن 250 ملل - بزيت الزيتون', 'Cream Gel 250ml — Olive Oil',
   '250 مل · زيت الزيتون', '250ml · Olive Oil',
   'زيت الزيتون', 'Olive Oil',
   0, '#6E8B3D', 'assets/catalog/cream-gel-250-olive.webp', 250, 3, '', 0, FALSE, 101),
  ('S7-CG250-ARGAN', 'cream-gel-250-argan', 'cream',
   'كريم جل نيو ستار سفن 250 ملل - بزيت الأرجان', 'Cream Gel 250ml — Argan Oil',
   '250 مل · زيت الأرجان', '250ml · Argan Oil',
   'زيت الأرجان', 'Argan Oil',
   0, '#2A6DE8', 'assets/catalog/cream-gel-250-argan.webp', 250, 3, '', 0, FALSE, 102),
  ('S7-CG250-JOJOBA', 'cream-gel-250-jojoba', 'cream',
   'كريم جل نيو ستار سفن 250 ملل - بزيت الجوجوبا', 'Cream Gel 250ml — Jojoba Oil',
   '250 مل · زيت الجوجوبا', '250ml · Jojoba Oil',
   'زيت الجوجوبا', 'Jojoba Oil',
   0, '#C8A24A', 'assets/catalog/cream-gel-250-jojoba.webp', 250, 3, '', 0, FALSE, 103),
  ('S7-CG250-BLACKS', 'cream-gel-250-black-seed', 'cream',
   'كريم جل نيو ستار سفن 250 ملل - بزيت حبة البركة', 'Cream Gel 250ml — Black Seed',
   '250 مل · حبة البركة', '250ml · Black Seed',
   'حبة البركة', 'Black Seed',
   0, '#3A3A3A', 'assets/catalog/cream-gel-250-black-seed.webp', 250, 3, '', 0, FALSE, 104),
  ('S7-CG250-COCONU', 'cream-gel-250-coconut', 'cream',
   'كريم جل نيو ستار سفن 250 ملل - بزيت جوز الهند', 'Cream Gel 250ml — Coconut Oil',
   '250 مل · زيت جوز الهند', '250ml · Coconut Oil',
   'زيت جوز الهند', 'Coconut Oil',
   0, '#E8E2D3', 'assets/catalog/cream-gel-250-coconut.webp', 250, 3, '', 0, FALSE, 105),
  ('S7-HS500-ULTRAS', 'hair-spray-500-ultra-strong', 'spray',
   'سبراي مثبت للشعر نيو ستار سفن 500 ملل - ثبات قوي جدا', 'Hair Spray 500ml — Ultra Strong',
   '500 مل · ثبات قوي جداً', '500ml · Ultra Strong',
   'ثبات قوي جداً', 'Ultra Strong',
   0, '#D7291D', 'assets/catalog/hair-spray-500-ultra-strong.webp', 500, 5, '', 0, FALSE, 110),
  ('S7-HS500-STRONG', 'hair-spray-500-strong', 'spray',
   'سبراي مثبت للشعر نيو ستار سفن 500 ملل - ثبات قوي', 'Hair Spray 500ml — Strong',
   '500 مل · ثبات قوي', '500ml · Strong',
   'ثبات قوي', 'Strong',
   0, '#2A6DE8', 'assets/catalog/hair-spray-500-strong.webp', 500, 5, '', 0, FALSE, 111),
  ('S7-C180-MAGIC', 'cologne-180-magic', 'cologne',
   'كولونيا بعد الحلاقة نيو ستار سفن 180 ملل - Magic', 'After-Shave Cologne 180ml — Magic',
   '180 مل · ماجيك', '180ml · Magic',
   'ماجيك', 'Magic',
   0, '#8B4DC9', 'assets/catalog/cologne-180-magic.webp', 180, 3, '', 0, FALSE, 120),
  ('S7-C180-FRESH', 'cologne-180-fresh', 'cologne',
   'كولونيا بعد الحلاقة نيو ستار سفن 180 ملل - Fresh', 'After-Shave Cologne 180ml — Fresh',
   '180 مل · فريش', '180ml · Fresh',
   'فريش', 'Fresh',
   0, '#5E9C2B', 'assets/catalog/cologne-180-fresh.webp', 180, 3, '', 0, FALSE, 121),
  ('S7-C180-AQUA', 'cologne-180-aqua', 'cologne',
   'كولونيا بعد الحلاقة نيو ستار سفن 180 ملل - AQUA', 'After-Shave Cologne 180ml — Aqua',
   '180 مل · أكوا', '180ml · Aqua',
   'أكوا', 'Aqua',
   0, '#2A9DE8', 'assets/catalog/cologne-180-aqua.webp', 180, 3, '', 0, FALSE, 122),
  ('S7-C180-ECHO', 'cologne-180-echo', 'cologne',
   'كولونيا بعد الحلاقة نيو ستار سفن 180 ملل - Echo', 'After-Shave Cologne 180ml — Echo',
   '180 مل · إيكو', '180ml · Echo',
   'إيكو', 'Echo',
   0, '#4A6A8B', 'assets/catalog/cologne-180-echo.webp', 180, 3, '', 0, FALSE, 123),
  ('S7-C180-ESSENC', 'cologne-180-essence', 'cologne',
   'كولونيا بعد الحلاقة نيو ستار سفن 180 ملل - ESSENCE', 'After-Shave Cologne 180ml — Essence',
   '180 مل · إيسنس', '180ml · Essence',
   'إيسنس', 'Essence',
   0, '#C48A2E', 'assets/catalog/cologne-180-essence.webp', 180, 3, '', 0, FALSE, 124),
  ('S7-C180-SENSE', 'cologne-180-sense', 'cologne',
   'كولونيا بعد الحلاقة نيو ستار سفن 180 ملل - SENSE', 'After-Shave Cologne 180ml — Sense',
   '180 مل · سينس', '180ml · Sense',
   'سينس', 'Sense',
   0, '#B0455E', 'assets/catalog/cologne-180-sense.webp', 180, 3, '', 0, FALSE, 125),
  ('S7-DW400-BEESWA', 'depilatory-wax-400-beeswax', 'depilatory',
   'قالب شمع إزالة للشعر نيو ستار سفن 400 جم - شمع العسل', 'Depilatory Wax 400g — Beeswax',
   '400 جم · شمع العسل', '400g · Beeswax',
   'شمع العسل', 'Beeswax',
   0, '#D9A81E', 'assets/catalog/depilatory-wax-400-beeswax.webp', 400, 3, '', 0, FALSE, 130),
  ('S7-DW400-ROSE', 'depilatory-wax-400-rose', 'depilatory',
   'قالب شمع إزالة للشعر نيو ستار سفن 400 جم - بخلاصة الورد', 'Depilatory Wax 400g — Rose',
   '400 جم · الورد', '400g · Rose',
   'الورد', 'Rose',
   0, '#D46A8A', 'assets/catalog/depilatory-wax-400-rose.webp', 400, 3, '', 0, FALSE, 131),
  ('S7-DW400-COAL', 'depilatory-wax-400-coal', 'depilatory',
   'قالب شمع إزالة للشعر نيو ستار سفن 400 جم - بخلاصة الفحم', 'Depilatory Wax 400g — Coal',
   '400 جم · الفحم', '400g · Coal',
   'الفحم', 'Coal',
   0, '#4A4A4A', 'assets/catalog/depilatory-wax-400-coal.webp', 400, 3, '', 0, FALSE, 132),
  ('S7-WR100-BEESWA', 'wax-roll-100-beeswax', 'depilatory',
   'شمع إزالة الشعر رول نيو ستار سفن 100 ملل - شمع العسل', 'Hair Removal Wax Roll 100g — Beeswax',
   '100 جم · شمع العسل', '100g · Beeswax',
   'شمع العسل', 'Beeswax',
   0, '#D9A81E', 'assets/catalog/wax-roll-100-beeswax.webp', 100, 3, '', 0, FALSE, 140),
  ('S7-WR100-COAL', 'wax-roll-100-coal', 'depilatory',
   'شمع إزالة الشعر رول نيو ستار سفن 100 ملل - بخلاصة الفحم', 'Hair Removal Wax Roll 100g — Coal',
   '100 جم · الفحم', '100g · Coal',
   'الفحم', 'Coal',
   0, '#4A4A4A', 'assets/catalog/wax-roll-100-coal.webp', 100, 3, '', 0, FALSE, 141),
  ('S7-WR100-ROSE', 'wax-roll-100-rose', 'depilatory',
   'شمع إزالة الشعر رول نيو ستار سفن 100 ملل - بخلاصة الورد', 'Hair Removal Wax Roll 100g — Rose',
   '100 جم · الورد', '100g · Rose',
   'الورد', 'Rose',
   0, '#D46A8A', 'assets/catalog/wax-roll-100-rose.webp', 100, 3, '', 0, FALSE, 142),
  ('S7-RP100-WATERM', 'removal-paste-100-watermelon-mint', 'depilatory',
   'عجينة بيضاء لإزالة الشعر 100 جم - بخلاصة البطيخ والنعناع', 'Hair Removal Paste 100g — Watermelon & Mint',
   '100 جم · البطيخ والنعناع', '100g · Watermelon & Mint',
   'البطيخ والنعناع', 'Watermelon & Mint',
   0, '#E4595F', 'assets/catalog/removal-paste-100-watermelon-mint.webp', 100, 3, '', 0, FALSE, 150),
  ('S7-RP100-COALOU', 'removal-paste-100-coal-oud', 'depilatory',
   'عجينة بيضاء لإزالة الشعر 100 جم - بخلاصة الفحم والعود', 'Hair Removal Paste 100g — Coal & Oud',
   '100 جم · الفحم والعود', '100g · Coal & Oud',
   'الفحم والعود', 'Coal & Oud',
   0, '#5A4632', 'assets/catalog/removal-paste-100-coal-oud.webp', 100, 3, '', 0, FALSE, 151),
  ('S7-RP100-POMEGR', 'removal-paste-100-pomegranate', 'depilatory',
   'عجينة بيضاء لإزالة الشعر 100 جم - بخلاصة الرمان', 'Hair Removal Paste 100g — Pomegranate',
   '100 جم · الرمان', '100g · Pomegranate',
   'الرمان', 'Pomegranate',
   0, '#B02B4A', 'assets/catalog/removal-paste-100-pomegranate.webp', 100, 3, '', 0, FALSE, 152),
  ('S7-RP100-PASSIO', 'removal-paste-100-passion-fruit', 'depilatory',
   'عجينة بيضاء لإزالة الشعر 100 جم - بخلاصة فاكهة الباشون', 'Hair Removal Paste 100g — Passion Fruit',
   '100 جم · فاكهة العاطفة', '100g · Passion Fruit',
   'فاكهة العاطفة', 'Passion Fruit',
   0, '#E0A32E', 'assets/catalog/removal-paste-100-passion-fruit.webp', 100, 3, '', 0, FALSE, 153),
  ('S7-RP100-COCONU', 'removal-paste-100-coconut', 'depilatory',
   'عجينة بيضاء لإزالة الشعر 100 جم - بخلاصة جوز الهند', 'Hair Removal Paste 100g — Coconut',
   '100 جم · جوز الهند', '100g · Coconut',
   'جوز الهند', 'Coconut',
   0, '#E8E2D3', 'assets/catalog/removal-paste-100-coconut.webp', 100, 3, '', 0, FALSE, 154),
  ('S7-SP100-BEESWA', 'sweet-paste-100-beeswax', 'depilatory',
   'معجون سويت لإزالة الشعر 100 جم - بشمع العسل', 'Sweet Paste 100g — Beeswax',
   '100 جم · شمع العسل', '100g · Beeswax',
   'شمع العسل', 'Beeswax',
   0, '#D9A81E', 'assets/catalog/sweet-paste-100-beeswax.webp', 100, 3, '', 0, FALSE, 160),
  ('S7-SP100-COAL', 'sweet-paste-100-coal', 'depilatory',
   'معجون سويت لإزالة الشعر 100 جم - بخلاصة الفحم', 'Sweet Paste 100g — Coal',
   '100 جم · الفحم', '100g · Coal',
   'الفحم', 'Coal',
   0, '#4A4A4A', 'assets/catalog/sweet-paste-100-coal.webp', 100, 3, '', 0, FALSE, 161)
ON CONFLICT (sku) DO NOTHING;

-- ---------------------------------------------------------------------------
--  The shampoo line (3 products)
--
--  Three 800ml pump bottles from the client PDF of September 2026: a 2x1
--  shampoo and conditioner for dry hair, the same for normal hair, and an
--  anti-dandruff shampoo. The Arabic names and highlights are the PDF text as
--  printed; the English is a translation of it. The photographs are cut from
--  the same PDF.
--
--  These land `active = TRUE` at `price = 0`, which the catalogue block above
--  may not do. The difference is intent: the client wants this line on the
--  storefront now, and a row at price 0 renders as unavailable rather than as
--  free (lib/product-state.js), so the page can exist before the price does.
--  Stock is 0 for the same reason. Both are for the admin to set, and DO
--  NOTHING means a redeploy cannot put either back.
--
--  hold_level means nothing for a shampoo; 1 is the lowest the CHECK allows.
--  hair_types is filled so the finder can offer them once they are priced -
--  sellable() in lib/hairtypes.js keeps them out of it until then.
--
--  (No apostrophes in this comment, for the same reason as above.)
-- ---------------------------------------------------------------------------
INSERT INTO products
  (sku, slug, kind, name_ar, name_en, sub_ar, sub_en, chip_ar, chip_en,
   price, color, image, size_ml, hold_level, hair_types, stock, active, sort,
   highlights_ar, highlights_en)
VALUES
  ('S7-SH800-DRY', 'shampoo-800-dry', 'shampoo',
   'شامبو وبلسم نيو ستار سفن للشعر الجاف', 'Shampoo & Conditioner 800ml — Dry Hair',
   '800 مل · شامبو وبلسم 2×1 · للشعر الجاف', '800ml · 2-in-1 · Dry Hair',
   'للشعر الجاف', 'Dry Hair',
   0, '#12100B', 'assets/catalog/shampoo-800-dry.webp', 800, 1, 'coily,curly,thick', 0, TRUE, 170,
   'ينظف الشعر وفروة الرأس بسرعه وبدون جفاف بفضل تركيبة الشامبو والبلسم 2×1.
سهل الاستخدام ومناسب لاصلاح الشعر التالف والجاف.
يزيل كل منتجات نيوستارسفن بسهولة مع الحفاظ على رطوبة الشعر.
يوصى بإستخدام حمام كريم نيوستارسفن بعد الشامبو للحصول على أقصى استفادة.',
   'Cleans the hair and scalp quickly and without drying, thanks to the 2-in-1 shampoo and conditioner formula
Easy to use, and made for repairing damaged, dry hair
Washes every New Star Seven product out easily while keeping the moisture in the hair
For the most out of it, follow the shampoo with New Star Seven cream bath'),
  ('S7-SH800-NORMAL', 'shampoo-800-normal', 'shampoo',
   'شامبو وبلسم نيو ستار سفن للشعر العادي', 'Shampoo & Conditioner 800ml — Normal Hair',
   '800 مل · شامبو وبلسم 2×1 · للشعر العادي', '800ml · 2-in-1 · Normal Hair',
   'للشعر العادي', 'Normal Hair',
   0, '#FFFDF8', 'assets/catalog/shampoo-800-normal.webp', 800, 1, 'straight,wavy,fine', 0, TRUE, 171,
   'ينظف الشعر وفروة الرأس بسرعه بفضل تركيبة الشامبو والبلسم 2×1.
سهل الاستخدام ومناسب للشعر العادي.
يزيل كل منتجات نيوستارسفن بسهولة مع الحفاظ على رطوبة الشعر.
يوصى بإستخدام حمام كريم نيوستارسفن بعد الشامبو للحصول على أقصى استفادة.',
   'Cleans the hair and scalp quickly, thanks to the 2-in-1 shampoo and conditioner formula
Easy to use, and made for normal hair
Washes every New Star Seven product out easily while keeping the moisture in the hair
For the most out of it, follow the shampoo with New Star Seven cream bath'),
  ('S7-SH800-DANDRF', 'shampoo-800-anti-dandruff', 'shampoo',
   'شامبو نيو ستار سفن ضد القشرة', 'Shampoo 800ml — Anti-Dandruff',
   '800 مل · شامبو ضد القشرة', '800ml · Anti-Dandruff',
   'ضد القشرة', 'Anti-Dandruff',
   0, '#2A6DE8', 'assets/catalog/shampoo-800-anti-dandruff.webp', 800, 1, 'straight,wavy,curly,coily,fine,thick,white', 0, TRUE, 172,
   'ينظف الشعر وفروة الرأس ويتخلص من القشرة تماما.
يمنح انتعاشا فوريا واحساس بالنشاط والحيوية.
سهل الاستخدام ومناسب لجميع أنواع الشعر.
يزيل كل منتجات نيوستارسفن بسهولة مع انتعاش لفروة الرأس.
يوصى بإستخدام حمام كريم نيوستارسفن بعد الشامبو للحصول على أقصى استفادة.',
   'Cleans the hair and scalp and gets rid of dandruff completely
Gives an instant feeling of freshness, energy and vitality
Easy to use, and right for every hair type
Washes every New Star Seven product out easily and leaves the scalp refreshed
For the most out of it, follow the shampoo with New Star Seven cream bath')
ON CONFLICT (sku) DO NOTHING;

-- ---------------------------------------------------------------------------
--  Price the catalogue that shares a format with something already on sale
--
--  Instruction was to price these the same as the existing products. That maps
--  cleanly onto anything in the same format family, and not at all onto a
--  different one, so it is applied only where it means something:
--
--    wax and gel-wax  -> 45, the price of the 120ml premium waxes
--    gel and cream gel at 250ml -> 40, the price of the 250ml premium gels
--
--  Deliberately NOT priced here, because copying a number across these would
--  be wrong rather than merely approximate:
--    * 650ml and 850ml gels - between 2.6x and 3.4x the volume of the 250ml
--      the price would be copied from
--    * 14ml and 20ml sachets - a fraction of that volume
--    * hair spray, cologne, and the whole depilatory range - no product on the
--      shop shares a format with any of them
--  Those stay hidden until someone supplies a real number.
--
--  Guarded on price = 0 AND active = false, so this touches a row exactly once
--  and can never overwrite a price set later in the admin.
--
--  And guarded on origin = seed, which is the half that was missing. The shape
--  these two look for - no price yet, not on the shop yet - is also exactly
--  what a product half-written in the admin looks like while the owner is
--  still deciding what to charge for it. Without the origin test the next
--  deploy would finish that decision for them: 45 EGP, 200 in stock, live on
--  the shop. The catalogue rows this was written for are seeded, so naming
--  that costs nothing and closes it.
-- ---------------------------------------------------------------------------
UPDATE products
   SET price = 45, stock = 200, active = TRUE
 WHERE price = 0 AND active = FALSE
   AND origin = 'seed'
   AND kind IN ('wax', 'gelwax');

UPDATE products
   SET price = 40, stock = 200, active = TRUE
 WHERE price = 0 AND active = FALSE
   AND origin = 'seed'
   AND kind IN ('gel', 'cream')
   AND size_ml = 250;


-- ---------------------------------------------------------------------------
--  Take each accent colour from the product photograph
--
--  color drives the --c custom property: the card border, the price tint and
--  the wash behind the jar on the product page. It has to be the colour of the
--  pack.
--
--  The first pass derived it from the ingredient name - argan meant blue,
--  olive meant green - which was a guess about packs nobody had looked at, and
--  it was wrong on most of them. An olive-oil wax is a green jar; a jojoba
--  cream gel is a blue one; the argan cream gel is orange.
--
--  These are sampled from the images now: every opaque pixel bucketed by hue
--  and weighted by saturation, dominant bucket wins, and a genuinely neutral
--  pack - the black and silver cartons - gets a grey at its own lightness
--  rather than whatever faint cast the render happened to carry.
--
--  Guarded on active = FALSE is NOT possible here, because 24 of these are now
--  live. Guarded on the value instead: only rows still carrying the guessed
--  colour are corrected, so a colour picked by hand in the admin survives.
-- ---------------------------------------------------------------------------
UPDATE products SET color = CASE
    WHEN sku = 'S7-W120-COCONU' THEN '#6292CF'
    WHEN sku = 'S7-W135-OLIVE' THEN '#00C740'
    WHEN sku = 'S7-W135-ARGAN' THEN '#FEFF32'
    WHEN sku = 'S7-W135-COCONU' THEN '#0072DE'
    WHEN sku = 'S7-W135-SHEA' THEN '#965F00'
    WHEN sku = 'S7-W125-BLACKS' THEN '#D39008'
    WHEN sku = 'S7-GW140-ARGAN' THEN '#FE1E50'
    WHEN sku = 'S7-GW140-JOJOBA' THEN '#3F3F3F'
    WHEN sku = 'S7-GW140-COCONU' THEN '#0056E4'
    WHEN sku = 'S7-GW140-ROSEMA' THEN '#69B800'
    WHEN sku = 'S7-GW140-SHEA' THEN '#FDC418'
    WHEN sku = 'S7-GW140-ALOEVE' THEN '#C69E6B'
    WHEN sku = 'S7-G250-WHITE' THEN '#674327'
    WHEN sku = 'S7-G250-BLACK' THEN '#898989'
    WHEN sku = 'S7-SG250-WHITE' THEN '#BE007C'
    WHEN sku = 'S7-SG250-BLACK' THEN '#AF0074'
    WHEN sku = 'S7-SG250-BLUE' THEN '#001A8E'
    WHEN sku = 'S7-SG250-YELLOW' THEN '#E6CD00'
    WHEN sku = 'S7-SG650-WHITE' THEN '#D20082'
    WHEN sku = 'S7-SG650-BLACK' THEN '#D10083'
    WHEN sku = 'S7-SG650-BLUE' THEN '#0069D9'
    WHEN sku = 'S7-SG650-YELLOW' THEN '#E4C200'
    WHEN sku = 'S7-SG850-WHITE' THEN '#D00082'
    WHEN sku = 'S7-SG850-BLACK' THEN '#CF0083'
    WHEN sku = 'S7-SG850-BLUE' THEN '#0068DB'
    WHEN sku = 'S7-SG850-YELLOW' THEN '#E3CC00'
    WHEN sku = 'S7-GS20-SACHET' THEN '#B01888'
    WHEN sku = 'S7-GS14-SACHET' THEN '#B01888'
    WHEN sku = 'S7-CG250-BEESWA' THEN '#DDB300'
    WHEN sku = 'S7-CG250-OLIVE' THEN '#1F840A'
    WHEN sku = 'S7-CG250-ARGAN' THEN '#C96000'
    WHEN sku = 'S7-CG250-JOJOBA' THEN '#008DCF'
    WHEN sku = 'S7-CG250-BLACKS' THEN '#515151'
    WHEN sku = 'S7-CG250-COCONU' THEN '#727272'
    WHEN sku = 'S7-HS500-ULTRAS' THEN '#BB902B'
    WHEN sku = 'S7-HS500-STRONG' THEN '#CC261A'
    WHEN sku = 'S7-C180-MAGIC' THEN '#AB7A00'
    WHEN sku = 'S7-C180-FRESH' THEN '#3CBD0A'
    WHEN sku = 'S7-C180-AQUA' THEN '#03ADCF'
    WHEN sku = 'S7-C180-ECHO' THEN '#F23F45'
    WHEN sku = 'S7-C180-ESSENC' THEN '#6B7AC6'
    WHEN sku = 'S7-C180-SENSE' THEN '#5805C9'
    WHEN sku = 'S7-DW400-BEESWA' THEN '#C36100'
    WHEN sku = 'S7-DW400-ROSE' THEN '#B4255E'
    WHEN sku = 'S7-DW400-COAL' THEN '#8F8F8F'
    WHEN sku = 'S7-WR100-BEESWA' THEN '#834E0B'
    WHEN sku = 'S7-WR100-COAL' THEN '#454545'
    WHEN sku = 'S7-WR100-ROSE' THEN '#AC492F'
    WHEN sku = 'S7-RP100-WATERM' THEN '#008E59'
    WHEN sku = 'S7-RP100-COALOU' THEN '#954C00'
    WHEN sku = 'S7-RP100-POMEGR' THEN '#C0001C'
    WHEN sku = 'S7-RP100-PASSIO' THEN '#C02F00'
    WHEN sku = 'S7-RP100-COCONU' THEN '#8D3B01'
    WHEN sku = 'S7-SP100-BEESWA' THEN '#CE4E00'
    WHEN sku = 'S7-SP100-COAL' THEN '#AFAFAF'
  END
WHERE sku IN ('S7-W120-COCONU', 'S7-W135-OLIVE', 'S7-W135-ARGAN', 'S7-W135-COCONU', 'S7-W135-SHEA', 'S7-W125-BLACKS', 'S7-GW140-ARGAN', 'S7-GW140-JOJOBA', 'S7-GW140-COCONU', 'S7-GW140-ROSEMA', 'S7-GW140-SHEA', 'S7-GW140-ALOEVE', 'S7-G250-WHITE', 'S7-G250-BLACK', 'S7-SG250-WHITE', 'S7-SG250-BLACK', 'S7-SG250-BLUE', 'S7-SG250-YELLOW', 'S7-SG650-WHITE', 'S7-SG650-BLACK', 'S7-SG650-BLUE', 'S7-SG650-YELLOW', 'S7-SG850-WHITE', 'S7-SG850-BLACK', 'S7-SG850-BLUE', 'S7-SG850-YELLOW', 'S7-GS20-SACHET', 'S7-GS14-SACHET', 'S7-CG250-BEESWA', 'S7-CG250-OLIVE', 'S7-CG250-ARGAN', 'S7-CG250-JOJOBA', 'S7-CG250-BLACKS', 'S7-CG250-COCONU', 'S7-HS500-ULTRAS', 'S7-HS500-STRONG', 'S7-C180-MAGIC', 'S7-C180-FRESH', 'S7-C180-AQUA', 'S7-C180-ECHO', 'S7-C180-ESSENC', 'S7-C180-SENSE', 'S7-DW400-BEESWA', 'S7-DW400-ROSE', 'S7-DW400-COAL', 'S7-WR100-BEESWA', 'S7-WR100-COAL', 'S7-WR100-ROSE', 'S7-RP100-WATERM', 'S7-RP100-COALOU', 'S7-RP100-POMEGR', 'S7-RP100-PASSIO', 'S7-RP100-COCONU', 'S7-SP100-BEESWA', 'S7-SP100-COAL')
  AND color = CASE
    WHEN sku = 'S7-W120-COCONU' THEN '#E8E2D3'
    WHEN sku = 'S7-W135-OLIVE' THEN '#6E8B3D'
    WHEN sku = 'S7-W135-ARGAN' THEN '#2A6DE8'
    WHEN sku = 'S7-W135-COCONU' THEN '#E8E2D3'
    WHEN sku = 'S7-W135-SHEA' THEN '#8B4DC9'
    WHEN sku = 'S7-W125-BLACKS' THEN '#3A3A3A'
    WHEN sku = 'S7-GW140-ARGAN' THEN '#2A6DE8'
    WHEN sku = 'S7-GW140-JOJOBA' THEN '#C8A24A'
    WHEN sku = 'S7-GW140-COCONU' THEN '#E8E2D3'
    WHEN sku = 'S7-GW140-ROSEMA' THEN '#4E7A4E'
    WHEN sku = 'S7-GW140-SHEA' THEN '#8B4DC9'
    WHEN sku = 'S7-GW140-ALOEVE' THEN '#5E9C2B'
    WHEN sku = 'S7-G250-WHITE' THEN '#E9E9E9'
    WHEN sku = 'S7-G250-BLACK' THEN '#2A2A2A'
    WHEN sku = 'S7-SG250-WHITE' THEN '#E9E9E9'
    WHEN sku = 'S7-SG250-BLACK' THEN '#2A2A2A'
    WHEN sku = 'S7-SG250-BLUE' THEN '#2A6DE8'
    WHEN sku = 'S7-SG250-YELLOW' THEN '#D9A81E'
    WHEN sku = 'S7-SG650-WHITE' THEN '#E9E9E9'
    WHEN sku = 'S7-SG650-BLACK' THEN '#2A2A2A'
    WHEN sku = 'S7-SG650-BLUE' THEN '#2A6DE8'
    WHEN sku = 'S7-SG650-YELLOW' THEN '#D9A81E'
    WHEN sku = 'S7-SG850-WHITE' THEN '#E9E9E9'
    WHEN sku = 'S7-SG850-BLACK' THEN '#2A2A2A'
    WHEN sku = 'S7-SG850-BLUE' THEN '#2A6DE8'
    WHEN sku = 'S7-SG850-YELLOW' THEN '#D9A81E'
    WHEN sku = 'S7-GS20-SACHET' THEN '#2A6DE8'
    WHEN sku = 'S7-GS14-SACHET' THEN '#2A6DE8'
    WHEN sku = 'S7-CG250-BEESWA' THEN '#D9A81E'
    WHEN sku = 'S7-CG250-OLIVE' THEN '#6E8B3D'
    WHEN sku = 'S7-CG250-ARGAN' THEN '#2A6DE8'
    WHEN sku = 'S7-CG250-JOJOBA' THEN '#C8A24A'
    WHEN sku = 'S7-CG250-BLACKS' THEN '#3A3A3A'
    WHEN sku = 'S7-CG250-COCONU' THEN '#E8E2D3'
    WHEN sku = 'S7-HS500-ULTRAS' THEN '#D7291D'
    WHEN sku = 'S7-HS500-STRONG' THEN '#2A6DE8'
    WHEN sku = 'S7-C180-MAGIC' THEN '#8B4DC9'
    WHEN sku = 'S7-C180-FRESH' THEN '#5E9C2B'
    WHEN sku = 'S7-C180-AQUA' THEN '#2A9DE8'
    WHEN sku = 'S7-C180-ECHO' THEN '#4A6A8B'
    WHEN sku = 'S7-C180-ESSENC' THEN '#C48A2E'
    WHEN sku = 'S7-C180-SENSE' THEN '#B0455E'
    WHEN sku = 'S7-DW400-BEESWA' THEN '#D9A81E'
    WHEN sku = 'S7-DW400-ROSE' THEN '#D46A8A'
    WHEN sku = 'S7-DW400-COAL' THEN '#4A4A4A'
    WHEN sku = 'S7-WR100-BEESWA' THEN '#D9A81E'
    WHEN sku = 'S7-WR100-COAL' THEN '#4A4A4A'
    WHEN sku = 'S7-WR100-ROSE' THEN '#D46A8A'
    WHEN sku = 'S7-RP100-WATERM' THEN '#E4595F'
    WHEN sku = 'S7-RP100-COALOU' THEN '#5A4632'
    WHEN sku = 'S7-RP100-POMEGR' THEN '#B02B4A'
    WHEN sku = 'S7-RP100-PASSIO' THEN '#E0A32E'
    WHEN sku = 'S7-RP100-COCONU' THEN '#E8E2D3'
    WHEN sku = 'S7-SP100-BEESWA' THEN '#D9A81E'
    WHEN sku = 'S7-SP100-COAL' THEN '#4A4A4A'
  END;

-- ---------------------------------------------------------------------------
--  Show the rest of the range, without inventing a price for it
--
--  These are the products where "same price as the others" does not map onto
--  anything: the 650ml and 850ml gels are 2.6x and 3.4x the volume of the
--  250ml the price would come from, the sachets are a fraction of it, and the
--  spray, cologne and depilatory ranges share a format with nothing on the
--  shop.
--
--  Hiding them answered the pricing question and lost the range. So they go
--  live at price 0, and the storefront reads a zero price as "ask us" - the
--  card shows the pack, the name and a WhatsApp button instead of Add to cart.
--  Nothing can be ordered at a wrong price, and the catalogue stops pretending
--  the brand makes eight things.
--
--  stock stays 0 on purpose: it is a second lock, so even a bug that rendered
--  a buy button could not place the order.
--
--  Guarded on price = 0 AND active = FALSE, so this touches a row once and a
--  price set later in the admin is never disturbed.
--
--  And on origin = seed, which matters more here than on the two pricing
--  statements above, because this one names no format at all. Every hidden,
--  unpriced row in the table matched it - including one an owner had created
--  in the admin ten minutes earlier and not finished. This statement would
--  have put that on the shop, at no price, on the next deploy. The rows it was
--  written for all came from the seed, so it says so.
-- ---------------------------------------------------------------------------
--  The depilatory range used to be excluded here.
--
--  It was taken off the shop on 31 Aug because it had never been priced, and
--  "ask us on WhatsApp" was inviting a conversation about something there was
--  no stock of. That reasoning was about the MESSAGE, not about hiding the
--  products, and the message is fixed now: lib/product-state.js answers
--  out-of-stock before unpriced, so a product with no stock says so plainly
--  instead of offering a WhatsApp nobody can act on.
--
--  So the range comes back, visible and marked out of stock, which is what the
--  client asked for on 1 Sep - "marked out of stock, not removed". The rows
--  carry stock 0 and are not buyable; the checkout refuses an unpriced line
--  regardless (app/api/order/route.js), so there is no path to an order at
--  zero pounds.
UPDATE products
   SET active = TRUE
 WHERE price = 0 AND active = FALSE
   AND origin = 'seed';

-- ===========================================================================
--  The client price list, 1 September 2026
--
--  Sent as a WhatsApp message from the manufacturer and applied here so that a
--  fresh database and a redeploy both agree with the shop.
--
--  GUARDED ON THE OLD PRICE, and that is the whole design of this block. Each
--  statement only touches a row that still carries the figure it is replacing,
--  so it applies exactly once and then matches nothing for ever. An owner who
--  later changes a price in the admin is never overwritten by a deploy - which
--  is the mistake the depilatory range taught this file, in the other
--  direction, in August.
--
--  The prices are for a product LINE, so every colour or scent variant in a
--  line gets the same figure. The counts in the message are colour counts and
--  they are what the SKU groups below were matched against.
-- ===========================================================================

--  جل واكس نيو ستار سفن 140 مل - 6 الوان - 80
UPDATE products SET price = 80
 WHERE sku IN ('S7-GW140-ARGAN','S7-GW140-JOJOBA','S7-GW140-COCONU',
               'S7-GW140-ROSEMA','S7-GW140-SHEA','S7-GW140-ALOEVE')
   AND price = 45;

--  واكس الشعر العبوة البلاستيك 135 مل - 5 الوان - 60
--  Four 135ml plus the 125ml black-seed, which is the fifth in the same plastic
--  line and priced with it.
UPDATE products SET price = 60
 WHERE sku IN ('S7-W135-OLIVE','S7-W135-ARGAN','S7-W135-COCONU','S7-W135-SHEA','S7-W125-BLACKS')
   AND price = 45;

--  واكس بريميوم العبوة المعدن 120 مل - 5 الوان - 80
--  Six rows, not five: the message counts colours and the coconut-oil variant
--  is the same 120ml metal tin. Confirmed with the client before applying.
UPDATE products SET price = 80
 WHERE sku IN ('S7-WAX-RED','S7-WAX-PUR','S7-WAX-BLU','S7-WAX-BLK','S7-WAX-YEL','S7-W120-COCONU')
   AND price = 45;

--  كريم جل نيو ستار سفن 250 مل - 6 الوان - 80
--  The line whose name was obscured in the screenshot by a UI overlay. It is
--  the only 250ml product with six variants, so the match is unambiguous.
UPDATE products SET price = 80
 WHERE sku IN ('S7-CG250-BEESWA','S7-CG250-OLIVE','S7-CG250-ARGAN',
               'S7-CG250-JOJOBA','S7-CG250-BLACKS','S7-CG250-COCONU')
   AND price = 40;

--  جل شعر 650 مل - 4 الوان - 80
UPDATE products SET price = 80
 WHERE sku IN ('S7-SG650-WHITE','S7-SG650-BLACK','S7-SG650-BLUE','S7-SG650-YELLOW')
   AND price = 0;

--  جل شعر 850 مل - 4 الوان - 100
UPDATE products SET price = 100
 WHERE sku IN ('S7-SG850-WHITE','S7-SG850-BLACK','S7-SG850-BLUE','S7-SG850-YELLOW')
   AND price = 0;

--  جل شعر بريميوم 250 مل - 5 الوان - 80
UPDATE products SET price = 80
 WHERE sku IN ('S7-GEL-YEL','S7-GEL-GRN','S7-GEL-BLU','S7-G250-WHITE','S7-G250-BLACK')
   AND price = 40;

--  جل نيو ستار سفن 400 مل - 4 الوان - 60
--
--  The catalogue had these four at 250 ml. The list from the client says 400,
--  colour count and the line name match nothing else, so the size was wrong
--  here rather than the message being about a product the shop does not carry.
--  Both columns are corrected together and guarded together, so a row that has
--  already been fixed by hand in the admin is left alone.
UPDATE products SET price = 60, size_ml = 400
 WHERE sku IN ('S7-SG250-WHITE','S7-SG250-BLACK','S7-SG250-BLUE','S7-SG250-YELLOW')
   AND price = 40 AND size_ml = 250;

--  ...and the size everywhere a customer reads it, not only in the column.
--
--  size_ml drives the spec row on the product page; the name, the subtitle and
--  the highlights list are free text and say "250" independently. Correcting
--  the column alone left the page contradicting itself - "400ml" in the spec
--  box, "250 مل" in the line under the title - which is worse than the original
--  error, because now one of them is definitely wrong and a customer cannot
--  tell which.
--
--  Guarded on the old string, so each is a no-op once applied and none of them
--  touches a value an owner has since rewritten in the admin. The SKU keeps its
--  SG250 spelling: a SKU is permanent, it is printed on nothing a customer
--  sees, and renaming it would orphan every past order line.
UPDATE products SET name_en = 'Styling Gel 400ml — White'
 WHERE sku = 'S7-SG250-WHITE' AND name_en = 'Styling Gel 250ml — White';
UPDATE products SET name_en = 'Styling Gel 400ml — Black'
 WHERE sku = 'S7-SG250-BLACK' AND name_en = 'Styling Gel 250ml — Black';
UPDATE products SET name_en = 'Styling Gel 400ml — Blue'
 WHERE sku = 'S7-SG250-BLUE' AND name_en = 'Styling Gel 250ml — Blue';
UPDATE products SET name_en = 'Styling Gel 400ml — Yellow'
 WHERE sku = 'S7-SG250-YELLOW' AND name_en = 'Styling Gel 250ml — Yellow';

UPDATE products SET sub_ar = '400 مل · أبيض', sub_en = '400ml · White'
 WHERE sku = 'S7-SG250-WHITE' AND sub_en = '250ml · White';
UPDATE products SET sub_ar = '400 مل · أسود', sub_en = '400ml · Black'
 WHERE sku = 'S7-SG250-BLACK' AND sub_en = '250ml · Black';
UPDATE products SET sub_ar = '400 مل · أزرق', sub_en = '400ml · Blue'
 WHERE sku = 'S7-SG250-BLUE' AND sub_en = '250ml · Blue';
UPDATE products SET sub_ar = '400 مل · أصفر', sub_en = '400ml · Yellow'
 WHERE sku = 'S7-SG250-YELLOW' AND sub_en = '250ml · Yellow';

--  The last line of the highlights list is the size, on all four.
UPDATE products
   SET highlights_ar = replace(highlights_ar, 'عبوة 250 مل', 'عبوة 400 مل'),
       highlights_en = replace(highlights_en, '250ml jar', '400ml jar')
 WHERE sku IN ('S7-SG250-WHITE','S7-SG250-BLACK','S7-SG250-BLUE','S7-SG250-YELLOW')
   AND highlights_en LIKE '%250ml jar%';

--  ...and clear the "was" price that the rise left stranded.
--
--  S7-WAX-RED carried compare_at = 55 from when it sold at 45. At 80 that is no
--  longer a discount, and the card was rendering "80 جنيه" with "55" struck out
--  beside it - a price RISE drawn in the visual language of a saving, on a shop
--  where the number is collected in cash at the door.
--
--  lib/money.js now refuses to draw a "was" price that is not higher than the
--  price, so this cannot reappear on the next rise. The row is corrected anyway,
--  because a stale value nothing renders is still a wrong value.
UPDATE products SET compare_at = NULL
 WHERE sku = 'S7-WAX-RED' AND compare_at = 55 AND price = 80;




-- ---------------------------------------------------------------------------
--  Put the hold levels the right way up
--
--  The shop had the five waxes at 4 and 5 and the three premium gels at 3.
--  Ovanza publishes the opposite. Their Premium Hair Gel tier is Ultra Strong
--  Hold, 48 hours; the Styling Gel tier under it is Strong, 24 hours; and the
--  waxes are Strong (Pro X, Pro) or Medium (Shea, Argan, Black Seed).
--
--  So the site was telling a customer with straight hair that gel is the only
--  format with enough hold - which is true, and which its own numbers then
--  contradicted. The 55 products added later already carry the correct scale,
--  which is what made the original eight stand out.
--
--    Ultra Strong -> 5      Strong -> 4      Medium -> 3
--
--  Guarded on the old value, one SKU at a time, so a level set by hand in the
--  admin is left alone. See docs/product-facts.md.
-- ---------------------------------------------------------------------------
UPDATE products SET hold_level = 4 WHERE sku = 'S7-WAX-RED' AND hold_level = 5;
UPDATE products SET hold_level = 4 WHERE sku = 'S7-WAX-YEL' AND hold_level = 5;
-- Black Seed was missed in the first pass: its chip, subtitle and hair-type
-- mapping were corrected by their own guarded updates below, but its hold was
-- only changed in the INSERT literal, which does nothing to a row that already
-- exists. So production kept the old 5. Ovanza rate it Medium, which is 3.
UPDATE products SET hold_level = 3 WHERE sku = 'S7-WAX-BLK' AND hold_level = 5;
UPDATE products SET hold_level = 3 WHERE sku = 'S7-WAX-PUR' AND hold_level = 4;
UPDATE products SET hold_level = 3 WHERE sku = 'S7-WAX-BLU' AND hold_level = 4;
UPDATE products SET hold_level = 5 WHERE sku = 'S7-GEL-YEL' AND hold_level = 3;
UPDATE products SET hold_level = 5 WHERE sku = 'S7-GEL-GRN' AND hold_level = 3;
UPDATE products SET hold_level = 5 WHERE sku = 'S7-GEL-BLU' AND hold_level = 3;

-- Pro X carried a "Mega Hold" chip on top of the 5. Ovanza rate it Strong.
-- Mega stays true of the range - the gels are the top of it now - but not of
-- this jar.
UPDATE products
   SET chip_ar = 'تثبيت قوي', chip_en = 'Strong Hold'
 WHERE sku = 'S7-WAX-RED' AND chip_en = 'Mega Hold';


-- ---------------------------------------------------------------------------
--  Premium Wax Black is not a matte wax
--
--  The shop sold it as no shine, matte, hold 5, for fine and straight hair,
--  and the hair-types page recommended it to fine hair as the closest thing to
--  a clay in the range. Every source says otherwise:
--
--    * Ovanza spec: Medium hold - High flexibility - HIGH shine
--    * their selling point is grey coverage, which the shop never mentioned
--    * recommended for dry and greying hair, not fine hair
--    * the ingredient list has no matting agent in it at all: no silica, no
--      starch, no clay. Nothing in the jar could produce a matte finish.
--    * lowest-rated SKU on Amazon at 2.5 stars, which is what that mismatch
--      looks like from the customer side
--
--  So the chip, the subtitle and the hair-type mapping all move. It keeps a
--  place on wavy and thick - medium hold with high flexibility is a real fit
--  for hair that gets reworked during the day - but it leads neither, and it
--  is off the fine tile entirely. Pro takes fine over: Ovanza call it suitable
--  for all hair types, and it is the most flexible thing left once the matte
--  claim is gone. The fine tile now says out loud that the range has no clay.
--
--  Guarded on the old values, so a rewrite in the admin survives.
-- ---------------------------------------------------------------------------
UPDATE products
   SET sub_ar  = 'بيغطي الشيب · 120 مل · أسود',
       sub_en  = 'Covers grey · 120ml · Black',
       chip_ar = 'يغطي الشيب',
       chip_en = 'Covers Grey'
 WHERE sku = 'S7-WAX-BLK' AND chip_en = 'Matte';

UPDATE products
   SET hair_types = 'wavy,thick'
 WHERE sku = 'S7-WAX-BLK' AND hair_types = 'fine,straight';

UPDATE products
   SET hair_types = 'thick,straight,wavy,fine'
 WHERE sku = 'S7-WAX-YEL' AND hair_types = 'thick,straight,wavy';


-- ---------------------------------------------------------------------------
--  Carry the same corrections into the long-form copy
--
--  long_*, howto_* and highlights_* are seeded by the guarded UPDATE near the
--  top of this file, which fills a column only while it is still empty. On a
--  database that already exists they are full, so editing the literal up there
--  changes nothing for the live shop - the same reason the /#hair link fix had
--  to be its own statement.
--
--  Each of these is a replace() of the exact sentence that carries the wrong
--  number, guarded on a marker that is gone once it has run. So it is a no-op
--  on every deploy after the first, and it cannot touch a paragraph an admin
--  has rewritten: a rewrite loses the marker and the row is skipped.
-- ---------------------------------------------------------------------------
UPDATE products
   SET long_ar       = replace(long_ar, 'التثبيت ميجا هولد، ٥ من ٥ — أعلى درجة في التشكيلة كلها.', 'التثبيت قوي، ٤ من ٥ — أقوى واكس في التشكيلة.'),
       long_en       = replace(long_en, 'Hold is mega, 5 out of 5 — the strongest in the range.', 'Hold is strong, 4 out of 5 — the strongest of the waxes.'),
       highlights_ar = replace(highlights_ar, 'تثبيت ميجا هولد — ٥ من ٥', 'تثبيت قوي — ٤ من ٥'),
       highlights_en = replace(highlights_en, 'Mega hold — 5 out of 5', 'Strong hold — 4 out of 5')
 WHERE sku = 'S7-WAX-RED' AND long_en LIKE '%Hold is mega, 5 out of 5%';

UPDATE products
   SET long_ar       = replace(long_ar, 'التثبيت ٤ من ٥:', 'التثبيت ٣ من ٥:'),
       long_en       = replace(long_en, 'Hold is 4 out of 5:', 'Hold is 3 out of 5:'),
       highlights_ar = replace(highlights_ar, 'تثبيت ٤ من ٥ — مرن مش ناشف', 'تثبيت ٣ من ٥ — مرن مش ناشف'),
       highlights_en = replace(highlights_en, 'Hold 4 out of 5 — flexible, not crunchy', 'Hold 3 out of 5 — flexible, not crunchy')
 WHERE sku = 'S7-WAX-PUR' AND long_en LIKE '%Hold is 4 out of 5%';

UPDATE products
   SET long_ar       = replace(long_ar, 'التثبيت ٤ من ٥ —', 'التثبيت ٣ من ٥ —'),
       long_en       = replace(long_en, 'Hold is 4 out of 5 —', 'Hold is 3 out of 5 —'),
       highlights_ar = replace(highlights_ar, 'تثبيت ٤ من ٥', 'تثبيت ٣ من ٥'),
       highlights_en = replace(highlights_en, 'Hold 4 out of 5', 'Hold 3 out of 5')
 WHERE sku = 'S7-WAX-BLU' AND long_en LIKE '%Hold is 4 out of 5%';

-- Pro also inherits the fine tile, so its copy has to say so.
UPDATE products
   SET long_ar       = replace(long_ar, 'تثبيت ٥ من ٥ بتركيبة سهلة التوزيع تنفع لأنواع شعر كتير — تخين، مفرود، أو متموج.', 'تثبيت ٤ من ٥ بتركيبة سهلة التوزيع تنفع لأنواع شعر كتير — تخين، مفرود، أو متموج، وحتى الخفيف لو كمية صغيرة.'),
       long_en       = replace(long_en, '5-out-of-5 hold in a formula that spreads easily and suits a range of hair — thick, straight or wavy.', '4-out-of-5 hold in a formula that spreads easily and suits a range of hair — thick, straight, wavy, and fine hair too if you keep the amount small.'),
       highlights_ar = replace(replace(highlights_ar, 'تثبيت ٥ من ٥', 'تثبيت ٤ من ٥'), 'يناسب الشعر التخين والمفرود والمتموج', 'يناسب الشعر التخين والمفرود والمتموج والخفيف'),
       highlights_en = replace(replace(highlights_en, 'Hold 5 out of 5', 'Hold 4 out of 5'), 'Suits thick, straight and wavy hair', 'Suits thick, straight, wavy and fine hair')
 WHERE sku = 'S7-WAX-YEL' AND long_en LIKE '%5-out-of-5 hold%';

-- The three gels go up, and stop claiming fine hair in English. The Arabic
-- always said "ناعم مفرود", which is the name of the straight tile rather than
-- the fine one, so only the English was wrong.
UPDATE products
   SET long_ar       = replace(long_ar, 'التثبيت ٣ من ٥: تحكم يومي بيتغسل بسهولة.', 'التثبيت ٥ من ٥: أقوى تثبيت عندنا، وبيتغسل بسهولة.'),
       long_en       = replace(long_en, 'Hold is 3 out of 5: daily control that washes out easily.', 'Hold is 5 out of 5: the strongest hold we make, and it washes out easily.'),
       highlights_ar = replace(highlights_ar, 'تثبيت ٣ من ٥', 'تثبيت ٥ من ٥'),
       highlights_en = replace(replace(highlights_en, 'Hold 3 out of 5', 'Hold 5 out of 5'), 'For fine, straight hair', 'For straight hair')
 WHERE sku = 'S7-GEL-YEL' AND long_en LIKE '%Hold is 3 out of 5%';

UPDATE products
   SET long_ar       = replace(long_ar, 'نفس تثبيت الجل بريميوم، ٣ من ٥،', 'نفس تثبيت الجل بريميوم، ٥ من ٥،'),
       long_en       = replace(replace(long_en, 'The same Premium Gel hold, 3 out of 5,', 'The same Premium Gel hold, 5 out of 5,'), 'For fine, straight hair: daily control', 'For straight hair: daily control'),
       highlights_ar = replace(highlights_ar, 'تثبيت ٣ من ٥', 'تثبيت ٥ من ٥'),
       highlights_en = replace(replace(highlights_en, 'Hold 3 out of 5', 'Hold 5 out of 5'), 'For fine, straight hair', 'For straight hair')
 WHERE sku = 'S7-GEL-GRN' AND long_en LIKE '%The same Premium Gel hold, 3 out of 5%';

UPDATE products
   SET long_ar       = replace(long_ar, 'الأزرق هو الكلاسيك: تثبيت ٣ من ٥', 'الأزرق هو الكلاسيك: تثبيت ٥ من ٥'),
       long_en       = replace(replace(long_en, 'Blue is the classic: 3-out-of-5 hold', 'Blue is the classic: 5-out-of-5 hold'), 'For fine, straight hair that needs', 'For straight hair that needs'),
       highlights_ar = replace(highlights_ar, 'تثبيت ثابت طول اليوم', 'أقوى تثبيت عندنا — ٥ من ٥'),
       highlights_en = replace(replace(highlights_en, 'Holds all day', 'Our strongest hold — 5 out of 5'), 'For fine, straight hair', 'For straight hair')
 WHERE sku = 'S7-GEL-BLU' AND long_en LIKE '%Blue is the classic: 3-out-of-5 hold%';

-- The black wax needs the page rewritten rather than a number swapped: what it
-- was sold on is not a property it has. Guarded on the matte claim, so it runs
-- once and never touches a rewrite.
UPDATE products SET
  long_ar = 'بلاك هو البرطمان الوحيد في التشكيلة اللي بيعمل حاجة زيادة على التصفيف: بيغطي الشيب. الصبغة الوحيدة في التركيبة هي **CI 77266** — الأسود — فالواكس بيسيب لون أسود لامع على الشعرة وإنت بتوزّعه. باقي الألوان فيها خمس صبغات بتلوّن البرطمان بس.

التثبيت ٣ من ٥ بمرونة عالية ولمعة عالية، ومعاه **زيت حبة البركة**. يعني ده مش واكس مطفي — لو انت بتدوّر على شكل مات من غير لمعة، ده مش هو.',
  long_en = 'Black is the one jar in the line that does something besides styling: it covers grey. The only colourant in the formula is **CI 77266** — black — so the wax leaves a glossy black tone on the strand as you work it in. The other colours carry a five-pigment set that only colours the jar.

Hold is 3 out of 5, with high flexibility, high shine and **black seed oil** in the base. So it is not a matte wax. If a matte, no-shine finish is what you are after, this is not it.',
  howto_ar = 'خد كمية صغيرة وافركها بين إيديك لحد ما تدفى
حطها على شعر ناشف أو نص ناشف
وزّعها على الأماكن اللي فيها شيب الأول
مشّط أو ظبّط بصوابعك — التركيبة مرنة وتقدر تعدّلها في أي وقت',
  howto_en = 'Take a small amount and warm it between your palms
Work it through dry or towel-dried hair
Cover the greying areas first
Comb or shape with your fingers - the formula stays pliable, so you can rework it',
  highlights_ar = 'بيغطي الشيب — صبغة CI 77266 السودا
تثبيت ٣ من ٥ بمرونة عالية
لمعة عالية — مش واكس مطفي
زيت حبة البركة في التركيبة
برطمان ١٢٠ مل',
  highlights_en = 'Covers grey - CI 77266 black
Hold 3 out of 5, high flexibility
High shine - not a matte wax
Black seed oil in the formula
120ml jar'
WHERE sku = 'S7-WAX-BLK' AND long_en LIKE '%fully **matte** formula%';


-- ---------------------------------------------------------------------------
--  The two hair sprays take their accent from the cap, not from the label
--
--  The sampler that derived every accent colour from its photograph picked the
--  dominant hue across the whole pack, weighted by saturation. On the sprays
--  that is the gold lower half of the label, so both cans came out within three
--  points of the same muddy brown - #936701 and #966801 - even though one is
--  black with a gold cap and the other is silver with a red one.
--
--  It reads worse than a merely inaccurate swatch, because color drives the
--  radial wash behind the product on the product page at 22 percent. A brown
--  haze behind an already black can is why these two looked dark.
--
--  Sampled from the cap instead, which is what tells the two apart on a shelf:
--  the mean of the saturated pixels across the top of the can, lifted to a
--  usable lightness. Ultra Strong reads gold, Strong reads red.
--
--  Guarded on the sampled values, so it runs once and leaves a colour picked by
--  hand in the admin alone.
-- ---------------------------------------------------------------------------
UPDATE products SET color = '#BB902B' WHERE sku = 'S7-HS500-ULTRAS' AND color = '#936701';
UPDATE products SET color = '#CC261A' WHERE sku = 'S7-HS500-STRONG' AND color = '#966801';

-- ---------------------------------------------------------------------------
--  Ingredient lists for the five waxes
--
--  Verbatim from the printed pack, transcribed in docs/product-facts.md. INCI
--  names are Latin and read the same in both languages, so this is one field.
--  Guarded on ingredients = the empty string, so a re-run is a no-op and any
--  edit made in the admin survives. Only the five waxes have a photographed
--  panel; every other product is left empty on purpose and the page shows an
--  honest note rather than an invented list.
--
--  The separators are EN DASH (U+2013) and the +/- colourant markers are kept
--  exactly as the pack prints them. Do not normalise them.
-- ---------------------------------------------------------------------------
UPDATE products SET ingredients = 'Microcrystalline wax – Bees wax – Petrolatum – Paraffinum Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – parfum – isopropyl myristate – +/– CI 15850 – +/– CI 61565 – +/– CI 47005 – +/– CI 73015 – +/– CI 77266' WHERE sku = 'S7-WAX-RED' AND ingredients = '';
UPDATE products SET ingredients = 'Microcrystalline wax – Bees wax – Petrolatum – Paraffinum Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – Parfume – isopropyl myristate – +/– CI 15850 – +/– CI 61565 – +/– CI 47005 – +/– CI 73015 – +/– CI 77266' WHERE sku = 'S7-WAX-YEL' AND ingredients = '';
UPDATE products SET ingredients = 'Microcrystalline wax – Bees wax – Petrolatum – Paraffinum Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – Parfume – butyrospermum parkii [butter] – isopropyl myristate – +/– CI 15850 – +/– CI 61565 – +/– CI 47005 – +/– CI 73015 – +/– CI 77266' WHERE sku = 'S7-WAX-PUR' AND ingredients = '';
UPDATE products SET ingredients = 'Microcrystalline wax – Bees wax – Petrolatum – Paraffinum Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – Parfum – isopropyl myristate – Nigella Sativa seed oil – +/– CI 77266' WHERE sku = 'S7-WAX-BLK' AND ingredients = '';
UPDATE products SET ingredients = 'Microcrystalline wax – Bees wax – Petrolatum – Paraffinum Liquidum – Propyl Paraben – BHT – Tocopheryl acetate – Lanolin – Parfume – Argania Spinosa Kernel Oil – isopropyl myristate – +/– CI 15850 – +/– CI 61565 – +/– CI 47005 – +/– CI 73015 – +/– CI 77266' WHERE sku = 'S7-WAX-BLU' AND ingredients = '';

-- ---------------------------------------------------------------------------
--  Tag the black-coloured products for the grey-hair tile
--
--  /hair-types gained a seventh tile in Aug 2026: white and grey hair. It is
--  not a curl family and not a density, and it is the single most common reason
--  an Egyptian man over forty picks one jar over another. The range has always
--  answered it - Premium Wax Black is a colour-depositing wax whose printed
--  colourant is CI 77266 alone, and the gels come in a black - but nothing in
--  the data said so, so the finder could not surface any of them.
--
--  rankProducts reads position in the CSV as priority, and only the wax gets
--  white first. Grey coverage is the whole of what that jar is sold on - the
--  pack says Covers Grey and its only colourant is CI 77266 - whereas the black
--  gels are gels that happen to come in black, so white is their second claim
--  and straight hair, which is what a hold-5 gel is for, is their first. Left
--  level the gels would take the tile on the hold tie-break and the one product
--  actually built for grey would rank under them.
--
--  The 650ml and 850ml black gels are NOT tagged: both are still at price 0,
--  and sellable() in lib/hairtypes.js keeps unpriced rows out of every finder
--  anyway. Tagging them would be writing a row the guard exists to ignore.
--
--  The Black Seed wax and the Black Seed cream gel are deliberately NOT here -
--  nigella oil is an ingredient, not a colourant, and treating a black seed as
--  a black would be the same category error the site made when it sold this wax
--  as matte.
--
--  Guarded on the exact value each one is replacing, so every statement is a
--  no-op on the next deploy and none of them can overwrite a list edited in the
--  admin. The two that read 'white' are corrections to the first version of
--  this block, which shipped before the tie-break and the price guard were
--  understood; they revert those two rows and then stop matching.
-- ---------------------------------------------------------------------------
--  One statement per SKU, each guarded on the exact list it is replacing,
--  because that is the shape every other correction in this file takes and the
--  shape the seed tests enforce. An IN list with a computed CASE would have
--  been shorter and would have been the one UPDATE here nobody could read the
--  before-and-after of.
UPDATE products SET hair_types = 'white,wavy,thick' WHERE sku = 'S7-WAX-BLK' AND hair_types = 'wavy,thick';
UPDATE products SET hair_types = 'straight,white' WHERE sku = 'S7-G250-BLACK' AND hair_types = '';
UPDATE products SET hair_types = 'straight,white' WHERE sku = 'S7-G250-BLACK' AND hair_types = 'white';
UPDATE products SET hair_types = 'straight,white' WHERE sku = 'S7-SG250-BLACK' AND hair_types = '';
UPDATE products SET hair_types = 'straight,white' WHERE sku = 'S7-SG250-BLACK' AND hair_types = 'white';
UPDATE products SET hair_types = '' WHERE sku = 'S7-SG650-BLACK' AND hair_types = 'white';
UPDATE products SET hair_types = '' WHERE sku = 'S7-SG850-BLACK' AND hair_types = 'white';
