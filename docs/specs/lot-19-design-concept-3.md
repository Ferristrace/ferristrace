# Lot 19: design concept 3 in the app

Goal
  The web app looks and reads like the design the maintainer validated on
  2026-11-16 (Design artifact "concept 3", SigNoz inspired, indigo accent,
  near-black flat shell): an icon rail, a breadcrumb top bar, flat panels
  with a kind chip, dense tables with a toolbar and a pager, readable
  charts, a bottom tab bar on phones. Every page that exists today moves to
  it. New screens that only need data the API already serves come with it.

Context
  Today the shell is a sidebar of five axes with a sub-navigation of tabs,
  Source Sans 3, zinc greys and a lighter indigo. The design was drawn as
  HTML boards (desktop 1440 and phone 390). The reference renders live in
  the artifact; this spec names the decisions the code must follow, so the
  boards are a picture, not the contract.

Out of scope
  - The sign-in, password, second-factor screens: served by FerrisKey. The
    three screens FerrisTrace shows itself (signed out, sign-in stalled,
    sign-in unavailable) and /welcome do move to the new look.
  - Features the design shows but the API does not serve yet. They get
    their own lot with a spec (lot 20): configurable escalation policies
    with levels, conditions, repeats and a dry run; personal paging rules;
    push, SMS and phone paging and the phone screens of a page; incident
    roles and tracked follow-ups. Where the design shows them inside an
    existing page, the page ships without them.
  - The data region at organisation creation (not offered).

Decisions
  D1  Tokens. Dark: background #0b0c0e, card #121317, panel head #16181d,
      hover #1a1c22, popover #1b1d24, line #1f2128, strong line #2b2e38,
      text #e6e7ea, muted #a6a9b1, faint #7d818c, axis #c3c6cd, link
      #6f8cff, accent #4e74f8, error #ff6b81, warning #ffcd56, series
      #7aa2ff #f5a742 #27c9b0 #f06ea9. Light: background #f4f5f7, card
      #ffffff, head #f0f1f4, hover #eceef2, line #e2e4ea, strong line
      #cdd1da, text #1a1c21, muted #4d525d, faint #636875, link #2f4fd0,
      accent #3556d4, error #c0233f, warning #8a5a00. The existing token
      names stay (`--background`, `--card`, `--primary`...): only values
      change, plus `--panel-head` and `--line-strong`.
  D2  Type: Inter variable for text, JetBrains Mono for ids, numbers in
      tables and code. Base 13/20. Page title 18/24 600.
  D3  Shape: radius 3 px on controls and panels, 6 to 8 px on menus,
      cards of the onboarding and dialogs. Flat: no shadow on panels,
      one shadow level on popovers.
  D4  Shell. A 54 px icon rail with tooltips; its logo cell is as tall as
      the top bar (51 px) and shares its bottom line. Rail order: Home,
      Alerts, Incidents, Dashboards, Services, Logs, Traces, Metrics,
      Infrastructure, Cost; at the bottom Help, Settings, the account menu.
      The top bar carries the breadcrumb (organisation switcher / project
      switcher / page), the search (⌘K) and the time window.
  D5  Sections and their tabs (URLs unchanged):
        Home           Overview, AI
        Alerts         Rules (/alerts), On-call (/oncall, new)
        Incidents      Incidents, Insights, Issues, Status page
        Dashboards     Dashboards
        Services       Services, Service map, Releases, Backend views
        Logs, Traces, Metrics   one page each
        Infrastructure Overview, Kubernetes
        Cost           Cost (own section since lot 22)
      Tabs sit under the page title, underlined, not in a second bar.
  D6  Phone (<= 760 px): the rail becomes a 60 px bottom bar: Home, Alerts
      and incidents, Services, Traces, More. More lists the rest and the
      account. Grids become one column, filters go behind a button, wide
      tables scroll sideways, the time window keeps only its chip.
  D7  Panels: a 40 px head with the title, a kind chip (Time series, Bar,
      Table...) and a menu; tables: a toolbar (search, filter selects,
      actions), sortable headers, a pager (rows per page, page numbers).
  D8  Charts keep lot 18 and add: vertical bars rounded 4 px at the top,
      stacked bars rounded on the top segment only, donut with a centre
      figure, horizontal bars, a heatmap, quota bars.
  D9  Settings: a left nav grouped Personal, Organisation, Project; the
      active item is a tinted pill in the link colour, not a bar.
  D10 On-call page (/oncall) on the existing API: who is on call now per
      schedule, a two-week timeline of shifts and overrides with a "now"
      line and the gaps nobody covers, the override list, the rotation;
      a Pages tab listing pages with their status and trail. Editing a
      schedule stays where it is (team dialog) until lot 20.

