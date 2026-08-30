# New Star Seven — handoff

**Written 27 Aug 2026.** State of the project, what is outstanding, and the
things that will bite someone who does not know them.

---

## What this is

Bilingual (Arabic-first, English under `/en`) storefront for **New Star Seven**,
a men's hair-care brand made by **Ovanza Cosmetics** (Belbeis, El Sharqia).
Next.js App Router on Vercel, Neon Postgres, Resend for email.

- Repo: `github.com/youssefm56798-jpg/starseven-vercel` (**public** — nothing
  secret may ever land in this file)
- Live: `starseven-vercel.vercel.app` — **no custom domain yet**
- Deploys on push to `main`. `vercel-build` runs `scripts/setup-db.mjs`
  (schema + seed) before `next build`, so the database migrates every deploy.

---

## Where it stands

**63 products live.** 32 are buyable; 31 show "ask for price" with a WhatsApp
button, because the manufacturer's catalogue carries no prices and guessing one
on a cash-on-delivery shop is an argument at the customer's door.

| Range | Count | Price |
|---|---|---|
| Premium Wax 120ml, Hair Wax 135/125ml, Gel Wax 140ml | 18 | 45 EGP |
| Premium Gel 250ml, Styling Gel 250ml, Cream Gel 250ml | 14 | 40 EGP |
| Styling Gel 650ml / 850ml, sachets | 10 | **unpriced** |
| Hair Spray 500ml, Cologne 180ml, Depilatory range | 21 | **unpriced** |

**No customer accounts.** Email is mandatory at checkout; the confirmation
carries a link (`/order/<ref>?t=<token>`) showing the order, its status, and a
cancellation/refund request. The token is 32 random bytes stored only as a
SHA-256 — see `lib/order-access.js`.

**Admin** at `/admin`: dashboard, orders, subscribers, offers (the coupon
screen), products (price, stock, active, featured), accounts and security.
Seven tabs, and that is the whole back office — `app/admin/(panel)/tabs.js` is
the list. Each tab carries the permission its screen needs; hiding one is a
courtesy, never a control, because every screen and every Server Action calls
`requirePermission()` for itself.

**There is no articles screen, and there never was.** The `articles` table is
seeded from `db/seed.sql` and re-applied on every deploy, so the blog is edited
by changing that file and pushing. Ten articles, all published. If an editor is
ever built, `articles` has to join the backup set at the same time — see
[`docs/RECOVERY.md`](RECOVERY.md), which currently leaves it out precisely
because the seed is the only thing that writes it.

---

## Do this before a real domain goes live

1. **`SESSION_SECRET`** — the admin login throws without it.
2. **`NEXT_PUBLIC_SITE_URL`** — the CSRF origin check compares against it, so a
   wrong value refuses every mutation.
3. **`RESEND_API_KEY`** — without it no email sends at all, and **no customer
   can reach their order**. The link is never stored, only its digest, so email
   is the only way one ever arrives: at checkout, on every status change, and
   from `/order/find` when somebody asks for it again.
4. **`MAIL_FROM`** — currently defaults to `newstarseven.com`, which belongs to
   an unrelated honey business. The brand's real domain is
   **ovanzacosmetics.com** (it is printed on the jar).
5. ~~**Remove `ADMIN_SETUP_KEY`** once the first admin exists.~~ **Done, 30 Aug
   2026** — the first admin exists and the key is out of the production
   environment, so `/admin/setup` now serves no form. `keyOk()` fails closed
   when no key is configured, which is what makes that safe.
6. Price the 31 unpriced products, or leave them on "ask".

---

## Open questions for the client

- **The pack prints two customer-service numbers** — `002 01110391048` and
  `002 01029660069` — and neither is the WhatsApp number the site uses
  (`01028282216`). A customer reading the jar calls a number nobody answers.
- **"Wave & Groom"** is printed on the red tin and is also **DAX's** product
  name for a red-tin hair wax. The site repeats it.
- Prices for the 31 unpriced SKUs.
- Which gel leads the Straight hair type — currently Golden, by an accidental
  `sort` tie-break. `tests/hairtypes.test.mjs` now fails on any *new* tie and
  skips this one on purpose: the three gels are one formula in three scents at
  one hold, so which of them fronts the tile is an editorial call, not a bug.
