CREATE TABLE status_component_events (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    component_id uuid NOT NULL REFERENCES status_components (id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('operational', 'degraded', 'down')),
    at_ms bigint NOT NULL
);

CREATE INDEX status_component_events_by_component
    ON status_component_events (component_id, at_ms, seq);

INSERT INTO status_component_events (component_id, status, at_ms)
SELECT c.id, COALESCE(c.manual_status, 'operational'), p.created_ms
FROM status_components c
JOIN status_pages p ON p.id = c.page_id
WHERE c.link_kind = 'manual';
