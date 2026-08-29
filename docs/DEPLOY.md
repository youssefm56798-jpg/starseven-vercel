# Deploying New Star Seven to Vercel

Everything here is a one-time setup. After it is done, deploying is `git push`.

---

## 1. Create the Vercel project

The store is a commercial site, so it needs the **Pro** plan ($20/month per member) —
Vercel's Hobby tier is for personal, non-commercial projects only.

1. Push this folder to a Git repository (GitHub, GitLab or Bitbucket).
2. In Vercel: **Add New… → Project**, import the repository.
3. Framework preset is detected as **Next.js**. Leave the build settings alone —
   `next build` and the default output directory are correct.
4. Don't deploy yet. Add the environment variables first (step 3), otherwise the
   first build succeeds but every page renders an empty catalogue.

## 2. Create the database

Vercel Storage → **Neon (Serverless Postgres)** → create, then **Connect** it to
the project. Vercel writes `DATABASE_URL` into the project's environment
variables for you.

If you'd rather create the database directly at neon.tech, copy its **pooled**
connection string into `DATABASE_URL` yourself. It must be the connection string
with `?sslmode=require` — `@neondatabase/serverless` talks HTTP, not raw TCP.

## 3. Environment variables

Copy `.env.example` and fill it in. Every variable must exist in **Production**,
**Preview** and **Development** unless noted.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Set by the Neon integration. Don't edit by hand. |
| `NEXT_PUBLIC_SITE_URL` | The live origin, no trailing slash. Used for canonical URLs, `sitemap.xml` and `robots.txt`. Getting this wrong hurts SEO more than anything else on this list. |
| `NEXT_PUBLIC_WHATSAPP` | Support number in international format, no `+`. |
| `SHIPPING_FEE` | Delivery fee in EGP. |
| `FREE_DELIVERY_OVER` | Order value at which delivery becomes free. `0` disables free delivery. |
| `RESEND_API_KEY` | From resend.com. Without it the site still takes orders — it just cannot send email. |
| `MAIL_FROM` | Sender address on a domain verified in Resend. |
| `MAIL_FROM_NAME` | Display name on outgoing mail. |
| `ORDER_NOTIFY_TO` | Where the team's new-order alert goes. Use a shared company inbox, not a personal one. |
| `SESSION_SECRET` | Signs the admin login cookie. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Changing it logs every admin out. |
| `ADMIN_SETUP_KEY` | Used **once** to create the first admin login, then delete the variable. |

`SESSION_SECRET` and `ADMIN_SETUP_KEY` are secrets: never commit them, and never
reuse the values between Preview and Production.

## 4. The tables create themselves

There is no manual migration step. `package.json` defines

```
"vercel-build": "node scripts/setup-db.mjs && next build"
```

so every deployment applies `db/schema.sql` then `db/seed.sql` before building.
Both are safe to re-run:

- the schema is all `CREATE ... IF NOT EXISTS` plus `ALTER ... ADD COLUMN IF NOT
  EXISTS`, so new columns reach existing databases automatically;
- the seed is `INSERT ... ON CONFLICT DO NOTHING`. It is **initial data only**.
  Once a product exists, the shop owner owns it — a deploy will never revert a
  price, stock level or description edited in the admin.
- the one exception is the long-form product copy at the end of `seed.sql`,
  which fills `long_*`, `howto_*` and `highlights_*` **only where they are still
  empty**. To restore the original wording for a product, blank the field in the
  admin and redeploy.

If the database is unreachable, the build fails rather than shipping a site
that cannot read its own catalogue. You can still run it by hand:

```bash
npm run db:setup
```

## 5. Create the admin login

Deploy, then visit `https://<your-domain>/admin/setup`, enter the value of
`ADMIN_SETUP_KEY` along with the email and password for the first admin.

**Then remove `ADMIN_SETUP_KEY` from the Vercel environment and redeploy.** The
route refuses to run once an admin exists, but leaving the key set is one less
lock on the door than you need.

## 5b. Backups — do this on day one

Step 4 is also the largest risk in this project: `db/schema.sql` and
`db/seed.sql` are applied to the **production** database on every deploy, before
the site is built. One careless statement in either file reaches the entire
order history, and it reaches it on the deploy that introduces it.

Take a dump before any deploy that touches `db/`:

```bash
npm run backup
```

It only ever runs `SELECT`, so it is safe against production. The output lands in
`backups/`, which is gitignored twice over — the file holds customer names,
addresses, phone numbers, the mailing list and the admin password hashes, so get
it off the machine that made it.

Prove it works before you need it to:

```bash
npm run verify:backup                            # the round trip, on a throwaway database
npm run verify:backup -- --dump backups/<file>   # rehearse the real file
```

Neon also keeps a point-in-time recovery window, which is better than a dump
whenever the damage is recent enough to be inside it. **Find out how long yours
is** — Neon Console → project → Settings → Storage — because on the free tier it
is short, and it is the number that decides whether a Friday-evening mistake is
recoverable on Monday.

Everything else — what to do when a migration has already wiped something, when
the database is unreachable, when a deploy broke production, and how to look at
yesterday's data without touching today's — is [`RECOVERY.md`](RECOVERY.md).

## 6. Domain

Vercel → project → **Domains** → add the domain and follow the DNS instructions.
The certificate is issued and renewed automatically.

Once the domain is live, set `NEXT_PUBLIC_SITE_URL` to it and redeploy, so the
sitemap and canonical tags point at the real address rather than the
`*.vercel.app` preview one.

---

## Checks after the first deploy

- `/` shows eight products. An empty grid means `DATABASE_URL` is missing or the
  seed has not been run.
- `/sitemap.xml` lists your real domain, not `localhost` or `vercel.app`.
- `/robots.txt` allows crawling and points at the sitemap.
- Place a test order. Confirm it appears in `/admin/orders`, that the customer
  confirmation arrives, and that the alert reaches `ORDER_NOTIFY_TO`.
- `/admin/setup` returns "already set up".

## Day-to-day

- `git push` to the main branch deploys to production.
- Every other branch and pull request gets its own preview URL with its own
  build — safe for showing work before it goes live.
- If a deploy goes wrong, Vercel → **Deployments** → the previous one →
  **Promote to Production**. It's instant; there is nothing to rebuild.

  **That rolls back the code and not the data.** Promoting reuses a build Vercel
  already has, so `vercel-build` does not run again and `setup-db.mjs` does not
  run again — which is what makes it instant, and which means any migration the
  bad deploy applied is still applied. Do not reach for **Redeploy** instead:
  that *does* rebuild, and rebuilding re-runs the statement that broke it. If
  data is wrong rather than just the site, see [`RECOVERY.md`](RECOVERY.md).

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

`npm test` runs the suite (no database required — every test is against pure
functions and the SQL files).

Without `DATABASE_URL` only the homepage renders, with an empty product grid.
Every other data-driven page needs the database, so run `npm run db:setup`
before doing anything beyond landing-page layout.
