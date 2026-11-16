DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dashboards) THEN
        RAISE EXCEPTION 'the old dashboards table holds rows; move or delete them before this migration';
    END IF;
END $$;

DROP TABLE dashboards;

CREATE TABLE dashboards (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name text NOT NULL,
    tags jsonb NOT NULL DEFAULT '[]',
    doc jsonb NOT NULL,
    schema_version integer NOT NULL,
    updated_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
    created_at bigint NOT NULL DEFAULT ((extract(epoch FROM clock_timestamp()) * 1000000000)::bigint),
    updated_at bigint NOT NULL DEFAULT ((extract(epoch FROM clock_timestamp()) * 1000000000)::bigint),
    UNIQUE (project_id, name)
);

CREATE INDEX dashboards_by_org ON dashboards (org_id);
