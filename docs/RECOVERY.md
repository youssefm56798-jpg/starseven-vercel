# Recovery

**Read this first, act second.** This is written for somebody who did not build
the shop, at an hour when nobody who did is answering the phone.

Everything below is a command you can paste. Where a choice has to be made, the
choice is written out with what it costs.

---

## The first ninety seconds

Do these three things before anything else. All three are read-only.

```bash
# 1. Is the site actually down, or is it one page?
curl -sS -o /dev/null -w "%{http_code}\n" https://starseven-vercel.vercel.app/
curl -sS -o /dev/null -w "%{http_code}\n" https://starseven-vercel.vercel.app/shop

# 2. Is the database reachable, and does it still have orders in it?
npm run backup -- --tables orders
```

`npm run backup` only ever runs `SELECT`. It cannot make anything worse, it
tells you in one line whether the database answers, and it prints the order
count. **If there are still orders, take a full backup before you touch
anything:**

```bash
npm run backup
```

Then work out which of the four situations you are in.

| What you are seeing | Go to |
|---|---|
| Rows are gone or wrong, and a deploy just happened | [A bad migration](#a-a-bad-migration-wiped-or-corrupted-data) |
| Every page 500s, `npm run backup` cannot connect | [The database is unreachable](#b-the-database-is-unreachable) |
| The database is fine, the site is broken | [A deploy broke production](#c-a-deploy-broke-production) |
| Nothing is broken, somebody needs an older copy | [Yesterday's state](#d-somebody-needs-yesterdays-state) |

---

## The one thing that is easy to get wrong

**Rolling back the deploy does not roll back the data.**

`vercel-build` is `node scripts/setup-db.mjs && next build`. Every deployment
applies `db/schema.sql` and `db/seed.sql` to the production database *before* the
site is built. So a migration runs the moment the build starts, and it has
already run by the time anyone notices.

- **Promote to Production** on an older deployment restores the **code** only.
  Vercel promotes a build it already has; it does not rebuild, so it does not
  re-run `setup-db.mjs`. Data damage stays exactly as it is.
- **Redeploy**, or any new push, **does** re-run `setup-db.mjs`. If the bad
  statement is still in `db/schema.sql`, redeploying runs it again.

Rolling back and restoring are two separate jobs. Usually you need both, in that
order: stop the bleeding with a rollback, then put the data back.

---

## A. A bad migration wiped or corrupted data

### A1. Stop it happening again on the next deploy

Find the statement. It is in `db/schema.sql` or `db/seed.sql`, and it ran on
every deploy since it was added.

```bash
git log --oneline -20 -- db/schema.sql db/seed.sql
git show <sha> -- db/schema.sql
```

Revert it in the repository **before** you restore anything. A restore followed
by a deploy that re-runs the same destructive statement puts you back where you
started, with one fewer chance to get it right.

```bash
git revert <sha>          # or edit the file directly and commit
```

Do **not** push yet. Pushing starts a deploy, and a deploy runs the schema.

### A2. Choose how to get the data back

Two routes. Try them in this order.

| | Neon point-in-time | The dump |
|---|---|---|
| Gets you | The database exactly as it was at a chosen second | The database as it was when the dump was taken |
| Loses | Nothing, up to the recovery window | Everything since the dump |
| Works if | The damage is inside the retention window | You have a dump |
| Time | A minute | A few minutes |

**Point-in-time is better whenever it is available.** It is exact, it needs no
file, and it cannot be half-applied. Use the dump when the window has passed or
Neon itself is the problem.

### A3. Route 1 — Neon point-in-time recovery

Neon keeps a write-ahead log and can produce the database as it was at any
instant inside the retention window.

1. **Find the window you actually have.** Do not trust this document for it, and
   do not trust the pricing page either — Neon has changed the defaults more than
   once and a project keeps whatever it was created under.

   Neon Console → your project → **Settings → Storage** (labelled *History
   retention* or *Restore window*). Or:

   ```bash
   npx neonctl projects get <project-id>       # look for history_retention_seconds
   ```

   The project id is in `.env.local` as `DATABASE_NEON_PROJECT_ID`.

   As a rough guide, at the time of writing: **Free is 24 hours**, paid plans
   start at 7 days and go up. **24 hours is short.** A migration that runs on a
   Friday evening deploy and is noticed on Monday is outside it. That is the
   single strongest argument for taking a dump before any risky deploy.

2. **Branch first, restore second.** Neon Console → **Branches** → *New branch*
   → *from a point in time* → pick the timestamp just **before** the bad deploy.
   A branch is a full copy with its own connection string and it costs nothing to
   look at.

3. **Check it is right** before you touch production. Point the rehearsal at the
   branch, or just count:

   ```bash
   DATABASE_URL="<branch connection string>" npm run backup -- --out ./scratch
   ```

   That prints the row count per table for the branch. Compare it to what you
   expect.

4. **Then** either promote the branch, or use *Restore* on the main branch
   (Neon Console → Branches → your branch → **Restore**), which resets it to that
   moment and keeps a backup branch of the current state so the restore itself is
   reversible.

5. Confirm, then push the revert from step A1.

### A4. Route 2 — restore from a dump

You need a dump file. `backups/` in this repository is where `npm run backup`
writes them, and they are gitignored, so look on whichever machine last ran it.

**Always verify the file before you trust it.** This restores it into a
throwaway Neon database, checks every value survives the round trip, and drops
the database afterwards. It never writes to production.

```bash
npm run verify:backup -- --dump backups/starseven-2026-08-29T14-23-13Z.ndjson
```

If that says `all checks passed`, the file is good.

**Restoring one table that was wiped**, leaving everything else alone. This is
the common case and the least destructive thing you can do:

```bash
npm run restore -- --dump backups/<file>.ndjson \
  --only orders,order_items,order_events,order_tokens \
  --truncate --confirm neondb
```

- `--confirm` takes the **database name**, and the restore prints that name two
  lines before it asks. It is a typed name and not a `y/n` because a `y/n` at 3am
  is answered by muscle memory.
- `orders` cannot be restored on its own. `order_items`, `order_events` and
  `order_tokens` all reference it, so `TRUNCATE` refuses unless they go too. The
  error names them if you forget.

**Restoring everything**, when the whole database is gone:

```bash
npm run restore -- --dump backups/<file>.ndjson --with-schema
```

`--with-schema` applies `db/schema.sql` first, so this works against a brand new
empty Neon database. Without `--with-schema` the tables must already exist.

A restore refuses to load on top of live rows unless you pass `--truncate`. If
you get *"is not empty"*, that is the guard working; read what it says is in the
way before overriding it.

### A5. Afterwards

```bash
npm run verify:orders        # the order state machine still behaves
npm run verify:access        # customer order links still resolve
npm run backup               # a fresh dump of the recovered state
```

Then push the revert from A1 and watch the deploy.

---

## B. The database is unreachable

Symptoms: every data-driven page 500s, `npm run backup` fails with a connection
error rather than a SQL error.

1. **Check whether it is Neon or you.**

   ```bash
   curl -sS https://neonstatus.com/api/v2/status.json
   ```

   Also Vercel → project → **Logs**, filtered to errors. A Neon incident looks
   like connection timeouts across every route at once.

2. **Check the database has not been suspended or deleted.** Neon Console →
   Branches → your branch. A Neon project on a free plan can be suspended for
   inactivity; the first query wakes it, which is what step 1's `npm run backup`
   already tried.

3. **Check `DATABASE_URL` still exists.** Vercel → project → Settings →
   Environment Variables. If somebody disconnected and reconnected the Neon
   integration, this can point at a *different, empty* database — which looks
   identical to data loss and is not. Compare the host in the Vercel variable
   against the host in Neon Console.

   ```bash
   # what the local copy points at, password redacted
   node -e "console.log((process.env.DATABASE_URL||'unset').replace(/:[^:@\/]+@/, ':****@'))"
   ```

4. If Neon has genuinely lost the database, this is [A4](#a4-route-2--restore-from-a-dump)
   against a **new** Neon database:

   ```bash
   # create the project/database in the Neon console, copy its connection string
   DATABASE_URL="<new connection string>" \
     npm run restore -- --dump backups/<file>.ndjson --with-schema
   ```

   Then put the new `DATABASE_URL` into Vercel and redeploy.

**The shop keeps taking orders while you do this?** No. There is no queue and no
offline mode — checkout writes straight to Postgres. Orders placed during an
outage are lost, and the customer sees an error. If the outage will be long,
the honest move is to put the WhatsApp number in front of people.

---

## C. A deploy broke production

The database is fine. The site is not.

1. **Roll the code back.** Vercel → project → **Deployments** → the last
   deployment that worked → **⋯ → Promote to Production**. This is instant and it
   does not rebuild, so it does not re-run `setup-db.mjs`.

2. **Read the note above** — if the broken deploy also ran a migration, the
   migration is still applied. Promoting older code onto a newer schema usually
   works here, because `db/schema.sql` only ever adds; but if the broken deploy
   dropped or renamed something, go to [A](#a-a-bad-migration-wiped-or-corrupted-data).

3. **Do not Redeploy** to "try again". Redeploy re-runs the build, which re-runs
   `setup-db.mjs`, which re-runs whatever broke it.

4. Fix forward on a branch. Every branch gets its own preview URL with its own
   build, and preview builds run `setup-db.mjs` against the **same** database as
   production unless the preview environment has its own `DATABASE_URL`. Check
   that before pushing anything schema-shaped:

   Vercel → Settings → Environment Variables → is `DATABASE_URL` set separately
   for **Preview**? If it is not, a preview deploy migrates production.

5. Before merging:

   ```bash
   npm test
   npm run test:routes
   npx next build
   ```

---

## D. Somebody needs yesterday's state

Nothing is broken. Someone wants to know what an order looked like before it was
edited, or what the price of something was last week.

**Do not restore into production to answer a question.** Restore into a
throwaway database and query that.

```bash
# 1. Make a scratch database. CREATE DATABASE is refused through the pooler,
#    so this uses the direct endpoint, which Neon supplies as DATABASE_URL_UNPOOLED.
node --input-type=module -e "
  const { neon } = await import('@neondatabase/serverless');
  await neon(process.env.DATABASE_URL_UNPOOLED)('CREATE DATABASE scratch_lookup');
  console.log('created scratch_lookup');
"

# 2. Load the dump into it. Replace the database name in the URL with scratch_lookup.
DATABASE_URL="${DATABASE_URL_UNPOOLED/\/neondb/\/scratch_lookup}" \
  npm run restore -- --dump backups/<file>.ndjson --with-schema

# 3. Ask it whatever the question was.
node --input-type=module -e "
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.SCRATCH_URL);
  console.table(await sql\`SELECT ref, status, total, created_at FROM orders ORDER BY id DESC LIMIT 20\`);
"

# 4. Throw it away. Do this. A forgotten copy of the customer table is a breach
#    waiting to be one.
node --input-type=module -e "
  const { neon } = await import('@neondatabase/serverless');
  await neon(process.env.DATABASE_URL_UNPOOLED)('DROP DATABASE IF EXISTS scratch_lookup WITH (FORCE)');
  console.log('dropped scratch_lookup');
"
```

A Neon branch from a point in time (see [A3](#a3-route-1--neon-point-in-time-recovery))
does the same job with less typing and no dump file, as long as the moment you
want is inside the retention window.

For an order's own history there is a cheaper answer that needs no restore at
all: `order_events` is an append-only audit log of every status move, note, call
and refund request, with the actor and the timestamp.

```sql
SELECT e.created_at, e.kind, e.from_status, e.to_status, e.actor, e.note
  FROM order_events e JOIN orders o ON o.id = e.order_id
 WHERE o.ref = 'S7-1042'
 ORDER BY e.id;
```

---

## Taking a backup

```bash
npm run backup                        # everything, into backups/
npm run backup -- --out D:/offsite    # somewhere that is not this laptop
npm run backup -- --tables orders     # just to see whether the database answers
```

The output is one NDJSON file. It is plain text on purpose — `head`, `grep` and
`wc -l` all work on it, which matters more at 2am than the disk a compressed
file would save.

**Take one before every risky deploy.** A schema change, a seed change, anything
touching `db/`. It costs seconds and it is the only thing standing between a bad
migration and the order history, once the Neon retention window has passed.

### Where dumps must not go

`backups/` is gitignored twice — by `backups/*` in the root `.gitignore` and by
`backups/.gitignore` from the inside — and `*.ndjson` is ignored everywhere in
the tree. A dump holds customer names, addresses, phone numbers, the mailing
list and the admin password hashes. It is the most sensitive artifact this
project produces and a commit is not undone by deleting the file afterwards.

Get it off the machine that made it. A laptop is not a backup location.

---

## What the backup contains, and what it does not

Ten tables, in restore order:

`settings`, `admins`, `admin_recovery_codes`, `products`, `offers`,
`subscribers`, `orders`, `order_items`, `order_events`, `order_tokens`

The test for inclusion is simple: **can this be rebuilt from something that is in
git?** `db/schema.sql` and `db/seed.sql` are in git and re-applied on every
deploy, so anything they produce does not need a backup.

`settings` is in the list on a technicality worth stating plainly: **nothing
reads or writes it today.** `db/schema.sql` creates it on every deploy and it is
empty — the `lib/settings.js` its schema comment used to name does not exist. It
is backed up because it is one row per key, so it costs bytes and nothing else,
and because the day somebody builds the reader it was designed for is the day it
stops being reconstructible from git. A backup set that has to be remembered and
extended on that day is one that will not be.

`products` looks like it fails that test and does not. The seed does recreate all
63 rows — but it is `INSERT ... ON CONFLICT DO NOTHING`, which is what makes it
safe to re-run and useless as a restore: it recreates the catalogue as it
*shipped*, 55 products inactive at price 0, and then declines to touch the
prices, stock and active flags the owner has been editing in the admin ever
since. Restoring products from the seed would silently unprice the shop.

**Deliberately not included**, each for a stated reason:

| Table | Why not | What it costs |
|---|---|---|
| `articles` | `db/seed.sql` carries every body in both languages, and no admin screen edits them | `articles.views`, a vanity counter |
| `rate_limits` | Fixed windows, minutes old. Restoring stale ones is worse than losing them | Nothing |
| `order_attempts` | Idempotency keys, deleted after 30 days on every deploy | A checkout in flight across the restore can retry into a second order. Seconds wide |
| `email_log` | Operational log | A reporting gap |
| `quiz_results` | Funnel analytics | A reporting gap |
| the schema | `db/schema.sql` is in git; two copies of a schema can disagree | Nothing — the dump records a digest of the schema it was taken against |

If an article editor is ever built, `articles` moves into the backup on the same
day.

---

## Rehearsing

A backup nobody has restored is not a backup.

```bash
npm run verify:backup                         # the whole round trip, on fixtures
npm run verify:backup -- --dump backups/<f>   # rehearse a real file
```

The first builds two throwaway Neon databases, loads fixtures chosen to be
hostile — Arabic prose, apostrophes, embedded newlines, `NUMERIC` that must keep
its scale, a `BIGINT` past the last integer JavaScript counts exactly, `NULL`
next to the empty string, `DATE` columns, and a hole in the identity sequence —
dumps one, restores into the other, and requires every value to come back
identical. It also checks the things a restore gets quietly wrong: that ids are
preserved rather than renumbered, that the identity sequences are moved past
them so the next order does not collide, and that a truncated or edited dump is
refused rather than half-loaded.

The second does the same to a file you actually have. **Run it on any dump you
are about to depend on**, and on a recent one every quarter regardless. Neither
mode writes to production; both drop their databases in a `finally`.

### Known drift, as of 2026-08-29

`--dump` mode reports that `products`, `offers` and `orders` in production carry
their columns in a different **order** from a database created fresh out of
`db/schema.sql`. That is `ALTER TABLE ... ADD COLUMN` doing what it does — a new
column lands at the end — and it is harmless, because the restore matches columns
by name. It is noted here so that seeing it does not cost anyone twenty minutes.

---

## What is still not covered

Written down rather than left to be discovered.

- **Nothing is scheduled.** `npm run backup` runs when a human runs it. There is
  no cron, because there is nowhere on this stack to run one: Vercel builds have
  no persistent disk, so a dump taken during a build evaporates with the build.
  Closing this properly means a GitHub Actions workflow on a schedule, writing to
  object storage the shop controls, with the connection string in a repository
  secret. Until that exists, the backups are as good as the last person who
  remembered.
- **Dumps live wherever they were made.** There is no off-site copy and no
  retention policy.
- **Nothing alerts.** A failed backup is silent. So is a Neon incident.
- **The blast radius is unchanged.** `vercel-build` still applies
  `db/schema.sql` and `db/seed.sql` to production on every deploy. This document
  is a way to survive that, not a way to prevent it. Preventing it means either
  moving migrations out of the build, or gating them behind a review that a
  build cannot skip.
- **Preview deploys may share the production database.** If `DATABASE_URL` is
  not set separately for the Preview environment in Vercel, every pull request
  migrates production. Check it; see [C4](#c-a-deploy-broke-production).

---

## Reference

| | |
|---|---|
| `npm run backup` | Take a dump. Read-only; safe against production |
| `npm run restore -- --dump FILE` | Load one back. Refuses to land on live rows |
| `npm run verify:backup` | Prove the round trip on a throwaway database |
| `npm run db:setup` | Apply `db/schema.sql` then `db/seed.sql` |
| [`docs/DEPLOY.md`](DEPLOY.md) | Vercel and Neon setup, environment variables |
| [`docs/SECURITY.md`](SECURITY.md) | Where each control lives |
| [`scripts/backup-format.mjs`](../scripts/backup-format.mjs) | Why the dump looks the way it does |

Every command takes `--help`.
