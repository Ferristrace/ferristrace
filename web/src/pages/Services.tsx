import { Boxes, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { Link, useSearchParam } from '@/lib/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { EmptyState, PageHeader } from '@/components/ft/bits'
import { DataTable } from '@/components/ft/datatable/DataTable'
import { AddChartColumn } from '@/components/ft/datatable/AddChartColumn'
import { Spark, type SparkTone } from '@/components/ft/datatable/Spark'
import { useDataTable, type Column } from '@/components/ft/datatable/useDataTable'
import { formatMs } from '@/components/ft/datatable/model'
import { charted, ERROR_THRESHOLD, useServiceTable, type Service, type Stepped } from '@/data/services'
import { MAX_SERIES, useErrorRatesBefore, useSeriesOfServices } from '@/data/serviceRows'
import { useReleases } from '@/data/releases'
import { CRITICAL_FACTOR } from '@/pages/home/attention'
import { useWindow } from '@/lib/window'
import { placementSearch, usePlacement } from '@/data/placement'
import { PlacementPicker, placedCount } from '@/components/ft/Placement'
import { because } from '@/auth/client'
import { dur } from '@/lib/format'
import { useSettled } from '@/lib/settle'
import { textFirst } from './backend/sortKeys'
import type { Sorting } from '@/lib/sorting'
import { chartId, deltaOf, deltaText, HEALTH_LABEL, healthOf, latestReleases, METRICS, storedCharts, withChart, type ChartSpec, type Health, type Metric } from '@/lib/serviceRows'
import { cn } from '@/lib/utils'
import { Pill, Pills } from './backend/kit'

const SORTS = [
  { value: 'err', label: 'Error rate' },
  { value: 'rps', label: 'Requests' },
  { value: 'p50', label: 'p50' },
  { value: 'p95', label: 'p95' },
  { value: 'p99', label: 'p99' },
  { value: 'seen', label: 'Last span' },
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'release', label: 'Release' },
] as const

const STORAGE = 'ft-table-services'
const CHARTS = 'ft-table-services-charts'
const SIZES = [10, MAX_SERIES]
const DEFAULT_COLUMNS = ['name', 'status', 'p95', 'err', 'rps', 'release']
const DEFAULT_CHARTS: Partial<Record<Metric, ChartSpec['style']>> = { p95: 'line', err: 'area', rps: 'bars' }
const RANK: Record<Health, number> = { down: 3, degraded: 2, healthy: 1 }

const PILL: Record<Health, string> = {
  down: 'border-destructive-border bg-destructive-subtle text-destructive-text',
  degraded: 'border-warning-border bg-warning-subtle text-warning-text',
  healthy: 'border-success-border bg-success-subtle text-success-text',
}

const TONE: Record<Health, SparkTone> = { down: 'bad', degraded: 'warn', healthy: 'ok' }

const LABEL: Record<Metric, string> = Object.fromEntries(METRICS.map((one) => [one.value, one.label])) as Record<Metric, string>

const readCharts = () => {
  try {
    return storedCharts(window.localStorage.getItem(CHARTS))
  } catch {
    return []
  }
}

const saveCharts = (specs: ChartSpec[]) => {
  try {
    window.localStorage.setItem(CHARTS, JSON.stringify(specs))
  } catch {
    return
  }
}

const valueOf = (row: Service, metric: Metric): number | null =>
  metric === 'err' ? row.err : metric === 'rps' ? row.perSecond : row.requests === 0 ? null : (metric === 'p50' ? row.p50Us : metric === 'p95' ? row.p95Us : row.p99Us) / 1000

const textOf = (row: Service, metric: Metric): string =>
  metric === 'err' ? (row.err === null ? '—' : `${row.err.toFixed(1)} %`) : metric === 'rps' ? row.rps : metric === 'p50' ? row.p50 : metric === 'p95' ? row.p95 : row.p99

const formatOf = (metric: Metric) => (value: number) => (metric === 'err' ? `${value.toFixed(1)} %` : metric === 'rps' ? `${value < 10 ? value.toFixed(1) : Math.round(value)}/s` : dur(value))

const seriesOf = (series: Stepped | undefined, metric: Metric) => {
  if (!series) return null
  const charts = charted(series)
  const values = metric === 'err' ? charts.errorRate : metric === 'rps' ? charts.perSecond : charts[metric]
  return { values, times: series.points.map((point) => point.atMs), format: formatOf(metric) }
}

function StatusPill({ health }: { health: Health | null }) {
  if (!health) return <span className="text-caption text-muted-foreground">No data</span>
  return <span className={cn('inline-flex h-[18px] items-center rounded-sm border px-1.5 font-mono text-[11px] font-semibold', PILL[health])}>{HEALTH_LABEL[health]}</span>
}

