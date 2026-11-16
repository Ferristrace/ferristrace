# Lot 17: the home page answers one question

Goal
  The home page tells whoever signs in whether something is wrong in the
  selected project and why, ranks what needs attention with the evidence one
  click away, shows what changed lately, and gives three figures with a
  point of comparison. When nothing is wrong it is short and calm.

Context
  Today the Overview shows five tiles, three charts that repeat the first
  three tiles, and five cards of equal weight (recent issues, services by
  error rate, error logs, slowest traces, a project switcher). Nothing is
  ranked, no figure has a reference, and nothing says what changed. This
  goes against the product principles "problems first" and "one click from
  symptom to evidence". Every reader signs in here: the person on call, the
  developer, the lead. Scope follows the project selected in the top bar.
  Web only: every source below already has a hook.

Decisions
  D1  Four blocks, in this order on a phone: status line, needs attention,
      what changed, figures. On a wide screen the figures sit under the
      status line and the two lists sit side by side.
  D2  The page does not duplicate other pages: the three charts, the
      services count, the open issues tile, the Projects card, the recent
      error logs and the slowest traces leave the home page. They stay one
      click away on their own pages and can live on a dashboard.
  D3  Needs attention is a ranked list of facts the product already knows,
      not a score. Order: severity (critical, warning, info), then kind,
      then magnitude.
  D4  Comparison is against the previous period of the same length
      ("vs previous 1 h"), not against yesterday.
  D5  Releases show the measured error rate before and after, and the
      issues they introduced. p95 before and after needs a backend change
      and is out of scope.

Glossary
  Attention item   one thing that needs a person, with a kind, a severity,
                   a one line statement and a link to its evidence.

Invariants
  - Every attention item links to its evidence. [type: `AttentionItem.to`
    is required]
  - The list never invents an item from missing data: a source that failed
    or has not answered is shown as "could not check X", not as healthy.
    [test]
  - "Nothing needs attention" is shown only when every source answered and
    none produced an item. [test]
  - No figure is shown as a trend or a delta when the previous period holds
    no data. [test]
  - At most eight items are listed, then "and N more" linking to the right
    page. [test]

Out of scope
  - p95 before and after a release (needs the API).
  - A user-pinned dashboard under the list.
  - Filtering to "my services" or "my team".
  - Any change to the API or the data model.

Design
  A pure module `web/src/pages/home/attention.ts`:
    Item { id, kind: incident | alert | service | issue | pods | silent,
           severity: critical | warning | info, title, detail, since: number
           | null, to, evidence: { label, to } | null, magnitude: number }
    rank(items): Item[]; status(items, sources): Calm | Attention(n) |
    Unchecked(names) | NoData(sinceMs)
    deltaOf(now, before, kind): { text, tone: worse | better | same | none }
    releaseEffect(detail): { before, after, delta, tone, introduced }
  Sources (existing hooks): useIncidents('open'), useAlerts() (status
  firing and no_data), useServiceTable (error rate over ERROR_THRESHOLD,
  and last seen), useIssues (unresolved, first seen in the window),
  useCluster (unhealthy pods, grouped per namespace), useReleases and
  useRelease for the last five releases of the last 24 h at least.
  `useServiceSeries` gains an optional `shiftMs` so the previous period is a
  second call to the same endpoint.
  Rules:
    incident   open, severity sev1/sev2 critical, sev3 warning, sev4 info
    alert      firing: its rule severity; no_data: warning
    service    error rate >= ERROR_THRESHOLD: warning, >= 3x: critical,
               needs at least 20 requests in the window
    issue      unresolved and first seen inside the window: warning; if it
               first appeared within 30 min after a release of the same
               service, the detail says which release
    pods       any unhealthy pod: one item per namespace, warning, critical
               when a node is not ready
    silent     a service seen in the last 24 h whose last span is older
               than 10 min: warning
  Components: `Home` page (replaces Overview), `StatusLine`, `Attention`,
  `Changes`, `Figures`. Styling follows DESIGN.md: lists, not boxed cards;
  one accent; no icon inside figures.

Acceptance (tests, pure first)
  @spec-l17-1  ranking: severity, then kind, then magnitude, stable
  @spec-l17-2  status: Calm only when every source answered and no item
  @spec-l17-3  status: a failed source gives Unchecked and never Calm
  @spec-l17-4  more than eight items list eight and "and N more"
  @spec-l17-5  a service under 20 requests is not an item
  @spec-l17-6  an issue that appeared after a release names that release
  @spec-l17-7  deltaOf: rising error rate is worse, falling is better, no
               previous data gives none, a change under 5 percent is same
  @spec-l17-8  a release effect with fewer than 20 requests before or after
               is shown without a tone
  @spec-l17-9  silent service: older than 10 min and seen in 24 h
  @spec-l17-10 each state renders: calm, attention, unchecked, no data,
               empty project (existing onboarding)

Workstreams
  One: the pure module and its tests, then the components, then the route.

Risks / open questions
  - Five release detail requests on every load; acceptable now, a batched
    endpoint later.
  - A project without releases shows "No release in the last 24 hours".

Verify (exit)
  cd web && pnpm typecheck && pnpm build && pnpm test
  open the home page against the Mercato demo and read each state.
