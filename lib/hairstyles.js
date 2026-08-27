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
 * Six styles, and the range serves five of them. The sixth is here anyway,
 * because the honest answer to "how do I get a textured crop" is that we do not
 * make the product for it — the same admission /hair-types already makes on the
 * fine-hair tile, and for the same missing SKU.
 */

/**
 * The manufacturer's own finish ratings, per SKU, on the two axes that decide a
 * style once hold has been settled.
 *
 * These are not in the products table and cannot be, because they are not
 * things the shop owner sets: they are published specs, read off the panels and
 * the manufacturer renders and recorded in docs/product-facts.md. Keeping them
 * here as a lookup rather than a column means the style mapping is derived from
 * the same numbers a customer can check on the jar, and cannot be edited into
 * something the label contradicts.
 *
 *   shine 3 = High or Strong · 2 = Medium · (1 = matte, which nothing here is)
 *   flex  3 = High flexibility · 2 = Medium · 1 = a gel, which sets and stops
 *
 * Shine 1 exists in the scale and is deliberately unreachable. Every product in
 * this range is microcrystalline wax, beeswax and petrolatum with no silica, no
 * starch and no clay, so there is no ingredient present anywhere in it that
 * could produce a matte finish. A style that wants matte therefore scores worst
 * against everything we sell, which is the correct answer rather than a bug.
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
 * `served` is the tile own verdict on whether the range can actually deliver
 * the look: 'yes' for the four it serves properly, 'partly' for the spiky tile
 * where only the glossy half is reachable, and 'no' for the crop. It is data
 * rather than a slug check in the views because it decides two visible things —
 * whether the jar is offered as the answer or as the nearest thing, and whether
 * a tile is allowed to list alternates at all. A look the range cannot serve
 * has no second-best, and offering one would undo the admission the tile just
 * made.
 *
 * `needs` is the derivation, kept as data so the client can re-tune a tile
 * without a code change:
 *   formats  the formats that can make this look at all
 *   shine    the finish the look wants, on the FINISH scale above
 *   flex     how much the product is allowed to move after it sets
 *   hair     the hair type this look sits on best, used only to break ties
 *            through the existing products.hair_types CSV
 *   lead     the SKU this tile leads with. It is named rather than computed
 *            because two of the six picks turn on something the two axes cannot
 *            see: Green and Golden are the same gel at the same hold and the
 *            same Medium shine, and the only thing separating them for everyday
 *            wear is the scent.
 */
