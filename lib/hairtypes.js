/**
 * Hair-type definitions — the seven customer-facing tiles.
 *
 * Four are curl families from the Andre Walker system (1–4); two are density
 * states, because density — not curl pattern — decides how much product weight
 * hair can carry, and a customer can self-identify "my hair is thin" far more
 * reliably than "I'm a 2B". The seventh is grey, which is neither: it is a
 * colour problem the range answers with a colour-depositing product, and it is
 * the first thing a customer over forty is actually shopping for.
 *
 * The reasoning and sources live in docs/hair-type-research.md.
 * Which product each tile maps to is data, not code: it lives in the
 * products.hair_types column and is editable from the admin panel.
 */
export const HAIR_TYPES = [
  {
    "slug": "straight",
    "icon": "assets/hair/straight.svg",
    "walker": "1A – 1C",
    "color": "#2A6DE8",
    "ar": {
      "name": "ناعم مفرود",
      "short": "الشعر بيقع ومبيثبتش",
      "problem": "الشعر الناعم المفرود بيسيب الاستايل بسرعة، وزيوت فروة الرأس بتنزل عليه على طول فبيبقى دهون بدري.",
      "answer": "محتاج تثبيت عالي وخفيف في نفس الوقت — الجل هو الوحيد اللي بيمسك شكل على شعر أصلاً مش ماسك شكل، ومن غير أي وزن زيادة.",
      "avoid": "ابعد عن الواكس التقيل وزبدة الشيا — هيوقّعوا الشعر ويخلوه دهون."
    },
    "en": {
      "name": "Straight",
      "short": "Style drops, gets oily fast",
      "problem": "Straight hair loses its shape quickly, and scalp oil travels straight down the shaft — so it looks greasy sooner than any other type.",
      "answer": "You need high hold with zero weight. Gel is the only format with enough hold to hold a shape on hair that resists holding one.",
      "avoid": "Skip heavy waxes and shea butter — they flatten straight hair and speed up the grease."
    },
    "walkerEn": "1A – 1C"
  },
  {
    "slug": "wavy",
    "icon": "assets/hair/wavy.svg",
    "walker": "2A – 2C",
    "color": "#D7291D",
    "ar": {
      "name": "متموج",
      "short": "الموجة بتتفلت وبتنفش",
      "problem": "الشعر المتموج بيقاوم التصفيف وبينفش بسهولة — وأغلب المنتجات بتفرده بدل ما تظبط الموجة.",
      "answer": "واكس بتثبيت متوسط لعالي ولمعة طبيعية — بيعرّف الموجة بدل ما يلزقها. ده بالظبط اللي اتعملت عشانه تركيبة Wave & Groom في برو إكس.",
      "avoid": "ابعد عن الجل القوي جداً — بيفرد الموجة ويخليها قشرة."
    },
    "en": {
      "name": "Wavy",
      "short": "Waves drop out and frizz",
      "problem": "Wavy hair resists styling and frizzes easily — and most products flatten the wave instead of shaping it.",
      "answer": "Medium-high hold with a natural finish defines the S-pattern instead of gluing it flat. That is exactly what the Wave & Groom formula in Pro X is built for.",
      "avoid": "Avoid very hard gels — they straighten the wave and go crunchy."
    },
    "walkerEn": "2A – 2C"
  },
  {
    "slug": "curly",
    "icon": "assets/hair/curly.svg",
    "walker": "3A – 3C",
    "color": "#5E9C2B",
    "ar": {
      "name": "كيرلي",
      "short": "ناشف ومحتاج تعريف",
      "problem": "الكيرلي محتاج حاجتين مع بعض: تعريف للكيرلة وترطيب — وأغلب المنتجات بتديك واحدة وتضيع التانية.",
      "answer": "زيت الأرجان خفيف وبيدخل جوه الشعرة نفسها، فبيلين الكيرلة الخشنة ويديها لمعة من غير ما يتقّلها.",
      "avoid": "ابعد عن الطين (clay) — بينشّف الكيرلي أوي."
    },
    "en": {
      "name": "Curly",
      "short": "Dry, needs definition",
      "problem": "Curly hair needs two things at once — curl definition and moisture — and most products give you one at the cost of the other.",
      "answer": "Argan oil is lightweight and penetrates the shaft, so it softens coarse curls and adds shine without weighing them down. Curly hair also skews low-porosity, so light beats heavy here.",
      "avoid": "Not a clay — clay is documented as too drying for curly hair."
    },
    "walkerEn": "3A – 3C"
  },
  {
    "slug": "coily",
    "icon": "assets/hair/coily.svg",
    "walker": "4A – 4C",
    "color": "#8B4DC9",
    "ar": {
      "name": "خشن / أفرو",
      "short": "أنشف نوع وأكتره هشاشة",
      "problem": "الشعر الأفرو هو أنشف نوع وأكتر نوع بيتكسر — الرطوبة بتسيبه بسرعة وأي تركيبة مجففة بتأذيه.",
      "answer": "زبدة الشيا بتقفل الرطوبة جوه الشعرة وبتلين الخصلة الخشنة. دي التوصية القياسية للشعر الخشن والكيرلي التقيل.",
      "avoid": "ابعد عن أي تركيبة فيها كحول أو طين — بتزوّد النشاف."
    },
    "en": {
      "name": "Coily / Afro",
      "short": "Driest and most fragile",
      "problem": "Coily hair is the driest and most fragile type, with the highest shrinkage — moisture escapes fast and drying formulas damage it.",
      "answer": "Shea butter seals moisture into coarse, coily strands and softens them. It is the standard recommendation for thick, coarse and curly hair.",
      "avoid": "Avoid alcohol-heavy gels and clays — both make the dryness worse."
    },
    "walkerEn": "4A – 4C"
  },
  {
    "slug": "fine",
    "icon": "assets/hair/fine.svg",
    "walker": "أي نوع · كثافة قليلة",
    "color": "#D9A81E",
    "ar": {
      "name": "خفيف",
      "short": "محتاج حجم، وأي حاجة تقيلة بتقتله",
      "problem": "الشعر الخفيف محتاج حجم — وأي منتج تقيل أو لامع بيلزقه في الفروة ويخليه يبان أقل.",
      "answer": "الكلاي واكس. ده اللي اتعمل للحالة دي بالظبط — تثبيت قوي بخلاصة مطفية، بيدي حجم من غير لمعة ومن غير وزن. حتة قد الحمصة، دوّبها في إيدك، وحطها والشعر ناشف من نص الطول لبره. الجذور لأ.",
      "avoid": "البوماد وزبدة الشيا تقال على الشعر الخفيف وهيوقّعوه. والشعر المبلول زيهم — المية مع المنتج هي اللي بتلزقه في فروتك."
    },
    "en": {
      "name": "Fine & thin",
      "short": "Needs volume, heavy kills it",
      "problem": "Fine hair needs volume — and anything heavy or shiny glues it to the scalp and makes it look like there is even less of it.",
      "answer": "Clay wax. This is the one format built for exactly this — firm hold with a matte finish, so it gives volume without shine and without weight. A pea, warmed in your palms, through dry hair, mid-length out. Nothing at the roots.",
      "avoid": "Pomade and shea butter are both too heavy here and will flatten it. So will wet hair — water plus product is what glues it to your scalp."
    },
    "walkerEn": "Low density"
  },
  {
    "slug": "thick",
    "icon": "assets/hair/thick.svg",
    "walker": "أي نوع · كثافة عالية",
    "color": "#55524A",
    "ar": {
      "name": "كثيف",
      "short": "تقيل وبيقع بسرعة",
      "problem": "الشعر الكثيف بيقع تحت وزنه هو — محتاج أقوى تثبيت عندك، ومعظم المنتجات الخفيفة مبتصمدش معاه.",
      "answer": "تثبيت درجة ٤ — أقوى واكس عندنا. الشعر الكثيف هو النوع الوحيد اللي يقدر يشيل منتج تقيل من غير ما يقع.",
      "avoid": "التركيبات الخفيفة مش هتكفي — مش هتصمد لآخر اليوم."
    },
    "en": {
      "name": "Thick & coarse",
      "short": "Heavy hair, drops fast",
      "problem": "Thick hair collapses under its own weight. It needs the strongest hold you have, and light formulas simply do not survive the day.",
      "answer": "Level-4 hold — the strongest wax we make. Thick hair is the one density that can carry a heavy product without going limp.",
      "avoid": "Light formulas will not last — expect the style to drop by midday."
    },
    "walkerEn": "High density"
  },
  {
    // The seventh tile, and the only one that is not about texture at all.
    //
    // It is here because grey is the single most common reason an Egyptian man
    // over forty picks one jar over another, and the range already answers it:
    // five SKUs are made in a black that deposits colour as it holds. The site
    // had that fact buried in one product's chip and nowhere else, so the
    // finder could not surface it.
    //
    // The numbers in `answer` are the manufacturer's own and they are stated
    // rather than rounded up, because the failure mode here is a customer who
    // expected a dye. It darkens, partially, and it washes out. Saying 30-40%
    // out loud is what keeps that from becoming a complaint at the door.
    "slug": "white",
    "icon": "assets/hair/white.svg",
    "walker": "أي نوع · شيب",
    "color": "#8A8F98",
    "ar": {
      "name": "أبيض وشيب",
      "short": "عايز الشيب يغمق من غير صبغة",
      "problem": "الشيب بيبان أوضح كل ما الشعر يترتب، والصبغة قرار تقيل: كيماوي على فروتك، ولون بيفضل شهر، ولازم تمشي عليه كل كام أسبوع.",
      "answer": "المنتجات السودا عندنا. دي مش صبغة — بتغمّق الشعر الأبيض بنسبة تتراوح من ٣٠ لـ ٤٠٪ حسب درجة البياض وكميته في شعرك، وبتنزل مع أول غسلة. عندك أسود في الجل، وفي الواكس البريميوم، وفي الجل واكس والكريم جل.",
      "avoid": "متستناش تغطية كاملة ولا لون موحّد — دي مش صبغة ومش بتدّعي إنها صبغة. وابعد عن الكمية الزيادة: اللي مش ماسك في الشعرة بيسيب أثر على الياقة والمخدة."
    },
    "en": {
      "name": "White & grey",
      "short": "Wants the grey knocked back, not dyed",
      "problem": "Grey shows up more the moment hair is styled, and dye is a heavy decision: chemistry on your scalp, a colour that sits there for a month, and a repeat every few weeks.",
      "answer": "The black products. They are not a dye — they darken white hair by roughly 30–40%, depending on how white it is and how much of it there is, and the colour leaves on the first wash. Black exists in the gel, the premium wax, the gel wax and the cream gel.",
      "avoid": "Do not expect full, even coverage — this is not a dye and does not pretend to be one. And do not overload it: whatever does not grip the strand ends up on your collar and your pillow."
    },
    "walkerEn": "Any type · grey"
  }
];

