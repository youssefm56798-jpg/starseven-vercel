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
--
--  One order can hold several live links now - see order_tokens further down,
--  which is where every new one is written. access_hash is still filled at
--  checkout and still read, and both are deliberate: a deploy that had to be
--  rolled back would otherwise strand every order placed while the new code
--  was live, and the schema is applied at build time, before the old code
--  stops serving. The column goes when no deployment that reads it can come
--  back.
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

-- ---------------------------------------------------------------------------
--  The links into one order
--
--  orders.access_hash holds the SHA-256 of exactly one token: the one in the
--  confirmation email. One digest per order opens the order and does nothing
--  else, and two things it could not do had both become expensive.
--
--    A status email could not link to the order. At the moment an order ships
--    there is no token to build a URL from - only a digest - and writing a
--    fresh one into that column would silently kill the link already sitting
--    in the inbox of the customer. So four emails went out saying an order had
--    moved and none of them could say where to look.
--
--    Losing the email was a dead end. Nothing could be re-sent, because there
--    was nothing left to re-send.
--
--  A row per link answers both, and it does so by adding rather than
--  replacing: every link handed out so far keeps working, because minting a
--  new one does not touch the old row. The discipline is unchanged - the token
--  lives in one email and nowhere else, and this table holds its digest.
--
--  purpose is a label for whoever is reading the table later, never a
--  permission. Every live row opens the same single order, so nothing branches
--  on it; it is here so that "where did this link come from" has an answer.
--
--  expires_at is NULL for the links a customer is meant to keep, and that is
--  the original decision restated rather than a new one: somebody chasing a
--  refund six weeks later still needs the link, and a token that grants one
--  order rather than an identity is not a session. The recovery link from
--  /order/find is the single exception and carries a date. Not because it
--  travels less safely - it lands in the same mailbox the confirmation did -
--  but because it is the only token a stranger can cause to be minted, and the
--  only one whose loss costs the customer nothing, since the page that made it
--  will make another on request. An unbounded pile of credentials that nobody
--  asked for is avoidable there and nowhere else.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_tokens (
  id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- SHA-256 of the token, hex. The token itself is never written, here or
  -- anywhere else. Same rule access_hash has always followed.
  token_hash TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'checkout'
             CHECK (purpose IN ('checkout','status-mail','recovery')),
  -- NULL means no expiry. See the note above for which links get one.
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Unique rather than plain, on two counts. The lookup is by digest and has to
-- answer in one row without an ORDER BY to make it deterministic, and a mint
-- that somehow replayed cannot then leave two rows for one token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_tokens_hash ON order_tokens (token_hash);
-- For reading the links of one order, which is what an admin looking at a
-- support call wants.
CREATE INDEX IF NOT EXISTS idx_order_tokens_order ON order_tokens (order_id, id);

-- Every link handed out before this table existed, moved in without being
-- reissued. The customer keeps the email they already have: the digest is the
-- same value, it just lives in a row now instead of a column.
--
-- Idempotent twice over, because db:setup re-runs this whole file on every
-- deploy. NOT EXISTS makes the second run a no-op. DISTINCT ON is insurance
-- against two orders carrying the same digest - which 32 random bytes make
-- absurd, but the unique index above would answer it by aborting the deploy
-- rather than by skipping a row, and a schema file must never be able to do
-- that.
INSERT INTO order_tokens (order_id, token_hash, purpose, created_at)
SELECT DISTINCT ON (o.access_hash)
       o.id, o.access_hash, 'checkout'::text, o.created_at
  FROM orders o
 WHERE o.access_hash <> ''
   AND NOT EXISTS (SELECT 1 FROM order_tokens t WHERE t.token_hash = o.access_hash)
 ORDER BY o.access_hash, o.id;

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