- **Premium Wax Black was rewritten on 27 Aug 2026** from matte / fine hair to
  high shine / covers grey, and the hold levels were turned the right way up.
  Both changes move who a product is sold to, so the client should see them.

---

## Things that will bite you

**The range has nothing for fine hair, and now says so.** The black wax used to
carry that tile on a matte finish it does not have; Ovanza rate it *Medium hold
– High flexibility – **High shine*** and sell it on grey coverage, and its
ingredient list contains no matting agent at all. It is now sold as what it is,
and **Pro** carries the fine tile — last in its `hair_types` list, so it leads
nothing else — with the tile and its gap note saying out loud that the format
fine hair wants is a clay or a matte paste and that the range does not contain
one. That is honest, not solved. Detail in `docs/product-facts.md`.

**Hold is a range-wide scale now, not a per-format one.** Ultra Strong → 5,
Strong → 4, Medium → 3, so the three gels sit above every wax. Anything written
about hold has to hold that line: the number is not "how good", it is "how
little it forgives".

**The seed runs on every deploy.** Everything in `db/seed.sql` must stay
re-runnable and non-destructive — the product seeds are `ON CONFLICT DO
NOTHING` and the UPDATEs are guarded on their old value, so a redeploy can
never revert a price edited in the admin. Keep that property.

**Which means the order history is one careless statement away, on every
deploy.** `db/schema.sql` is applied to production before the site is even
built, and rolling the deploy back does not roll the data back — Vercel
promotes a build it already has, so `setup-db.mjs` never re-runs and the damage
stays. `npm run backup` before anything that touches `db/`, and
[`docs/RECOVERY.md`](RECOVERY.md) for the rest. Note that nothing schedules a
backup: it happens when a human runs it, and that gap is written down at the end
of that document rather than left to be found.

**No apostrophes in SQL comments.** `scripts/sql-split.mjs` tracks quote state
to split statements, and reads one as an unterminated string literal. There is
a test for it.

**Some tests read source as text, not behaviour.** They guard omissions — a
route that forgets the CSRF check, a font nothing loads, an identifier that
does not exist. Each exists because that exact failure reached production
behind a green build:

| Suite | What it caught |
|---|---|
| `tests/hook-deps.test.mjs` | `ReferenceError: q` in a hook dependency array — checkout was dead for 8 deploys |
| `tests/fonts.test.mjs` | The port never loaded Anton or Cairo; the whole site was in a system fallback |
| `tests/sql-split.test.mjs` | A migration that ran, reported success, and changed nothing |
| `tests/order-access.test.mjs` | The order token is the only credential there is |
| `tests/sql-split.test.mjs` | Every correction to the eight original products has to be its own guarded UPDATE, because their seed is `DO NOTHING` and editing the literal changes nothing live |
| `tests/backup-format.test.mjs` | A truncated dump has to be refusable. A backup that stops half way opens, and the first rows look right |

`npm test` — 1,261 tests, no database needed.

---

## Reference

| Doc | What is in it |
|---|---|
| `README.md` | Setup, layout, orientation for a new engineer |
| `docs/RECOVERY.md` | **Read before you need it.** Backups, restores, Neon point-in-time recovery, and what to do at 2am for each of the four ways this goes wrong |
| `docs/SECURITY.md` | Where each control lives; the order-link design and its costs |
| `docs/product-facts.md` | **Real ingredient lists read off the packaging**, the factory address, and every place the site contradicts them |
| `docs/DEPLOY.md` | Vercel and Neon setup |
| `docs/hair-type-research.md` | The research behind the hair-type finder |

`scripts/unwrap-label.py` un-warps text printed around a cylindrical jar —
that is how the ingredient panels were read out of the renders.

---

## Still not found

Ingredient lists for the **gels, cream gels, cologne, spray and depilatory**
ranges. The gel panel sits on the far curve of a transparent jar and no
published render has the pixels; marketplace research did not turn them up
either. They need a photograph of the physical pack, or the spec sheets from
Ovanza.

Two gel images (`gel-250-white`, `gel-250-black`) were **re-rendered
generatively** to match the site's camera angle. Their labels are plausible and
**not authoritative** — never read an ingredient off those two.
