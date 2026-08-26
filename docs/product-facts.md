# New Star Seven — verified product facts

**Compiled 26 Aug 2026.** Every line below is either read off a product label, read
from the manufacturer's own catalogue, or read from a retail listing — and each is
marked with which. Nothing here is inferred from "what hair wax usually contains".

Where a fact is missing it says **NOT FOUND**. That is a real answer, not a gap to
fill in later with a guess. Ingredient data on a cosmetic is a safety and a legal
matter, and the site must not state anything the packaging does not.

---

## Sources, and how much each is worth

| Source | What it is | Trust |
|---|---|---|
| `admin.ovanzacosmetics.com/api/items` | The manufacturer's own product catalogue, public JSON behind ovanzacosmetics.com. 65 New Star Seven SKUs. | **First-party.** Highest. |
| Amazon.eg product photos | 1500px shots that include the printed side panel. The ingredient lists below were read directly off these. | **The label itself.** Highest. |
| Amazon.eg listing text | Sold by **Ovanza Cosmetics** themselves, fulfilled by Amazon — so this is brand copy, not a reseller's rewrite. | First-party. |
| Cairo One, Dawaa, Tegwana, Aziz | Egyptian resellers. Prices and barcodes only. | Corroboration. |
| Jumia | Placeholder price (EGP 500) and boilerplate description copy-pasted across the seller's whole catalogue. | **Ignore.** |

Two fields in the manufacturer's API are template defaults on every single row —
`weight: "كيلو"` and `country_origin: "الكويت"` (Kuwait). They are junk. Amazon
states **Country of origin: Egypt**, which matches everything else known about the
company.

---

## The company

Read from ovanzacosmetics.com and its API:

- Trading name, as the company writes it in English: **"Ofanza Cosmetics for the Manufacturing and Trading of Cosmetics"**
- Arabic legal name, from its own merchant storefront: **أوفانزا لتصنيع وتجارة مستحضرات التجميل**
- Founded **2012**, one product at launch; exporting since **2018**
- Location given as **Egypt — Cairo**. No street address, registration number or EDA notification number found anywhere.
- Phone **+20 150 843 7333**, email **info@ovanzacosmetics.com**
- Facebook: facebook.com/Ovanzacosmetics
- Two brands: **New Star Seven** and **Source Lino**

**The official domain is `ovanzacosmetics.com`** — it is printed on the jar itself,
readable in the product renders. `newstarseven.com` is unrelated to this company,
and `MAIL_FROM` currently sends from it. That needs changing before launch.

---

## The waxes — full ingredient lists

Read directly off the printed side panel in Amazon.eg's 1500px photos.

**All four share one base.** The line is a single anhydrous wax/petrolatum formula,
differentiated only by the hero botanical and the colourants:

> Microcrystalline wax — Bees wax — Petrolatum — Paraffinum Liquidum — Propyl
> Paraben — BHT — Tocopheryl acetate — Lanolin — Parfum — isopropyl myristate

### Pro X — red — 120ml — `S7-WAX-RED`
**Ingredients (verbatim):** Microcrystalline wax – Bees wax – Petrolatum – Paraffinum
Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – parfum – isopropyl
myristate – +/– CI 15850 – +/– CI 61565 – +/– CI 47005 – +/– CI 73015 – +/– CI 77266

No botanical. Base plus colourants only.

- Manufacturer's spec: **Strong hold – Medium flexibility – High shine**
- "Easy to use for normal and **wavy** hair" ← the site's wavy mapping is the manufacturer's own
- Directions (the only SKU with a printed set): *"Apply to damp hair, style with a hair dryer, and remove with NewStarSeven shampoo."*
- Amazon EGP 100 · Cairo One EGP 56 · ASIN B0FKB9GFJ6 · 3.9★ (3 ratings)

### Pro — yellow — 120ml — `S7-WAX-YEL`
**Ingredients (verbatim):** Microcrystalline wax – Bees wax – Petrolatum – Paraffinum
Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – Parfume – isopropyl
myristate – +/– CI 15850 – +/– CI 61565 – +/– CI 47005 – +/– CI 73015 – +/– CI 77266

Identical to Pro X. No botanical.

- Manufacturer's spec: **Strong hold – High flexibility – High shine**
- "suitable for **all** hair types"
- Amazon EGP 80 · Cairo One EGP 56 · wholesale EGP 24 · ASIN B0FKB6JJLF · 3.8★ (3 ratings)
- Barcode **6224008563297** (Tegwana). A second source lists 6224008563563 — unresolved.

### Shea Butter — purple — 120ml — `S7-WAX-PUR`
**Ingredients (verbatim):** Microcrystalline wax – Bees wax – Petrolatum – Paraffinum
Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – Parfume –
**butyrospermum parkii** [butter] – isopropyl myristate – +/– CI 15850 – +/– CI 61565
– +/– CI 47005 – +/– CI 73015 – +/– CI 77266

