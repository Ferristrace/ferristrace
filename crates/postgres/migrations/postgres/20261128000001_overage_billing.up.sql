ALTER TABLE plans
    ADD COLUMN overage_price_ref text,
    ADD COLUMN overage_grace_gb integer NOT NULL DEFAULT 0,
    ADD COLUMN overage_cap_gb integer;

ALTER TABLE usage_hourly
    ADD COLUMN overage_reported_bytes bigint;
