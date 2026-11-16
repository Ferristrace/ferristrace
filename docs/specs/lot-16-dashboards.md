# Lot 16: dashboards

Goal
  A member builds a dashboard of panels over traces, logs and metrics from
  the interface, shares it with the project, and reads it with a time range
  and variables. Eleven panel types, a hover tooltip that lists every series
  at the pointer, and a click that opens the matching traces or logs.

Context
  Today the interface has fixed pages: Overview, Services, Logs, Traces,
  Metrics (an explorer over one metric, with `MetricChart` and its
  tooltip), Infra, Cost. Nothing is composable. A team that wants p95 per
  service next to the error count next to node memory has no place to put
  it. SigNoz offers this and it is the feature people ask about.
  Filters already have a language, used by Logs and Traces
  (`service = checkout AND http.status_code >= 500`, `query_body.rs`).
  Every signal reader is scoped by organisation and project.

Decisions
  D1  All eleven SigNoz panel types: time series, area, bar, pie, scatter,
      histogram, heatmap, number, table, list, text.
  D2  A panel queries traces, logs or metrics through a query builder:
      signal, aggregations, filter, group by, order, limit. No free SQL:
      a free query cannot be scoped to one organisation.
  D3  A dashboard is a JSON document in Postgres, versioned by
      `schema_version`, owned by a project. Any member of the project reads
      and edits it. A key with the `read` scope reads it (API, MCP).
  D4  One lot, delivered as four PRs (16a to 16d, below). Each PR leaves
      the product working.
  D5  Own schema, not the Perses one SigNoz uses: ours is a quarter of its
      size and maps to our readers. Export and import move the same JSON.

Glossary
  Dashboard   a named document of panels, a layout and variables, owned by
              a project.
  Panel       one visualisation and the queries that feed it.
  Variable    a named list of values a panel filter can use as `$name`.

Invariants
  - A query never reads another organisation's rows, or another project's
    when the dashboard is bound to a project.  [type: `Scope` is a
    required argument of the query port]
  - A panel query is bounded: at most 50 series, 500 points per series, 10
    s, 1 000 rows for table and list.  [test]
  - A dashboard document is at most 256 KB, 30 panels, 20 variables. A
    project holds at most 100 dashboards.  [type: `Dashboard::new` returns
    `Result`]
  - A document with an unknown `schema_version` is refused, never guessed.
    [type: enum with no catch-all]
  - A panel kind and its query result shape agree (a number panel gets a
    scalar). [type: `PanelKind::result_shape`]
  - `$name` in a filter is replaced by escaped values, never concatenated.
    [type: `FilterValue` is not a string]
  - Deleting a project deletes its dashboards.  [test: foreign key]

Out of scope
  - Free SQL or PromQL panels.
  - Alerts on a panel (alerts keep their own rules).
  - Per-dashboard permissions finer than the project.
  - Public or anonymous dashboards (the status page stays the public
    surface).
  - Version history and restore of a dashboard.
  - Annotations other than release markers.
  - Embedding a dashboard in another site.

Design
  Domain (`crates/domain/src/dashboard`)
    Dashboard { id, project, name, tags, doc: DashboardDoc, updated_by,
      updated_at }
    DashboardDoc { schema_version, variables, panels, layout, duration }
    Panel { id: PanelId, title, description, kind: PanelKind, queries,
      options: PanelOptions }
    PanelKind: TimeSeries | Area | Bar | Pie | Scatter | Histogram |
      Heatmap | Number | Table | List | Text
    ResultShape: Series | Scalar | Rows | Buckets | Heat | Pairs | None
    PanelQuery { name, signal: Traces | Logs | Metrics, aggregations,
      filter: Filter, group_by (max 3), order, limit, step: Auto | Fixed }
    Aggregation (traces, logs): Count | CountDistinct(field) | Sum | Avg |
      Min | Max | P50 | P90 | P95 | P99 | Rate, each over a field.
    Aggregation (metrics): { metric, time: Avg | Sum | Min | Max | Rate |
      Increase, space: Sum | Avg | Min | Max | Count }
    Variable { name, label, source: Attribute{signal, key} | Static{values},
      multi, all }
    Layout: items of { panel, x, y, w, h } on 12 columns.

  Ports (owner: domain)
    DashboardStore   list, get, create, update, delete, per project
                     (generic, one adapter)
    PanelQuery       `run(scope, query, range, variables) -> PanelResult`
                     one implementation per signal behind an enum:
                     `SignalQuery::{Traces, Logs, Metrics}` (static
                     dispatch, three known variants)
  Adapters
    postgres: table `dashboards (id, org_id, project_id, name, tags,
      doc jsonb, schema_version, updated_by, updated_at)`, unique
      `(project_id, name)`, index on project, FK on project with delete
      cascade. Migration `up` and `down`.
    clickhouse: one SQL builder per signal. The builder only emits
      statements from the closed `Aggregation`, field and filter types;
      values are bound parameters. Fields resolve through the existing
      materialised columns (`k8s_pod`, `service_name`) and the attribute
      maps.
  Errors
    DashboardError: NotFound, NameTaken, TooLarge, TooMany,
      UnknownSchema, Invalid(reason)
    QueryError: Refused(reason), TooManySeries, Timeout, Store

  API (`dashboard_routes.rs`, all under `/api/v1`, bearer auth)
    GET    /dashboards                        list (id, name, tags, updated)
    POST   /dashboards                        create
    GET    /dashboards/{id}                   document
    PUT    /dashboards/{id}                   replace (full document)
    DELETE /dashboards/{id}
    POST   /dashboards/{id}/clone
    POST   /dashboards/query                  run one panel query, so the
                                              editor previews an unsaved
                                              panel
    GET    /dashboards/{id}/export            the JSON, as a download
    POST   /dashboards/import                 create from exported JSON
  Reads need `read`, writes need membership of the project. Every change
  writes an audit entry.

  Interface (`web/src/pages/dashboards`)
    List page, dashboard page, editor mode on the same page.
    - Time range and variables on top, refresh, auto-refresh.
    - Panels render by kind. Graph panels share one tooltip component:
      all series at the hovered time, sorted by value, the nearest one
      highlighted, `P` pins it, a click opens the explorer (Traces or Logs
      with the panel filter, the group value and the time range; Metrics
      with the metric and the labels).
    - Drag a range on a time chart to zoom the whole dashboard, as the
      cost meter already does.
    - Release markers on time charts, with the lane layout of
      `MarkerLayer`.
    - Editor: add panel opens a picker grouped as in SigNoz (trends,
      compare, distributions, single values, raw records, documentation),
      then a query builder with a live preview, drag and resize on the
      grid, save, discard.
    - Empty, loading, error and truncated states for every panel.

