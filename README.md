# New Star Seven — store

Bilingual (Arabic/English) e-commerce site for New Star Seven, a men's hair-care
brand by Ovanza Cosmetics. Next.js App Router on Vercel, Neon Postgres, Resend
for email.

```bash
npm install
cp .env.example .env.local     # DATABASE_URL and SESSION_SECRET at minimum
npm run db:setup               # creates tables, loads products and articles
npm run dev
```

`SESSION_SECRET` is not optional if you touch anything behind a login: every
auth route throws without it. `DATABASE_URL` comes from Neon.

Without `DATABASE_URL` the homepage still renders (with an empty product grid),
which is enough to work on the landing layout offline. The shop, blog, product
and checkout pages need the database.

## Layout

| Path | What lives there |
|---|---|
| `app/` | Pages and API routes. `_components/` is shared UI, `api/` is the JSON endpoints, `admin/` is the back office. |
| `lib/` | Logic, mostly framework-free so it is directly testable: pricing, phone normalisation, hair-type data and ranking, credentials, carts, markdown, mail templates. The two that do import from Next are `customer-auth.js` and `auth.js`, because sessions live in cookies. |
| `db/` | `schema.sql` and `seed.sql`. Both safe to re-run. |
| `scripts/` | `setup-db.mjs` applies the SQL files. `verify-order-status.mjs` exercises the order state machine against a real Postgres — it creates its own throwaway database and drops it, so it is safe to point at any connection string. |
| `tests/` | `node --test`. No database needed. |
| `docs/` | Deployment, security notes, and the hair-type research the finder is based on. |

## Things worth knowing before changing code

- **The browser is never trusted with money.** The cart holds SKUs and
  quantities only; `app/api/order/` re-reads every price from the database and
  recomputes the total with `lib/pricing.js`. Client-side totals are display.
- **Stock is decremented inside a transaction** with a guard that aborts the
  whole order if another customer took the last jar in between. See
  `app/api/order/route.js`.
- **Nothing writes `orders.status` except `lib/order-status.js`.** Moving an
  order is not one column change: cancelling also returns the stock, gives the
  coupon redemption back, and writes the audit row, and all four have to happen
  together or not at all. The legal moves live in one table there,
  `delivered` and `cancelled` are terminal, and `tests/order-status.test.mjs`
  fails if an UPDATE of that column appears anywhere else.
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

## If you are picking this up cold

Read in this order:

1. [`docs/SECURITY.md`](docs/SECURITY.md) — where every control lives, the one
   trade-off in the session design, and the checklist before a real domain.
2. [`lib/order-access.js`](lib/order-access.js) — how a customer gets back to
   their own order. There are no accounts; the link in the confirmation email
   is the credential, and the comment there explains why and what it costs.
3. [`docs/product-facts.md`](docs/product-facts.md) — the catalogue as it
   actually is, with real ingredient lists read off the packaging, and the
   places the site currently contradicts them.
4. [`docs/DEPLOY.md`](docs/DEPLOY.md) — Vercel and Neon setup.

### Three things that will surprise you

- **55 of the 63 products are `active = false` with `price = 0`.** That is
  deliberate, not unfinished. The manufacturer catalogue carries no prices, and
  a guessed price on a cash-on-delivery shop is an argument at the customer's
  door. The client sets price and stock in the admin and ticks Active. A
  category with nothing live **404s** rather than serving an empty grid, and the
  sitemap only lists categories that hold something.

- **The database migrates on every deploy.** `vercel-build` runs
  `scripts/setup-db.mjs` before `next build`, applying `db/schema.sql` then
  `db/seed.sql`. Both are written to be safe to re-run — the seeds are
  `ON CONFLICT DO NOTHING` so a redeploy can never revert a price edited in the
  admin. If you add a statement, keep that property, and keep apostrophes out
  of SQL comments: the splitter tracks quote state and reads one as an
  unterminated string.

- **Some tests read source files as text rather than executing them.** That is
  on purpose. They guard against omissions — a route that forgets the CSRF
  check, a font nothing loads, an identifier that does not exist — and an
  omission has no behaviour to assert against. Each one exists because the
  corresponding failure reached production behind a green build.

### Where a test goes

`npm test` runs with no database and must stay that way — it is what makes a
fresh clone testable in seconds. Anything that needs a real Postgres is a script
under `scripts/`, run on demand, and every one of them creates its own throwaway
database, applies `db/schema.sql` to it and drops it in a `finally`. None of them
writes to the connection string in your environment, and each asserts that
before its first write rather than trusting it.

There are two. `npm run verify:orders` exercises the SQL in
`lib/order-status.js`. `npm run test:routes` starts a real Next server on a spare
port, points it at a throwaway database, and calls every endpoint in `app/api`
over HTTP — the honeypots, the origin and content-type guards, the 413s, the
rate limiters actually filling, and the concurrent cases that the sequential
ones cannot see: two checkouts racing for one unit of stock, five racing for one
redemption of a capped code. Pass a case-file name (`npm run test:routes --
refund`) to run one on its own.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test` | Test suite — no database needed |
| `npm run test:routes` | Every `app/api` route over HTTP, against a throwaway database |
| `npm run verify:orders` | The order state machine, against a throwaway database |
| `npm run db:setup` | Apply `db/schema.sql` then `db/seed.sql` |
