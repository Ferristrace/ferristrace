CREATE TABLE billing_subscriptions (
    org_id uuid PRIMARY KEY REFERENCES orgs (id) ON DELETE CASCADE,
    stripe_customer_id text NOT NULL UNIQUE,
    stripe_subscription_id text UNIQUE,
    status text,
    period_end bigint,
    created_at bigint NOT NULL DEFAULT ((extract(epoch FROM clock_timestamp()) * 1000000000)::bigint)
);