- Manufacturer's spec: **Medium hold – High flexibility – Medium shine**
- "especially dry and brittle" hair
- Amazon EGP 100 · Cairo One EGP 56 · ASIN B0FKBFDKK9 · 3.3★ (4 ratings)

### Black Seed — black — 120ml — `S7-WAX-BLK`
**Ingredients (verbatim):** Microcrystalline wax – Bees wax – Petrolatum – Paraffinum
Liquidum – Propyl Paraben – BHT–Tocopheryl acetate – Lanolin – Parfum – isopropyl
myristate – **Nigella Sativa seed oil** – +/– CI 77266

Note the colourants: **CI 77266 only** (black). The other three carry a five-pigment
set. This is consistent with a product whose job is to deposit black.

- Manufacturer's spec: **Medium hold – High flexibility – High shine**
- Amazon EGP 80 · Cairo One EGP 62 · ASIN B0FKBGD6JP · **2.5★ (5 ratings)** — lowest in the line
- Amazon's "Active Ingredients" field reads *"Pond Seed Oil"* — a machine mistranslation of حبة البركة. **Never publish that.**

### Argan — blue — 120ml — `S7-WAX-BLU`
**Ingredients: NOT FOUND.** This SKU is not on Amazon.eg, so there is no photograph of
its panel. Confirmed to exist at 120ml on Ovanza's own storefront (Cairo One, EGP 56).

Do not assume it matches the others with argan swapped in — get the jar and read it.

- Manufacturer's copy claims argan oil and **vitamin E**, for hair loss and split ends
- Manufacturer's spec: **Medium hold – High flexibility – High shine**

---

## The gels

The manufacturer runs **two tiers**, and the site sells the upper one:

| Tier | Hold | Duration | Extra |
|---|---|---|---|
| Styling Hair Gel | Strong | 24 hours | — |
| **Premium Hair Gel** ← ours | **Ultra Strong** | **48 hours** | **Vitamin B5**, anti-hair-loss claim |

Manufacturer's per-colour spec for the Premium tier:

| Colour | Spec |
|---|---|
| White | Ultra Strong Hold – Strong Shine |
| Black | Ultra Strong Hold – Strong Shine + covers grey |
| Blue | Ultra Strong Hold – Strong Shine |
| Yellow | Ultra Strong Hold – Medium Shine |
| Green | Ultra Strong Hold – Medium Shine |

**Gel ingredients: NOT FOUND on the label.** One reseller (royalelchim.app) lists
"Glycerin, PVP, and Copolymer" for a New Star 7 gel — that is three words, not a
declared list, and it is not tied to the Premium 250ml tier. Do not publish it.

---

## What the site currently gets wrong

### 1. "Premium Wax Black" is not matte — this one has to change

The site sells it as **"من غير لمعة · مطفي" (No shine · Matte)**, hold **5/5**, matched
to **fine and straight** hair, and the hair-types page recommends it to fine hair as
"the closest thing to a clay that exists here."

Every source contradicts that:

- The manufacturer's own copy: **"Medium hold – High flexibility – High shine"**
- Its actual selling point is grey coverage — *"covers gray hair and white hair… gives it a shiny black color"* — which the site never mentions at all
- Recommended for **dry and grey** hair, not fine hair
- The ingredient list contains **no matting agent whatsoever** — no silica, no starch, no clay. There is nothing in it that could produce a matte finish.

A customer with fine hair currently buys this expecting matte volume and receives a
high-shine, black colour-depositing wax. It is also the lowest-rated SKU on Amazon at
2.5★, which is what that mismatch looks like from the other side.

This also knocks out the hair-types page's answer for **fine** hair, which was built
on that finish. Fine hair needs a different recommendation, or an honest "we don't
make one".

### 2. Hold levels are inverted

The site has waxes at **hold 5** and gels at **hold 3**. The manufacturer has gels at
**Ultra Strong / 48 hours** and waxes at **Strong or Medium**. The hair-types page
tells straight hair "gel is the only format with enough hold" — which is right, and
which the site's own numbers then contradict.

### 3. "Wave & Groom" is DAX's product name

It is printed on Ovanza's red tin and it is in the site copy. **DAX Wave & Groom** is
a long-established US product, also a red tin, also a hair wax. That is the
manufacturer's exposure rather than ours, but the site repeats it, and it is worth
raising with the client before spending on the name.

### 4. Pricing is half the brand's own retail

Site EGP 45 (wax) / 40 (gel). Ovanza sells the same jars on Amazon.eg at **EGP
80–100**. Either the site undercuts the brand's own storefront by 50%, or the price
list is stale.

### 5. Claims worth a second look against the actual formula

- **"No grease"** on a base of Petrolatum + Paraffinum Liquidum, with the only stated removal method being the brand's own shampoo.
- The hair-types page sends **curly and coily** hair here for *moisture*. This is a sealing, anhydrous, non-moisturising base — it holds moisture in, it does not add any.
- **Lanolin** (wool-derived) and **Propyl Paraben** are both in every jar. No vegan or paraben-free claim is made anywhere on the site, which is correct — keep it that way.

