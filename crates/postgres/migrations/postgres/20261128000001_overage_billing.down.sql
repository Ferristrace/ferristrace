ALTER TABLE usage_hourly
    DROP COLUMN overage_reported_bytes;

ALTER TABLE plans
    DROP COLUMN overage_cap_gb,
    DROP COLUMN overage_grace_gb,
    DROP COLUMN overage_price_ref;
