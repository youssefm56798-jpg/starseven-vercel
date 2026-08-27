# Hair-style research — the six tiles behind /hair-styles

The source of truth for every editorial claim on the style finder, the way
`docs/hair-type-research.md` is for the type finder. Nothing on `/hair-styles`
says anything that is not traceable to a line in here or to
`docs/product-facts.md`.

---

## 1. Why a style finder at all, and why in this market

The type finder asks what your hair *is*. This one asks what you want it to
*look like*, and that is the question Egyptian men are already shopping with.

**Eva Cosmetics — the largest domestic personal-care manufacturer in Egypt —
sells its Man Look gel line segmented by look rather than by hair type.** "Wet
Look", "Spiky Look" and "Curly Look" are three separate SKUs on the shelf, not
three claims on one label.

- https://shop.eva-cosmetics.com/en/product/man-look-hair-gel-spiky-look-250-gm-pouch-890
- https://eva-cosmetics.com/man-look/
- https://www.amazon.eg/-/en/Eva-Man-Look-Wet-Hair/dp/B083X1NM59

So a style-first finder is the native mental model here. It is not an import of
a European or American merchandising idea.

**The vocabulary.** سلك باك، سبايكي، كيرلي، بومبادور، فرنش كروب، ديجراديه/تدريج
are all confirmed in Egyptian and Gulf retail and editorial copy, and all sit in
the same transliteration register the site already uses (ويت لوك، جولدن،
كلاسيك، كيرلي — `db/seed.sql` and `lib/hairtypes.js:62`).

- Arabic styling guide naming بومبادور، فرنش كروب، سبايكي verbatim:
  https://aslalhaiba.com/ستايلات-شعر-رجالي/

