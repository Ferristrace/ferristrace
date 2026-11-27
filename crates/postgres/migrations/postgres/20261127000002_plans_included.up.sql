ALTER TABLE plans
  ADD COLUMN included_spans_gb integer,
  ADD COLUMN included_logs_gb integer,
  ADD COLUMN included_metrics_million integer;