export function Services() {
  const { ms: windowMs, label, short } = useWindow()
  const [sorting, setSorting] = useState<Sorting<string>>({ key: 'err', dir: 'desc' })
  const [hideEmpty, setHideEmpty] = useState(false)
  const [charts, setCharts] = useState<ChartSpec[]>(readCharts)
  const route = useRouterNavigate()
  const environment = useSearchParam('env') ?? ''
  const [typedEnv, setTypedEnv] = useState(environment)
  const settledEnv = useSettled(typedEnv)
  const { placement, place } = usePlacement()
  const { services, pending, failed } = useServiceTable(settledEnv, windowMs, placement)
  const { releases } = useReleases(windowMs)
  const before = useErrorRatesBefore(settledEnv, windowMs, placement)
  const versions = useMemo(() => latestReleases(releases), [releases])
  const kept = { ...(settledEnv.trim() ? { env: settledEnv.trim() } : {}), ...placementSearch(placement) }
  useEffect(() => {
    if (settledEnv.trim() !== environment) void route({ to: '/services' as never, search: kept as never, replace: true })
  }, [settledEnv])
  const rows = useMemo(() => services.filter((s) => !hideEmpty || s.err !== null), [hideEmpty, services])
  const [pageNames, setPageNames] = useState<string[]>([])
  const [charting, setCharting] = useState(true)
  const series = useSeriesOfServices(pageNames, settledEnv, windowMs, placement, charting)
  const health = (row: Service) => healthOf(row.err, ERROR_THRESHOLD, CRITICAL_FACTOR)

  const columns = useMemo<Column<Service>[]>(() => {
    const chart = (metric: Metric, style: ChartSpec['style'], id: string, header: string): Column<Service> => ({
      id,
      header,
      numeric: true,
      tag: short,
      sort: (row) => valueOf(row, metric),
      text: (row) => valueOf(row, metric),
      filter: metric === 'err'
        ? { kind: 'number', unit: '%', presets: [1, ERROR_THRESHOLD, ERROR_THRESHOLD * CRITICAL_FACTOR, 10], value: (row) => row.err }
        : metric === 'rps'
          ? undefined
          : { kind: 'number', unit: 'ms', presets: [100, 500, 1000, 2000], format: formatMs, value: (row) => valueOf(row, metric) },
      cell: (row) => {
        const shown = seriesOf(series.get(row.name), metric)
        const state = health(row)
        const bad = metric === 'err' && (state === 'down' || state === 'degraded')
        const delta = metric === 'err' ? deltaOf(row.err, before.get(row.name)) : null
        return (
          <span className="flex items-center justify-end gap-2.5">
            <b className={cn('min-w-[58px] text-right font-medium', bad && 'text-destructive-text', row.err === null && metric === 'err' && 'text-muted-foreground')}>{textOf(row, metric)}</b>
            {shown ? <Spark values={shown.values} times={shown.times} style={style} format={shown.format} tone={metric === 'err' && state ? TONE[state] : 'line'} label={`${header} of ${row.name}`} /> : <span className="inline-block w-[132px]" aria-hidden />}
            {metric === 'err' ? <span className={cn('min-w-[64px] text-right font-sans text-caption', delta !== null && delta > 0 && 'text-destructive-text', delta !== null && delta < 0 && 'text-success-text')} title={delta === null ? undefined : `Change from the ${label} before`}>{delta === null ? '' : deltaText(delta)}</span> : null}
          </span>
        )
      },
    })
    return [
      {
        id: 'name',
        header: 'Service',
        hideable: false,
        firstDir: 'asc',
        sort: (row) => row.name,
        text: (row) => row.name,
        cell: (row) => (
          <Link to={`/services/${row.name}`} search={kept} className="inline-flex items-center gap-2 font-medium text-accent-text no-underline hover:underline" onClick={(event) => event.stopPropagation()}>
            {row.name}{row.name.startsWith('unknown') ? <Badge variant="warning" size="xs">service.name not set</Badge> : null}
          </Link>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        sort: (row) => { const state = health(row); return state ? RANK[state] : null },
        text: (row) => { const state = health(row); return state ? HEALTH_LABEL[state] : 'No data' },
        filter: { kind: 'values', noun: 'statuses', value: (row) => { const state = health(row); return state ? HEALTH_LABEL[state] : 'No data' } },
        cell: (row) => <StatusPill health={health(row)} />,
      },
      chart('p95', 'line', 'p95', 'p95 latency'),
      chart('err', 'area', 'err', 'Error rate'),
      chart('rps', 'bars', 'rps', 'Requests'),
      {
        id: 'release',
        header: 'Release',
        firstDir: 'asc',
        sort: (row) => versions.get(row.name) ?? null,
        text: (row) => versions.get(row.name) ?? null,
        filter: { kind: 'values', noun: 'releases', value: (row) => versions.get(row.name) ?? null },
        cell: (row) => <span className="font-mono text-caption text-muted-foreground">{versions.get(row.name) ?? '—'}</span>,
      },
      { id: 'p50', header: 'p50', numeric: true, sort: (row) => row.p50Us, text: (row) => row.p50, cell: (row) => row.p50 },
      { id: 'p99', header: 'p99', numeric: true, sort: (row) => row.p99Us, text: (row) => row.p99, cell: (row) => row.p99 },
      { id: 'seen', header: 'Last span', sort: (row) => row.lastSeenMs, text: (row) => row.seen, cell: (row) => <span className={cn('font-mono text-control', row.seen.includes('min') && 'text-muted-foreground')}>{row.seen}</span> },
      ...charts.map((spec) => chart(spec.metric, spec.style, chartId(spec), `${LABEL[spec.metric]} (${spec.style})`)),
    ]
  }, [series, before, versions, short, label, charts, kept.env, placement])

  const table = useDataTable<Service>({
    rows,
    columns,
    rowKey: (row) => row.name,
    storageKey: STORAGE,
    defaultColumns: DEFAULT_COLUMNS,
    sorting,
    onSorting: (next) => setSorting(next ?? { key: 'err', dir: 'desc' }),
    pageSize: 10,
    resetKey: `${hideEmpty}|${settledEnv}`,
  })
  const names = table.pageRows.map((row) => row.name).join('\n')
  const chartsShown = table.shown.some((column) => column.id in DEFAULT_CHARTS || column.id.startsWith('chart:'))
  useEffect(() => setPageNames(names ? names.split('\n') : []), [names])
  useEffect(() => setCharting(chartsShown), [chartsShown])

  const addChart = (metric: Metric, style: ChartSpec['style']) => {
    const spec = { metric, style }
    const id = DEFAULT_CHARTS[metric] === style ? metric : chartId(spec)
    if (id === metric) { table.toggleColumn(id, true); return }
    const next = withChart(charts, spec)
    setCharts(next)
    saveCharts(next)
    table.toggleColumn(id, true)
  }
  const preview = (metric: Metric) => seriesOf(table.pageRows.map((row) => series.get(row.name)).find(Boolean), metric)
  const pressured = services.filter((s) => (s.err ?? 0) >= ERROR_THRESHOLD).length
  const placed = placedCount(placement)

  return (
    <>
      <PageHeader title="Services" meta={<Pills><Pill>{services.length} {services.length === 1 ? 'service' : 'services'}</Pill>{pressured > 0 ? <Pill tone="err">{pressured} above {ERROR_THRESHOLD} % errors</Pill> : null}<Pill>last {label}</Pill></Pills>} />
      <DataTable
        table={table}
        label="Services"
        noun="services"
        searchLabel="Search services"
        selectable
        exportName="services"
        sizes={SIZES}
        loading={pending}
        onRowClick={(row) => void route({ to: `/services/${row.name}` as never, search: kept as never })}
        toolbar={
          <>
            <InputGroup className="h-[34px] w-[200px] max-w-full max-md:w-full"><input aria-label="Environment" placeholder="Environment, e.g. production" value={typedEnv} onChange={(e) => setTypedEnv(e.target.value)} /></InputGroup>
            <Popover>
              <PopoverTrigger asChild>
                <Button className="h-[34px]" aria-label="Kubernetes placement"><Boxes />Kubernetes{placed > 0 ? <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">{placed}</span> : null}</Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(560px,calc(100vw-32px))] p-3">
                <PlacementPicker placement={placement} onChange={place} windowMs={windowMs} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button className="h-[34px]" aria-label="Display options"><SlidersHorizontal />Display</Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="flex w-[300px] flex-col gap-3 p-3">
                <div className="flex items-center justify-between gap-2 text-control">
                  Order
                  <NativeSelect aria-label="Sort by" value={sorting.key} onChange={(e) => setSorting({ key: e.target.value, dir: e.target.value === 'release' ? 'asc' : textFirst(e.target.value) })} className="h-7 w-[160px]">
                    {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </NativeSelect>
                </div>
                <Switch checked={hideEmpty} onCheckedChange={setHideEmpty} label="Hide services with no data" />
              </PopoverContent>
            </Popover>
          </>
        }
        actions={<AddChartColumn metrics={METRICS} preview={preview} onAdd={addChart} windowLabel={label} />}
        error={failed ? <EmptyState title="The services could not be read">{because(failed, 'The span store did not answer')}</EmptyState> : undefined}
        empty={<EmptyState title={settledEnv.trim() ? `No services in ${settledEnv.trim()} in the last ${label}` : `No services in the last ${label}`} code="OTEL_SERVICE_NAME=checkout-api">A service appears as soon as one span it served arrives with a service.name. The environment filter reads the deployment.environment span attribute.</EmptyState>}
        footnote={<>Hover a chart to read one value. Charts share the page time range and cover the rows of this page. From the <span className="font-mono">service.name</span> resource attribute of your spans: requests and error rate count the server and consumer spans of each service, spans with status ERROR ÷ all of them. Degraded from {ERROR_THRESHOLD} % errors, the status page threshold, down from {ERROR_THRESHOLD * CRITICAL_FACTOR} %. The change is against the {label} before.</>}
      />
    </>
  )
}
