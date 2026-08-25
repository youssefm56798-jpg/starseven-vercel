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
               CHECK (kind IN ('wax','gel','cream','shampoo','cologne')),
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
  sort         SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_live ON products (active, sort);

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
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_code ON offers (code) WHERE code <> '';

CREATE TABLE IF NOT EXISTS articles (
  id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
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
CREATE INDEX IF NOT EXISTS idx_articles_live ON articles (status, lang, published_at DESC);

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
