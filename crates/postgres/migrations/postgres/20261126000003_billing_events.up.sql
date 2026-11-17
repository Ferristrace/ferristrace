CREATE TABLE billing_events (
    event_id text PRIMARY KEY,
    received_at bigint NOT NULL DEFAULT ((extract(epoch FROM clock_timestamp()) * 1000000000)::bigint)
);
