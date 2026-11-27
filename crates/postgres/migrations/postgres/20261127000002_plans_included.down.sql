ALTER TABLE plans
  DROP COLUMN included_spans_gb,
  DROP COLUMN included_logs_gb,
  DROP COLUMN included_metrics_million;
