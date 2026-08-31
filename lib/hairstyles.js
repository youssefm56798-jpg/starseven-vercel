/**
 * Hair-style definitions — the six customer-facing tiles of the style finder.
 *
 * The hair-type finder asks what your hair IS. This one asks what you want it
 * to LOOK like, which is the question Egyptian men are already shopping with:
 * Eva Cosmetics, the largest domestic personal-care manufacturer in the
 * country, segments its whole Man Look gel line by look rather than by hair
 * type, with Wet Look, Spiky Look and Curly Look as three separate SKUs on the
 * shelf. A style-first finder is the native mental model here, not an import.
 *
 * The reasoning and sources live in docs/hair-style-research.md.
 *
 * Six styles. Five are served by a jar that is on the shop today; the sixth,
 * the textured crop, is served by a format the factory makes and the shop has
 * not listed yet, so its tile leads with the nearest live wax and says as much
 * out loud. That is the same position /hair-types now takes on the fine-hair
 * tile, and for the same product. This set is the 2026 rebuild:
 * the crunchy wet spike the site used to sell is gone, replaced by the centre
 * part (curtains) that took over from it, the generic fade is retitled to the
 * low taper that is the fade of the year, and the tall pompadour is softened
 * into the modern quiff.
 */

/**
 * The manufacturer’s own finish ratings, per SKU, on the two axes that decide a
 * style once hold has been settled.
 *
 * These are not in the products table and cannot be, because they are not
 * things the shop owner sets: they are published specs, read off the panels and
 * the manufacturer renders and recorded in docs/product-facts.md. Keeping them
 * here as a lookup rather than a column means the style mapping is derived from
 * the same numbers a customer can check on the jar, and cannot be edited into
 * something the label contradicts.
 *
 *   shine 3 = High or Strong · 2 = Medium · 1 = matte
 *   flex  3 = High flexibility · 2 = Medium · 1 = a gel, which sets and stops
 *
 * Shine 1 used to be unreachable, and the comment here said so at length: every
 * SKU in the table below is microcrystalline wax, beeswax and petrolatum with
 * no silica, no starch and no clay, so nothing in any of them could produce a
 * matte finish. That was true of these eight and is no longer true of the
 * range — the manufacturer makes a clay wax and a pomade now, and both finish
 * matte. Neither is a row in this table, because this table is per-SKU and
 * those SKUs are not on the shop yet; they are rated by format instead, in
 * KIND_FINISH below.
 */
export const FINISH = {
  // docs/product-facts.md: Strong hold - Medium flexibility - High shine.
  // The only Medium-flexibility product in the range, which is why it is the
  // one that keeps a set shape instead of relaxing out of it.
  'S7-WAX-RED': { shine: 3, flex: 2 },
  // Strong hold - High flexibility - High shine.
  'S7-WAX-YEL': { shine: 3, flex: 3 },
  // Medium hold - High flexibility - Medium shine. The single lowest-shine
  // product in the whole range, and the only wax the manufacturer rates Medium.
  'S7-WAX-PUR': { shine: 2, flex: 3 },
  // Medium hold - High flexibility - High shine.
  'S7-WAX-BLU': { shine: 3, flex: 3 },
  // Medium hold - High flexibility - High shine. Its job is grey coverage, and
  // it is not matte - see docs/product-facts.md "What the site currently gets
  // wrong", which is the correction this scale exists to keep true.
  'S7-WAX-BLK': { shine: 3, flex: 3 },
  // Ultra Strong Hold - Strong Shine. The only gel of the three the
  // manufacturer rates Strong, which is what decides the slick back.
  'S7-GEL-BLU': { shine: 3, flex: 1 },
  // Ultra Strong Hold - Medium Shine.
  'S7-GEL-YEL': { shine: 2, flex: 1 },
  // Ultra Strong Hold - Medium Shine.
  'S7-GEL-GRN': { shine: 2, flex: 1 },
};

/**
 * Finish by format, for the two formats where the finish is the format.
 *
 * A clay is matte because it is a clay — silica and kaolin are what take the
 * shine off, and every clay in the category has them. The same goes for this
 * brand’s pomade, which the manufacturer rates with no shine at all (the shiny
 * version of that idea is sold separately, as the gel wax). So unlike the eight
 * SKUs above, these two do not need a photographed panel to be rated: the
 * rating follows from the word on the tin.
 *
 * Rating by format rather than by SKU is also what lets the clay lead the crop
 * tile the moment the client uploads one, without a code change — which is the
 * whole point, because the SKUs are not written yet.
 */
