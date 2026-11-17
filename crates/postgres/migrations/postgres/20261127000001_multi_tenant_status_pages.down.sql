ALTER TABLE status_pages DROP CONSTRAINT status_pages_org_slug_key;
ALTER TABLE status_pages ADD CONSTRAINT status_pages_slug_key UNIQUE (slug);

DROP TRIGGER IF EXISTS orgs_ensure_slug_trigger ON orgs;
DROP FUNCTION IF EXISTS orgs_ensure_slug();

ALTER TABLE orgs DROP COLUMN slug;
