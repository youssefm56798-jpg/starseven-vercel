/**
 * Hair-type definitions — the six customer-facing tiles.
 *
 * Four are curl families from the Andre Walker system (1–4); two are density
 * states, because density — not curl pattern — decides how much product weight
 * hair can carry, and a customer can self-identify "my hair is thin" far more
 * reliably than "I'm a 2B".
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
      "answer": "تركيبة مطفية (مات) هي الاختيار المثبت للشعر الخفيف: بتدي تكستشر وحجم، ومن غير لمعة يعني من غير منظر \"مبلول وملزوق\".",
      "avoid": "ابعد خالص عن البوميد التقيل وزبدة الشيا — بيوقّعوا الشعر الخفيف."
    },
    "en": {
      "name": "Fine & thin",
      "short": "Needs volume, heavy kills it",
      "problem": "Fine hair needs volume — and anything heavy or shiny glues it to the scalp and makes it look like there is even less of it.",
      "answer": "A matte finish is the documented pick for fine hair needing volume: texture and lift, with no shine to give away the \"wet and flat\" look.",
      "avoid": "Stay away from heavy pomades and shea butter — both weigh fine hair down."
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
      "answer": "تثبيت درجة ٥ لليومي. الشعر الكثيف هو النوع الوحيد اللي يقدر يشيل منتج تقيل من غير ما يقع.",
      "avoid": "التركيبات الخفيفة مش هتكفي — مش هتصمد لآخر اليوم."
    },
    "en": {
      "name": "Thick & coarse",
      "short": "Heavy hair, drops fast",
      "problem": "Thick hair collapses under its own weight. It needs the strongest hold you have, and light formulas simply do not survive the day.",
      "answer": "Level-5 daily hold. Thick hair is the one density that can carry a heavy product without going limp.",
      "avoid": "Light formulas will not last — expect the style to drop by midday."
    },
    "walkerEn": "High density"
  }
];

export const bySlug = slug => HAIR_TYPES.find(t => t.slug === slug) || null;

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
    stock: Number(p.stock),
    ar: { name: p.name_ar, sub: p.sub_ar, chip: p.chip_ar },
    en: { name: p.name_en, sub: p.sub_en, chip: p.chip_en },
    ...(p.match_rank ? { match_rank: p.match_rank } : {}),
  };
}
