CREATE TABLE status_maintenances (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    title text NOT NULL,
    details text,
    starts_ms bigint NOT NULL,
    ends_ms bigint NOT NULL,
    closure text,
    closed_ms bigint,
    created_ms bigint NOT NULL,
    updated_ms bigint NOT NULL,
    CONSTRAINT status_maintenances_window_is_forward CHECK (ends_ms > starts_ms),
    CONSTRAINT status_maintenances_closure_is_known CHECK (closure IN ('ended', 'cancelled')),
    CONSTRAINT status_maintenances_closure_is_dated CHECK ((closure IS NULL) = (closed_ms IS NULL))
);

CREATE INDEX status_maintenances_by_org ON status_maintenances (org_id, ends_ms);

CREATE TABLE status_maintenance_components (
    maintenance_id uuid NOT NULL REFERENCES status_maintenances (id) ON DELETE CASCADE,
    component_id uuid NOT NULL REFERENCES status_components (id) ON DELETE CASCADE,
    position integer NOT NULL,
    PRIMARY KEY (maintenance_id, component_id)
);