export const bySlug = slug => HAIR_TYPES.find(t => t.slug === slug) || null;

/**
 * The rows a finder is allowed to recommend.
 *
 * A finder's whole sentence is "buy this one", so it may only name a product
 * somebody can actually buy. `active` is not enough on its own: the shop
 * deliberately carries active rows at price 0 — the manufacturer feed arrived
 * without prices — and the shop grid renders those as "ask for price" with a
 * WhatsApp link rather than as a purchase. A finder has no such affordance. It
 * prints a number next to a jar and an Add to cart button under it, so an
 * unpriced row reaching one is a page offering a product for nothing.
 *
 * Nothing could reach one until the grey tile arrived, because until then only
 * the eight launch SKUs carried a hair_types value and all eight are priced.
 * The tile itself is not the bug; it is what made the missing guard reachable,
 * and the guard belongs here rather than in the tagging, because the next way
 * in is an admin tagging a product they have not priced yet.
 *
 * Deliberately not folded into rankProducts or rankForStyle: those two are pure
 * scoring functions over whatever they are handed, and their tests hand them
 * fixtures with no price column at all.
 */
export function sellable(rows) {
  return (Array.isArray(rows) ? rows : []).filter(p => Number(p.price) > 0);
}

/**
 * Ranks product rows for a hair type. Pure — no database — so it is testable.
 * Position in the hair_types CSV is the priority: first listed = primary match.
 * Hold level breaks ties.
 */
