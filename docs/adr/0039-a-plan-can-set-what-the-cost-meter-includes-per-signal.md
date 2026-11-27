# 0039. A plan can set what the cost meter includes per signal

Status: accepted
Date: 2026-11-27

## Context
ADR 0038 put the monthly allowance per signal in the `[billing]` section of the server config, one figure per signal for the whole server. The hosted service sells plans: Free includes one gigabyte of spans, Pro includes a hundred. Every organisation saw the server-wide figure, so a Pro organisation read "Spans included 823 %" and a projected bill that charged everything past one gigabyte. The quota already reads `plans.ingest_gb` per organisation; the cost meter did not read the plan at all.

## Decision
A plan may declare `included_spans_gb`, `included_logs_gb` and `included_metrics_million`, in the `[[plans]]` config and in three nullable columns of `plans`. `UsageHistory::included` returns what the organisation's plan includes: the ingest ceiling the quota uses and, per signal, an optional allowance. The metering service builds the price list of the organisation by replacing, signal by signal, the server allowance with the plan's when the plan sets one. An explicit `0` on a plan means nothing is included; an absent field means the server figure applies. Prices stay server-wide. The bill, the projection and the `pricing.included` the API returns all come from the organisation's price list, so the page needs no change.

## Alternatives rejected
- A second port method for the per-signal allowance: two reads of the same row for one concept.
- Deriving the per-signal allowance from `ingest_gb`: the quota counts binary gigabytes of everything, the cost meter prices decimal gigabytes per signal; no split of one figure is right for every plan.
- Moving prices onto the plan too: nobody asked for a price per plan yet, and ADR 0038's reasons still hold.

## Consequences
- Gains: the Cost page of a Pro organisation shows what Pro includes; a self-hosted server with no plans behaves as before.
- Costs: a migration adds three columns; `sync_plans` writes them; the hosted plan declaration must carry the figures or every plan keeps the server allowance.
- What becomes harder: nothing new; a price per plan still means a port, as ADR 0038 said.
