CREATE TABLE billing_subscriptions (
    org_id uuid PRIMARY KEY REFERENCES orgs (id) ON DELETE CASCADE,
    customer_ref text NOT NULL UNIQUE,
    subscription_ref text,
    status text,
    period_end bigint,
    event_at bigint NOT NULL DEFAULT 0,
    created_at bigint NOT NULL DEFAULT ((extract(epoch FROM clock_timestamp()) * 1000000000)::bigint)
);
