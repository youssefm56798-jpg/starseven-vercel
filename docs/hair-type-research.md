# Hair-type → product mapping — research basis

Source of truth for the hair-type finder on the site, the `products.hair_types`
column in the database, and the personalisation section of the ecommerce plan.

Compiled 2026-08-24.

---

## 1. Which typing system to use, and its limits

The public-facing standard is the **Andre Walker system** (created 1990s for
Walker's own product line): four curl families, each split A/B/C from loosest to
tightest.

| Type | Family | Subtypes | Behaviour |
|---|---|---|---|
| 1 | Straight | 1A hard to hold a curl, oily, hard to damage · 1B has body · 1C bone-straight, hard to curl | Sebum travels down the shaft easily → looks greasy fastest, drops style fastest |
| 2 | Wavy | 2A loose S, styles easily · 2B defined S, resists styling · 2C wide waves, resists styling, frizz-prone | The "in-between" — needs hold that keeps the wave, not hold that flattens it |
| 3 | Curly | 3A big loose curls with body · 3B medium spacing, combination texture · 3C tight corkscrews | Dryness-prone; wants definition + moisture |
| 4 | Coily | 4A/4B (Z-bends with sharp angles); 4C is a later community addition, **not** in Walker's original chart | Driest, highest shrinkage, most fragile — needs sealing moisture, hates drying formulas |

**Documented limitations we must design around:**

- It only measures **curl pattern**. It ignores **porosity, density and strand
  diameter** — the attributes that actually decide which product weight works.
- It is internally inconsistent: some subtypes describe strand *thickness*,
  others describe curl *tightness*.
- Research by Dr Tina Lasisi finds the scale over-resolves the narrow variation
  in European hair and under-resolves the wide variation in African and
  African-descended hair — types 3–4 are compressed, and the chart carries an
  implicit hierarchy where type 3 reads as "the desirable one".
- The stronger practical predictor is **shrinkage** (wet vs dry length) — hair
  with big shrinkage behaves fundamentally differently from hair without.
- Counter-intuitive but well documented: **curlier hair skews *low* porosity**
  (cuticle layers are smaller and more tightly packed), so it needs light,
  penetrating oils rather than heavy sealing butters piled on.

### Decision for Star Seven

Ship **six chooser tiles**, not twelve. Four are curl families (straight, wavy,
curly, coily) and two are density states (fine/thin, thick/coarse) — because
density is what decides product *weight*, and a customer can self-identify
"my hair is thin" far more reliably than "I'm a 2B". Never show a 1A–4C grid to
a customer; use it internally only.

---

## 2. What each product format actually does

| Format | Hold | Shine | Strong for | Avoid on |
|---|---|---|---|---|
| **Gel** | Very high | Wet / high | Structured styles, sharp side parts, spikes, slick-backs, **curl definition** | Anyone wanting a natural look; dries hard, no restyling once set |
| **Wax** | Medium–high | Low / natural | Short-to-medium hair, textured "woke up like this" styles, defining coarse hair | Long hair (sags under its own weight); doesn't harden so restyling is limited |
| **Clay** | High | Matte / ultra-matte | **Fine or thin hair needing volume**, textured crops, French crops, quiffs | **Very curly or coily hair — too drying**; sets firmly, poor restyling |
| **Cream** | Light | Low | The most forgiving format, works across all types; natural styles, loose waves; good for hair that runs dry | Anyone needing real structure |
| **Pomade** | Medium–high | High (or matte if water-based) | Medium-to-thick hair; slick-backs, side parts, pompadours, quiffs | **Thin/fine hair — too heavy**; oil-based versions build up and resist washing out |

---

## 3. Ingredient logic (this is what separates the SKUs)

**Argan oil** — lightweight, non-greasy, penetrates the shaft, rich in vitamin E
and fatty acids. Adds shine and softens coarse curls **without weighing hair
down**. The right choice for fine, straight or oil-prone hair, and for
**low-porosity** hair that rejects heavy products.

**Shea butter** — a heavy butter. Sits on the surface and **seals** moisture
rather than penetrating. Excellent on thick, coarse, curly and coily hair, and
on damaged/brittle hair. **Too heavy for fine hair.** Low-porosity hair should
use it sparingly or it builds up.

Rule of thumb: **argan = penetrate + lighten; shea = seal + soften.** Weight of
the ingredient must match density of the hair.

---

## 4. The mapping we ship

Six tiles → SKU. `hair_types` CSV in the `products` table encodes this, so the
finder is data-driven and the client can re-tune it from the admin panel without
touching code.

| Tile | Internal (Walker) | The real problem | Primary SKU | Why |
|---|---|---|---|---|
| **ناعم مفرود** / Straight | 1A–1C | Style drops; scalp oils fastest; won't hold a shape | **Premium Gel — Blue / Green** (`S7-GEL-BLU`, `S7-GEL-GRN`) | Gel is the only format with hold high enough to hold a shape on hair that resists holding one. Wet-look finish suits a side part. Zero added weight. |
| **متموج** / Wavy | 2A–2C | Resists styling; frizz; wants the wave *kept*, not flattened | **Premium Wax Pro X** (`S7-WAX-RED`) | Medium-high hold with low/natural shine — defines the S-pattern instead of gluing it flat. The Wave & Groom formula is literally built for this tile; it is also the hero SKU, so the highest-traffic tile points at it. |
| **كيرلي** / Curly | 3A–3C | Dryness + needing definition at the same time | **Premium Wax Argan** (`S7-WAX-BLU`) | Argan softens coarse curls and adds shine without weight, and curly hair skews low-porosity so light beats heavy. Explicitly **not** a clay — clay is too drying here. |
| **خشن / أفرو** / Coily | 4A–4C | Driest and most fragile; needs moisture sealed in | **Premium Wax Shea Butter** (`S7-WAX-PUR`) | Shea seals moisture on coarse, coily strands and is the standard recommendation for thick/coarse/curly. Soft touch, no drying agents. |
| **خفيف** / Fine & thin | any pattern, low density | Needs volume; anything heavy kills it | **Premium Wax Black — Matte** (`S7-WAX-BLK`) | Matte finish is the documented pick for fine hair needing volume — no shine means no "wet and flat" read. Avoids the pomade/heavy-butter trap that weighs fine hair down. |
| **كثيف** / Thick & coarse | any pattern, high density | Needs the most hold; heavy hair drops fast | **Premium Wax Pro** (`S7-WAX-YEL`) + Pro X | Level-5 daily hold. Thick hair is the one density that can carry a heavy product without going limp. |

Secondary matches are also stored in the CSV so each tile can show a first and
second choice (e.g. coily → Shea first, Argan second).

### Gaps this exposes in the current range

1. **No clay / matte paste.** Fine-hair volume is the single clearest documented
   gap, and it is the tile with the weakest current answer — Black Matte wax is a
   workaround, not a purpose-built product. A clay is the highest-confidence next
   SKU.
2. **No cream.** The "Cream Gel" tile already exists in the site's hold picker
   with no product behind it. Cream is the most forgiving format and the natural
   entry product for curly/coily customers who find wax too much.
3. **No leave-in / pre-styler** for coily hair, which is where repeat-purchase
   margin usually sits in this category.

---

## Sources

- [Andre Walker Hair Typing System — Wikipedia](https://en.wikipedia.org/wiki/Andre_Walker_Hair_Typing_System)
- [The Science of Curly Hair Typing — CurlsBot](https://www.curlsbot.com/blog/the-science-of-hair-typing)
- [Hair Type Chart: 3B, 3C, 4A, 4B, 4C — Curl Centric](https://www.curlcentric.com/hair-typing-system/)
- [Men's Hair Products Explained: Pomade vs Wax vs Clay vs Gel — ReadySleek](https://www.readysleek.com/mens-hair-products-explained/)
- [Men's Hair Products: Gel, Cream, Wax, Paste, Clay or Pomade? — The Plunge](https://theplunge.com/fitness/mens-hair-products-gel-cream-wax-paste-clay-or-pomade)
- [Hair Clay vs Pomade vs Paste vs Wax vs Cream — Barber's Take](https://www.barberstake.com/blog/hair-clay-vs-pomade-vs-paste-vs-wax-vs-cream-whats-the-difference/)
- [Shea Butter vs Argan Oil — hairs-how.com](https://hairs-how.com/which-is-better-for-hair-shea-butter-or-argan-oil.html)
- [Best Hair Butters & Oils for Your Porosity — Beautycon](https://www.beautycon.com/article/what-you-need-to-know-about-hair-butter-and-oils)
