import { Boxes, Copy, ListFilter, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { Link, useNavigate, useSearchParam } from '@/lib/router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ViewsPanel, ViewsToggle, useViewsState } from '@/components/ft/Views'
import { Facets } from '@/components/ft/Facets'
import { FilterBar } from '@/components/ft/FilterBar'
import { QueryBar } from '@/components/ft/QueryBar'
import { isChip, itemsText, normalise, parse, queryTextOf, type Node } from '@/lib/queryLang'
import { withValue, withoutValue, type Chip, type FieldRef } from '@/lib/traceQuery'
import { Kbd } from '@/components/ui/misc'
import { Pager } from '@/components/ui/pager'
import { TimelineBar } from '@/pages/explore/ResultsCard'
import { DataTable } from '@/components/ft/datatable/DataTable'
import { useDataTable, type Column } from '@/components/ft/datatable/useDataTable'
import { formatMs } from '@/components/ft/datatable/model'
import { EmptyState, PageHeader, ServiceDot } from '@/components/ft/bits'
import { ANY, COUNTS, useTraces, type Sift, type TraceRow } from '@/data/traces'
import { groupOf, measureOf, orderOf, tabOf, TABS, TAB_LABELS, type Definition, type Measure, type Order, type Tab } from '@/data/views'
import { SeriesPanel } from '@/components/ft/SeriesPanel'
import { TABLE_DEFAULT_GROUP, TablePanel } from '@/components/ft/TablePanel'
import { Histogram } from '@/components/ft/Histogram'
import { useZoom } from '@/lib/bounds'
import { useSpans } from '@/data/spans'
import { SpansTable } from '@/components/ft/SpansTable'
import { ValueMenu } from '@/components/ft/ValueMenu'
import { isPlaced, NOWHERE, usePlacement } from '@/data/placement'
import { PlacementPicker, placedCount } from '@/components/ft/Placement'
import { because } from '@/auth/client'
import { shortId } from '@/lib/format'
import { pagesOf } from '@/lib/paging'
import { cn } from '@/lib/utils'
import { useWindow } from '@/lib/window'

const codeTone = (code: number, errors: number) =>
  code >= 500 || errors > 0 ? 'text-destructive-text' : code >= 400 ? 'text-warning-text' : 'text-muted-foreground'

const NUMERIC = ['http_status_code', 'duration']

const DEFAULT_COLUMNS = ['root', 'service', 'trace', 'duration', 'status', 'spans', 'started', 'timeline']

function TraceStatus({ errors }: { errors: number }) {
  return errors > 0
    ? <span title={`${errors} errors`} className="inline-flex h-[18px] items-center rounded-sm border border-destructive-border bg-destructive-subtle px-1.5 font-mono text-[11px] font-semibold text-destructive-text">ERROR</span>
    : <span className="inline-flex h-[18px] items-center rounded-sm border border-success-border bg-success-subtle px-1.5 font-mono text-[11px] font-semibold text-success-text">OK</span>
}

const counts = (field: FieldRef) => 'built' in field && NUMERIC.includes(field.built)

export function Traces() {
  const navigate = useNavigate()
  const goTo = useRouterNavigate()
  const { ms: windowMs, label: windowLabel } = useWindow()
  const [limit, setLimit] = useState(ANY.limit)
  const [density, setDensity] = useState<'compact' | 'comfy'>('compact')
  const [cursor, setCursor] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const rawQuery = useSearchParam('q')
  const text = useMemo(() => queryTextOf(rawQuery), [rawQuery])
  const parsed = useMemo(() => parse(text), [text])
  const items = useMemo<Node[]>(() => (parsed.ok ? parsed.items : []), [parsed])
  const chips = useMemo(() => items.filter(isChip), [items])
  const others = useMemo(() => items.filter((item) => !isChip(item)), [items])
  const order = orderOf(useSearchParam('o'))
  const tab = tabOf(useSearchParam('t'))
  const measure = measureOf(useSearchParam('m'))
  const zoom = useZoom()
  const group = groupOf(useSearchParam('g'))
  const viewParam = useSearchParam('view')
  const viewKey = viewParam ?? (items.length === 0 && order === 'started' && tab === 'traces' ? 'recent' : undefined)
  const sift = useMemo<Sift>(() => ({ ...ANY, rangeMs: windowMs, order, limit }), [windowMs, order, limit])
  const { placement, place } = usePlacement()
  const { rows, loading, failed } = useTraces(sift, placement, items, tab === 'traces')
  const spans = useSpans(windowMs, order, limit, items, tab === 'spans')
  const total = tab === 'spans' ? spans.rows.length : rows.length
  const at = Math.min(page, pagesOf(total, size))
  const offset = (at - 1) * size
  const slowest = Math.max(1, ...rows.map((row) => row.durationMs))
  const copy = (id: string) => { void navigator.clipboard?.writeText(id); toast.success('Trace id copied', { description: shortId(id) }) }
  const onFilter = useRef<(field: FieldRef, value: string, keep: boolean) => void>(() => undefined)
  const columns = useMemo<Column<TraceRow>[]>(() => [
    {
      id: 'root',
      header: 'Root operation',
      hideable: false,
      firstDir: 'asc',
      sort: (t) => t.root,
      text: (t) => t.root,
      className: 'max-w-[320px]',
      cell: (t) => <Link to={`/traces/${t.id}`} className="block truncate font-medium text-accent-text" onClick={(e) => e.stopPropagation()}>{t.root}</Link>,
    },
    {
      id: 'service',
      header: 'Service',
      firstDir: 'asc',
      sort: (t) => t.svc,
      text: (t) => t.svc,
      filter: { kind: 'values', noun: 'services', value: (t) => t.svc },
      cell: (t) => (
        <ValueMenu field={{ built: 'service' }} value={t.svc} onFilter={(...args) => onFilter.current(...args)}>
          <span className="inline-flex items-center gap-1.5 truncate text-control"><ServiceDot name={t.svc} />{t.svc}</span>
        </ValueMenu>
      ),
    },
    {
      id: 'trace',
      header: 'Trace ID',
      firstDir: 'asc',
      sort: (t) => t.id,
      text: (t) => t.id,
      cell: (t) => <button type="button" onClick={(e) => { e.stopPropagation(); copy(t.id) }} className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm font-mono text-caption text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" title={t.id} aria-label={`Copy trace id ${t.id}`}>{shortId(t.id)}<Copy className="size-3" aria-hidden /></button>,
    },
    {
      id: 'duration',
      header: 'Duration',
      numeric: true,
      sort: (t) => t.durationMs,
      text: (t) => t.durationMs,
      filter: { kind: 'number', unit: 'ms', presets: [100, 500, 1000, 2000], format: formatMs, value: (t) => t.durationMs },
      cell: (t) => <span className={cn('font-semibold', t.errors > 0 && 'text-destructive-text')}>{t.dur}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      sort: (t) => t.errors,
      text: (t) => (t.errors > 0 ? 'Error' : 'OK'),
      filter: { kind: 'values', noun: 'statuses', value: (t) => (t.errors > 0 ? 'Error' : 'OK') },
      cell: (t) => <TraceStatus errors={t.errors} />,
    },
    {
      id: 'code',
      header: 'Code',
      numeric: true,
      sort: (t) => t.code,
      text: (t) => t.code,
      filter: { kind: 'values', noun: 'codes', value: (t) => (t.code === null ? null : String(t.code)) },
      cell: (t) => t.code === null
        ? <span className="text-muted-foreground">—</span>
        : (
          <ValueMenu field={{ built: 'http_status_code' }} value={String(t.code)} onFilter={(...args) => onFilter.current(...args)}>
            <span className={codeTone(t.code, t.errors)}>{t.code}</span>
          </ValueMenu>
        ),
    },
    { id: 'spans', header: 'Spans', numeric: true, sort: (t) => t.spans, text: (t) => t.spans, className: 'text-muted-foreground', cell: (t) => t.spans },
    { id: 'started', header: 'Started', sort: (t) => t.startedAtMs, text: (t) => new Date(t.startedAtMs).toISOString(), className: 'font-mono text-control text-faint-foreground', cell: (t) => t.start },
    { id: 'timeline', header: 'Timeline', headClassName: 'w-[200px]', cell: (t) => <TimelineBar share={t.durationMs / slowest} failed={t.errors > 0} /> },
  ], [slowest])
  const table = useDataTable<TraceRow>({ rows, columns, rowKey: (t) => t.id, storageKey: 'ft-table-traces', defaultColumns: DEFAULT_COLUMNS, pageSize: 10, resetKey: `${text}|${order}|${limit}|${windowMs}` })
  const pager = <Pager total={total} page={at} size={size} onPage={setPage} onSize={(next) => { setSize(next); setPage(1) }} noun={tab === 'spans' ? 'spans' : 'traces'} className="border-t" />
  const current = useMemo<Definition>(() => ({ q: normalise(text), o: order, t: tab, m: measure, g: group }), [text, order, tab, measure, group])
  const [panel, setPanel] = useState<'facets' | 'views'>('facets')
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setPage(Math.floor(cursor / size) + 1) }, [cursor, size])
  useEffect(() => { table.setPage(Math.floor(cursor / table.size) + 1) }, [cursor, table.size])
  const show = (next: Partial<{ q: string; o: Order; t: Tab; m: Measure; g: string; view: string | undefined }>) => {
    const was = { q: text, o: order, t: tab, m: measure, g: group, view: viewParam }
    const merged = { ...was, ...next }
    void goTo({
      to: '.' as never,
      search: ((search: Record<string, unknown>) => ({
        ...search,
        q: merged.q.trim() === '' ? undefined : merged.q,
        o: merged.o === 'started' ? undefined : merged.o,
        t: merged.t === 'traces' ? undefined : merged.t,
        m: merged.m === 'count' ? undefined : merged.m,
        g: merged.g === '' ? undefined : merged.g,
        view: merged.view,
      })) as never,
      replace: true,
    })
    setCursor(0)
  }
  const zoomTo = (from: number, to: number | undefined) => {
    void goTo({
      to: '.' as never,
      search: ((search: Record<string, unknown>) => ({ ...search, from: to === undefined ? undefined : Math.round(from), to: to === undefined ? undefined : Math.round(to) })) as never,
      replace: true,
    })
    setCursor(0)
  }
  const setItems = (next: Node[]) => show({ q: itemsText(next) })
  const setChips = (next: Chip[]) => setItems([...others, ...next])
  const pickGroup = (value: string) => {
    const by = group === '' ? TABLE_DEFAULT_GROUP : group
    const field: FieldRef = by.startsWith('attr:') ? { attr: by.slice(5) } : { built: by as never }
    setChips(withValue(chips, field, value, true, by === 'http_status_code'))
  }
  const filterOn = (field: FieldRef, value: string, keep: boolean) =>
    setChips(
      keep
        ? withValue(chips, field, value, true, counts(field))
        : withoutValue(chips, field, value, true, counts(field)),
    )
  onFilter.current = filterOn
  const select = (key: string | undefined, definition: Definition) => show({ q: definition.q, o: definition.o, t: definition.t, m: definition.m, g: definition.g, view: key })
  const viewsState = useViewsState(current, viewKey, select)
  const clear = () => { show({ q: '', o: 'started', view: undefined }); place(NOWHERE) }
  const sifting = items.length > 0 || order !== 'started' || isPlaced(placement)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return
      const count = tab === 'series' || tab === 'table' ? 0 : tab === 'spans' ? spans.rows.length : table.view.length
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(count - 1, c + 1)) }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
      if (e.key === 'Enter') {
        const target = tab === 'spans' ? spans.rows[cursor]?.traceId : table.view[cursor]?.id
        if (target) navigate(`/traces/${target}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [table.view, spans.rows, tab, cursor, navigate])


  return (
    <>
      <PageHeader title="Traces" meta={zoom ? `${new Date(zoom.from).toLocaleString()} to ${new Date(zoom.to).toLocaleString()}` : `Last ${windowLabel}`}>
        <ViewsToggle state={viewsState} on={panel === 'views'} onToggle={() => { setPanel((was) => (was === 'views' ? 'facets' : 'views')); setMobileOpen(true) }} />
        <Button size="sm" variant="outline" className="md:hidden" aria-expanded={mobileOpen} onClick={() => setMobileOpen((was) => !was)}>
          <ListFilter />Filters{items.length > 0 ? <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">{items.length}</span> : null}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Display options"><SlidersHorizontal />Display</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-[280px] flex-col gap-3 p-3">
            <div className="flex items-center justify-between gap-2 text-control">
              Order
              <NativeSelect aria-label="Order" value={order} onChange={(e) => show({ o: orderOf(e.target.value) })} className="h-7 w-[150px]">
                <option value="started">Newest first</option>
                <option value="duration">Slowest first</option>
                <option value="spans">Most spans first</option>
              </NativeSelect>
            </div>
            <div className="flex items-center justify-between gap-2 text-control">
              Row density
              <Segmented label="Row density" size="sm" value={density} onChange={setDensity} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfy', label: 'Comfortable' }]} />
            </div>
            <div className="flex items-center justify-between gap-2 text-control">
              Traces read
              <NativeSelect aria-label="How many to read" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setCursor(0) }} className="h-7 w-[100px]">
                {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
              </NativeSelect>
            </div>
            <span className="inline-flex items-center gap-1 text-caption text-muted-foreground"><Kbd>J</Kbd><Kbd>K</Kbd>move<Kbd>↵</Kbd>open</span>
          </PopoverContent>
        </Popover>
      </PageHeader>
      {viewsState.dialog}
      <div className="grid gap-4 md:grid-cols-[248px_minmax(0,1fr)]">
        <aside className={cn('min-w-0 md:sticky md:top-[100px] md:max-h-[calc(100vh-116px)] md:self-start md:overflow-y-auto md:pr-1', !mobileOpen && 'max-md:hidden')}>
          {panel === 'views' ? (
            <ViewsPanel state={viewsState} viewKey={viewKey} onSelect={select} onClose={() => setPanel('facets')} />
          ) : (
            <Facets chips={chips} query={items} onChange={setChips} rangeMs={sift.rangeMs} />
          )}
        </aside>
        <div className="flex min-w-0 flex-col gap-3">
          <div role="tablist" aria-label="How to list the matches" className="flex gap-1 border-b">
            {TABS.map((one) => (
              <button
                key={one}
                type="button"
                role="tab"
                aria-selected={one === tab}
                onClick={() => show({ t: one })}
                className={cn('-mb-px h-10 cursor-pointer border-b-2 border-transparent bg-transparent px-3 text-control font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', one === tab && 'border-primary text-foreground')}
              >
                {TAB_LABELS[one]}
              </button>
            ))}
          </div>
          <QueryBar text={text} onCommit={(next) => show({ q: next })} rangeMs={sift.rangeMs} />
          {!parsed.ok ? <p role="alert" className="m-0 text-caption text-destructive-text">The query in this link is not valid, so nothing is filtered: {parsed.error}.</p> : null}
          <div className="flex flex-wrap items-center gap-2" role="search">
            <FilterBar items={items} onChange={setItems} rangeMs={sift.rangeMs} />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Kubernetes placement"><Boxes />Kubernetes{placedCount(placement) > 0 ? <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">{placedCount(placement)}</span> : null}</Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(560px,calc(100vw-32px))] p-3">
                <PlacementPicker placement={placement} onChange={(part) => { place(part); setCursor(0) }} windowMs={sift.rangeMs} />
              </PopoverContent>
            </Popover>
            {sifting ? <Button variant="ghost" size="sm" onClick={clear}>Reset</Button> : null}
          </div>
      {tab !== 'series' ? (
        <div className="flex flex-col gap-1.5">
          {zoom ? (
            <div className="flex items-center gap-2 text-caption text-muted-foreground">
              <span>Zoomed on a period of {Math.max(1, Math.round((zoom.to - zoom.from) / 1000))} s.</span>
              <Button size="sm" variant="ghost" onClick={() => zoomTo(0, undefined)}>Back to the last {windowLabel}</Button>
            </div>
          ) : null}
          <Histogram items={items} rangeMs={windowMs} onZoom={(from, to) => zoomTo(from, to)} />
        </div>
      ) : null}
      {tab === 'table' ? (
        <TablePanel items={items} rangeMs={windowMs} order={measure} group={group} onChange={(part) => show(part)} onPick={pickGroup} />
      ) : tab === 'series' ? (
        <SeriesPanel items={items} rangeMs={windowMs} measure={measure} group={group} onChange={(part) => show(part)} />
      ) : tab === 'spans' ? (
        <SpansTable rows={spans.rows.slice(offset, offset + size)} total={total} offset={offset} pager={pager} loading={spans.loading} failed={spans.failed} sifting={sifting} limit={limit} cursor={cursor} density={density} onOpen={(row) => navigate(`/traces/${row.traceId}`)} onCopy={copy} onClear={clear} onFilter={filterOn} />
      ) : failed ? (
        <EmptyState title="The traces could not be read">{because(failed, 'The span store did not answer')}</EmptyState>
      ) : (
        <DataTable
          table={table}
          label="Traces"
          noun="traces"
          selectable
          exportName="traces"
          loading={loading}
          activeKey={table.view[cursor]?.id}
          onRowClick={(t) => navigate(`/traces/${t.id}`)}
          rowClassName={() => (density === 'comfy' ? '[&>td]:h-12' : undefined)}
          note={`${order === 'duration' ? 'Slowest first' : order === 'spans' ? 'Most spans first' : 'Newest first'} from the span store${rows.length === sift.limit ? `, capped at ${sift.limit}` : ''}`}
          error={failed ? <EmptyState title="The traces could not be read">{because(failed, 'The span store did not answer')}</EmptyState> : undefined}
          empty={
            <EmptyState title={sifting ? 'No traces match' : 'No traces in this window'} actions={sifting ? <Button size="sm" onClick={clear}>Reset filters</Button> : null}>
              {sifting ? 'Try fewer filters, a wider window or no placement.' : 'Nothing arrived in the window you are looking at. Try a wider one.'}
            </EmptyState>
          }
        />
      )}
        </div>
      </div>
    </>
  )
}
