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
- **An admin session can be killed, and the epoch is how.** The login cookie is
  a signed JWT with an eight-hour life, which on its own is not revocable at
  all. It now carries the `session_epoch` from its admin row, and
  `lib/auth.js` refuses any token whose epoch is not current — so bumping that
  one integer ends every session that admin holds, everywhere. Changing a
  password bumps it, so does turning two-factor off, so does the
  sign-out-everywhere button. Only `lib/session-epoch.js` may write it, and
  `tests/admin-security.test.mjs` fails if a second writer appears.
- **Two-factor is hand-rolled, and that is on purpose.** `lib/totp.js` is RFC
  4226 and RFC 6238 over WebCrypto, about two hundred lines, no dependency. The
  price of that choice is paid in `tests/totp.test.mjs`, which checks every
  published RFC vector. The shared secret is encrypted at rest under a key
  derived from `SESSION_SECRET`, so rotating that variable signs everyone out
  **and** requires re-enrolment. Recovery codes are stored as SHA-256 and
  claimed by a guarded `UPDATE`, never by a read followed by a write.
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

There are six, and each one covers something the unit tests structurally cannot:
SQL that only a server can execute, or a race that needs two requests genuinely
in flight at the same moment. `npm run test:routes` is the broadest — it starts a
real Next server on a spare port, points it at a throwaway database, and calls
every endpoint in `app/api` over HTTP: the honeypots, the origin and
content-type guards, the 413s, the rate limiters actually filling, and the
concurrent cases the sequential ones cannot see, like two checkouts racing for
one unit of stock or five racing for one redemption of a capped code. Pass a
case-file name (`npm run test:routes -- refund`) to run one on its own.

A note on why several of them exist at all: three separate bugs in this
repository passed a sequential test and failed a concurrent one — a double
cancel crediting stock twice, a double-submitted checkout writing two orders,
and a duplicate request being told an item had sold out when its own twin had
taken the stock. If you add a verification script, make it overlap the requests.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run db:setup` | Apply `db/schema.sql` then `db/seed.sql` |
| `npm test` | Test suite — no database needed, and it must stay that way |
| `npm run test:routes` | Every `app/api` route over HTTP, against a throwaway database |
| `npm run verify:orders` | The order state machine, including a concurrent double cancel |
| `npm run verify:checkout` | Checkout idempotency, including a five-way simultaneous duplicate |
| `npm run verify:access` | Order links: migration, tampering, and `/order/find` timing |
| `npm run verify:auth` | Admin two-factor and session revocation |
| `npm run verify:indexes` | Every index, `EXPLAIN ANALYZE`d on 200k seeded orders |

The three `verify:` scripts are not tests and are not run by `npm test`. Each
one creates its own Neon database, applies the real schema to it, works only in
there and drops it in a `finally` — so they are safe to run with the production
connection string in the environment, and they cover the parts of the code that
are mostly SQL and cannot be exercised without a server.