**One name we deliberately did not use.** Egyptian press calls the messy-curly
look قصة الكابوريا (Youm7, quoting stylist Mustafa al-Shafi'i), and curly hair
has an unusually strong cultural anchor here because of Mohamed Salah. But the
word originally refers to Ahmed Zaki's 1990 film haircut, which the director has
said was a Tyson-style cut with shaved sides, not curls. The term is contested,
so half the audience would picture the wrong head. The curls tile is named
كيرلي مظبوط.

- https://www.elwatannews.com/news/details/6766426
- https://aawsat.com/home/article/3804376/

**Why a fade tile exists.** Egyptian barbering is fade-and-blade-led — straight
razor line work, shaved-in parts, a cut that needs re-cutting every two to three
weeks. "The barber did the sides, the top is yours" is a real customer
situation, not an invented tile.

- https://culturedgrooming.com/middle-eastern-men-hairstyle-guide/

---

## 2. The range as one grid

Two axes, both already on the site. Hold is the range-wide 1-5 scale
`db/seed.sql:1894-1900` put the right way up against the manufacturer's own
tiers. Shine and flexibility are the manufacturer's published per-SKU specs,
recorded in `docs/product-facts.md` and mirrored into `lib/hairstyles.js` as
`FINISH`.

| SKU | Product | Hold | Shine (maker) | Flex | Style it serves |
|---|---|---|---|---|---|
| S7-GEL-BLU | Premium Gel Blue | 5 | **Strong** | sets hard | slick back |
| S7-GEL-GRN | Premium Gel Green | 5 | Medium | sets hard | spiky |
| S7-GEL-YEL | Premium Gel Golden | 5 | Medium | sets hard | (the straight hair-type tile) |
| S7-WAX-RED | Pro X | 4 | High | **Medium** | quiff |
| S7-WAX-YEL | Pro | 4 | High | High | fade top |
| S7-WAX-BLU | Argan | 3 | High | High | defined curls |
| S7-WAX-PUR | Shea Butter | 3 | **Medium** | High | textured crop, under protest |
| S7-WAX-BLK | Black | 3 | High | High | grey coverage — no style tile |

Sources: `docs/product-facts.md:107` (Pro X, the only Medium flexibility in the
range), `:119` (Pro), `:130` (Shea, the only Medium shine among the waxes),
`:142` (Black), `:160` (Argan), `:178-182` (the three gels, of which only Blue
is rated Strong Shine).

**Everything in that table shines.** That single fact decides which styles the
range can sell and which it has to hand back.

---

## 3. The six tiles

### 1 · سلك باك — Slick back → Premium Gel Blue
Hold 5, and the only gel Ovanza rate Strong Shine. Wax cannot do it: it shines,
but it holds at 4 and never sets, so the front is back on the forehead by 2pm.
The high-shine slicked-back look is a live 2026 trend, not a period reference.

- https://www.reuzel.com/blogs/news/the-slick-is-back-how-high-shine-slicked-back-hair-took-over-mens-style-again
- https://menshairstyleempire.com/hairstyles/slick-back/

### 2 · سبايكي — Spiky → Premium Gel Green
Hold 5, Medium shine, clean scent. Egypt has a whole shelf named after this look
and it is a gel shelf. Green rather than Golden because the scent is what earns
its place on a product worn every morning, and because a step less gloss suits a
spike.

**Partial gap.** There are two spikes in circulation and the range makes one.
The dry matte spike is a clay or matte-paste product. The glossy gel spike is a
real look with its own following, and it is the one that is reachable here.

### 3 · كيرلي مظبوط — Defined curls → Premium Wax Argan
Hold 3 on purpose: a curl has to keep moving and anything stronger locks it
shut. Same jar as the curly hair-type tile, which is correct — different
question, same answer.

**Gap, and a mechanical constraint.** The wax base is anhydrous and sealing: it
holds moisture in and adds none (`docs/product-facts.md:261`). So the tile must
instruct application on wet hair, or there is nothing for it to seal. There is
no curl cream and no leave-in in the range.

### 4 · ديجراديه — Fade, top styled → Premium Wax Pro
Hold 4, high flexibility. The volume tile, and the cut most Egyptian men are
actually walking around in. Ovanza call Pro suitable for all hair types, and
this is the tile where that claim earns its keep: everyone gets a fade, on every
texture.

### 5 · بومبادور — Quiff → Premium Wax Pro X
Hold 4, and the only Medium-flexibility product Ovanza make, which here is the
whole argument: it is the one product that keeps a set shape rather than
relaxing out of it.

**Gap.** There is no mousse and no pre-styling primer, and that is the product
that builds the height. The look leans on the customer's dryer more than on
anything in the jar. The hold-5 hair spray that would finish it exists in the
catalogue but is seeded inactive at price 0 (`db/seed.sql:1572-1581`), so no
customer copy may point at it yet.

### 6 · فرنش كروب — Textured crop → nothing. **The gap tile.**
The textured crop is currently the most-requested men's cut in barbershops, and
it is built with a matte paste or clay on damp-to-dry hair. For Middle Eastern
hair specifically, the textured crop with a taper fade wants "a small amount of
matte paste".

- https://blumaan.com/blogs/learn/textured-crop-haircut-men
- https://menshairstyleempire.com/hairstyles/mens-haircuts/
- https://culturedgrooming.com/middle-eastern-men-hairstyle-guide/

**Nothing in this range is matte.** Every wax is Microcrystalline wax + Beeswax
+ Petrolatum + Paraffinum Liquidum, with no silica, no starch and no clay — no
ingredient present anywhere that could produce a matte finish
(`docs/product-facts.md:97-98` and `:203`). The closest is the Shea wax at
Medium shine, and the tile says so in those words rather than selling it as the
answer.

---

## 4. What the range serves, and what it does not

- **Served properly (4):** slick back, defined curls, fade top, quiff. In all
  four the mapped product is the right answer on both axes, not a compromise.
- **Served partly (1):** spiky — the glossy gel spike is genuinely good, the
  matte textured spike is out of reach.
- **Not served (1):** textured crop. Needs matte, there is no matting agent,
  full stop.

**One gap runs through all of it: no clay, no matte paste.** It is the same
missing SKU the hair-type finder already blames for the fine-hair tile
(`lib/hairtypes.js:107` and `:114`). Two of six style tiles now point at it as
well. That is four of twelve tiles across both finders wanting one product that
does not exist, and it is the strongest commercial argument for a clay this
project has assembled.

**Second gap:** no mousse or pre-styler for the quiff, and the hold-5 hair spray
that would finish both the quiff and the slick back is seeded inactive at price
0. Pricing the two 500ml sprays would complete two of the six tiles at zero
product-development cost.

---

## 5. Open questions for the client

**Open: the Golden gel subtitle.** Golden ships as "ويت لوك / Wet look"
(`db/seed.sql:59-60`) while Ovanza rate Yellow at Medium Shine and Blue at
Strong Shine (`docs/product-facts.md:180-181`). The gel the site sells as the
wet-look one is not the shiniest gel it sells, and the slick-back tile
recommends Blue. This is the same class of error as the Black-is-not-matte fix
and wants the same treatment: a guarded UPDATE swapping the Golden and Blue
subtitles. It is left alone here because it changes live product copy the client
owns, and because `tests/sql-split.test.mjs` pins the statement and correction
counts of `db/seed.sql` by hand.

Applying the maker's shine ratings also closes the question
`docs/hair-type-research.md` left open under "which gel leads the Straight
tile": Blue leads the slick back, Green leads spiky, and Golden leads the
straight hair-type tile by elimination rather than by sort accident. Each gel
leads exactly one tile.

**Open: ديجراديه vs تدريج.** Both are current in Egypt. Which one the tile
carries is the client's call about their own audience. The tile currently says
ديجراديه.

**Open: demand logging.** `POST /api/quiz` accepts and logs an unused `concern`
field, and `quiz_results.hair_type` is unconstrained TEXT. Sending the style
slug through it would tell the client which looks their audience actually wants,
which is the demand signal that decides whether the clay is worth making. Not
wired up in v1: `bySlug` in the quiz route rejects anything outside
`HAIR_TYPES`, so it needs its own branch, and the home-page strip is a set of
plain links with no click handler to hang it on.
