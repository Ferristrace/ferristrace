ALTER TABLE orgs ADD COLUMN slug text;

CREATE OR REPLACE FUNCTION orgs_ensure_slug() RETURNS trigger AS $$
DECLARE
    base text;
    candidate text;
    short_id text;
BEGIN
    IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
        RETURN NEW;
    END IF;
    short_id := lower(substring(replace(NEW.id::text, '-', ''), 1, 8));
    base := trim(both '-' FROM regexp_replace(lower(NEW.name), '[^a-z0-9]+', '-', 'g'));
    base := left(base, 36);
    base := trim(both '-' FROM base);
    IF length(base) < 3 OR base IN ('confirm', 'unsubscribe') THEN
        base := 'org-' || short_id;
    END IF;
    candidate := base;
    IF EXISTS (SELECT 1 FROM orgs WHERE slug = candidate AND id <> NEW.id) THEN
        candidate := left(base, 39) || '-' || short_id;
    END IF;
    NEW.slug := candidate;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orgs_ensure_slug_trigger
BEFORE INSERT OR UPDATE OF name, slug ON orgs
FOR EACH ROW EXECUTE FUNCTION orgs_ensure_slug();

UPDATE orgs SET slug = NULL WHERE slug IS NULL;

ALTER TABLE orgs
    ALTER COLUMN slug SET NOT NULL,
    ADD CONSTRAINT orgs_slug_key UNIQUE (slug),
    ADD CONSTRAINT orgs_slug_check CHECK (slug ~ '^[a-z0-9-]{3,48}$');

ALTER TABLE status_pages DROP CONSTRAINT status_pages_slug_key;
ALTER TABLE status_pages ADD CONSTRAINT status_pages_org_slug_key UNIQUE (org_id, slug);
