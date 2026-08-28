# Hair-style research — the six tiles behind /hair-styles

The source of truth for every editorial claim on the style finder, the way
`docs/hair-type-research.md` is for the type finder. Nothing on `/hair-styles`
says anything that is not traceable to a line in here or to
`docs/product-facts.md`.

This is the 2026 rebuild of the set. The dominant direction across the barber
press this year is natural texture with a matte or low-shine finish, and the
single most-requested men's cut worldwide and in Egypt is the textured crop over
a low taper fade. Two of the old tiles were on the wrong side of that shift: the
crunchy wet gel spike is exactly the dated look every source now names, and the
tall greased pompadour reads retro. The spike is removed and replaced by the
centre part (curtains) that took its place; the generic fade is retitled to the
low taper that is the fade of the year; the pompadour is softened into the
modern quiff. Slick back, defined curls and the honesty crop tile stay.

- 2026 finish direction is matte/natural, not glossy:
  https://blumaan.com/blogs/learn/best-mens-hairstyles-2026
  https://salon-221.com/blog/best-mens-trending-haircuts-2026/
  https://culturedgrooming.com/middle-eastern-men-hairstyle-guide/

This is the central tension of the whole project: **nothing in the range is
matte**, so the 2026 trend is on the wrong side of the entire catalogue. That
does not weaken the site's existing "no matte" honesty — it makes it the most
important thing the finder says.

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

**The vocabulary of the new six.** سلك باك، تدريج خفيف (ديجراديه)، كيرلي،
كيرتن (شعر مقسوم من النص)، كويف، فرنش كروب are all confirmed current in
Egyptian and Gulf retail and editorial copy for 2026, and all sit in the same
transliteration register the site already uses (ويت لوك، جولدن، كلاسيك، كيرلي —
`db/seed.sql` and `lib/hairtypes.js:62`).

- Egyptian 2026 style lists carrying كويف، فرنش كروب، تدريج and the return of
  الموليت بشكل أهدأ: https://lahamag.com/article/239443 and
  https://lahamag.com/article/235625
- Egyptian press on the new low taper displacing the older fade
  (غير التدريجة الشهيرة): https://www.youm7.com/story/2026/6/9/7442087
- Terminology register for كيرتن / شعر مقسوم and فرنش كروب:
  https://www.tajuki.com/... (article 812608)

**بومبادور and سبايكي are the retired words.** The tall pompadour reads as the
dated half of the height look, and the crunchy gel spike is precisely the
version the barber press calls out as no longer in fashion. The tiles that
replace them use كويف and كيرتن.

- Spiky as sold here is dated:
  https://woodwardbarbers.com/spiky-hairstyles-for-men/ ;
  https://apexhaircuts.com/spiky-haircut/ ;
  https://barbermane.com/spiky-hairstyles-for-men/
- Modern quiff current, tall pompadour retro:
  https://salon-221.com/blog/best-mens-trending-haircuts-2026/ ;
  https://lahamag.com/article/239443

