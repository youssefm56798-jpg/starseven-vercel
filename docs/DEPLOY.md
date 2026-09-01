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
| `DATABASE_URL` | Set by the Neon integration. Don't edit by hand. This is the **owner** role: it can run DDL, which the migration needs. |
| `DATABASE_URL_APP` | **Set this in production.** The **restricted** role the running site connects as; see below. Absent, the site falls back to `DATABASE_URL` — the owner, which can drop any table — and logs a SECURITY warning on every cold start. The fallback exists so a fresh clone and a preview deployment work with no setup, and so the hardening can be rolled back by deleting one variable. It is not a production configuration. |
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
| `ORDER_HOLD_HOURS` | How long an order nobody has confirmed keeps holding its stock. Past it, the nightly sweep cancels the order, puts the stock back and emails the customer. This is what stops fake cash-on-delivery orders draining the catalogue permanently — there is no payment step to stop them being placed. Default `72`, which clears a Thursday-evening order rung on Saturday. Raise it before a holiday. `0` turns the sweep off. |
| `CRON_SECRET` | Authorises **both** nightly sweeps — the stock release, and the retention sweep that redacts personal data past its published window (`lib/retention.js`). Vercel Cron sends it as `Authorization: Bearer <this>`, but **only when it is set** — so leaving it unset does not open the endpoints, it silently stops stock being released *and* stops the shop honouring the retention periods its own privacy policy publishes. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |
| `NEXT_PUBLIC_GA_ID` | Optional. Google Analytics 4. Read at **build** time by three places at once: the script tag, the Google hosts in the CSP, and the Google paragraph in the privacy policy. Setting it puts `_ga` cookies on every visitor, which changes the shop from one that gives customers no cookies to one that does — `docs/LEGAL-BRIEF.md` Q3 asks whether that needs a consent banner, and nobody has answered yet. |
| `BLOB_READ_WRITE_TOKEN` | Set for you when a Blob store is connected. Optional — see below. |

### The restricted runtime role

`DATABASE_URL` is the Neon owner: it owns every table, runs DDL, and carries
`BYPASSRLS`. The migration needs that. A web server does not — holding it means
anything that reaches SQL execution through the running site inherits the power
to drop the orders table.

So point the runtime at a role that can only do what the code actually does.
The privileges are listed in `db/grants.mjs`, applied on every deploy by
`setup-db.mjs`, and proved against a throwaway database by `npm run verify:grants`.
It cannot create, alter or drop anything, and it cannot delete an order, an
order event, an access token or a mail-log row — the order history and the audit
trail are not the application's to erase.

**Once, by hand.** In the Neon SQL editor, on the production database:

```sql
CREATE ROLE s7_app LOGIN PASSWORD 'paste-a-generated-password-here';
```

Generate the password rather than inventing one:

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Then take the `DATABASE_URL` connection string, replace the username and
password with `s7_app` and that password, keep everything else identical
(`?sslmode=require` included), and set it as `DATABASE_URL_APP` in Vercel —
Production and Preview. Redeploy. The deploy applies the grants itself; you do
not run any GRANT statement by hand.

Check it landed with `node scripts/apply-grants.mjs --check`, which prints what
the role holds against what the matrix wants.

**To roll back**, delete `DATABASE_URL_APP` and redeploy. The site falls back to
the owner string and nothing else changes — worth knowing before you need it.

A new table added by a later migration picks its grants up on the next deploy,
because `db/grants.mjs` is re-applied every time. Adding a table without adding
it to that file fails `npm test`, which is the intended way to find out.

### Product image uploads

Adding a product in `/admin/products` includes uploading its photograph, and
that needs somewhere to put the file. In Vercel → **Storage** → **Create** →
**Blob**, connect the store to this project. Vercel then sets
`BLOB_READ_WRITE_TOKEN` in all three environments and the next deploy picks it
up. Nothing else has to be configured.

Without the token the panel still works: the file input is replaced by a note,
and the image field takes the path of a file committed under `public/` — which
is what every product seeded so far uses (`assets/catalog/wax-135-argan.webp`).
So a fresh clone, a local `npm run dev` and a build on a project with no store
attached all behave exactly as they did before uploads existed.

Uploaded images are served from `https://<store>.public.blob.vercel-storage.com`,
which `next.config.mjs` allows in the `img-src` of the Content-Security-Policy.
If images render locally and are blank in production, that header is the first
thing to look at.

Files are validated on the server before they are stored: the real format is
read out of the file signature rather than taken from the name or the
`Content-Type`, so a renamed HTML file is refused; the size cap is 3 MB, the
picture has to be between 120 and 4096 pixels on each side and roughly square,
and the stored filename is generated here from the SKU rather than taken from
the upload. SVG is not accepted — it can carry script.

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