export const KIND_FINISH = {
  clay: { shine: 1, flex: 2 },
  pomade: { shine: 1, flex: 3 },
};

/**
 * The published finish for a product row, or null when nothing rates it.
 *
 * Null rather than a default, because the two callers want different things
 * from an unrated SKU: the ranker treats it as the middle of both scales so a
 * product added tomorrow still ranks, and finishCounts must not count it as
 * anything at all — a page that says "N matte products" cannot arrive at N by
 * guessing.
 */
export function finishOf(p) {
  return FINISH[p?.sku] || KIND_FINISH[String(p?.kind)] || null;
}

/**
 * The six styles, in tile order.
 *
 * `hold` is the one hold band the look actually needs, on the same range-wide
 * 1-5 scale the shop already sells on, and it is both the display number and
 * the filter. It is an exact band rather than a floor because each tile argues
 * for its own number out loud: the slick back says a hold-4 wax will be back on
 * your forehead by two, and the curls tile says anything above 3 locks the curl
 * shut. A floor would quietly contradict both.
 *
 *
 * `served` is the tile own verdict on whether the shop can actually deliver
 * the look today: 'yes' for the four it serves properly, and 'partly' for the
 * two where the closest live product is a genuine compromise — the curtains
 * tile, whose Shea is a wax and not the light cream a centre part is built for,
 * and the crop, whose clay wax is made but not yet listed. It is data rather
 * than a slug check in the views because it decides two visible things: whether
 * the jar is offered as the answer or as the nearest thing, and how loudly the
 * tile has to say which of the two it is doing.
 *
 * 'no' is still a value the views handle. Nothing carries it at the moment, and
 * a tile should only take it back if the range genuinely has no route to the
 * look at all.
 *
 * `needs` is the derivation, kept as data so the client can re-tune a tile
 * without a code change:
 *   formats  the formats that can make this look at all
 *   shine    the finish the look wants, on the FINISH scale above
 *   flex     how much the product is allowed to move after it sets
 *   hair     the hair type this look sits on best, used only to break ties
 *            through the existing products.hair_types CSV
 *   lead     the SKU this tile leads with. It is named rather than computed so
 *            a tile’s answer cannot be flipped by a later re-tune of the two
 *            axes or by seed order — the curtains tile in particular leads with
 *            the Shea only because it is the single Medium-shine wax, and a
 *            change to any other wax’s rating must never be able to take that
 *            lead from it.
 *
 * The hair spray (hold 5) is named as a finisher in the slick-back and quiff
 * copy, but it is never a `formats` entry and so can never surface in the
 * product rail: rankForStyle filters on format first, the two tiles ask only
 * for 'gel' and 'wax', and the spray is kind 'spray'. It exists as a sentence
 * and nothing else, which is deliberate — both 500ml sprays are seeded
 * inactive at price 0 (db/seed.sql), so no tile may link a live spray product
 * until the client prices and activates them.
 */
