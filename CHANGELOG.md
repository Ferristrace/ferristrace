# Changelog

All notable changes to FerrisTrace. Generated from the conventional commits between tags.

## [Unreleased]

## [0.0.8] - 2026-11-26

### Added

- **status**: Record 30-day history for manual component changes (#393)
- **status**: Schedule maintenances on status pages (#394)

### Fixed

- **web**: Apply the status page theme mode on public views (#390)
- **status**: Scope subscriber email links by org slug and format timestamps (#391)
- **status**: Degrade service components that stop reporting (#392)

## [0.0.7] - 2026-11-24

### Added

- **web**: Show member photos on issue owners and on-call badges (#382)
- **billing**: Wire Stripe metered overage checkout and hourly reporting (#388)

### Fixed

- **web**: Stop showing the initials behind a transparent avatar or logo (#381)
- **web**: Open the overview on a window that holds data (#383)

## [0.0.6] - 2026-11-18

### Added

- **usage**: Count spans, logs and metric datapoints per hour (lot 15a) (#325)
- **api**: Return usage by signal and per hour (lot 15b) (#326)
- **web**: Add the cost meter page (lot 15c) (#327)
- **usage**: Rebuild the split of past hours from the span store (lot 15d) (#328)
- **web**: Show a tooltip with the day and its value on the daily bars (#329)
- **web**: Zoom the cost meter by dragging a range on a chart (#330)
- **dashboards**: Store dashboards per project and serve them over the API (lot 16a) (#335)
- **dashboards**: Run a panel query over traces, logs and metrics (lot 16b) (#337)
- **web**: View and edit dashboards (lots 16c and 16d) (#341)
- **web**: Make the home page answer whether something is wrong (lot 17) (#342)
- **web**: Hover, keys and release list on the line charts (service page and others) (#343)
- Bigger charts with percentiles, readable axes and agreeing headlines (lot 18) (#344)
- Design concept 3 across the app, with an on-call page (lot 19) (#357)
- **web**: Finish design concept 3 with the data the api serves (lot 19f) (#363)
- The cost meter in money, per signal and per project (lot 21) (#371)
- **web**: Rebuild the home page on the hub board (lot 22) (#374)
- **web**: Cost is a section of its own in the rail and the phone menu (#373)
- **web**: One table system for the lists, on services and traces (lot 22) (#375)
- Refresh tenant allowances every 20 seconds (lot 20, slice 20a) (#376)
- Stripe plans, checkout, portal and webhooks (lot 20, slice 20b) (#377)
- **billing**: Start new organisations on a configured default plan (#378)
- **status**: Multi-tenant status pages and 30-day uptime history (#379)

### Fixed

- **web**: Keep release labels from overlapping on charts (#332)
- **web**: Rail tooltips draw above the page content (#372)

## [0.0.5] - 2026-11-13

### Added

- **web**: Keep or exclude a value from the traces and spans lists (#285)
- **infra**: List clusters, hosts and containers as resources (lot 12a-c) (#288)
- **infra**: Link services and the infrastructure they run on (lot 12f) (#289)
- **api**: Let an owner disband an organisation (#290)
- **web**: Wire the delete-organisation button to the disband route (#291)
- **profile**: Persist display preferences per account (#293)
- **alerts**: Silence a firing rule without disabling it (#292)
- **inbox**: Add an in-app notification center, no producers yet (#294)
- **incidents**: Show deploys, new errors, resources and failing traces on an incident (lot 13a) (#296)
- **alerts**: Send alerts to a Slack or Discord channel (lot 13b1) (#298)
- **alerts**: Design the Discord message of a channel (lot 13b1b) (#301)
- **inbox**: Let an account choose per-kind notification channels (#299)
- **alerts**: Let a rule name the roles and users a Discord alert pings (lot 13b1c) (#304)
- **incidents**: Post incident updates to a Slack or Discord channel (lot 13b2) (#305)
- **incidents**: Show how fast incidents are acknowledged and resolved (lot 13c) (#306)
- **roster**: Notify the other admins when a member joins or leaves (#307)
- **alerts**: Let a Slack channel use the same design and mentions as Discord (lot 13b1d) (#308)
- **explore**: Show how services call each other (#318)
- **explore**: Show a service's blast radius on its detail page (#320)
- **clickhouse**: Move parts older than spans.cold_after_days to a cold volume (lot 14a) (#322)

### Changed

- **web**: One chart for every backend page (#283)

### Fixed

- **otlp**: Read the current http status code attribute (#284)
- **web**: Stagger deploy markers on line charts (#287)
- **web**: Default a missing services list to empty on infrastructure resources (#295)
- **alerts**: Leave the alert link out of a chat message when it is not absolute (#300)
- **audit**: Update the frozen action-spellings snapshot (#297)
- **alerts**: Refuse an svg thumbnail on a Discord design (#302)

## [0.0.4] - 2026-11-07

### Added

- **logs**: Query the logs with the explorer's query tree (lot 10a) (#273)
- **web**: The logs page becomes the explorer (lot 10b) (#274)
- **web**: A trace opens its logs with a plain query (lot 10c) (#275)
- **metrics**: Filter a series with the explorer's query tree (lot 11a) (#276)
- **web**: Filter a metric with the query bar (lot 11b) (#277)
- **explore**: The cache page reads the span store (#278)
- **explore**: The requests, jobs and queries pages read the span store (#280)
- **explore**: Find a possible N+1, and read system metrics for real (#281)

### Changed

- **web**: Drop the backend emails tab (#279)

### Fixed

- **otlp**: Accept OTLP/JSON on the traces, logs and metrics routes (#272)

## [0.0.3] - 2026-11-06

### Added

- **web**: Navigation by axis, and traces split into views (#250)
- **explore**: Filter traces on any span attribute (lot 9a) (#251)
- **views**: Save trace queries as views, private or shared (lot 9b) (#252)
- **explore**: Count the values of a field for the facets panel (lot 9c, backend) (#253)
- **web**: A facets panel and a views panel beside the traces list (lot 9c) (#255)
- **web**: A query bar that takes the query as text (lot 9e) (#256)
- **explore**: A Spans tab that lists the spans matching the query (lot 9d-1) (#258)
- **explore**: A Time series tab, with a measure and a group by (lot 9d-2) (#259)
- **explore**: A Table tab that lists the matching spans by a field (lot 9d-3) (#260)
- **web**: A histogram over the traces list, with a brush to zoom (lot 9f-1) (#261)

### Fixed

- **web**: Stop the query bar from growing taller than its line (#257)

## [0.0.2] - 2026-11-04

### Added

- **web**: Read a trace list by time, code and duration (#244)
- **web**: Read and act on a log record without the mouse (#245)
- **auth**: Let the web sign in and the api verify a bearer (#246)

## [0.0.1] - 2026-11-03

### Changed

- **Breaking:** Split the workspace by layer and backend and run each use case in one transaction (#169)
- **Breaking:** Rename comettrace to ferristrace everywhere (#172)
- **Breaking:** auth: Make ferriskey the only way in (#221)

### Added

- **issues**: Group exceptions into issues and keep what was decided (#156)
- **keys**: Manage api keys with ingest and read scopes (#192)
- **audit**: Record every organisation change in an audit log (#193)
- **chart**: Deploy ferristrace on kubernetes with a helm chart (#194)
- **retention**: Let an owner set the retention of their organisation (#195)
- **export**: Let an owner download their organisation's data (#197)
- **logs**: Accept, keep and search OTLP logs (#199)
- **metrics**: Accept, keep and chart OTLP metrics (#200)
- **explore**: Serve services, operations, overview and the logs of a trace (#201)
- **alerts**: Evaluate alert rules and deliver their changes (#202)
- **incidents**: Open incidents and keep their timeline (#203)
- **oncall**: Page the person on call and escalate until acknowledged (#204)
- **postmortems**: Draft a postmortem from an incident's timeline (#205)
- **status**: Serve public status pages with subscriptions (#206)
- **placement**: Filter traces, logs and metrics by kubernetes placement (#207)
- **cluster**: Show pods, nodes and workloads from collector metrics (#208)
- **releases**: Record releases and deploys from spans and deploy events (#209)
- **alerts**: Name the pods, nodes and version behind a firing alert (#210)
- **llm**: Recognise genai spans as llm calls and price them (#211)
- **llm**: Break llm spend down by feature, model or customer (#212)
- **alerts**: Alert on llm cost, tokens, calls or latency (#213)
- **agents**: Let ferriskey agents read telemetry with scoped tokens (#214)
- **agents**: Let agents comment on and resolve incidents within their scopes (#215)
- **web**: Put problems first on the kubernetes page (#216)
- **orgs**: Create an organisation and switch the active one (#218)
- **auth**: Bring FerrisKey up with the stack and fix federated provisioning" (#217)
- **web**: Make phone navigation thumb-first and install as an app (#220)
- **mcp**: Prepare ferristrace for an mcp policy gateway (#222)
- **mcp**: Serve ferristrace tools over mcp (#228)
- **mcp**: Enforce ferriskey decisions in an mcp gateway (#229)
- **mcp**: Run the mcp stack and provision ferriskey for its decisions (#230)
- **web**: Ask an account with no organisation to create one (#232)
- **web**: One time window for every signal page (#234)
- **web**: An onboarding that gets the first signal through (#235)
- **web**: Read a trace on a phone (#236)
- **web**: Keep an incident readable when the network drops (#237)

### Fixed

- **deploy**: Read the settings ferriskey-init writes when the services start (#239)
- **ci**: Give each image only its own digests (#242)
