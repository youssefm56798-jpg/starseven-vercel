-- =====================================================================
--  NEW STAR SEVEN — Postgres schema (Neon)
--  Ported from the MySQL build. Run once:  npm run db:setup
--
--  Notes on the port:
--    AUTO_INCREMENT      -> GENERATED ALWAYS AS IDENTITY
--    ENUM(...)           -> TEXT + CHECK constraint (easier to extend later)
--    DATETIME            -> TIMESTAMPTZ (store UTC, render in Africa/Cairo)
--    ON DUPLICATE KEY    -> ON CONFLICT ... DO UPDATE
-- =====================================================================

CREATE TABLE IF NOT EXISTS admins (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku          TEXT NOT NULL UNIQUE,
  slug         TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL DEFAULT 'wax'
               CHECK (kind IN ('wax','gel','gelwax','cream','spray',
                               'cologne','shampoo','depilatory')),
  name_ar      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  sub_ar       TEXT NOT NULL DEFAULT '',
  sub_en       TEXT NOT NULL DEFAULT '',
  chip_ar      TEXT NOT NULL DEFAULT '',
  chip_en      TEXT NOT NULL DEFAULT '',
  price        NUMERIC(10,2) NOT NULL,
  compare_at   NUMERIC(10,2),
  color        TEXT NOT NULL DEFAULT '#D7291D',
  image        TEXT NOT NULL,
  size_ml      INT,
  hold_level   SMALLINT NOT NULL DEFAULT 3 CHECK (hold_level BETWEEN 1 AND 5),
  -- comma separated, in priority order: first = primary recommendation
  hair_types   TEXT NOT NULL DEFAULT '',
  stock        INT NOT NULL DEFAULT 100,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Shown on the home page. The home grid is a shortlist, not the catalogue:
  -- with 32 products live and more to come, listing everything there buries
  -- the products the brand actually leads with.
  featured     BOOLEAN NOT NULL DEFAULT FALSE,
  sort         SMALLINT NOT NULL DEFAULT 0,
  -- Long-form page content, all optional. Each is plain text rendered through
  -- lib/markdown.js; howto_* and highlights_* are one item per line.
  long_ar        TEXT NOT NULL DEFAULT '',
  long_en        TEXT NOT NULL DEFAULT '',
  howto_ar       TEXT NOT NULL DEFAULT '',
  howto_en       TEXT NOT NULL DEFAULT '',
  highlights_ar  TEXT NOT NULL DEFAULT '',
  highlights_en  TEXT NOT NULL DEFAULT '',
  -- The verbatim ingredient list, read off the printed pack. INCI names are
  -- Latin and read the same in both languages, so this is one field, not a
  -- bilingual pair. Empty for any product whose pack list has not been
  -- transcribed yet, and the page shows an honest note rather than a guess.
  ingredients    TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_live ON products (active, sort);

-- Added after the first release, so bring existing databases up to date too.
-- Every statement here is idempotent; db:setup re-runs the whole file safely.
ALTER TABLE products ADD COLUMN IF NOT EXISTS long_ar       TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS long_en       TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS howto_ar      TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS howto_en      TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS highlights_ar TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS highlights_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients   TEXT NOT NULL DEFAULT '';

-- The catalogue grew past wax and gel. Ovanza also makes a gel-wax hybrid, a
-- cream gel, a hair spray and a depilatory range, and an existing database
-- still carries the old three-value CHECK — which would reject every one of
-- them. Dropped and re-added rather than altered: Postgres has no
-- ALTER CONSTRAINT for a CHECK, and IF EXISTS keeps this safe to re-run.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check
  CHECK (kind IN ('wax','gel','gelwax','cream','spray',
                  'cologne','shampoo','depilatory'));

ALTER TABLE products ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;

-- The eight the shop launched with are the featured set, unless someone has
-- since chosen otherwise. Runs once: after any row is featured, the NOT EXISTS
-- guard stops it, so a selection made in the admin is never overwritten.
UPDATE products SET featured = TRUE
 WHERE sku IN ('S7-WAX-RED','S7-WAX-PUR','S7-WAX-BLU','S7-WAX-BLK',
               'S7-WAX-YEL','S7-GEL-YEL','S7-GEL-GRN','S7-GEL-BLU')
   AND NOT EXISTS (SELECT 1 FROM products WHERE featured = TRUE);

CREATE TABLE IF NOT EXISTS subscribers (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  lang         TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  hair_type    TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'site',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','active','unsubscribed','bounced')),
  token        TEXT NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscribers (status);
CREATE INDEX IF NOT EXISTS idx_subs_token  ON subscribers (token);

CREATE TABLE IF NOT EXISTS orders (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  lang        TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  subtotal    NUMERIC(10,2) NOT NULL DEFAULT 0,
  shipping    NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  coupon      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','confirmed','shipped','delivered','cancelled')),
  source      TEXT NOT NULL DEFAULT 'web',
  ip          TEXT NOT NULL DEFAULT '',
  -- Mandatory at checkout: it is how the customer gets back to this order.
  email       TEXT NOT NULL DEFAULT '',
  -- SHA-256 of the token in the confirmation email. The token is never stored.
  access_hash TEXT NOT NULL DEFAULT '',
  refund_requested_at TIMESTAMPTZ,
  refund_reason       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT,
  sku        TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  price      NUMERIC(10,2) NOT NULL,
  qty        SMALLINT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS offers (
  id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title_ar       TEXT NOT NULL,
  title_en       TEXT NOT NULL DEFAULT '',
  body_ar        TEXT NOT NULL,
  body_en        TEXT,
  code           TEXT NOT NULL DEFAULT '',
  discount_type  TEXT NOT NULL DEFAULT 'percent'
                 CHECK (discount_type IN ('percent','fixed','none')),
  discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_total      NUMERIC(10,2) NOT NULL DEFAULT 0,
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  sent_at        TIMESTAMPTZ,
  sent_count     INT NOT NULL DEFAULT 0,
  -- Redemption cap. NULL means unlimited, which is the historical behaviour and
  -- what a broadcast code without a stated limit gets. used_count is bumped
  -- inside the order write transaction, guarded on staying under max_uses, so a
  -- code cannot be spent past its cap even under concurrent checkout.
  max_uses       INT,
  used_count     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Added after the table shipped, so an existing database gets them here rather
-- than only on a fresh create. Both are non-destructive.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS max_uses   INT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS used_count INT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_code ON offers (code) WHERE code <> '';

CREATE TABLE IF NOT EXISTS articles (
  id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Unique per (slug, lang), not globally: an article and its translation are
  -- the same article and should share a slug, so /article/wax-or-gel and
  -- /en/article/wax-or-gel are the pair. A global unique forced the Arabic
  -- twin onto a '-ar' slug, which is why the language toggle could not
  -- switch between them: there was no shared key to switch on.
  slug          TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  group_key     TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL,
  excerpt       TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL,
  cover         TEXT NOT NULL DEFAULT '',
  cover_alt     TEXT NOT NULL DEFAULT '',
  meta_title    TEXT NOT NULL DEFAULT '',
  meta_desc     TEXT NOT NULL DEFAULT '',
  hair_type     TEXT NOT NULL DEFAULT '',
  sku           TEXT NOT NULL DEFAULT '',
  author        TEXT NOT NULL DEFAULT 'New Star Seven',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  views         INT NOT NULL DEFAULT 0,
  published_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_slug_lang ON articles (slug, lang);
CREATE INDEX IF NOT EXISTS idx_articles_live ON articles (status, lang, published_at DESC);

-- Existing databases were created with a global UNIQUE on slug and with the
-- Arabic rows on '-ar' slugs. Drop the old constraint and fold the twins back
-- onto a shared slug. Both statements are safe to re-run.
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_slug_key;

-- Fold the legacy '-ar' Arabic slugs onto the shared slug.
--
-- Written as one statement rather than a DELETE followed by an UPDATE: as two
-- statements each guarded by its own EXISTS, whether a row was deleted, renamed
-- or skipped depended on what the other had already done, and the pair reported
-- success while changing nothing.
--
-- Here the deletion is a CTE, so the UPDATE sees the table as it will be after
-- the duplicates are gone, and the two decisions are made against one snapshot.
WITH dupes AS (
  DELETE FROM articles a
   WHERE a.lang = 'ar'
     AND a.slug LIKE '%-ar'
     AND EXISTS (SELECT 1 FROM articles b
                  WHERE b.lang = 'ar'
                    AND b.slug = left(a.slug, length(a.slug) - 3))
  RETURNING a.id
)
UPDATE articles t
   SET slug = left(t.slug, length(t.slug) - 3)
 WHERE t.lang = 'ar'
   AND t.slug LIKE '%-ar'
   AND t.id NOT IN (SELECT id FROM dupes);

-- ---------------------------------------------------------------------------
--  Customer accounts, removed
--
--  The shop briefly had passwords, sessions and per-user carts. It does not
--  need them: this is a cash-on-delivery shop where the only thing a customer
--  ever wants to come back for is the status of one order, and an emailed link
--  does that without asking anyone to invent a password.
--
--  Dropped rather than left in place, because an unused users table is a
--  liability - it holds addresses and password hashes for an account system
--  nothing signs into any more.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS carts;
DROP TABLE IF EXISTS sessions;
ALTER TABLE orders DROP COLUMN IF EXISTS user_id;
DROP TABLE IF EXISTS users;

-- ---------------------------------------------------------------------------
--  Looking up your own order
--
--  Email is mandatory at checkout now, and the confirmation carries a link to
--  a page showing the order and its status.
--
--  access_hash is the SHA-256 of a random token. The token itself lives in
--  that one email and nowhere else - not in the database, not in a log - so a
--  dump of this table cannot be used to read any customer order. Same discipline
--  the session tokens used, for the same reason.
--
--  No expiry: a customer chasing a refund six weeks later still needs it, and
--  the token guards one order rather than an account.
-- ---------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_orders_access ON orders (access_hash);

-- ---------------------------------------------------------------------------
--  Order status, and the record of how it got there
--
--  Status used to be written by one screen, with a plain UPDATE. It is about
--  to be written by three — the admin panel, a customer cancelling their own
--  order, and a courier webhook — and a column three callers each write
--  however they like is how a state machine rots. So lib/order-status.js
--  becomes the only writer, the legal moves live in one table there, and every
--  move it makes lands here as a row.
--
--  This is two things at once and that is deliberate: the timeline a customer
--  sees on their order page, and the audit log the shop needs when someone
--  asks why an order was cancelled. One source, so the two cannot disagree.
--
--  `actor` is free text rather than a foreign key because the three writers do
--  not share an identity space: 'admin:4', 'customer', 'system'. A key would
--  have to point at whichever table won.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_events (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'status'
              CHECK (kind IN ('status','note','refund-request','mail')),
  from_status TEXT NOT NULL DEFAULT '',
  to_status   TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT 'system',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The timeline reads one order oldest-first; the audit view reads recent
-- events across all orders. Both are covered by leading on order_id and id.
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id, id);

-- When the cancel happened, as opposed to when the row was created. Read by
-- the order page, and the only way to tell a cancelled-today order from one
-- cancelled in March without walking the event log.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS quiz_results (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hair_type   TEXT NOT NULL,
  concern     TEXT NOT NULL DEFAULT '',
  sku         TEXT NOT NULL DEFAULT '',
  lang        TEXT NOT NULL DEFAULT 'ar',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_hair ON quiz_results (hair_type, created_at DESC);

CREATE TABLE IF NOT EXISTS email_log (
  id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fixed-window rate limiter, same approach as the PHP build.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT NOT NULL,
  ip           TEXT NOT NULL,
  hits         INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, ip)
);



-- ---------------------------------------------------------------------------
--  Indexes for the queries that grow
--
--  Two indexes, both written against one statement that is already in the code
--  and both measured before being kept. An index nobody asked for is not free:
--  orders is written on every checkout and again on every status move, so every
--  index on it is paid for at the till.
--
--  Measured means scripts/verify-indexes.mjs, which builds a throwaway database
--  with two hundred thousand orders in it and prints the plan with and without
--  each one. Three further indexes were written, measured and then deleted
--  because the numbers said they did nothing. What they were and why they did
--  nothing is recorded below and in that script, so the next person to have the
--  same good idea can read the answer instead of doing the work again.
-- ---------------------------------------------------------------------------

-- Serves the search box on app/admin/(panel)/orders/page.js:
--     ... WHERE (ref || ' ' || name || ' ' || phone) ILIKE $1 ...
--
-- 146 ms to 0.97 ms on 200k orders, and the gap widens with the table, because
-- what it replaces is a sequential scan of every order in the shop. A leading %
-- gives a btree no prefix to seek on, so no ordinary index could help however
-- the three columns were arranged. It is the one read here that gets slower in
-- exact proportion to the shop doing well, and it runs every time somebody
-- rings up about an order.
--
-- pg_trgm indexes the three-character substrings of a value, which is what LIKE
-- and ILIKE are actually looking for, and gin_trgm_ops covers both. One index
-- over the three columns concatenated rather than three separate ones: the
-- screen always searches all three together, three indexes would be three
-- writes per order to answer one question, and a BitmapOr across three GIN
-- scans is slower than one scan of one. A GIN index can only be used by a
-- predicate whose left-hand side is exactly the expression it was built on,
-- which is why the page had to stop writing the search as three ORs.
--
-- The space in the join earns its place twice: it stops a reference running
-- into a name and matching across the seam by accident, and it lets somebody
-- type a name and a phone number into one box and have that match.
--
-- Two things this cannot do, both fine. A search shorter than three characters
-- has no whole trigram to look up and falls back to a scan; 200 rows is a
-- sensible answer to a one-letter search anyway. And the three columns are all
-- NOT NULL, so the concatenation can never collapse to NULL and lose a row.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_orders_search
    ON orders USING gin ((ref || ' ' || name || ' ' || phone) gin_trgm_ops);

-- Serves the two date-bounded KPIs in app/admin/(panel)/page.js - orders today
-- and revenue this month. 177 ms to 0.08 ms and 213 ms to 8.5 ms on 200k rows.
--
-- Both were written as an equality on a converted value:
--     WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date = <today in Cairo>
-- which reads correctly and can never use an index, because the thing being
-- compared has to be computed for every row before it can be compared at all.
-- Nor can it be rescued with an expression index: converting a timestamptz into
-- a named zone is STABLE rather than IMMUTABLE - the answer depends on the
-- timezone database, which is allowed to change - and Postgres will not index a
-- function that may change its mind. So the dashboard scanned the whole orders
-- table twice on every load, and this index only becomes usable once both KPIs
-- are rewritten as a half-open range on the raw column. They have been.
--
-- A BRIN index would be the textbook choice for an append-only timestamp and
-- would cost a fraction of the space. Not here: status is indexed, so every
-- status move is a non-HOT update that writes the row to the end of the heap,
-- and BRIN is only fast while physical order still tracks time. It would look
-- excellent on a freshly loaded table and decay in production, which is the
-- worst way for an index to be wrong.
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);

-- ---------------------------------------------------------------------------
--  Three indexes that were written and then thrown away
--
--  All three read as obviously right and measured at 1.0x. Recorded here rather
--  than silently omitted, because each one is a mistake that is easy to make
--  twice.
--
--  orders (status, id DESC), for the status filter on the orders screen. The
--  screen asks for 200 rows and the primary key is already in id order, so
--  Postgres reads the primary key backwards and discards the rows that do not
--  match the status. Two hundred matches turn up long before that walk gets
--  expensive, whichever status is chosen - even cancelled, which is a small
--  share of the table and absent from the newest rows. Measured at 1.0x, 1.0x
--  and 1.5x across three statuses. This would change if the screen ever grew
--  pagination deep enough that the LIMIT stopped saving it.
--
--  subscribers (status, id), for the broadcast cursor and the subscriber list.
--  Same reason, same 1.0x. The broadcast reads WHERE status = active AND id >
--  cursor, and nine subscribers in ten are active, so walking the primary key
--  from the cursor finds a batch almost immediately.
--
--  quiz_results (created_at, hair_type), replacing (hair_type, created_at
--  DESC). The dashboard filters on created_at and groups by hair_type, so the
--  existing index looks like the wrong way round and the swap looks free. It is
--  not free - it is an index rebuild on a deploy - and it is worth nothing:
--  Postgres reaches the range through the existing index with a skip scan, and
--  what the query actually costs is the heap fetch for the count, which neither
--  index avoids.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  Admin sessions that can be killed, and a second factor
--
--  Two separate problems, one table, so they are described together.
--
--  session_epoch is the answer to a stolen admin cookie. The session is a
--  signed JWT with an eight-hour life and nothing on the server to check it
--  against, which means that until this column existed there was no way to end
--  one early - not by changing the password, not by anything. The token now
--  carries the epoch it was minted under and the verifier refuses any token
--  whose epoch is not the current one, so bumping this column by one
--  invalidates every session that admin holds, everywhere, at once. An integer
--  rather than a timestamp because the only question ever asked of it is
--  whether two values are equal, and a counter cannot be confused by a clock.
--
--  The TOTP columns are the second factor. totp_secret holds the shared secret
--  ENCRYPTED, not in the clear - see lib/totp.js. A password hash is useless to
--  somebody holding a database dump; a plaintext TOTP secret is not, and the
--  whole point of the second factor is that stealing the first one is not
--  enough. totp_pending holds a secret that has been generated but not yet
--  proved, so an enrolment that is abandoned halfway cannot lock anyone out.
--
--  totp_last_step is replay protection. A code is valid for a thirty-second
--  step and for one step either side of it, so a code read over a shoulder or
--  out of a phishing page is usable for up to ninety seconds.
--  Recording the step that was accepted and refusing anything at or below it
--  closes that window to the single use it was meant to have.
-- ---------------------------------------------------------------------------
ALTER TABLE admins ADD COLUMN IF NOT EXISTS session_epoch  INT NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret    TEXT NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_pending   TEXT NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
--  Recovery codes
--
--  The way back in when the phone is gone. Ten codes, shown once at enrolment
--  and never again.
--
--  Stored as a SHA-256 digest, exactly as orders.access_hash is, and for the
--  same reason: a dump of this table must not be a way in. Hashed with SHA-256
--  rather than bcrypt on purpose. bcrypt is slow so that guessing a
--  human-chosen password is slow, and that cost only buys anything when the
--  secret is guessable. These are fifty bits of machine-generated randomness,
--  where guessing is not on the table - and the slowness would have to be paid
--  ten times over on every attempt, because verification has to compare against
--  every unused code. A digest lookup is one indexed read instead.
--
--  used_at rather than a delete, so that a used code stays in the table and can
--  never be re-issued by chance, and so that the panel can honestly say how
--  many are left. Single use is enforced by the UPDATE that claims it, not by
--  a read followed by a write: WHERE used_at IS NULL means two requests racing
--  on the same code cannot both win.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id   INT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The lookup at sign-in is by digest alone, and a digest belongs to one code.
-- Unique so a collision is a constraint violation rather than two admins
-- sharing a way in.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_hash  ON admin_recovery_codes (code_hash);
-- Serves the count on the security screen and the delete-and-reissue that
-- regenerating a set does, both of which read every row for one admin.
CREATE INDEX IF NOT EXISTS idx_recovery_admin ON admin_recovery_codes (admin_id, used_at);