export const HAIR_STYLES = [
  {
    slug: 'slick-back',
    served: 'yes',
    icon: 'assets/style/slick-back.svg',
    photo: 'assets/style/slick-back.webp',
    color: '#2A6DE8',
    hold: 5,
    label: 'تثبيت ٥ · لمعة مبلولة',
    labelEn: 'Hold 5 · Wet shine',
    needs: { formats: ['gel'], shine: 3, flex: 1, hair: 'straight', lead: 'S7-GEL-BLU' },
    ar: {
      name: 'سلك باك',
      short: 'الشعر كله لورا، لامع، وثابت لآخر اليوم.',
      look: 'الشعر كله مرجّع لورا، مفيش شعرة واقفة. اللمعة مقصودة — المفروض تبان إنك مسرّح، مش صاحي من النوم. بيطلع أحلى على الشعر المفرود أو المتموج. لو شعرك ناعم هتحتاج تثبيت أعلى عشان يفضل لورا.',
      why: 'الجل الأزرق. تثبيت ٥ وأعلى لمعة في التشكيلة كلها، وأوفانزا نفسها مصنفاه Strong Shine. الواكس مش شغلانته: لامع أيوة، بس تثبيته ٤ وبيفضل طري، فبعد ساعتين الشعر بيرجع مكانه. عندك فرح أو يوم طويل بره في الحر؟ بعد ما ينشف، رشة سبراي خفيفة فوقه تقفل الشكل وتمنعه يتحرك.',
      steps: [
        'اغسل شعرك وسيبه مبلول شوية، مش مقطّر.',
        'كمية قد الجوزة، دوّبها بين كفوفك.',
        'مشّط من قدام لورا بمشط واسع، والجناب لورا كمان.',
        'سيبه ينشف لوحده. عايزه يقعد لآخر الليل؟ رشة سبراي واحدة خفيفة بعد ما ينشف، مش أكتر.',
      ],
      avoid: 'متحطهوش على شعر ناشف — هيتكتّل ويعمل قشر أبيض. ومتزوّدش الكمية عشان الثبات؛ الزيادة بتنزل على جبهتك أول ما تعرق.',
    },
    en: {
      name: 'Slick back',
      short: 'Everything back, wet, and it holds all day.',
      look: 'Everything combed back, nothing standing up. The wet shine is on purpose: you want it looking styled, not like you just rolled out of bed. Best on straight or wavy hair. If yours is fine, you’ll need more hold to keep it back.',
      why: 'The Blue gel. Hold 5 and the highest shine in the range, and Ovanza rate this one Strong Shine themselves. Wax is the wrong tool: it shines, but it holds at 4 and never sets, so the front drops back down inside two hours. A wedding, or a long day out in the heat? Once it dries, one light pass of the spray over the top locks the shape and stops it moving.',
      steps: [
        'Wash it, leave it damp. Not dripping.',
        'A walnut of gel, rubbed between your palms.',
        'Comb straight back with a wide comb, sides included.',
        'Leave it to dry. Want it to last till night? One light pass of spray once it is dry. One, not more.',
      ],
      avoid: 'Never on dry hair. It clumps and flakes white. And don’t add more to buy more hold; the extra just runs down your forehead when you sweat.',
    },
  },
  {
    slug: 'low-taper-fade',
    served: 'yes',
    icon: 'assets/style/low-taper-fade.svg',
    photo: 'assets/style/low-taper-fade.webp',
    color: '#D9A81E',
    hold: 4,
    label: 'تثبيت ٤ · مرن طول اليوم',
    labelEn: 'Hold 4 · Reworkable all day',
    needs: { formats: ['wax'], shine: 3, flex: 3, hair: 'thick', lead: 'S7-WAX-YEL' },
    ar: {
      name: 'تدريج خفيف',
      short: 'الجناب تدريج واطي عند الحلاق. الفوق عليك إنت.',
      look: 'دي القصة اللي بتخرج بيها من أي حلاق في مصر دلوقتي: الجناب نازلة تدريج واطي، والفوق سايب بطول. التدريج الواطي بقى هو الماشي، مش الحلاقة اللي بتوصل للزيرو. الحلاق بيسلّمك القصة نضيفة، وبعد كام يوم الفوق بيبقى عايم ومش واخد شكل. القصة تمام. اللي ناقص إنك تظبط الفوق.',
      why: 'واكس برو الأصفر. تثبيت ٤ ومرونة عالية — ماسك بجد، وبرضه تعدّله بإيدك الساعة ٤ العصر من غير ما تغسل شعرك. أوفانزا بيقولوا إنه بيناسب كل أنواع الشعر، وده لازم يكون صح في التدريج — القصة دي بتتعمل على كل نوع شعر في مصر. حاجة واحدة بس: الموضة دلوقتي ناشفة طبيعية، والواكس بيلمع. حط شوية — كل ما تقلّل كل ما يبان أطبيعي.',
      steps: [
        'شعر ناشف أو منشّف بالفوطة. مش مبلول.',
        'حتة قد الحمصة، دوّبها بين كفوفك لحد ما تختفي.',
        'ادخل بصوابعك من ورا لقدام وشكّل الفوق. مش مشط.',
        'آخر حاجة: اظبط الخط اللي بين الفوق والجناب. ده الخط اللي الناس بتشوفه.',
      ],
      avoid: 'متحطش على الجناب. المنطقة المدرّجة قصيرة ومفيش فيها حاجة تمسك — كل اللي هيحصل إنها تلمع وتبان دهنة.',
    },
    en: {
      name: 'Low taper fade, top styled',
      short: 'Low taper sides from the barber. The top is on you.',
      look: 'The cut you walk out of any barber in Egypt with now: a low taper down the sides, length left up top. The low taper is what people ask for these days, not the high fade shaved to the skin. He hands it to you clean, and a few days later the top is just floating with no shape. The cut is fine. Nobody styled the top.',
      why: 'The yellow Pro. Hold 4 with high flexibility, so it holds properly and you can still push it back into shape at 4pm without washing it out. Ovanza call it suitable for every hair type, and a fade is where that has to be true; every texture in Egypt gets this cut. One thing: the look now is dry and natural, and wax shines. Go light. The less you use, the more natural it reads.',
      steps: [
        'Dry or towel-dried hair. Not wet.',
        'A chickpea, rubbed between your palms until it disappears.',
        'Fingers in from the back, forward, shaping the top. No comb.',
        'Last thing: tidy the line where the top meets the fade. That’s the line people actually see.',
      ],
      avoid: 'Keep it off the sides. The faded area is too short to hold anything, so all it does down there is shine like grease.',
    },
  },
  {
    slug: 'defined-curls',
    served: 'yes',
    icon: 'assets/style/defined-curls.svg',
    photo: 'assets/style/defined-curls.webp',
    color: '#8B4DC9',
    hold: 3,
    label: 'تثبيت ٣ · لمعة طبيعية',
    labelEn: 'Hold 3 · Natural shine',
    needs: { formats: ['wax'], shine: 3, flex: 3, hair: 'curly', lead: 'S7-WAX-BLU' },
    ar: {
      name: 'كيرلي مظبوط',
      short: 'الكيرلة تبان محددة. مش منفوشة ومش ملزوقة.',
      look: 'شعرك كيرلي أصلاً، والمطلوب إنه يبان كده. محدد يعني كل خصلة واخدة شكلها لوحدها، مش داخلة في اللي جنبها في نفشة واحدة. المشكلة إن أغلب المنتجات بتحل النفشة بإنها تفرد الكيرلة — وساعتها ضيّعت اللي إنت أصلاً عايزه.',
      why: 'واكس الأرجان. تثبيت ٣ بس، ومقصود — الكيرلة لازم تفضل تتحرك، وأي تثبيت أعلى بيقفلها. وزيت الأرجان خفيف وبيدخل جوه الشعرة نفسها، فبيلين الخشونة ويدي لمعة من غير ما يتقّل الخصلة ويوقّعها.',
      steps: [
        'على شعر مبلول. ده الوحيد في الليستة دي اللي بيتحط والشعر لسه مبلول بجد.',
        'كمية صغيرة، دوّبها كويس لحد ما تبقى زي الزيت في إيدك.',
        'اعصر الخصل لفوق ناحية دماغك بكفك. متمشّطش.',
        'سيبه ينشف في الهوا ومتلمسهوش. لمس الكيرلي وهو بينشف = نفشة.',
      ],
      avoid: 'المشط والفوطة الخشنة. المشط بيفك الكيرلة والفوطة بتنفشها — نشّف بتيشرت قطن.',
    },
    en: {
      name: 'Defined curls',
      short: 'Curl you can actually see. Not frizz, not glued down.',
      look: 'Your hair is already curly. The job is making the curl show: each one keeping its own shape instead of merging with its neighbours into one cloud. Most products kill frizz by flattening the curl, and then you’ve lost the thing you wanted.',
      why: 'The Argan wax. Hold 3, and that’s deliberate: a curl has to keep moving, and anything stronger locks it shut. Argan oil is light enough to go into the strand instead of sitting on top, so it softens coarse curl and adds shine without the weight that drops it.',
      steps: [
        'On wet hair. This is the only one on the list that genuinely goes on wet.',
        'A small amount, warmed until it turns to oil in your hands.',
        'Scrunch the lengths up toward your scalp with your palm. No comb.',
        'Air-dry and leave it alone. Touching curls while they dry is how you get frizz.',
      ],
      avoid: 'The comb and the rough towel. A comb pulls the curl apart, a towel roughs it into frizz. Dry it with a cotton t-shirt.',
    },
  },
  {
    slug: 'curtains',
    served: 'partly',
    icon: 'assets/style/curtains.svg',
    photo: 'assets/style/curtains.webp',
    color: '#5E9C2B',
    hold: 3,
    label: 'تثبيت ٣ · مفروق من النص',
    labelEn: 'Hold 3 · Centre part',
    // shine:2 is load-bearing, not decorative. Argan and Black are also hold-3
    // waxes, so without pinning the finish the ranker would let either of them
    // pass; Shea leads only because it is the single Medium-shine SKU, which is
    // exactly the finish a natural centre part wants.
    needs: { formats: ['wax'], shine: 2, flex: 3, hair: 'wavy', lead: 'S7-WAX-PUR' },
    ar: {
      name: 'كيرتن',
      short: 'مفروق من النص وطايح على الجنبين. لوك الجيل الجديد.',
      look: 'شعر متوسط الطول، مفروق من النص، وكل ناحية طايحة على وشك. محتاج شوية طول عشان يقع صح، والفرقة لازم تفضل مفتوحة طول اليوم من غير ما تتلزق. ده اللي خد مكان السبايكي.',
      why: 'أخف حاجة في إيدك. الكيرتن مش عايز تثبيت قوي، عايز حركة. لو لزقته بجل هيبان متسطّر بالمسطرة، والمفروض يبان طبيعي. واكس الشيا أقل واحد لامع في التشكيلة، تثبيته ٣ ومرن — يمسك الفرقة ويسيب الشعر يتحرك.',
      steps: [
        'شعر مبلول شوية، استشوره من النص لكل ناحية عشان الفرقة تبان.',
        'كمية صغيرة شيا، دوّبها في إيدك.',
        'عدّي بيها على الطول، مش على الجذر، وسيب الفرقة نضيفة.',
        'لو الشعر تقيل والفرقة مش قافلة معاك، برو إكس بيمسك الفرقة أكتر شوية.',
      ],
      avoid: 'الجل بيلزق الفرقة ويعملها مسطرة. وابعد عن الجذر — أول ما المنتج ينزل على الجذر الشعر بيتقل والفرقة بتقفل.',
    },
    en: {
      name: 'Curtains',
      short: 'Parted down the middle, falling to each side. What every young guy wants now.',
      look: 'Medium-length hair, split from a centre part, each side sweeping onto your face. It needs a bit of length to fall right, and the part has to stay open all day without gluing flat. This is what took over from the spike.',
      why: 'The lightest thing you own. Curtains don’t want strong hold, they want movement. Glue it down with gel and the part looks drawn on with a ruler, when it should look natural. The Shea wax is the least shiny in the range, hold 3 and flexible, so it holds the part and still lets the hair move.',
      steps: [
        'Slightly damp hair. Blow it from the centre out to each side so the part shows.',
        'A small amount of Shea, warmed in your hand.',
        'Run it through the lengths, not the roots, and leave the part clean.',
        "If your hair is heavy and the part won’t stay, Pro X grips it a little harder.",
      ],
      avoid: 'Gel drags the part into a straight line. And stay off the roots: the moment product hits the root the hair goes heavy and the part closes.',
    },
  },
  {
    slug: 'quiff',
    served: 'yes',
    icon: 'assets/style/quiff.svg',
    photo: 'assets/style/quiff.webp',
    color: '#D7291D',
    hold: 4,
    label: 'تثبيت ٤ · ارتفاع من قدام',
    labelEn: 'Hold 4 · Height at the front',
    needs: { formats: ['wax'], shine: 3, flex: 2, hair: 'wavy', lead: 'S7-WAX-RED' },
    ar: {
      name: 'كويف',
      short: 'ارتفاع من قدام، طبيعي مش متنفخ، ومبيقعش قبل الليل.',
      look: 'الشعر قدام بيتاخد لفوق ولورا فبيعمل موجة فوق الجبهة. بس الكويف الجديد أهدأ وأطبيعي من البومبادور القديم العالي المتنفخ — ده اللي ماشي دلوقتي. وأهم حاجة تفهمها: الارتفاع بييجي من الاستشوار. المنتج بس بيمسكه بعد كده.',
      why: 'واكس برو إكس الأحمر. تثبيت ٤، ومرونته متوسطة — الوحيد كده في التشكيلة كلها. يعني الوحيد اللي بيمسك الشكل اللي ظبطته ومبيسبهوش يرتخي على مدار اليوم. الارتفاع نفسه من الاستشوار مش من العلبة. عايزه يفضل واقف لآخر الليل؟ بعد ما تخلّص، رشة سبراي خفيفة تقفل الطول.',
      steps: [
        'شعر مبلول شوية. سخّن الاستشوار وارفع الشعر قدام لفوق ولورا وإنت بتنشّفه، بفرشة مدوّرة لو معاك.',
        'استنى الشعر يبرد وهو واقف. البرودة هي اللي بتثبت الشكل، مش السخونة.',
        'دوّب الواكس كويس — لازم يبقى شفاف في إيدك قبل ما يلمس شعرك.',
        'اسحب من قدام لورا واظبط الموجة. ليلة طويلة؟ رشة سبراي خفيفة فوقه في الآخر.',
      ],
      avoid: 'متحطش الواكس والشعر لسه مبلول، ولا قبل الاستشوار. هيتقل وهيقع، وإنت هتفتكر إن التثبيت هو المشكلة، والمشكلة الترتيب.',
    },
    en: {
      name: 'Quiff',
      short: 'Height at the front, natural not inflated, and it holds past lunch.',
      look: 'The front is lifted up and swept back into a wave above the forehead. But the modern quiff is softer and more natural than the old tall pompadour, and that’s the one people wear now. The part most men get wrong: the height comes from the dryer. The jar only holds it there.',
      why: 'The red Pro X. Hold 4, medium flexibility, and the only one like that in the whole range. That’s what makes it keep the shape you set instead of relaxing out of it through the day. The height itself is the dryer, not the jar. Want it standing till the end of the night? Once you’re done, one light pass of spray locks it.',
      steps: [
        'Slightly damp hair. Dryer on, lift the front up and back as you dry it. Round brush if you have one.',
        'Let it cool while it’s still standing. The cooling sets the shape, not the heat.',
        'Warm the wax properly. It has to go clear in your hands before it touches your hair.',
        'Pull from the front back and shape the wave. Long night ahead? One light pass of spray over the top at the end.',
      ],
      avoid: 'Don’t put wax in while the hair is still wet, or before the dryer. It goes heavy and drops, and you’ll blame the hold when the order was the problem.',
    },
  },
  {
    slug: 'textured-crop',
    // 'partly' rather than 'no', and the change is a fact about the factory
    // rather than a softening. The crop needs a clay; the manufacturer makes a
    // clay wax now. What it is still waiting on is the photograph and the
    // price, so the tile leads with the nearest live jar and says why.
    //
    // 'clay' is first in `formats` and `lead` is null on purpose. With no clay
    // on the shop the Shea wins the format 'wax' branch on shine alone, exactly
    // as it did when this tile said 'no'; the day a clay is switched on it
    // takes the tile on an exact shine match, with no code change and no named
    // lead to override it. A named lead here would have to be a SKU that does
    // not exist yet, which is a lead that can only ever be wrong.
    served: 'partly',
    icon: 'assets/style/textured-crop.svg',
    photo: 'assets/style/textured-crop.webp',
    color: '#55524A',
    hold: 3,
    label: 'تثبيت ٣ · مطفي',
    labelEn: 'Hold 3 · Matte',
    needs: { formats: ['clay', 'wax'], shine: 1, flex: 3, hair: 'thick', lead: null },
    ar: {
      name: 'فرنش كروب',
      short: 'مكركب، ناشف، وغرة قدام. ده شغل الكلاي.',
      look: 'الجناب قصيرة، الفوق مقصوص طبقات ومكركب، والغرة رايحة قدام على الجبهة. سرّه كله إنه يبان ناشف — كأن مفيش حاجة على شعرك وهو واخد الشكل ده لوحده. ودي بقت أكتر قصة الناس بتطلبها دلوقتي.',
      why: 'الكلاي واكس. ده الشكل الوحيد اللي بيدي تثبيت قوي وخلاصة مطفية في نفس الوقت، فالطبقات بتفضل مفكوكة والشعر بيفضل باين ناشف. لسه منزلش على الموقع — لحد ما ينزل، أقل واكس لامع عندنا هو الشيا: بنص الكمية اللي في دماغك، وعلى شعر ناشف تماماً. بس اعرف إن الواكس بيلمع، وأول ما اللمعة تنزل على كروب بيتحوّل من "مكركب" لـ"مدهون" — يعني بتقرّب من الشكل، مش بتوصله.',
      steps: [
        'شعر ناشف تماماً. مفيش مية خالص.',
        'كمية صغيرة جداً — نص اللي في دماغك.',
        'دوّبها في إيدك لحد ما تختفي، وعدّي بضهر إيدك على السطح بس.',
        'ادفع الغرة قدام بصوابعك وفكّك الخصل. متسحبش من الجذر.',
      ],
      avoid: 'الجل. أي جل. بيلحم الطبقات في بعضها والكروب بيتحول لطاقية.',
    },
    en: {
      name: 'Textured crop',
      short: 'Choppy, dry, fringe forward. This is a clay job.',
      look: 'Short sides, a choppy layered top, fringe pushed forward onto the forehead. The whole thing lives on looking dry, as if there’s nothing in your hair and it fell that way. And it’s the cut most men are asking for right now.',
      why: 'The clay wax. It’s the only format that gives firm hold and a matte finish at once, which is what keeps the pieces separated and the hair reading dry. It isn’t on the shop yet. Until it is, the least shiny wax we sell is the Shea: half what you think, on bone-dry hair. Just know that wax shines, and shine on a crop turns it from choppy to oily, so you’re getting close to the look rather than landing it.',
      steps: [
        'Completely dry hair. No water at all.',
        'A very small amount. Half what you were about to take.',
        'Warm it until it vanishes in your palms, then skim the surface only.',
        'Push the fringe forward with your fingers and separate the pieces. Do not work it from the root.',
      ],
      avoid: 'Gel. Any gel. It welds the layers together and the crop turns into a helmet.',
    },
  },
];

