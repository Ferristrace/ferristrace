# Lot 18: charts and data presentation

Goal
  Charts carry the data: bigger, readable, with the percentiles an SRE
  compares, one unit per axis, and values that agree with the figures next
  to them. First step of the design review of 2026-11-16 (critique stored in
  `.impeccable/critique/`), chosen by the maintainer: charts and data first,
  keep the indigo accent, system plus four pages (service detail, dashboards,
  the line chart used elsewhere, tables of durations).

Context
  The service page shows four KPI tiles that repeat three 140 px charts with
  one indigo line and 10 px axes. The latency chart draws only p95 although
  the table below has p50, p95 and p99. The y axis wraps (`2.000` over `s`),
  mixes `0 ns` and `998 ms`, and the chart headline shows the last bucket
  (`0 %`) while the tile says `7.6 %`. Dashboard legends are bordered pills
  that wrap and overflow, a duration column prints `922,503,087`, and with
  "All projects" selected a dashboard shows skeletons forever. SigNoz draws
  larger charts with percentile overlays and readable axes.

Out of scope (decided with the maintainer)
  - The trace detail, the Kubernetes pod squares, the public status page.
  - Colour mood, density tokens, typography (next lots of the review).
  - Sparklines in tiles (judged decoration unless they carry a threshold).
  - A new accent colour.

Decisions
  D1  Default chart plot height 200 px on the service page and dashboards.
  D2  Axes 11/16 px, `--muted-foreground`, tabular figures, never wrapped.
      Values carry their unit: `2 s`, `500 ms`, `0.5/s`, `25 %`, `683 MiB`.
      One formatter per axis (the geometry helpers `formatValue` and
      `axisValue` already know ns, bytes, % and counts).
  - D3  Lines 1.5 px, round joins, no markers. Single series: vertical
      gradient fill from 18 % to 0 of the series colour. Several series:
      no fill (stacked areas keep their 0.35 fill with a 1 px line).
  D4  Grid: horizontal lines only, three or four, `--chart-grid`. Vertical
      guide only at the hovered point and for release markers.
  D5  Percentiles: p50 1 px at 70 % opacity, p95 1.75 px, p99 1 px dashed
      `4 3`, all from the series palette in that order. They need the data
      (below).
  D6  Legend: an inline row of swatch and name in 12 px, no border and no
      pill, at most two lines then "and N more". For percentile charts the
      header is the legend and carries the live values:
      `p50 300 ms · p95 831 ms · p99 1.37 s`, which follow the pointer.
  D7  The chart headline is the aggregate of the whole window, with the
      window named (`7.6 %` · `last 1 h`), never the last bucket; hovering
      replaces it with the value at the pointer. The service page drops the
      four KPI tiles that repeat the charts; the counts they carried move to
      the chart subtitle (`229 of 2,997 requests`).
  D8  Durations in tables are written in their unit (`922.5 ms`). A column
      whose aggregation reads the span `duration` field is a duration.
  D9  A dashboard needs a project: with "All projects" it shows the same
      'Pick a project' state as the list, not skeletons.
  D10 The developer help about fixture dashboards shows only in development.

Design
  Data: service series gain `p50_ns` and `p99_ns` per point and for the whole
  window next to `p95_ns`. Wire: `points: [[at_ns, requests, errors, p95_ns,
  p50_ns, p99_ns]]` and `p50_ns`, `p99_ns` at the top, null when no span.
  Only the service series routes (`/api/orgs/{org}/series` and
  `/api/orgs/{org}/services/{name}/series`); other routes keep their shape.
  Web: `Stepped` and `charted()` carry p50/p99; `LineChart` gains `lines`
  (several named series with weight and dash) and `headline`; panels
  `TimeChart` follows D2 to D6; `DataTablePanel` follows D8.

Invariants
  - A percentile series never invents values: a bucket without spans is a
    gap, not zero. [test]
  - p50 <= p95 <= p99 per point when all are present. [test on the reader]
  - No axis label wraps and none mixes units. [test on the formatter]
  - The headline and the figure it replaces agree for the same window.
    [test: the service page headline equals the table row]

Acceptance
  @spec-l18-1  the series routes return p50, p95 and p99 per point and
               overall, null where there is no span
  @spec-l18-2  other series routes are unchanged
  @spec-l18-3  axis labels use one unit and never wrap (formatter tests for
               ns, ms, s, bytes, %, counts, rates)
  @spec-l18-4  the latency chart draws three lines with the weights of D5
               and a header legend with live values
  @spec-l18-5  the headline is the window aggregate and hover replaces it
  @spec-l18-6  the four tiles are gone from the service page and the counts
               are in the chart subtitles
  @spec-l18-7  a duration column prints a unit (`922.5 ms`)
  @spec-l18-8  a dashboard with "All projects" shows 'Pick a project'
  @spec-l18-9  the fixture help is absent from a production build
  @spec-l18-10 contrast: axis text, legend text and tooltip text >= 4.5:1 in
               light and dark; series colours >= 3:1 against the card

Workstreams
  18a  Backend: p50 and p99 on the two service series routes (domain
       reader, ClickHouse adapter, API wire, tests). Owns: crates/.
  18b  Web: chart system, service page, dashboard polish, tests. Codes
       against the wire above with fixtures until 18a lands. Owns: web/.

Verify (exit)
  cargo fmt --all --check; cargo clippy --workspace --all-targets -- -D
  warnings; cargo test (domain, application, clickhouse, api);
  cd web && pnpm typecheck && pnpm build && pnpm test
  look at the service page and a dashboard in light and dark at 1440 and 390.