---

## The other 57 SKUs

The site sells 8. The manufacturer's catalogue lists **65 New Star Seven products**:

| Range | What is in it |
|---|---|
| Premium Wax 120ml | Pro, Pro X, Shea Butter, Argan, Black Seed, **Coconut** |
| Wax 135ml | Olive Oil, Coconut, Argan, Shea Butter |
| Wax 125ml | Black Seed |
| Gel Wax 140ml | Argan, Jojoba, Coconut, Rosemary, Shea Butter, Aloe Vera |
| Cream Gel 250ml | Olive, Argan, Black Seed, Coconut, Jojoba, Beeswax |
| Premium Hair Gel | White, Black, Blue, Yellow, Green |
| Styling Hair Gel | White, Black, Blue, Yellow — 650ml, 850ml, 20ml and 14ml sachets |
| Hair Spray 500ml | Strong, Ultra Strong |
| After-Shave Cologne 180ml | Aqua, Echo, Essence, Fresh, Magic, Sense |
| Depilatory | Wax 400g, roll-on 100ml, sugar/white paste 100g — several scents |
| Shampoo | Referenced throughout the label copy as the recommended remover; not yet in the catalogue feed |

This answers the open reseller-SKU question: **black seed, aloe vera, olive oil, 135ml
and 140ml are all genuine New Star Seven products** — different ranges, not
counterfeits and not a different company.

Worth knowing: the 125ml/135ml waxes are a **separate, cheaper line** from our 120ml
Premium line, and Amazon carries both. They are easy to confuse.

---

## Still missing

- **Ingredient list for the Argan (blue) wax** — the only one of our five with no photographed panel
- **Ingredient lists for all three gels**
- Manufacturer address, cosmetic registration / EDA notification number
- Scent descriptions for any SKU
- Directions for four of the five waxes (only Pro X has a printed set)
- Barcodes for red, purple, blue, black

The fastest way to close all of these: photograph the back panels of the eight jars
the client already has, or ask Ovanza for the spec sheets.

---

## What is now in the database (26 Aug 2026)

All 55 remaining New Star Seven products are seeded, in seven categories:

| Category | URL | Count |
|---|---|---|
| Wax | `/shop/wax` | 6 new (120ml Coconut, 135ml ×4, 125ml Black Seed) |
| Gel | `/shop/gel` | 2 new (Premium White, Premium Black) |
| Gel Wax | `/shop/gel-wax` | 6 (140ml) |
| Cream Gel | `/shop/cream-gel` | 6 (250ml) |
| Hair Spray | `/shop/hair-spray` | 2 (500ml) |
| After-Shave Cologne | `/shop/cologne` | 6 (180ml) |
| Hair Removal | `/shop/depilatory` | 13 |
| Styling Gel (250 / 650 / 850 / sachets) | `/shop/gel` | 14 |

**Every one is seeded `active = FALSE`, `price = 0`, `stock = 0.`** The
manufacturer's feed carries no prices, and a guessed price on a
cash-on-delivery shop becomes an argument at the customer's door. The client
sets price and stock in the admin and ticks Active; until then they are
invisible to the storefront, the sitemap and the structured data.

A category with no live product **404s** rather than serving an empty grid, and
the sitemap lists only categories that hold something. So today `/shop/cologne`
is a 404 — and becomes a real page the moment the first cologne is priced.

### Two things to watch

**The depilatory range cuts across the SEO.** Egyptian search for "واكس" is
dominated by hair *removal*, and the styling copy was deliberately qualified
with تصفيف / تثبيت to stay out of that SERP. Putting 13 removal products on the
same domain reopens exactly that ambiguity. The category page says out loud
that it is not styling wax, and a test holds that sentence in place — but if
the client would rather keep this a men's styling brand, this is the range to
drop.

**`/hair-types` claimed "we make no cream."** That was true of a range of five
waxes and three gels and false the moment a cream gel is priced. The claim, and
the formats table beside it, are now generated from the live catalogue instead
of typed, so they cannot rot.

### Image provenance

This matters if anyone asks where a picture came from.

- **49 of 55** are Ovanza's own renders, re-cropped and re-scaled to one 900×900
  canvas so the grid does not mix four resolutions and three aspect ratios.
- **4** — Cream Gel Coconut and the three Wax Roll-Ons — existed only on a dark
  backdrop in every copy in the feed. Background removed, re-laid on white. The
  product itself is untouched photography.
- **6 gels** — Styling White/Black/Blue/Yellow and Premium White/Black — had no
  modern render at all, only flat front-on shots from an older shoot. These
  were **re-rendered with AI** (Higgsfield / Nano Banana Pro) from Ovanza's own
  photograph, prompted to hold the packaging artwork and every printed word
  exactly and change only the camera angle and lighting.

  They are the only synthetic images on the site. They were checked against the
  originals and the label text reads correctly — but they are a re-render, not
  a photograph, and before these six go live someone should confirm the pack
  art still matches what is actually in the box.