**One curls name we deliberately did not use.** Egyptian press calls the
messy-curly look قصة الكابوريا (Youm7, quoting stylist Mustafa al-Shafi'i), but
the word originally refers to Ahmed Zaki's 1990 film haircut, which the director
has said was a Tyson-style cut with shaved sides, not curls. The term is
contested, so half the audience would picture the wrong head. The curls tile is
named كيرلي مظبوط.

- https://www.elwatannews.com/news/details/6766426
- https://aawsat.com/home/article/3804376/

**Why a fade tile exists, and why it is now the low taper.** Egyptian barbering
is fade-and-blade-led — straight razor line work, shaved-in parts, a cut that
needs re-cutting every two to three weeks. "The barber did the sides, the top is
yours" is a real customer situation. The specific fade of 2026 is the low taper,
which overtook the high skin fade as the most-requested version, and it is the
one the textured crop is built on.

- https://culturedgrooming.com/middle-eastern-men-hairstyle-guide/
- https://menshairstyleempire.com/hairstyles/textured-crop/
- https://lowtaperfades.com/low-taper-fade-with-trending-textured-crop/

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
| S7-GEL-GRN | Premium Gel Green | 5 | Medium | sets hard | — (no style tile now the spike is gone) |
| S7-GEL-YEL | Premium Gel Golden | 5 | Medium | sets hard | (the straight hair-type tile) |
| S7-WAX-RED | Pro X | 4 | High | **Medium** | quiff · curtains fallback for heavy hair (prose only) |
| S7-WAX-YEL | Pro | 4 | High | High | low taper fade |
| S7-WAX-BLU | Argan | 3 | High | High | defined curls |
| S7-WAX-PUR | Shea Butter | 3 | **Medium** | High | curtains (partly) · textured crop, under protest |
| S7-WAX-BLK | Black | 3 | High | High | grey coverage — no style tile |
| S7-HS500-ULTRAS / -STRONG | Hair Spray 500ml | 5 | — | — | finisher named on slick back + quiff — **prose only, seeded inactive** |

Sources: `docs/product-facts.md:107` (Pro X, the only Medium flexibility in the
range), `:119` (Pro), `:130` (Shea, the only Medium shine among the waxes),
`:142` (Black), `:160` (Argan), `:178-182` (the three gels, of which only Blue
is rated Strong Shine).

**Everything in that table shines.** That single fact decides which styles the
range can sell and which it has to hand back.

**The hair spray is the one product used across the range that is not a rankable
pick.** The task was to map the whole range, not gels alone, and the hold-5 hair
spray is placed as the all-day finisher on the two styles that want one: the
slick back and the quiff. But both 500ml sprays are seeded `active=FALSE,
price=0, stock=0` (`db/seed.sql:1572-1581`), so the spray is named in the copy as
a technique and never linked as a product. `rankForStyle` can never surface it
either way: the slick-back tile asks for `gel` and the quiff for `wax`, and the
spray is `kind='spray'`, so the format filter drops it before scoring. It exists
as a sentence and nothing else until the client prices and activates it.

---

## 3. The six tiles

### 1 · سلك باك — Slick back → Premium Gel Blue (finisher: Hair Spray)
Hold 5, and the only gel Ovanza rate Strong Shine. Wax cannot do it: it shines,
but it holds at 4 and never sets, so the front is back on the forehead by 2pm.
The high-shine slicked-back look is a live 2026 trend and the dominant Gulf look,
and it is the one style where ignoring the matte default is correct — the wet
slick is deliberately polished.

- https://www.reuzel.com/blogs/news/the-slick-is-back
- https://menshairstyleempire.com/hairstyles/slick-back/
- Gulf polished slick-back: https://culturedgrooming.com/middle-eastern-men-hairstyle-guide/

**Served fully.** The Blue gel is the right answer on both axes. The hair spray
is named as heat/wedding/long-day insurance over the top once dry — framed so it
does not undercut the gel's own 48h hold, and never linked while it is unpriced.

### 2 · تدريج خفيف — Low taper fade, top styled → Premium Wax Pro
Hold 4, high flexibility. Retitled from the generic fade to the low taper, which
is the specific 2026 fade and the cut most Egyptian men actually walk out of the
barber with. Ovanza call Pro suitable for all hair types, and this is the tile
where that claim earns its keep: everyone gets a fade, on every texture.

- https://menshairstyleempire.com/hairstyles/textured-crop/
- https://lowtaperfades.com/low-taper-fade-with-trending-textured-crop/
- https://culturedgrooming.com/middle-eastern-men-hairstyle-guide/

**Served fully, with one honest caveat.** Pro is correct on hold and flex, but it
finishes shinier than 2026's matte-natural ideal, so the copy tells the customer
to go light — the less wax, the more natural it reads.

### 3 · كيرلي مظبوط — Defined curls → Premium Wax Argan
Hold 3 on purpose: a curl has to keep moving and anything stronger locks it
shut. Same jar as the curly hair-type tile, which is correct — different
question, same answer. The look has a strong Egyptian cultural anchor in Mohamed
Salah's curls, repeatedly framed as موضة السنة / على طريقة محمد صلاح.

- https://www.youm7.com/story/2022/3/3/5676350
- https://elbalad.news/4054352 (لو شعرك زي محمد صلاح)

**Gap, and a mechanical constraint.** The wax base is anhydrous and sealing: it
holds moisture in and adds none (`docs/product-facts.md:261`). So the tile must
instruct application on wet hair, or there is nothing for it to seal. There is
no curl cream and no leave-in in the range (the S7-CG250 cream gels would be the
lighter alternate but are seeded inactive at price 0).

### 4 · كيرتن — Curtains (centre part) → Premium Wax Shea. **NEW — replaces the spike.**
Medium-length hair split from a centre part, each side sweeping onto the face —
the Gen-Z / soft-mullet look that displaced the spike. It wants movement, not
strong hold, and the part has to stay open all day without gluing flat. Shea is
the least shiny wax in the range and the only one Ovanza rate Medium shine, hold
3 and flexible, which suits the natural finish; Pro X is offered in prose as a
firmer grip for heavy hair that will not stay parted.

- https://aeno.com/blog/mens-hairstyles-trend-in-2026/
- https://didahairstudio.com/blog/mens-hairstyles-2026-trending-styles-queens-nyc
- https://milanocenterestilismo.com/en/blog/mens-haircuts-2026-trends/
- Egyptian soft-mullet return: https://lahamag.com/article/235625

**Gap.** The product a centre part is really built for is a light cream or a
sea-salt spray. The range makes neither — the S7-CG250 cream gel would be the
right lighter product but is unpriced, and there is no sea-salt spray at all.
Shea is the closest active compromise, and the tile says so. The lead is pinned
with `shine:2` and `lead:'S7-WAX-PUR'` so it wins on finish; Argan and Black are
also hold-3 waxes and would otherwise outrank it.

### 5 · كويف — Quiff → Premium Wax Pro X (finisher: Hair Spray). **Renamed from بومبادور.**
Hold 4, and the only Medium-flexibility product Ovanza make, which here is the
whole argument: it is the one product that keeps a set shape rather than relaxing
out of it. The modern quiff is softer and more natural than the old tall
pompadour — the height comes from the dryer, the product only holds it.

- https://lahamag.com/article/239443 (قصة الكويف current)
- https://salon-221.com/blog/best-mens-trending-haircuts-2026/ (modern quiff vs retro pompadour)

**Served fully for the shape; gap on the build.** There is no mousse and no
pre-styling primer, and that is the product that builds the height — the look
leans on the dryer more than on the jar. The hold-5 hair spray that would lock
the height for the day is named as the finisher but is seeded inactive at price
0, so no customer copy links it yet.

### 6 · فرنش كروب — Textured crop → nothing. **The gap tile.**
The textured crop over a low taper is currently the single most-requested men's
cut, worldwide and in Egypt — one source puts nearly half of 2026 men's
appointments on it. It is built with a matte paste or clay on damp-to-dry hair.

- https://blumaan.com/blogs/learn/best-mens-hairstyles-2026
- https://menshairstyleempire.com/hairstyles/textured-crop/
- Egyptian: https://www.youm7.com/story/2026/6/9/7442087 and https://lahamag.com/article/239443

**Nothing in this range is matte.** Every wax is Microcrystalline wax + Beeswax
+ Petrolatum + Paraffinum Liquidum, with no silica, no starch and no clay — no
ingredient present anywhere that could produce a matte finish
(`docs/product-facts.md:97-98` and `:203`). The closest is the Shea wax at
Medium shine, and the tile says so in those words rather than selling it as the
answer. Because this is now the #1 requested cut, the honest "we don't make it"
is the tile's strongest voice and the clearest commercial case for a clay.

---

## 4. What the range serves, and what it does not

- **Served properly (4):** slick back (Gel Blue, hold 5, right on both axes),
  low taper fade (Pro, hold 4/high flex; finishes shinier than the matte ideal,
  so "go light"), defined curls (Argan, hold 3), quiff (Pro X, hold 4/medium
  flex, plus the spray finisher). In all four the mapped product is the right
  answer, not a compromise.
- **Served partly (1):** curtains — the closest active product (Shea) is
  genuinely light and lowest-shine, but the right product is a light cream /
  cream gel (unpriced) or a sea-salt spray (not made). The tile marks itself
  `partly` and carries the gap note.
- **Not served (1):** textured crop. Needs matte, there is no matting agent,
  full stop.

**The matte gap now touches three surfaces:** the textured crop (not served),
the curtains centre part (the natural finish it wants), and the fine-hair type
tile on `/hair-types` (`lib/hairtypes.js:107`, `:114`). That is the strongest
commercial argument this project has assembled for Ovanza to make a clay or
matte paste — the one SKU that would move the most demand.

**Second and third gaps:** no curl cream or leave-in for defined curls, no
mousse or pre-styler for the quiff, and the hold-5 hair spray that would finish
both the quiff and the slick back is seeded inactive at price 0. Pricing the two
500ml sprays and any of the six cream gels would let two tiles gain a live
finisher and two tiles gain a lighter alternate at zero product-development cost.

---

## 5. Open questions for the client

**Open: price and activate the spray and cream gels.** `S7-HS500-ULTRAS`,
`S7-HS500-STRONG` (hold 5) and the six `S7-CG250-*` cream gels (hold 3) are all
seeded `active=FALSE, price=0, stock=0` (`db/seed.sql:1542-1581`). Until the
client sets price + stock + Active in admin, the slick-back and quiff copy name
the spray as a technique but link no product, and the cream gel stays out of the
defined-curls and curtains copy entirely. Pointing a cash-on-delivery customer
at a price-0 product is the exact failure mode the seed comments warn about, and
a shop category with no live product already 404s.

**Open: terminology.** تدريج خفيف vs ديجراديه for the fade tile, and كيرتن vs
شعر مقسوم من النص for the centre part — both are current in 2026 Egyptian press.
The tiles use تدريج خفيف and كيرتن because they match the short transliteration
register already on the site (سلك باك، كويف، فرنش كروب). Swap either if the
client's audience skews the other way.

**Open: the Golden gel subtitle.** Golden ships as "ويت لوك / Wet look"
(`db/seed.sql:59-60`) while Ovanza rate Yellow at Medium Shine and Blue at
Strong Shine (`docs/product-facts.md:180-181`). The gel the site sells as the
wet-look one is not the shiniest gel it sells, and the slick-back tile
recommends Blue. This is the same class of error as the Black-is-not-matte fix
and wants the same treatment: a guarded UPDATE swapping the Golden and Blue
subtitles. It is left alone here because it changes live product copy the client
owns, and because `tests/sql-split.test.mjs` pins the statement and correction
counts of `db/seed.sql` by hand.

With the crunchy gel spike retired, the Green gel now fronts no style tile and
the Blue is the only gel that leads one. Golden still leads the straight
hair-type tile by elimination.

**Open: demand logging.** `POST /api/quiz` accepts and logs an unused `concern`
field, and `quiz_results.hair_type` is unconstrained TEXT. Sending the style
slug through it would tell the client which looks their audience actually wants,
which is the demand signal that decides whether the clay is worth making. Not
wired up in v1: `bySlug` in the quiz route rejects anything outside
`HAIR_TYPES`, so it needs its own branch, and the home-page strip is a set of
plain links with no click handler to hang it on.