export function rankProducts(rows, type, limit = 3) {
  return rows
    .map(p => {
      const list = String(p.hair_types || '').split(',').map(s => s.trim()).filter(Boolean);
      const pos = list.indexOf(type);
      if (pos === -1) return null;
      return { ...p, match_rank: pos + 1, match_score: 100 - pos * 22 + Number(p.hold_level || 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}

/** Shapes a database row for the browser. */
export function productPublic(p) {
  return {
    sku: p.sku, slug: p.slug, kind: p.kind,
    price: Number(p.price),
    compare_at: p.compare_at == null ? null : Number(p.compare_at),
    color: p.color, img: p.image,
    size_ml: p.size_ml == null ? null : Number(p.size_ml),
    hold: Number(p.hold_level),
    hair: String(p.hair_types || '').split(',').map(s => s.trim()).filter(Boolean),
    // In or out, never the exact count. The public /api/products response is
    // built from this shape and cached at the edge, so an exact integer let a
    // competitor poll live inventory for every SKU and infer sales velocity.
    // Every consumer only asks whether stock is above zero, so 1/0 loses
    // nothing the storefront uses.
    stock: Number(p.stock) > 0 ? 1 : 0,
    featured: Boolean(p.featured),
    ar: { name: p.name_ar, sub: p.sub_ar, chip: p.chip_ar },
    en: { name: p.name_en, sub: p.sub_en, chip: p.chip_en },
    ...(p.match_rank ? { match_rank: p.match_rank } : {}),
  };
}