Acceptance (Gherkin)
  @spec-l16-1  Scenario: a member creates a dashboard with a time series
               panel and reads it back unchanged
  @spec-l16-2  Scenario: a member of another project cannot read, edit or
               query a dashboard
  @spec-l16-3  Scenario: a key with only the ingest scope is refused
  @spec-l16-4  Scenario: a document with an unknown schema_version is
               refused with 422
  @spec-l16-5  Scenario: a 31st panel, a 257 KB document or a 101st
               dashboard is refused
  @spec-l16-6  Scenario: a traces query counts spans per service over an
               hour and returns one series per service
  @spec-l16-7  Scenario: a logs query counts error logs per service as a
               table of rows ordered by count
  @spec-l16-8  Scenario: a metrics query returns node memory per node
  @spec-l16-9  Scenario: a query that would return 51 series is refused
               with the count, not truncated silently
  @spec-l16-10 Scenario: a variable value containing a quote or `)` cannot
               change the meaning of the filter
  @spec-l16-11 Scenario: a number panel given a series query is refused at
               save
  @spec-l16-12 Scenario: each of the eleven kinds renders from a fixture,
               and shows its empty state when the query returns nothing
  @spec-l16-13 Scenario: hovering a time chart lists every series at that
               time, and clicking opens the explorer with the same filter
               and range
  @spec-l16-14 Scenario: dragging a range on one chart sets the time range
               of every panel
  @spec-l16-15 Scenario: exporting a dashboard and importing it into
               another project gives an equal document
  @spec-l16-16 Scenario: deleting a project deletes its dashboards
  @spec-l16-17 Scenario: dashboard create, update and delete each write an
               audit entry

Simulation
  No. Nothing here is concurrent or time-dependent beyond a query range
  that is a plain argument.

Workstreams
  16a  Model and storage. Domain types, Postgres migration, store adapter,
       CRUD routes, audit, limits, export and import. Depends on: none.
       Owns: `crates/domain/src/dashboard`, `crates/postgres`,
       `crates/api/src/dashboard_routes.rs`.
  16b  Panel queries. `SignalQuery` for traces, logs and metrics, the SQL
       builders, result shapes for all eleven kinds, the query route,
       variables. Depends on: 16a types. Owns: `crates/clickhouse`.
  16c  Viewer. List page, dashboard page, the eleven renderers, the shared
       tooltip with pin and drilldown, zoom, release markers, states.
       Depends on: 16a, 16b contracts. Owns: `web/src/pages/dashboards`,
       `web/src/components/ft`.
  16d  Editor. Panel picker, query builder with live preview, grid drag
       and resize, save and discard, import and export buttons. Depends
       on: 16c.
  Order: 16a, then 16b and 16c in parallel against the frozen contracts
  below, then 16d.

Frozen contracts
  The document and the panel result are the contracts. `DashboardDoc` is
  defined by the domain types above and serialised with serde, tagged by
  `schema_version: 1`. `PanelResult` is one of
    { kind: "series",  series: [{ labels, points: [[t_ns, value]] }] }
    { kind: "scalar",  value }
    { kind: "rows",    columns: [..], rows: [[..]], truncated }
    { kind: "buckets", buckets: [{ from, to, count }] }
    { kind: "heat",    x: [t_ns], y: [from, to], cells: [[x, y, count]] }
    { kind: "pairs",   points: [{ group, x, y }] }
  The exact field list is fixed in 16a with the types, and amended here.

Risks / open questions
  - Grid drag and resize: a library (`react-grid-layout`) or our own
    pointer code. Owner: 16d, decide with a spike before the PR.
  - Percentiles and heatmaps on spans use `quantile` and `histogram` on
    `duration`; cost on a large tenant is unmeasured. Owner: 16b, measure
    on the benchmark data in `docs/benchmarks` before merging.
  - Metrics: histograms and exemplars exist in their own tables. v1 reads
    sums, gauges and the p50/p95/p99 of histograms. Owner: 16b.
  - The `Metrics` explorer page overlaps with a time series panel. Keep
    it; link "add to dashboard" from it in 16d.

Verify (exit)
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  cargo test --workspace
  cd web && pnpm typecheck && pnpm build
  docker compose -f deploy/docker-compose.yml up --build --detach
  create a dashboard with each kind from the interface, reload, compare
  with `GET /api/v1/dashboards/{id}`.
