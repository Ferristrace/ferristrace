import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@/lib/router'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Table, Td, SortTh } from '@/components/ui/misc'
import { Pager } from '@/components/ui/pager'
import { EmptyState, Kpi, PageHeader } from '@/components/ft/bits'
import { StackedChart, stackColour, type Marker } from '@/components/ft/charts'
import {
  GROUP_BYS,
  LLM_PRICES_PATH,
  NO_FILTERS,
  SPEND_WINDOWS,
  formatCost,
  formatMs,
  formatTokens,
  useGroupCalls,
  useSpend,
  type GroupBy,
  type Spend,
  type SpendFilters,
  type SpendGroup,
} from '@/data/llm'
import { timeLabels } from '@/data/series'
import { ApiError, because } from '@/auth/client'
import { num, stamp } from '@/lib/format'
import { pagesOf } from '@/lib/paging'
import { sorted } from '@/lib/sorting'
import { FiltersBar } from './FiltersBar'
import { useSortState } from './useSortState'
import { useSettled } from '@/lib/settle'
import { cn } from '@/lib/utils'

const LAYERS = 7
const OTHER = 'other'
const FILTER_FIELDS: { name: keyof SpendFilters; placeholder: string }[] = [
  { name: 'feature', placeholder: 'Feature' },
  { name: 'model', placeholder: 'Model' },
  { name: 'customer', placeholder: 'Customer' },
  { name: 'user', placeholder: 'User' },
  { name: 'prompt', placeholder: 'Prompt version' },
]

const SHARE_ROWS = 8
const DEFAULT_SIZE = 10

const named = (key: string, groupBy: GroupBy) => (key === '' ? `(no ${groupBy})` : key)

const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

type Slice = { key: string; label: string; value: number; colour: string }

function slicesOf(groups: SpendGroup[], groupBy: GroupBy, read: (group: SpendGroup) => number): Slice[] {
  const shown = groups.slice(0, LAYERS)
  const rest = groups.slice(LAYERS)
  const slices = shown.map((group, at) => ({ key: group.key, label: named(group.key, groupBy), value: read(group), colour: stackColour(at) }))
  if (rest.length > 0) slices.push({ key: OTHER, label: OTHER, value: rest.reduce((sum, group) => sum + read(group), 0), colour: stackColour(LAYERS) })
  return slices
}

