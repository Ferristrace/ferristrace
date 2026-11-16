import { ScrollText, TriangleAlert, Waypoints } from 'lucide-react'
import { Link, useParams, useSearchParam } from '@/lib/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { Table, Td, Th, Tr } from '@/components/ui/misc'
import { EmptyState, PageHeader, ServiceDot, svcBg } from '@/components/ft/bits'
import type { FrameStatus } from '@/components/ft/ChartFrame'
import { percentileLines } from '@/components/ft/percentiles'
import { axisLabels, formatValue } from '@/components/ft/panels/geometry'
import { LineChart } from '@/components/ft/charts'
import { ceiling, timeLabels, useDeployMarkers } from '@/data/series'
import { ERROR_THRESHOLD, type Edge, charted, perSecond, useOperations, useServiceDependencies, useServiceSeries, useServiceTable } from '@/data/services'
import { useWindow } from '@/lib/window'
import { ANY as ANY_ISSUE, useIssues } from '@/data/issues'
import { placementSearch, usePlacement } from '@/data/placement'
import { PlacementPicker } from '@/components/ft/Placement'
import { RunsOn } from '@/components/ft/RunsOn'
import { because } from '@/auth/client'
import { num } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PagedFooter, usePaged } from './backend/kit'

const axis = (hi: number, unit: string, blank = false): [string, string, string] => {
  if (blank) return ['', '', '']
  const [top, middle, bottom] = axisLabels([hi, hi / 2, 0], unit)
  return [top, middle, bottom]
}

const errorFormat = (value: number) => (value === 0 ? '0 %' : value < 1 ? `${value.toFixed(2)} %` : `${value.toFixed(1)} %`)

const latency = (ms: number) => formatValue(ms, 'ms')

const inMs = (us: number | undefined): number | null => (us === undefined ? null : us / 1000)