Invariants
  - No route changes its URL; old bookmarks keep working. [test: routes]
  - Contrast: text >= 4.5:1, series and lines >= 3:1 on the card, in
    light and dark. [test on the token table]
  - At 390 px no page scrolls sideways; wide tables scroll inside their
    panel. [manual pass per page, listed in the PR]
  - A page that showed real data still shows it: restyling never swaps a
    real source for a mock.

Acceptance
  @spec-l19-1  tokens and type of D1 to D3 in light and dark
  @spec-l19-2  the rail, top bar and tab placement of D4 and D5 on every
               page in the shell
  @spec-l19-3  the bottom bar and More page of D6 at 390 px
  @spec-l19-4  panels, tables, toolbars and pagers of D7 on every list
  @spec-l19-5  chart shapes of D8 (bar rounding, donut, heatmap, h-bars)
  @spec-l19-6  settings nav of D9
  @spec-l19-7  every page of the shell restyled (list in the PRs)
  @spec-l19-8  the on-call page of D10 shows the real schedules, overrides
               and pages
  @spec-l19-9  signed out, sign-in stalled, unavailable and /welcome in the
               new look, without a region field

Workstreams (one PR each, stacked shallow)
  19a  Tokens, fonts, base components (button, input, select, badge,
       pill, panel, tabs, dialog, popover). Owns: styles/, components/ui/.
  19b  Shell: rail, top bar, breadcrumb, tabs under the title, phone
       bottom bar and More page, settings nav. Owns: components/layout/,
       routes.tsx nav data.
  19c  Data components: table, toolbar, pager, stat tiles, chart shapes.
       Owns: components/ft/.
  19d  Pages, in batches: home, AI, cost / services, service map,
       releases / traces, trace detail, logs, metrics / alerts, incidents,
       insights, issues, postmortem, status page / dashboards / infra /
       settings, onboarding, auth screens, not found.
  19e  On-call page (D10).

Verify (exit)
  cd web && pnpm typecheck && pnpm build && pnpm test; each page looked at
  in light and dark at 1440 and 390 against its board.

19f: finish (board items the API already serves)
  The page PRs of 19d left out every board item they did not have data
  for. Many of them have data: the endpoint exists, only the page did
  not use it. 19f adds those, and nothing that needs a new endpoint.
  Shared: `SortTh` (components/ui/misc.tsx) and `sorted`/`toggled`
  (lib/sorting.ts) give every in-memory table sortable headers.

  F1  Shared frames: Histogram, TablePanel, SeriesPanel, MetricChart,
      DailyBars, ChartFrame, PiePanel, Filters, QueryBar use the panel
      frame (rounded-md, 40 px head, kind chip). The traces "Spans over
      time" panel gets a value axis, time ticks and an Ok/Error legend.
  F2  Services: sortable headers on the services list (kept in step with
      the sort select); service detail tabs Overview, Traces, Logs,
      Dependencies on a `tab` search param (the URL without it shows
      Overview as today); service map: clicking a node opens a side panel
      with the service figures, callers and callees, and Open service;
      release detail: error rate and p95 of the service around the
      release when the series can be asked for that window.
  F3  Alerts, incidents, issues: sortable headers; the Notifies column of
      the alert list from the rule channels; the services row of an
      incident.
  F4  Infrastructure, settings, dashboards: Kubernetes tabs Nodes,
      Workloads, Pods on the cluster view; Members Email column; Teams
      On call now column from the schedules; sortable headers on the
      settings and dashboards tables.
  F5  Phone: every list with filters puts them behind a Filters button
      at <= 760 px, like Traces and Logs.

  Acceptance
    @spec-l19-10 every in-memory table sorts by its headers, aria-sort set
    @spec-l19-11 F1 to F5 on the pages listed, URLs unchanged
