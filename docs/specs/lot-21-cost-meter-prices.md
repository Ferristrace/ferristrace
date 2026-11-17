# Lot 21: the cost meter in money, per signal and per project

Goal
  The Cost meter page of design concept 3 (board "Cost") shows what the
  organisation owes this month, what it will owe at month end, what the
  plan includes per signal, and which project spends it. Prices come from
  the server configuration, set by whoever runs the server; a server with
  no prices shows the same page in volumes.

Context
  Lot 15 and ADR 0037 meter each organisation per hour and per signal:
  spans and logs in decompressed bytes, metrics in datapoints, in Redis
  then `usage_hourly`. The project of a payload is known at ingest (the
  API key resolves to a project) and dropped. No price exists anywhere;
  the only allowance is `plans.ingest_gb`, one figure in bytes, read by
  the quota. Decided with the maintainer on 2026-11-17: prices and
  allowances per signal in the server config, a split per project, no
  budget.
  Decision: [ADR 0038](../adr/0038-prices-live-in-the-server-config-and-projects-in-the-hourly-hash.md).

Out of scope
  - A budget per organisation and the "budget pace" line.
  - Invoices, payment, "Download invoice", the Settings Billing page.
  - Prices an organisation edits itself.
  - Changing the quota: it keeps reading the monthly total and
    `plans.ingest_gb`.

Decisions
  P1  Config. A `[billing]` section, absent by default:
        currency                 ISO 4217 code, display only ("EUR")
        spans_gb_micros          price of 1 GB (10^9 bytes) of spans
        logs_gb_micros           price of 1 GB of logs
        metrics_million_micros   price of 10^6 datapoints
        included_spans_gb        allowance per month, default 0
        included_logs_gb
        included_metrics_million
      Env: FERRISTRACE_BILLING__SPANS_GB_MICROS and so on. Micros are
      millionths of the currency unit, integers (as `model_prices`).
      Absent section: no pricing, the API returns `pricing: null`.
      A currency that is not three ASCII letters fails the start.
  P2  Money. Value of a volume = round_half_up(volume x price / unit),
      unit 10^9 bytes or 10^6 points, per signal, in micros, computed in
      u128 then saturated to u64. The bill of a window, per signal:
        value     = value(used)
        billable  = value(max(0, used - included))
      Totals are the sum of the three signals. Hours without a split
      (before lot 15) count for nothing in money.
  P3  Projection. When now is inside the window, a signal's projected
      volume = used x window_length / elapsed (elapsed at least one hour);
      otherwise projected = used. Projected value and projected billable
      apply P2 to it. The date an allowance is passed at this pace =
      window start + included / used x elapsed, if inside the window.
  P4  Per project at ingest. `UsageMeter::record_ingest` takes the
      payload's `Option<ProjectId>`. Redis keeps, in the same hourly hash,
      the field `<signal>` (unchanged) and, when the project is known,
      `<signal>@<project uuid>`. The hourly rollup writes the project
      fields to a new table:
        usage_hourly_project(org_id uuid FK orgs ON DELETE CASCADE,
          project_id uuid, hour_start bigint, spans_bytes bigint,
          logs_bytes bigint, metrics_points bigint,
          PRIMARY KEY (org_id, project_id, hour_start))
      No foreign key on the project: a deleted project keeps its history
      and shows as "Deleted project". Volume without a project (static
      dev keys) is the org split minus the project rows, shown as
      "No project".
  P5  History. `ferristrace backfill-usage` also fills
      `usage_hourly_project`, only for hours that have a rolled-up org
      row with a split and no project row. Each project gets the hour's
      metered split apportioned by its share of the stored ClickHouse
      volume of that hour (`project_id` of spans, logs, metric_points,
      metric_histograms), per signal, rounded down; the rest is
      "No project". Same caveat as ADR 0037.
  P6  API. `GET /api/orgs/{org}/usage?from&to` keeps every field and adds:
        pricing: null | {
          currency: "EUR",
          spans_gb_micros, logs_gb_micros, metrics_million_micros,
          included: { spans_bytes, logs_bytes, metrics_points } }
        bill: null | {                       (null when pricing is null)
          value_micros, billable_micros,
          projected_value_micros, projected_billable_micros,
          by_signal: { spans|logs|metrics: {
            used, included, projected, value_micros, billable_micros,
            projected_billable_micros, passes_at_ms: number|null } } }
        projects: [ {
          project: uuid | null, name: string | null,   (null = no project)
          spans_bytes, logs_bytes, metrics_points,
          days: [ { day_ms, spans_bytes, logs_bytes, metrics_points } ] } ]
      `days` are UTC days of the window, only days with volume. `name` is
      null for "No project" and "Deleted project" (project set, name
      null). Members may read it, as today.
  P7  Page (/cost, URL unchanged), board "Cost":
      - head: "Cost meter", a "November, day 17 of 30" pill, period
        (this month, last month) and Project (all, each project).
      - tiles: Spend to date (billable, and "+n % vs the same days of
        last month"), Projected bill (projected billable, "renews Dec 1"),
        the allowance most used ("Logs included 59 %", warn from 80 %,
        error from 100 %, "passes it Nov 26"), Usage value (value, "x
        covered by what is included").
      - panels: cumulative spend this month with its projection dashed
        to month end; spend by signal donut with the total in the centre;
        spend per day by signal, stacked bars; usage against what is
        included, one quota bar per signal with "on pace for x"; spend by
        project table (search, sortable headers, pager, per-day mini
        bars, vs last month).
      - a project picked: tiles and charts show that project's value; the
        allowance is the organisation's, so billable and the quota bars
        are hidden for a single project.
      - no pricing: the same layout in volumes (GB, datapoints), no money
        tile, a note that the server has no prices configured.

Invariants
  - Σ project rows + "No project" = the org split, per hour, for hours
    metered after this lot. [test: rollup]
  - The quota and the monthly total key do not change. [test: existing]
  - Money is integer micros end to end; the web formats, never rounds
    differently from P2 (same test vectors in Rust and TS). [test]

Acceptance
  @spec-l21-1  config with and without `[billing]`; bad currency refused
  @spec-l21-2  P2 value and billable, rounding, saturation, unsplit hours
  @spec-l21-3  P3 projection and passes_at
  @spec-l21-4  ingest records the project field; rollup writes
               usage_hourly_project; sums agree
  @spec-l21-5  backfill fills project rows only where missing
  @spec-l21-6  API shape of P6 with and without pricing
  @spec-l21-7  page of P7 in money, in volumes, and for one project

Workstreams
  21a Server: config, domain pricing and bill, meter port + Redis,
      migration, rollup, backfill, API, ADR 0038. Owns crates/, apps/,
      migrations, docs/adr.
  21b Web: Cost page on the P6 contract, money formatting and pure maths
      with tests. Owns web/src/pages/Cost.tsx, web/src/pages/cost/,
      web/src/data/usage.ts (additive), web/tests/.

Verify (exit)
  cargo fmt --check; clippy -D warnings; cargo test on domain,
  application, api, postgres, redis; cd web && pnpm typecheck && pnpm test
  && pnpm build; the local stack with a `[billing]` section, looked at
  in light and dark at 1440 and 390.