function Donut({ slices, total, centre, caption }: { slices: Slice[]; total: number; centre: string; caption: string }) {
  const radius = 40
  const round = 2 * Math.PI * radius
  const drawn = slices.reduce<{ slice: Slice; length: number; offset: number }[]>((all, slice) => {
    const length = total > 0 ? (slice.value / total) * round : 0
    const offset = all.length ? all[all.length - 1].offset + all[all.length - 1].length : 0
    return [...all, { slice, length, offset }]
  }, [])
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 px-4 py-4">
      <div className="relative size-[172px] shrink-0">
        <svg viewBox="0 0 100 100" role="img" aria-label={`${caption}: ${slices.map((slice) => `${slice.label} ${percent(slice.value, total).toFixed(0)} percent`).join(', ')}`} className="size-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--border)" strokeWidth="12" />
          {drawn.map(({ slice, length, offset }) => length > 0 ? <circle key={slice.key} cx="50" cy="50" r={radius} fill="none" stroke={slice.colour} strokeWidth="12" strokeDasharray={`${length} ${round - length}`} strokeDashoffset={-offset} /> : null)}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-heading tabular">{centre}</span>
          <span className="text-caption text-muted-foreground">{caption}</span>
        </div>
      </div>
      <ul className="m-0 flex min-w-[200px] flex-1 list-none flex-col gap-2 p-0 text-control">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2">
            <span className="inline-block size-2 shrink-0 rounded-sm" style={{ background: slice.colour }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="font-mono tabular">{formatCost(slice.value)}</span>
            <span className="w-10 text-right font-mono text-caption text-muted-foreground tabular">{percent(slice.value, total).toFixed(0)} %</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Bar = { key: string; label: string; value: number; text: string }

function HBars({ rows, label }: { rows: Bar[]; label: string }) {
  const top = Math.max(1e-9, ...rows.map((row) => row.value))
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-3 px-4 py-4 text-control">
      {rows.map((row, at) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 max-md:grid-cols-[minmax(0,1fr)_auto]">
          <span className="truncate font-mono" title={row.label}>{row.label}</span>
          <span className="block h-2 overflow-hidden rounded-full bg-muted max-md:order-last max-md:col-span-2" aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, (row.value / top) * 100)}%`, background: stackColour(at) }} />
          </span>
          <span className="font-mono tabular">{row.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Panel({ title, kind, children, className }: { title: string; kind: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('flex min-w-0 flex-col overflow-hidden', className)}>
      <CardHeader><CardTitle>{title}</CardTitle><CardKind>{kind}</CardKind></CardHeader>
      {children}
    </Card>
  )
}

function layersOf(groups: SpendGroup[]) {
  const shown = groups.slice(0, LAYERS)
  const rest = groups.slice(LAYERS)
  const layers = shown.map((group) => ({ key: group.key, values: group.points.map((point) => point[1]) }))
  if (rest.length > 0) {
    layers.push({ key: OTHER, values: rest[0].points.map((_, at) => rest.reduce((sum, group) => sum + group.points[at][1], 0)) })
  }
  return layers
}

function markersOf(spend: Spend): Marker[] {
  const first = spend.groups[0]?.points[0]?.[0]
  if (first === undefined) return []
  const last = spend.groups[0].points.length - 1
  return spend.markers
    .map((marker) => ({ at: (marker.timeMs - first) / spend.stepMs, label: `${marker.feature} ${marker.promptVersion}` }))
    .filter((marker) => marker.at >= 0 && marker.at <= last)
}

function Calls({ windowMs, groupBy, selected, filters }: { windowMs: number; groupBy: GroupBy; selected: string; filters: SpendFilters }) {
  const navigate = useNavigate()
  const { calls, pending, failed } = useGroupCalls(windowMs, groupBy, selected, filters)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [page, setPage] = useState(1)
  const { sorting, dir, on } = useSortState<'time' | 'model' | 'feature' | 'in' | 'out' | 'duration' | 'cost'>()
  const ordered = useMemo(
    () => sorted(calls, sorting, (c, key) => (key === 'time' ? c.timeMs : key === 'model' ? c.model : key === 'feature' ? c.feature : key === 'in' ? c.inputTokens : key === 'out' ? c.outputTokens : key === 'duration' ? c.durationMs : c.cost)),
    [calls, sorting],
  )
  const at = Math.min(page, pagesOf(calls.length, size))
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>Calls of {named(selected, groupBy)}</CardTitle><CardKind>Table</CardKind></CardHeader>
      {failed ? <p className="m-0 px-4 py-3 text-control text-muted-foreground">{because(failed, 'The calls could not be read.')}</p> : null}
      {!failed && !pending && calls.length === 0 ? <p className="m-0 px-4 py-3 text-control text-muted-foreground">No call in this window.</p> : null}
      {calls.length > 0 ? (
        <div className="overflow-x-auto">
          <Table aria-label={`Calls of ${named(selected, groupBy)}`}>
            <thead><tr><SortTh label="Time" dir={dir('time')} onSort={on('time', 'desc')} className="w-[170px]" /><SortTh label="Model" dir={dir('model')} onSort={on('model')} /><SortTh label="Feature" dir={dir('feature')} onSort={on('feature')} /><SortTh numeric label="Tokens in" dir={dir('in')} onSort={on('in', 'desc')} className="w-[90px]" /><SortTh numeric label="Tokens out" dir={dir('out')} onSort={on('out', 'desc')} className="w-[90px]" /><SortTh numeric label="Duration" dir={dir('duration')} onSort={on('duration', 'desc')} className="w-[90px]" /><SortTh numeric label="Cost" dir={dir('cost')} onSort={on('cost', 'desc')} className="w-[90px]" /></tr></thead>
            <tbody>
              {ordered.slice((at - 1) * size, at * size).map((call) => {
                const to = `/traces/${call.traceId}`
                return (
                  <tr key={`${call.traceId}-${call.spanId}`} onClick={() => navigate(to)} className="cursor-pointer hover:[&>td]:bg-row-hover">
                    <Td className="font-mono text-control"><Link to={to} onClick={(e) => e.stopPropagation()} className="text-foreground">{stamp(call.timeMs)}</Link></Td>
                    <Td className="font-mono text-control">{call.model}{call.error ? <Badge variant="destructive" size="xs" className="ml-2">error</Badge> : null}</Td>
                    <Td className="text-control">{call.feature}</Td>
                    <Td numeric>{formatTokens(call.inputTokens)}</Td>
                    <Td numeric>{formatTokens(call.outputTokens)}</Td>
                    <Td numeric>{formatMs(call.durationMs)}</Td>
                    <Td numeric className={cn(call.cost === null && 'text-warning-text')}>{formatCost(call.cost)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      ) : null}
      {calls.length > 0 ? <Pager total={calls.length} page={at} size={size} onPage={setPage} onSize={(next) => { setSize(next); setPage(1) }} noun="calls" className="border-t" /> : null}
    </Card>
  )
}

export function Ai() {
  const [range, setRange] = useState('1d')
  const [groupBy, setGroupBy] = useState<GroupBy>('feature')
  const [typed, setTyped] = useState<SpendFilters>(NO_FILTERS)
  const [selected, setSelected] = useState<string | null>(null)
  const filters = useSettled(typed)
  const windowMs = SPEND_WINDOWS.find((w) => w.value === range)?.ms ?? SPEND_WINDOWS[1].ms
  const { spend, pending, failed } = useSpend(windowMs, groupBy, filters)
  const groups = spend?.groups ?? []
  const totals = useMemo(
    () => groups.reduce((sum, g) => ({ cost: sum.cost + g.cost, calls: sum.calls + g.calls, input: sum.input + g.inputTokens, output: sum.output + g.outputTokens, unpriced: sum.unpriced + g.unpriced }), { cost: 0, calls: 0, input: 0, output: 0, unpriced: 0 }),
    [groups],
  )
  const unconfigured = failed instanceof ApiError && failed.status === 503
  const layers = layersOf(groups)
  const filtered = Object.values(filters).some((value) => value.trim() !== '')
  const toggle = (key: string) => setSelected(key === selected ? null : key)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [page, setPage] = useState(1)
  const spendSort = useSortState<'key' | 'cost' | 'calls' | 'in' | 'out' | 'p50' | 'p95' | 'errors'>()
  const rows = useMemo(
    () => sorted(groups, spendSort.sorting, (g, key) => (key === 'key' ? named(g.key, groupBy) : key === 'cost' ? g.cost : key === 'calls' ? g.calls : key === 'in' ? g.inputTokens : key === 'out' ? g.outputTokens : key === 'p50' ? g.p50Ms : key === 'p95' ? g.p95Ms : g.errors)),
    [groups, spendSort.sorting, groupBy],
  )
  const at = Math.min(page, pagesOf(groups.length, size))
  const shares = useMemo(() => slicesOf(groups, groupBy, (group) => group.cost), [groups, groupBy])
  const slowest = useMemo(() => [...groups].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, SHARE_ROWS).map((group) => ({ key: group.key, label: named(group.key, groupBy), value: group.p95Ms, text: formatMs(group.p95Ms) })), [groups, groupBy])
  const heaviest = useMemo(() => [...groups].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)).slice(0, SHARE_ROWS).map((group) => ({ key: group.key, label: named(group.key, groupBy), value: group.inputTokens + group.outputTokens, text: `${formatTokens(group.inputTokens)} in · ${formatTokens(group.outputTokens)} out` })), [groups, groupBy])
  const windowLabel = SPEND_WINDOWS.find((w) => w.value === range)?.label ?? ''
  const groupLabel = GROUP_BYS.find((g) => g.value === groupBy)?.label ?? groupBy
  return (
    <>
      <PageHeader title="AI spend" meta={<CardKind>last {windowLabel}</CardKind>}>
        <Segmented label="Window" value={range} onChange={setRange} options={SPEND_WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
      </PageHeader>
      <FiltersBar active={Object.values(typed).filter((value) => value.trim() !== '').length} role="search">
        {FILTER_FIELDS.map((field) => (
          <InputGroup key={field.name} className="w-[160px] max-w-full max-md:w-[calc(50%-4px)]">
            <input aria-label={field.placeholder} placeholder={field.placeholder} value={typed[field.name]} onChange={(e) => setTyped({ ...typed, [field.name]: e.target.value })} />
          </InputGroup>
        ))}
        <Segmented label="Group by" value={groupBy} onChange={(next) => { setGroupBy(next); setSelected(null); setPage(1) }} options={GROUP_BYS.map((g) => ({ value: g.value, label: g.label }))} />
      </FiltersBar>
      {unconfigured ? (
        <EmptyState title="AI spend is not configured">This deployment has no span store, so there are no LLM calls to read. Configure one to see them here.</EmptyState>
      ) : failed ? (
        <EmptyState title="The spend could not be read">{because(failed, 'The span store did not answer.')}</EmptyState>
      ) : !pending && groups.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={filtered ? 'No LLM call matches in this window' : 'No LLM call in this window'}
          code={'gen_ai.provider.name=openai\ngen_ai.request.model=gpt-4o\ngen_ai.usage.input_tokens=1200\ngen_ai.usage.output_tokens=300\nferristrace.feature=ticket-summary'}
        >
          {filtered
            ? 'Clear a filter or widen the window.'
            : 'A span is an LLM call when it carries gen_ai.provider.name (or gen_ai.system) or gen_ai.request.model, the OpenTelemetry GenAI conventions. Send the token counts as gen_ai.usage.input_tokens and gen_ai.usage.output_tokens, and say who the call is for with ferristrace.feature, ferristrace.customer and ferristrace.prompt.version. Then enter the prices of your models under Settings, LLM prices. Prompts and completions are never copied out of the span.'}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Total spend" value={formatCost(totals.cost)} sub="priced calls in the window" />
            <Kpi label="Calls" value={num(totals.calls)} />
            <Kpi label="Tokens" value={`${formatTokens(totals.input)} in`} sub={`${formatTokens(totals.output)} out`} />
            <Kpi
              label="Unpriced calls"
              value={num(totals.unpriced)}
              sub={totals.unpriced > 0 ? 'add their prices under LLM prices' : 'every call has a price'}
              tone={totals.unpriced > 0 ? 'warn' : undefined}
              to={totals.unpriced > 0 ? LLM_PRICES_PATH : undefined}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {spend && layers.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-2">
                <StackedChart
                  title={`Spend by ${groupBy}`}
                  layers={layers}
                  markers={markersOf(spend)}
                  times={spend.groups[0]?.points.map((point) => point[0])}
                  format={formatCost}
                  yLabels={(top) => [formatCost(top), formatCost(top / 2), '$0.00']}
                  xLabels={timeLabels(spend.fromMs, spend.toMs)}
                  aria={`Stacked cost per ${groupBy} over the window`}
                />
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground">
                  {layers.map((layer, index) => <span key={layer.key} className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm" style={{ background: stackColour(index) }} />{named(layer.key, groupBy)}</span>)}
                </div>
              </div>
            ) : null}
            <Panel title={`Share of spend by ${groupBy}`} kind="Donut">
              <Donut slices={shares} total={totals.cost} centre={formatCost(totals.cost)} caption={`last ${windowLabel}`} />
            </Panel>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title={`p95 latency by ${groupBy}`} kind="Bar"><HBars rows={slowest} label={`p95 latency per ${groupBy}`} /></Panel>
            <Panel title={`Tokens by ${groupBy}`} kind="Bar"><HBars rows={heaviest} label={`Tokens per ${groupBy}`} /></Panel>
          </div>
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Breakdown by {groupLabel.toLowerCase()}</CardTitle><CardKind>Table</CardKind></CardHeader>
            <div className="overflow-x-auto">
              <Table aria-label="Spend by group">
                <thead><tr><SortTh label={groupLabel} dir={spendSort.dir('key')} onSort={spendSort.on('key')} /><SortTh numeric label="Cost" dir={spendSort.dir('cost')} onSort={spendSort.on('cost', 'desc')} className="w-[100px]" /><SortTh numeric label="Calls" dir={spendSort.dir('calls')} onSort={spendSort.on('calls', 'desc')} className="w-[80px]" /><SortTh numeric label="Tokens in" dir={spendSort.dir('in')} onSort={spendSort.on('in', 'desc')} className="w-[90px]" /><SortTh numeric label="Tokens out" dir={spendSort.dir('out')} onSort={spendSort.on('out', 'desc')} className="w-[90px]" /><SortTh numeric label="p50" dir={spendSort.dir('p50')} onSort={spendSort.on('p50', 'desc')} className="w-[80px]" /><SortTh numeric label="p95" dir={spendSort.dir('p95')} onSort={spendSort.on('p95', 'desc')} className="w-[80px]" /><SortTh numeric label="Errors" dir={spendSort.dir('errors')} onSort={spendSort.on('errors', 'desc')} className="w-[80px]" /></tr></thead>
                <tbody>
                  {rows.slice((at - 1) * size, at * size).map((g) => (
                    <tr key={g.key} onClick={() => toggle(g.key)} className={cn('cursor-pointer hover:[&>td]:bg-row-hover', g.key === selected && '[&>td]:bg-accent-subtle')}>
                      <Td>
                        <button type="button" aria-pressed={g.key === selected} onClick={(e) => { e.stopPropagation(); toggle(g.key) }} className="cursor-pointer bg-transparent p-0 font-mono font-semibold text-foreground">{named(g.key, groupBy)}</button>
                        {g.unpriced > 0 ? <Badge variant="warning" size="xs" className="ml-2">{num(g.unpriced)} unpriced</Badge> : null}
                      </Td>
                      <Td numeric>{formatCost(g.cost)}</Td>
                      <Td numeric>{num(g.calls)}</Td>
                      <Td numeric>{formatTokens(g.inputTokens)}</Td>
                      <Td numeric>{formatTokens(g.outputTokens)}</Td>
                      <Td numeric>{formatMs(g.p50Ms)}</Td>
                      <Td numeric>{formatMs(g.p95Ms)}</Td>
                      <Td numeric className={cn(g.errors > 0 && 'font-semibold text-destructive-text')}>{num(g.errors)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pager total={groups.length} page={at} size={size} onPage={setPage} onSize={(next) => { setSize(next); setPage(1) }} noun="rows" />
          </Card>
          {selected === '' ? <p className="m-0 text-control text-muted-foreground">Calls without a {groupBy} cannot be listed on their own; filter on another field.</p> : null}
          {selected ? <Calls key={selected} windowMs={windowMs} groupBy={groupBy} selected={selected} filters={filters} /> : null}
        </>
      )}
    </>
  )
}
