# New Star Seven — store

Bilingual (Arabic/English) e-commerce site for New Star Seven, a men's hair-care
brand by Ovanza Cosmetics. Next.js App Router on Vercel, Neon Postgres, Resend
for email.

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL at minimum
npm run db:setup               # creates tables, loads products and articles
npm run dev
```

Without `DATABASE_URL` the homepage still renders (with an empty product grid),
which is enough to work on the landing layout offline. The shop, blog, product
and checkout pages need the database.

## Layout

| Path | What lives there |
|---|---|
| `app/` | Pages and API routes. `_components/` is shared UI, `api/` is the JSON endpoints, `admin/` is the back office. |
| `lib/` | Pure logic: pricing, phone normalisation, hair-type data and ranking, auth, mail templates, cart, markdown. No framework imports, so it is all directly testable. |
| `db/` | `schema.sql` and `seed.sql`. Both safe to re-run. |
| `scripts/` | `setup-db.mjs` applies the SQL files. |
| `tests/` | `node --test`. No database needed. |
| `docs/` | Deployment, security notes, and the hair-type research the finder is based on. |

## Things worth knowing before changing code

- **The browser is never trusted with money.** The cart holds SKUs and
  quantities only; `app/api/order/` re-reads every price from the database and
  recomputes the total with `lib/pricing.js`. Client-side totals are display.
- **Stock is decremented inside a transaction** with a guard that aborts the
  whole order if another customer took the last jar in between. See
  `app/api/order/route.js`.
- **`hair_types` on a product is a CSV in priority order** — the first slug wins
  the primary recommendation. The three gels are deliberately `straight` only,
  because the wavy panel tells customers to avoid hard gels; `tests/hairtypes.test.mjs`
  fails if that ever contradicts itself again.
- **The landing page CSS is scoped under `.s7home`.** `app/landing.css` shares
  class names (`.card`, `.grid`, `.btn`) with `app/globals.css`, which styles
  every other page. Keep new landing rules inside that scope.
- **Looping decorations are CSS animations, not JavaScript.** The original build
  used JS-driven infinite rotations that no amount of pausing could stop; they
  burned CPU on an idle tab. Don't reintroduce them.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test` | Test suite |
| `npm run db:setup` | Apply `db/schema.sql` then `db/seed.sql` |

Deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md).
Security model and the attack testing behind it: [`docs/SECURITY.md`](docs/SECURITY.md).