export function ServiceDetail() {
  const { ms: windowMs, label } = useWindow()
  const { name = '' } = useParams()
  const environment = useSearchParam('env') ?? ''
  const { placement, place } = usePlacement()
  const { services, pending } = useServiceTable(environment, windowMs, placement)
  const { operations, failed: opsFailed } = useOperations(name, environment, windowMs, placement)
  const { series, pending: seriesPending, failed: seriesFailed } = useServiceSeries(name, environment, windowMs, placement)
  const { issues } = useIssues({ ...ANY_ISSUE, rangeMs: windowMs, service: name, limit: 50 })
  const { edges, pending: depsPending, failed: depsFailed } = useServiceDependencies(environment, windowMs, placement)
  const markers = useDeployMarkers(series, name)
  const s = services.find((x) => x.name === name)
  const bad = (s?.err ?? 0) >= ERROR_THRESHOLD
  const lines = charted(series)
  const to = series?.points.length ? series.points[series.points.length - 1].atMs + series.stepMs : Date.now()
  const labels = timeLabels(to - windowMs, to)
  const times = series?.points.map((point) => point.atMs)
  const rateHi = ceiling(lines.perSecond)
  const errHi = Math.max(ceiling(lines.errorRate), ERROR_THRESHOLD * 2)
  const latencyHi = ceiling([...lines.p50, ...lines.p95, ...lines.p99])
  const windowLabel = `last ${label}`
  const spread = { p50: inMs(s?.p50Us) ?? series?.p50Ms ?? null, p95: inMs(s?.p95Us) ?? series?.p95Ms ?? null, p99: inMs(s?.p99Us) ?? series?.p99Ms ?? null }
  const status: FrameStatus | undefined = seriesFailed
    ? { kind: 'error', text: because(seriesFailed, 'The series could not be read.') }
    : seriesPending
      ? { kind: 'loading', text: 'Reading the series…' }
      : !series || series.points.length === 0
        ? { kind: 'empty', text: `No spans in the last ${label}.` }
        : undefined
  const open = issues.filter((issue) => issue.status === 'unresolved').slice(0, 5)
  const where = placementSearch(placement)
  const kept = { ...(environment ? { env: environment } : {}), ...where }
  const upstream = edges.filter((edge) => edge.callee === name).sort((a, b) => b.calls - a.calls)
  const downstream = edges.filter((edge) => edge.caller === name).sort((a, b) => b.calls - a.calls)
  const paged = usePaged(operations, name, 10)
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-control"><Link to="/services" search={kept}>Services</Link><span className="text-faint-foreground"> / </span><span className="font-mono">{name}</span></nav>
      <PageHeader
        tabs={false}
        title={<span className="inline-flex items-center gap-2.5"><span className={cn('size-3 rounded-[3px]', svcBg(name))} aria-hidden /><span className="font-mono">{name}</span></span>}
        meta={pending ? null : !s ? <Badge variant="outline">No spans in the last {label}</Badge> : bad ? <Badge variant="warning"><TriangleAlert />Error rate above {ERROR_THRESHOLD} %</Badge> : <Badge variant="success">Healthy</Badge>}
      >
        <Button asChild size="sm"><Link to="/traces" search={where}><Waypoints />Traces</Link></Button>
        <Button asChild size="sm"><Link to="/logs" search={{ ...where, f: new URLSearchParams({ service: name }).toString() }}><ScrollText />Logs</Link></Button>
        <Button asChild size="sm" variant="ghost"><Link to="/metrics" search={where}>Metrics</Link></Button>
      </PageHeader>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-caption text-muted-foreground">
        <span>Window <span className="text-foreground">last {label}</span></span>
        {environment ? <span>Environment <span className="font-mono text-foreground">{environment}</span></span> : null}
        {s ? <span>Last span <span className="font-mono text-foreground">{s.seen}</span></span> : null}
      </div>
      <PlacementPicker collapsible placement={placement} onChange={place} windowMs={windowMs} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
        <LineChart title="Requests" legend={s ? `${num(s.requests)} requests` : 'server and consumer spans'} values={lines.perSecond} overall={s?.perSecond ?? null} windowLabel={windowLabel} status={status} hi={rateHi} yLabels={axis(rateHi, '/s', status !== undefined)} xLabels={labels} aria={`Requests per second of ${name} over the last ${label}`} markers={markers} times={times} format={perSecond} />
        <LineChart title="Error rate" legend={s ? `${num(s.errors)} of ${num(s.requests)} requests · dashed: ${ERROR_THRESHOLD} % status page threshold` : `dashed: ${ERROR_THRESHOLD} % status page threshold`} values={lines.errorRate} overall={s?.err ?? null} windowLabel={windowLabel} status={status} markers={markers} threshold={ERROR_THRESHOLD} hi={errHi} yLabels={axis(errHi, '%', status !== undefined)} xLabels={labels} aria={`Error rate of ${name} over the last ${label}`} times={times} format={errorFormat} />
        <LineChart title="Latency" lines={percentileLines({ p50: lines.p50, p95: lines.p95, p99: lines.p99, overall: spread, spread: series?.spread ?? false })} live windowLabel={windowLabel} status={status} markers={markers} hi={latencyHi} yLabels={axis(latencyHi, 'ms', status !== undefined)} xLabels={labels} aria={`p50, p95 and p99 latency of ${name} over the last ${label}`} times={times} format={latency} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Operations</CardTitle><CardKind>Table</CardKind><span className="text-caption text-muted-foreground">by span name, server and consumer spans</span></CardHeader>
        {opsFailed ? <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">{because(opsFailed, 'The operations could not be read.')}</p> : null}
        {!opsFailed && operations.length === 0 ? <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">No operation served in the last {label}.</p> : null}
        <div className={cn('overflow-x-auto', operations.length === 0 && 'hidden')}>
          <Table aria-label="Operations">
            <thead><tr><Th>Span name</Th><Th numeric className="w-[90px]">Requests</Th><Th numeric className="w-[90px]">Error rate</Th><Th numeric className="w-[80px]">p50</Th><Th numeric className="w-[80px]">p95</Th><Th numeric className="w-[80px]">p99</Th><Th className="w-[110px]">Last seen</Th></tr></thead>
            <tbody>
              {paged.shown.map((o) => (
                <Tr key={o.name}>
                  <Td><span className="font-mono">{o.name}</span></Td><Td numeric>{o.rps}</Td>
                  <Td numeric className={cn((o.err ?? 0) >= ERROR_THRESHOLD && 'font-semibold text-warning-text')}>{o.err === null ? '—' : `${o.err.toFixed(1)} %`}</Td><Td numeric>{o.p50}</Td><Td numeric>{o.p95}</Td><Td numeric>{o.p99}</Td>
                  <Td className="font-mono text-control">{o.seen}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <PagedFooter paged={paged} noun="operations" />
      </Card>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Dependencies</CardTitle><CardKind>List</CardKind><span className="text-caption text-muted-foreground">direct callers and callees in the last {label}</span></CardHeader>
        {depsFailed ? <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">{because(depsFailed, 'The dependency graph could not be read.')}</p> : null}
        {!depsFailed && !depsPending && upstream.length === 0 && downstream.length === 0 ? (
          <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">No cross-service calls involving {name} in the last {label}.</p>
        ) : null}
        {!depsFailed && (upstream.length > 0 || downstream.length > 0) ? (
          <div className="grid gap-px bg-border-subtle sm:grid-cols-2">
            <div className="bg-card">
              <p className="m-0 px-3.5 pt-3 pb-1 text-caption text-muted-foreground">Called by <span className="text-faint-foreground">if {name} breaks, these feel it</span></p>
              {upstream.length === 0 ? <p className="m-0 px-3.5 py-2 text-control text-muted-foreground">Nothing calls {name}.</p> : upstream.map((edge) => <DependencyRow key={edge.caller} other={edge.caller} edge={edge} kept={kept} />)}
            </div>
            <div className="bg-card">
              <p className="m-0 px-3.5 pt-3 pb-1 text-caption text-muted-foreground">Depends on <span className="text-faint-foreground">if these break, {name} feels it</span></p>
              {downstream.length === 0 ? <p className="m-0 px-3.5 py-2 text-control text-muted-foreground">{name} calls nothing else.</p> : downstream.map((edge) => <DependencyRow key={edge.callee} other={edge.callee} edge={edge} kept={kept} />)}
            </div>
          </div>
        ) : null}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Open issues</CardTitle><CardKind>List</CardKind><span className="text-caption text-muted-foreground">seen in the last {label}</span></CardHeader>
        {open.length === 0 ? <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">No unresolved issue was seen on this service in the last {label}.</p> : null}
        {open.map((issue) => (
          <div key={issue.fingerprint} className="flex flex-col gap-1 border-b border-border-subtle px-3.5 py-2.5">
            <div className="flex items-baseline gap-2"><Link to={`/issues/${issue.fingerprint}`} className="flex-1 truncate font-mono font-semibold text-destructive-text">{issue.exception_type}</Link><span className="font-mono text-control">{num(issue.events)}</span></div>
            <span className="truncate font-mono text-caption text-muted-foreground">{issue.message}</span>
          </div>
        ))}
      </Card>
      <RunsOn service={name} />
      {!pending && !s ? <EmptyState title="Nothing measured yet">This service served no span in the last {label}{environment ? ` in ${environment}` : ''}.</EmptyState> : null}
    </>
  )
}

function DependencyRow({ other, edge, kept }: { other: string; edge: Edge; kept: Record<string, string> }) {
  const bad = (edge.err ?? 0) >= ERROR_THRESHOLD
  return (
    <Link to={`/services/${other}`} search={kept} className="flex items-center justify-between gap-2 border-t border-border-subtle px-3.5 py-2 text-foreground no-underline first:border-0">
      <span className="inline-flex min-w-0 items-center gap-2 truncate font-mono"><ServiceDot name={other} />{other}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-control text-muted-foreground">
        <span>{edge.calls} calls</span>
        {bad ? <span className="inline-flex items-center gap-1 font-semibold text-warning-text"><TriangleAlert className="size-3.5" aria-hidden />{edge.err?.toFixed(1)} %</span> : null}
      </span>
    </Link>
  )
}
