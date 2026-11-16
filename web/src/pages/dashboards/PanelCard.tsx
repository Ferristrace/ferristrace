import { useQueries } from '@tanstack/react-query'
import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { Info, Loader2, TriangleAlert } from 'lucide-react'
import { memo, useId, useRef } from 'react'
import { ApiError } from '@/auth/client'
import { PanelEmpty } from '@/components/ft/panels/Empty'
import { drillTarget } from '@/components/ft/panels/drilldown'
import { drillRange } from '@/components/ft/panels/geometry'
import { PanelBody } from '@/components/ft/panels/index'
import { QUERY_LABEL, describeFailure, droppedQueries, mergeResults } from '@/components/ft/panels/result'
import { Skeleton } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import type { DrillFn, Mark, Range, ZoomFn } from '@/components/ft/panels/types'
import { panelQueryOptions, type PanelDoc, type PanelResult, type Source } from '@/data/dashboards'
import { useScope } from '@/lib/scope'
import { variablesFor } from './variables'

const MARKED = new Set(['time_series', 'area'])

const SCROLLS = new Set(['table', 'list', 'text'])

const NOTHING: PanelResult = { kind: 'rows', columns: [], rows: [], truncated: false }

function PanelCardView({ panel, range, sent, source, markers, onZoom }: {
  panel: PanelDoc
  range: Range
  sent: Record<string, string[]>
  source: Source
  markers: Mark[]
  onZoom: ZoomFn
}) {
  const { project } = useScope()
  const navigate = useRouterNavigate()
  const hint = useId()
  const runs = useQueries({
    queries: panel.queries.map((query) => panelQueryOptions(project, { kind: panel.kind, query, fromNs: range.fromNs, toNs: range.toNs, variables: variablesFor(query, sent) }, source)),
  })
  const names = panel.queries.map((query) => query.name)
  const failed = runs.find((run) => run.error)?.error ?? null
  const waiting = runs.some((run) => run.data === undefined && run.fetchStatus !== 'idle' && !run.error)
  const fetching = runs.some((run) => run.isFetching)
  const settled = runs.length > 0 && runs.every((run) => run.data !== undefined)
  const datas = runs.map((run) => run.data)
  const last = useRef<{ datas: unknown[]; names: string; merged: PanelResult | null; dropped: number } | null>(null)
  if (!last.current || last.current.names !== names.join('\u0000') || last.current.datas.length !== datas.length || datas.some((one, at) => one !== last.current?.datas[at])) {
    const found = settled ? datas as PanelResult[] : []
    last.current = { datas, names: names.join('\u0000'), merged: settled ? mergeResults(found, names) : null, dropped: droppedQueries(found) }
  }
  const { merged, dropped } = last.current

  const drill: DrillFn = (labels, at) => {
    const query = panel.queries.find((one) => one.name === labels[QUERY_LABEL]) ?? panel.queries[0]
    if (!query) return
    const span = range.toNs - range.fromNs
    const found = at ? drillRange(at.atNs, at.stepNs, span) : { fromMs: Math.floor(range.fromNs / 1e6), toMs: Math.ceil(range.toNs / 1e6) }
    const target = drillTarget({ query, labels, variables: variablesFor(query, sent), ...found })
    if (target) void navigate({ to: target.to as never, search: target.search as never })
  }

  const problem = failed ? describeFailure(failed instanceof ApiError ? failed.status : null, failed instanceof ApiError ? failed.body : '') : null
  const result = panel.kind === 'text' ? NOTHING : merged

  return (
    <section aria-label={panel.title || 'Untitled panel'} aria-busy={fetching || undefined} tabIndex={SCROLLS.has(panel.kind) ? 0 : undefined} data-panel={panel.kind} className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border bg-card text-card-foreground focus-visible:outline-2 focus-visible:outline-ring">
      <header className="flex min-h-10 items-center gap-1.5 border-b border-border-subtle px-3 py-1">
        <h2 className="m-0 min-w-0 flex-1 truncate text-sub">{panel.title || 'Untitled panel'}</h2>
        {fetching && result ? <Loader2 className="size-3.5 animate-spin text-faint-foreground" aria-label="Refreshing" /> : null}
        {panel.description ? (
          <span className="group relative">
            <button type="button" aria-label={`About ${panel.title || 'this panel'}`} aria-describedby={hint} className="inline-flex size-6 cursor-help items-center justify-center rounded-sm text-faint-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <Info className="size-3.5" aria-hidden />
            </button>
            <span id={hint} role="tooltip" className="invisible absolute right-0 top-7 z-20 w-[260px] rounded-md border bg-popover px-2.5 py-2 text-caption text-popover-foreground shadow-md group-focus-within:visible group-hover:visible">{panel.description}</span>
          </span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {problem ? (
          <div role="alert" data-state="error" className="flex h-full min-h-[80px] flex-col items-center justify-center gap-2 text-center">
            <TriangleAlert className="size-4 text-destructive-text" aria-hidden />
            <span className="max-w-[360px] text-control text-destructive-text">{problem.message}</span>
            {problem.kind === 'timeout' || problem.kind === 'other' ? <Button size="sm" onClick={() => runs.forEach((run) => void run.refetch())}>Try again</Button> : null}
          </div>
        ) : waiting || (panel.kind !== 'text' && !result) ? (
          <div data-state="loading" role="status" aria-label="Reading the panel" className="flex h-full min-h-[80px] flex-col justify-center gap-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ) : result ? (
          <>
          {dropped > 0 ? <p role="status" className="m-0 mb-1 rounded-sm bg-warning-subtle px-2 py-1 text-caption text-warning-text">Only the first query is drawn; this panel kind reads {panel.kind === 'time_series' || panel.kind === 'area' || panel.kind === 'bar' ? 'series queries only' : 'a single query'}.</p> : null}
          <div className="min-h-0 flex-1"><PanelBody panel={panel} result={result} range={range} markers={MARKED.has(panel.kind) ? markers : undefined} onZoom={onZoom} drill={panel.kind === 'text' ? undefined : drill} /></div>
          </>
        ) : (
          <PanelEmpty />
        )}
      </div>
    </section>
  )
}

export const PanelCard = memo(PanelCardView)