export const bySlug = slug => HAIR_STYLES.find(s => s.slug === slug) || null;

/**
 * Ranks product rows for a style. Pure — no database — so it is testable, and
 * it has the same shape and the same guarantees as rankProducts in
 * lib/hairtypes.js.
 *
 * The filter comes first and is structural: a product whose format cannot make
 * the look, or whose hold is not the band the look needs, is not scored at all.
 * That is what makes a brand promise enforceable in code rather than in an
 * admin textarea — the crop tile tells the customer that gel welds the layers
 * together, and no gel can reach the crop tile to contradict it, whatever
 * anyone types anywhere. It is also why the hair spray named in the slick-back
 * and quiff copy can never appear as a pick: those tiles ask for 'gel' and
 * 'wax', and a spray is neither.
 *
 * What is left is scored on the two axes the manufacturer publishes. The named
 * lead takes a decisive bonus, because for the curtains tile the axes alone
 * would let another hold-3 wax through; everything after it is ordered by how
 * close its finish is to the finish the look wants, then by the position of the
 * style’s affinity hair type inside the product’s own hair_types CSV, so the
 * alternates are in a defensible order rather than in seed order.
 */
export function rankForStyle(rows, style, limit = 3) {
  if (!style || !style.needs) return [];
  const need = style.needs;

  return (Array.isArray(rows) ? rows : [])
    .map(p => {
      if (!need.formats.includes(String(p.kind))) return null;
      if (Number(p.hold_level) !== Number(style.hold)) return null;

      // A SKU with no published rating is treated as the middle of both scales
      // rather than dropped, so a product the client adds tomorrow still ranks.
      const f = finishOf(p) || { shine: 2, flex: 2 };
      const hair = String(p.hair_types || '').split(',').map(s => s.trim()).filter(Boolean);
      const pos = hair.indexOf(need.hair);

      const score =
        (p.sku === need.lead ? 60 : 0) +
        30 -
        Math.abs(f.shine - need.shine) * 10 -
        Math.abs(f.flex - need.flex) * 6 +
        Number(p.hold_level || 0) +
        (pos === -1 ? 0 : 6 - pos);

      return { ...p, match_score: score };
    })
    .filter(Boolean)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit)
    .map((p, i) => ({ ...p, match_rank: i + 1 }));
}
