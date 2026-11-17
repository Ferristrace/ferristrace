CREATE TABLE usage_hourly_project (
    org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    hour_start bigint NOT NULL,
    spans_bytes bigint NOT NULL CHECK (spans_bytes >= 0),
    logs_bytes bigint NOT NULL CHECK (logs_bytes >= 0),
    metrics_points bigint NOT NULL CHECK (metrics_points >= 0),
    PRIMARY KEY (org_id, project_id, hour_start)
);

CREATE INDEX usage_hourly_project_by_hour ON usage_hourly_project (org_id, hour_start);
