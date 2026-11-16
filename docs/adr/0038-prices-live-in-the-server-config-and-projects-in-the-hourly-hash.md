# 0038. Prices live in the server config and projects in the hourly hash

Status: proposed
Date: 2026-11-17

## Context
The cost meter of ADR 0037 counts volume per organisation, per hour and per signal. The Cost page of design concept 3 shows money: what the organisation owes this month, what it will owe at month end, what the plan includes per signal, and which project spends it. No price exists anywhere, the only allowance is `plans.ingest_gb` (one figure, read by the quota), and the project of a payload is known at ingest, from the API key, then dropped.

## Decision
Prices and allowances are set by whoever runs the server, in an optional `[billing]` section of the server config: a currency code, a price in micros per decimal gigabyte of spans and of logs and per million datapoints, and an allowance per signal and per month. Without the section the usage endpoint answers `pricing: null` and the page shows volumes. A currency that is not three ASCII letters stops the start. Money is integer micros end to end, rounded half up once per signal, computed in u128 and saturated to u64. The bill and its projection are pure functions of the domain over the rolled-up split; hours without a split count for nothing in money.

`UsageMeter::record_ingest` takes the payload's project. Redis keeps, in the hourly hash that already holds `<signal>`, a field `<signal>@<project uuid>` when the project is known. The hourly rollup writes those fields to `usage_hourly_project`, in the same transaction as the organisation's row and only when that row is new, so a second rollup of an hour writes nothing twice. The project table has no foreign key on the project: a deleted project keeps its history and reads as a project without a name. Volume without a project is the organisation's split minus the project rows, computed when read. `ferristrace backfill-usage` fills project rows for split hours that have none: it apportions the hour's metered split among the projects by their share of what the span store holds for that hour, per signal, rounding down, so the projects never add up to more than the organisation and the rest reads as "No project".

## Alternatives rejected
- Prices on the plan, in Postgres: an organisation would need an editor and a migration path for prices nobody sets yet. One server, one price list, read at start, is enough until a price per organisation is asked for.
- Floating point money: it rounds differently in Rust and in the browser. Integer micros with one rounding rule give the same figure in both.
- One hash per project and hour: it multiplies keys and the scan of the rollup. Fields in the existing hash cost one more `HINCRBY` in the same atomic pipeline.
- Storing "No project" as a row: it would drift from the organisation's split whenever a project row is filled later. Deriving it on read keeps the sum equal to the split.

## Consequences
- Gains: the page shows money without any new store, and the projects of an hour add up to the organisation's split for hours metered from now on.
- Costs: a price change applies to every window read after the restart, past months included; there is no history of prices. Allowances are whole gigabytes and whole millions.
- What becomes harder: prices per organisation or per plan. They would move the price list behind a port and out of the config.
- Hours rolled before this lot read as "No project" until `backfill-usage` runs, and backfilled project rows are an estimate: the metered split is exact, its sharing among projects follows the stored rows.
