-- Additive operations schema, included in fresh database setup; never run by build.
-- Requires a separately reviewed database-owner application and runtime grants.
-- No account, password, token, session secret or historical order is changed.

ALTER TABLE offers ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_email_identity ON orders (lower(btrim(email)));

CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  area TEXT NOT NULL,
  record_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_recent ON admin_audit(created_at DESC, id DESC);

-- Record only allowlisted business/access fields, never credentials, session
-- state, contact data or unrestricted row JSON. No SECURITY DEFINER.
CREATE OR REPLACE FUNCTION s7_record_admin_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  before_row jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  after_row jsonb := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  before_safe jsonb;
  after_safe jsonb;
  allowed text[];
BEGIN
  allowed := CASE TG_TABLE_NAME
    WHEN 'admins' THEN ARRAY['role','suspended_at']
    WHEN 'products' THEN ARRAY['price','compare_at','stock','active','featured','archived_at']
    ELSE ARRAY['code','active','discount_type','discount_value','min_total','max_uses','per_customer','first_order_only','starts_at','ends_at'] END;
  SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO before_safe FROM jsonb_each(before_row) WHERE key=ANY(allowed);
  SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO after_safe FROM jsonb_each(after_row) WHERE key=ANY(allowed);
  IF before_safe IS DISTINCT FROM after_safe THEN
    INSERT INTO admin_audit(area,record_id,actor,action,detail)
    VALUES (CASE WHEN TG_TABLE_NAME='admins' THEN 'accounts' ELSE TG_TABLE_NAME END,
      coalesce(after_row->>'id',before_row->>'id'),
      coalesce(nullif(current_setting('s7.audit_actor',true),''),'system:unattributed'),
      lower(TG_OP),jsonb_build_object('before',before_safe,'after',after_safe));
  END IF;
  RETURN coalesce(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS s7_admin_audit_products ON products;
CREATE TRIGGER s7_admin_audit_products AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION s7_record_admin_change();
DROP TRIGGER IF EXISTS s7_admin_audit_offers ON offers;
CREATE TRIGGER s7_admin_audit_offers AFTER INSERT OR UPDATE OR DELETE ON offers FOR EACH ROW EXECUTE FUNCTION s7_record_admin_change();
DROP TRIGGER IF EXISTS s7_admin_audit_accounts ON admins;
CREATE TRIGGER s7_admin_audit_accounts AFTER INSERT OR UPDATE OR DELETE ON admins FOR EACH ROW EXECUTE FUNCTION s7_record_admin_change();

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INT NOT NULL,
  sku TEXT NOT NULL,
  delta INT NOT NULL,
  balance INT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_product ON stock_movements(product_id,id DESC);

-- Audit all stock writers, including reserve, cancel, return and manual edits.
-- No SECURITY DEFINER: runtime must receive only SELECT/INSERT on this ledger.
CREATE OR REPLACE FUNCTION s7_record_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stock IS DISTINCT FROM OLD.stock THEN
    INSERT INTO stock_movements(product_id,sku,delta,balance,actor,reason)
    VALUES (NEW.id,NEW.sku,
      CASE WHEN TG_OP='INSERT' THEN NEW.stock ELSE NEW.stock-OLD.stock END,
      NEW.stock,
      COALESCE(NULLIF(current_setting('s7.audit_actor',true),''),'system:unattributed'),
      COALESCE(NULLIF(current_setting('s7.audit_reason',true),''),'stock-write'));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS s7_stock_movement ON products;
CREATE TRIGGER s7_stock_movement AFTER INSERT OR UPDATE OF stock ON products
FOR EACH ROW EXECUTE FUNCTION s7_record_stock_movement();

CREATE TABLE IF NOT EXISTS order_returns (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'requested'
    CHECK(state IN ('requested','approved','received','refunded','closed','rejected')),
  version INT NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT '',
  restocked BOOLEAN NOT NULL DEFAULT false,
  refund_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(refund_amount >= 0),
  refund_method TEXT NOT NULL DEFAULT '',
  refund_reference TEXT NOT NULL DEFAULT '',
  refunded_at TIMESTAMPTZ,
  actor TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_returns_order ON order_returns(order_id,id);
CREATE TABLE IF NOT EXISTS return_items (
  return_id INT NOT NULL REFERENCES order_returns(id),
  order_item_id INT NOT NULL REFERENCES order_items(id),
  qty SMALLINT NOT NULL CHECK(qty>0),
  PRIMARY KEY(return_id,order_item_id)
);

CREATE TABLE IF NOT EXISTS shipping_zones (
  code TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  fee NUMERIC(10,2) NOT NULL CHECK(fee>=0),
  free_over NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(free_over>=0),
  min_days INT NOT NULL CHECK(min_days>=0 AND min_days<=30),
  max_days INT NOT NULL CHECK(max_days>=min_days AND max_days<=30),
  active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 0
);
-- Initial zone values must be copied from the reviewed current production
-- delivery policy at application time, never guessed by a migration.

CREATE TABLE IF NOT EXISTS courier_settlements (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  courier TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  settled_on DATE NOT NULL,
  received NUMERIC(10,2) NOT NULL CHECK(received>=0),
  fees NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(fees>=0),
  notes TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settlement_orders (
  settlement_id INT NOT NULL REFERENCES courier_settlements(id),
  order_id INT NOT NULL REFERENCES orders(id),
  expected NUMERIC(10,2) NOT NULL CHECK(expected>=0),
  recorded_collected NUMERIC(10,2),
  PRIMARY KEY(settlement_id,order_id),
  UNIQUE(order_id)
);

-- Deliberately no GRANT statements here. The exact least-privilege diff and
-- release/rollback sequence must be approved before any hosted application.
-- STAR10 is not silently changed by this schema migration; campaign activation
-- is a separate reviewed business-setting write after the new enforcement ships.

-- V2 collection history: signed corrections preserve earlier cash periods.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS collection_seq INT NOT NULL DEFAULT 0 CHECK(collection_seq>=0);
CREATE TABLE IF NOT EXISTS collection_movements (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id INT NOT NULL REFERENCES orders(id),
 collection_seq INT NOT NULL CHECK(collection_seq>=0),
 kind TEXT NOT NULL CHECK(kind IN ('opening','recorded','corrected','cleared')),
 amount_delta NUMERIC(12,2) NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL,
 actor TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(order_id,collection_seq)
);
CREATE INDEX IF NOT EXISTS collection_movements_period ON collection_movements(occurred_at,order_id);