export const HAIR_STYLES = [
  {
    slug: 'slick-back',
    served: 'yes',
    icon: 'assets/style/slick-back.svg',
    color: '#2A6DE8',
    hold: 5,
    label: 'تثبيت ٥ · لمعة مبلولة',
    labelEn: 'Hold 5 · Wet shine',
    needs: { formats: ['gel'], shine: 3, flex: 1, hair: 'straight', lead: 'S7-GEL-BLU' },
    ar: {
      name: 'سلك باك',
      short: 'الشعر كله لورا، لامع، وثابت لحد الليل.',
      look: 'الشعر كله مرجّع لورا ومفيش شعرة طالعة. اللمعة مقصودة — المفروض يبان إنك مسرّح، مش إنك صاحي من النوم. أحسن حاجة على شعر مفرود أو متموج، وكل ما شعرك يكون أنعم كل ما احتجت تثبيت أعلى.',
      why: 'الجل الأزرق. تثبيت ٥ وأعلى لمعة في التشكيلة كلها — أوفانزا نفسها مصنفاه Strong Shine. الواكس مش هينفع هنا: لامع أيوة، بس تثبيته ٤ وبيفضل طري، فالشعر بيرجع مكانه بعد ساعتين.',
      steps: [
        'اغسل شعرك وسيبه مبلول شوية، مش مقطّر.',
        'كمية قد الجوزة، دوّبها بين كفوفك.',
        'مشّط من قدام لورا بمشط واسع، والجناب لورا كمان.',
        'سيبه ينشف لوحده. متلمسهوش وهو بينشف.',
      ],
      avoid: 'متحطهوش على شعر ناشف — هيتكتّل ويعمل قشر أبيض. ومتزوّدش الكمية عشان تزوّد الثبات؛ الزيادة بتنزل على جبهتك أول ما تعرق.',
    },
    en: {
      name: 'Slick back',
      short: 'Everything back, wet, and it stays there.',
      look: 'Everything combed back, nothing standing up. The wet look is deliberate — you are supposed to see that it is done. Works best on straight or wavy hair, and finer hair needs more hold to stay back.',
      why: 'The Blue gel. Hold 5 and the highest shine in the range — Ovanza rate this one Strong Shine themselves. Wax will not do this job. It shines, but it holds at 4 and it never sets, so the front drops back down inside two hours.',
      steps: [
        'Wash it, leave it damp — not dripping.',
        'A walnut of gel, rubbed between your palms.',
        'Comb straight back with a wide comb, sides included.',
        'Leave it alone while it dries. Touch it while it sets and you break it.',
      ],
      avoid: 'Never on dry hair — it clumps and flakes white. And do not add more to get more hold. The extra just runs down your forehead when you sweat.',
    },
  },
  {
    slug: 'spiky',
    served: 'partly',
    icon: 'assets/style/spiky.svg',
    color: '#5E9C2B',
    hold: 5,
    label: 'تثبيت ٥ · شوكة واقفة',
    labelEn: 'Hold 5 · Spikes that stand',
    needs: { formats: ['gel'], shine: 2, flex: 1, hair: 'straight', lead: 'S7-GEL-GRN' },
    ar: {
      name: 'سبايكي',
      short: 'شوك واقف قدام، وثابت من الصبح للمغرب.',
      look: 'شعر قصير أو متوسط، بيتدفع لفوق في شوك مفصول عن بعضه. الاستايل كله عايش على إن الشوكة تفضل واقفة — أول ما تقع، خلاص. عشان كده السبايكي محتاج أعلى تثبيت عندك، مش أقوى واكس.',
      why: 'الجل الأخضر. تثبيت ٥، وريحته نضيفة — وده بيفرق فعلاً لما تكون حاططه كل يوم قبل الشغل. ولمعته أقل من الأزرق درجة، وده أحسن هنا: الشوكة اللي لامعة أوي بتبان دهنة مش مظبوطة.',
      steps: [
        'شعر مغسول ومنشّف بالفوطة.',
        'كمية صغيرة، دوّبها في إيدك.',
        'ادفع الشعر لفوق بأطراف صوابعك، شوكة شوكة، من الجذر.',
        'سيبه ينشف وهو واقف.',
      ],
      avoid: 'بلاش تمشّطه بعد ما ينشف — الشوكة هتتكسر ومش هترجع. وبلاش تحطه على شعر ناشف تماماً.',
    },
    en: {
      name: 'Spiky',
      short: 'Front standing up, and it stays up all day.',
      look: 'Short-to-medium hair pushed up into separated spikes. Once a spike drops the look is gone, so this one wants the strongest hold you own — and the strongest hold here is a gel.',
      why: 'The Green gel. Hold 5, and it smells clean, which matters when you are putting it in every morning before work. It shines a step less than the Blue, and that suits a spike — pile gloss on a spike and it just looks oily.',
      steps: [
        'Washed hair, towel-dried.',
        'A small scoop, worked into your palms.',
        'Push the hair up with your fingertips, spike by spike, from the root.',
        'Let it dry standing.',
      ],
      avoid: 'Do not comb it once it sets — the spikes snap and they do not come back. And do not put it on bone-dry hair.',
    },
  },
  {
    slug: 'defined-curls',
    served: 'yes',
    icon: 'assets/style/defined-curls.svg',
    color: '#8B4DC9',
    hold: 3,
    label: 'تثبيت ٣ · لمعة طبيعية',
    labelEn: 'Hold 3 · Natural shine',
    needs: { formats: ['wax'], shine: 3, flex: 3, hair: 'curly', lead: 'S7-WAX-BLU' },
    ar: {
      name: 'كيرلي مظبوط',
      short: 'الكيرلة تبان محددة. مش منفوشة ومش ملزوقة.',
      look: 'شعرك كيرلي أصلاً والمطلوب إنه يبان كده. محدد يعني كل خصلة واخدة شكلها لوحدها، مش داخلة في اللي جنبها في نفشة واحدة. والمشكلة إن أغلب المنتجات بتحل النفشة بإنها تفرد الكيرلة — وساعتها إنت ضيّعت اللي إنت أصلاً عايزه.',
      why: 'واكس الأرجان. تثبيت ٣ بس، وده مقصود — الكيرلة لازم تفضل تتحرك، وأي تثبيت أعلى بيقفلها. وزيت الأرجان خفيف وبيدخل جوه الشعرة نفسها، فبيلين الخشونة ويدي لمعة من غير ما يتقّل الخصلة ويوقّعها.',
      steps: [
        'على شعر مبلول. ده الوحيد في الليستة دي اللي بيتحط والشعر لسه مبلول بجد.',
        'كمية صغيرة، دوّبها كويس لحد ما تبقى زي الزيت في إيدك.',
        'اعصر الخصل لفوق ناحية دماغك بكفك. متمشّطش.',
        'سيبه ينشف في الهوا، ومتلمسهوش. لمس الكيرلي وهو بينشف = نفشة.',
      ],
      avoid: 'المشط والفوطة الخشنة. المشط بيفك الكيرلة والفوطة بتنفشها — نشّف بتيشرت قطن.',
    },
    en: {
      name: 'Defined curls',
      short: 'Curl you can actually see. Not frizz, not glued down.',
      look: 'Your hair is already curly. The job is making the curl show. Defined means each curl keeps its own shape instead of merging with its neighbours into one cloud. Most products fix frizz by flattening the curl, and then you have lost the thing you wanted.',
      why: 'The Argan wax. Hold 3, and that is deliberate — a curl has to keep moving, and anything stronger locks it shut. Argan oil is light enough to go into the strand instead of sitting on it, so it softens coarse curl and adds shine without the weight that drops it.',
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
    slug: 'fade-top',
    served: 'yes',
    icon: 'assets/style/fade-top.svg',
    color: '#D9A81E',
    hold: 4,
    label: 'تثبيت ٤ · مرن طول اليوم',
    labelEn: 'Hold 4 · Reworkable all day',
    needs: { formats: ['wax'], shine: 3, flex: 3, hair: 'thick', lead: 'S7-WAX-YEL' },
    ar: {
      name: 'ديجراديه',
      short: 'الجناب عند الحلاق. الفوق عليك إنت.',
      look: 'دي القصة اللي بتخرج بيها من أي حلاق في مصر: الجناب نازلة بالتدريج والفوق سايب بطول. الحلاق بيسلّمك القصة نضيفة يوم الجمعة، وبعد كام يوم الفوق بيبقى عايم ومش واخد شكل. القصة مظبوطة. اللي ناقص إنك تظبط الفوق.',
      why: 'واكس برو الأصفر. تثبيت ٤ ومرونة عالية — يعني ماسك بجد، وبرضه تقدر تعدّله بإيدك الساعة ٤ العصر من غير ما تغسل شعرك. أوفانزا بيقولوا عليه إنه بيناسب كل أنواع الشعر، وفي الديجراديه لازم يكون صح فعلاً — القصة دي بتتعمل على كل نوع شعر في مصر.',
      steps: [
        'شعر ناشف أو منشّف بالفوطة. مش مبلول.',
        'حتة قد الحمصة، دوّبها بين كفوفك لحد ما تختفي.',
        'ادخل بصوابعك من ورا لقدام وشكّل الفوق. مش مشط.',
        'آخر حاجة: اظبط الخط اللي بين الفوق والجناب بأطراف صوابعك. ده الخط اللي الناس بتشوفه.',
      ],
      avoid: 'متحطش على الجناب. المنطقة المدرّجة قصيرة أصلاً ومفيش فيها حاجة تمسك — كل اللي هيحصل إنها هتلمع وتبان دهنة.',
    },
    en: {
      name: 'Fade, top styled',
      short: 'The sides are the barber’s. The top is on you.',
      look: 'The cut you walk out of any barber in Egypt with: graduated sides, length left up top. He hands it to you clean on a Friday, and by Monday the top is just floating there with no shape. The cut is fine. Nobody styled the top.',
      why: 'The yellow Pro. Hold 4 with high flexibility — it genuinely holds, and you can still push it back into shape at 4pm without washing it out. Ovanza call it suitable for every hair type, and a fade is where that has to be true — every texture in Egypt gets this cut.',
      steps: [
        'Dry or towel-dried hair. Not wet.',
        'A chickpea, rubbed between your palms until it disappears.',
        'Fingers in from the back, forward, shaping the top. No comb.',
        'Last thing: tidy the line where the top meets the fade. That is the line people actually see.',
      ],
      avoid: 'Keep it off the sides. The faded area is too short to hold anything, so all it does down there is shine like grease.',
    },
  },
  {
    slug: 'quiff',
    served: 'yes',
    icon: 'assets/style/quiff.svg',
    color: '#D7291D',
    hold: 4,
    label: 'تثبيت ٤ · ارتفاع من قدام',
    labelEn: 'Hold 4 · Height at the front',
    needs: { formats: ['wax'], shine: 3, flex: 2, hair: 'wavy', lead: 'S7-WAX-RED' },
    ar: {
      name: 'بومبادور',
      short: 'ارتفاع من قدام، ومبيقعش قبل الضهر.',
      look: 'الشعر قدام بيتاخد لفوق ولورا فبيعمل موجة عالية فوق الجبهة. أطول استايل في الليستة دي وأصعبهم، لأنه شغل ضد الجاذبية. وأهم حاجة تفهمها فيه: الارتفاع ده بيجي من الاستشوار. المنتج بس بيمسكه بعد كده.',
      why: 'واكس برو إكس الأحمر. تثبيت ٤، ومرونته متوسطة — وهو الوحيد كده في التشكيلة كلها. يعني هو الوحيد اللي بيمسك الشكل اللي ظبطته ومش بيسيبه يرتخي بالراحة. ولمعته عالية، فالموجة بتاخد خط لامع من فوق. عايزه مقفول أكتر من كده؟ خش على الجل — بس ساعتها بقى استايل تاني خالص، مبيتحركش.',
      steps: [
        'شعر مبلول شوية. سخّن الاستشوار وارفع الشعر قدام لفوق ولورا وإنت بتنشّفه، بفرشة مدوّرة لو معاك.',
        'استنى الشعر يبرد وهو واقف. البرودة هي اللي بتثبت الشكل، مش السخونة.',
        'دوّب الواكس كويس — لازم يبقى شفاف في إيدك قبل ما يلمس شعرك.',
        'اسحب من قدام لورا واظبط الموجة.',
      ],
      avoid: 'متحطش الواكس والشعر لسه مبلول، ولا تحطه قبل الاستشوار. هيتقل وهيقع، وإنت هتفتكر إن التثبيت هو المشكلة.',
    },
    en: {
      name: 'Quiff',
      short: 'Height at the front that does not collapse by lunchtime.',
      look: 'The front is lifted up and swept back into a wave above the forehead. Tallest thing on this list and the hardest, because it works against gravity. And the part most men get wrong: the height comes from the dryer. The jar only holds it there.',
      why: 'The red Pro X. Hold 4, medium flexibility — the least flexible wax Ovanza make, and the only one they rate below High. That is why it keeps the shape you set instead of relaxing out of it over the afternoon. High shine, so the wave picks up a lit edge along the top. Want it locked harder than that? Use a gel — but then it stops moving at all, and that is a different look.',
      steps: [
        'Slightly damp hair. Dryer on, lift the front up and back as you dry it — round brush if you have one.',
        'Let it cool while it is still standing. The cooling sets the shape, not the heat.',
        'Warm the wax properly. It has to go clear in your hands before it touches your hair.',
        'Pull from the front back and shape the wave.',
      ],
      avoid: 'Do not put wax in while the hair is still wet, and do not put it in before the dryer. It goes heavy and drops, and you will blame the hold when the order was the problem.',
    },
  },
  {
    slug: 'textured-crop',
    served: 'no',
    icon: 'assets/style/textured-crop.svg',
    color: '#55524A',
    hold: 3,
    label: 'مطفي — وده اللي مش عندنا',
    labelEn: 'Matte — the one thing we do not make',
    needs: { formats: ['wax'], shine: 1, flex: 3, hair: 'thick', lead: 'S7-WAX-PUR' },
    ar: {
      name: 'فرنش كروب',
      short: 'مكركب، ناشف، وغرة قدام. وده اللي مش عندنا.',
      look: 'الجناب قصيرة، الفوق مقصوص طبقات ومكركب، والغرة رايحة قدام على الجبهة. وسرّه كله إنه يبان ناشف — كأن مفيش حاجة على شعرك وهو واخد الشكل ده لوحده.',
      why: 'الكروب ده بيتعمل بكلاي أو معجون مطفي، وإحنا مش عاملين لا ده ولا ده. كل حاجة في التشكيلة دي شمع وفازلين وكلها بتلمع، وأول ما اللمعة تنزل على كروب بيتحوّل من "مكركب" لـ"مدهون". أقل واكس لامع عندنا هو الشيا — أوفانزا مصنفاه Medium shine، وهو الواكس الوحيد اللي مصنفينه كده. لو هتجرب برضه، جرّب بيه، وبنص الكمية اللي هتفكر فيها، وعلى شعر ناشف تماماً.',
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
      short: 'Choppy, dry, fringe forward. This is the one we cannot do.',
      look: 'Short sides, a choppy layered top, fringe pushed forward onto the forehead. The whole thing depends on looking dry — as if there is nothing in your hair and it fell that way.',
      why: 'A crop is made with clay or a matte paste. We do not make either one. Everything here is wax and petrolatum and all of it shines, and shine on a crop kills it — the pieces stop looking choppy and start looking oily. The least shiny wax we sell is the Shea; Ovanza rate it Medium shine, the only wax they rate that low. If you want to try anyway, use that one, half what you think, on completely dry hair.',
      steps: [
        'Completely dry hair. No water at all.',
        'A very small amount — half what you were about to take.',
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
 * anyone types anywhere.
 *
 * What is left is scored on the two axes the manufacturer publishes. The named
 * lead takes a decisive bonus, because for two of the six tiles the axes alone
 * cannot separate two identical products; everything after it is ordered by how
 * close its finish is to the finish the look wants, then by the position of the
 * style's affinity hair type inside the product's own hair_types CSV, so the
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
      const f = FINISH[p.sku] || { shine: 2, flex: 2 };
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
