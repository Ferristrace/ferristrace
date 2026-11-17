ALTER TABLE plans ADD COLUMN stripe_price_id text UNIQUE;

INSERT INTO plans (id, slug, name, ingest_gb, retention_days, max_members, features)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'free',
    'Free',
    30,
    7,
    NULL,
    '{}'
);

INSERT INTO plans (id, slug, name, ingest_gb, retention_days, max_members, features)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    'pro',
    'Pro',
    100,
    30,
    NULL,
    '{overage}'
);
