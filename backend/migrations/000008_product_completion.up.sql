ALTER TABLE providers
 ADD COLUMN slug varchar(80),
 ADD COLUMN headline varchar(160) NOT NULL DEFAULT '',
 ADD COLUMN bio varchar(2000) NOT NULL DEFAULT '',
 ADD COLUMN avatar_url varchar(2048) NOT NULL DEFAULT '',
 ADD COLUMN location varchar(160) NOT NULL DEFAULT '';

-- Existing public names are preserved; UUID suffixes make backfill collision-free.
UPDATE providers SET slug = coalesce(nullif(trim(both '-' FROM left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),40)), ''), 'provider') || '-' || replace(id::text,'-','');
ALTER TABLE providers ALTER COLUMN slug SET NOT NULL;
ALTER TABLE providers ADD CONSTRAINT providers_slug_unique UNIQUE(slug);
ALTER TABLE providers ADD CONSTRAINT providers_slug_valid CHECK (
 length(slug) BETWEEN 3 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 AND slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 AND slug NOT IN ('api','auth','admin','www','app','public','providers','packages','passes','discover','health','new','settings','support','login','logout'));

-- Protect stable links, including writes outside the HTTP application. Also
-- support legacy inserts that omit the new field during rolling upgrades.
CREATE FUNCTION providers_stable_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' AND NEW.slug IS NULL THEN
  NEW.slug := coalesce(nullif(trim(both '-' FROM left(regexp_replace(lower(NEW.name), '[^a-z0-9]+', '-', 'g'),40)), ''), 'provider') || '-' || replace(NEW.id::text,'-','');
 ELSIF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
  RAISE EXCEPTION 'provider slug is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER providers_stable_slug BEFORE INSERT OR UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION providers_stable_slug();

CREATE TABLE service_categories (slug varchar(24) PRIMARY KEY);
INSERT INTO service_categories(slug) VALUES
 ('fitness'),('tutoring'),('languages'),('coaching'),('wellness'),('music'),('beauty'),('consulting'),('mentoring');
ALTER TABLE services ADD COLUMN category varchar(24) REFERENCES service_categories(slug);
CREATE INDEX services_category_idx ON services(category, id);
CREATE INDEX passes_customer_page_idx ON passes(created_at DESC, id DESC);

CREATE TABLE rate_limit_buckets (
 key_digest bytea PRIMARY KEY CHECK (length(key_digest)=32),
 attempts integer NOT NULL CHECK (attempts>0),
 resets_at timestamptz NOT NULL
);
CREATE INDEX rate_limit_buckets_expiry_idx ON rate_limit_buckets(resets_at);
ALTER TABLE payment_candidates ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count>=0);

CREATE TABLE auth_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 challenge_id uuid REFERENCES auth_challenges(id),
 kind varchar(24) NOT NULL CHECK (kind IN ('LOGIN_SUCCEEDED','PROOF_FAILED')),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_challenge_idx ON auth_events(challenge_id,id);
