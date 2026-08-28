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



