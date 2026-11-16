import { Boxes, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { useSearchParam } from '@/lib/router'
import { sorted } from '@/lib/sorting'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segmented } from '@/components/ui/segmented'
import { Kbd, Table, Td, Th, Tr, SortTh } from '@/components/ui/misc'
import { Kpi, PageHeader, barBg } from '@/components/ft/bits'
import { Bars, type Bar } from '@/components/ft/Histogram'
import { PlacementPicker, placedCount } from '@/components/ft/Placement'
import { usePlacement } from '@/data/placement'
import { GROUPINGS, groupingNoun, groupingOf, useCacheOperations, useCacheSeries } from '@/data/caches'
import { useZoom } from '@/lib/bounds'
import { useWindow } from '@/lib/window'
import { because } from '@/auth/client'
import { useSettled } from '@/lib/settle'
import { dur } from '@/lib/format'
import { cn } from '@/lib/utils'
import { KPI_GRID, Note, PagedFooter, PanelEmpty, PanelToolbar, Pill, Pills, SEARCH, SkeletonRows, usePaged } from './kit'
import { CACHE_KEYS, cacheFirst, cacheValue } from './sortKeys'
import { useUrlSort } from './useUrlSort'

const COLD = 80

const SORTS = [
  { value: 'rate', label: 'Hit rate' },
  { value: 'calls', label: 'Calls' },
  { value: 'hits', label: 'Hits' },
  { value: 'misses', label: 'Misses' },
  { value: 'name', label: 'Name' },
  { value: 'store', label: 'Store' },
] as const

const percent = (rate: number | null) => (rate === null ? '—' : `${rate.toFixed(1)} %`)

export function CachePage() {
  const goTo = useRouterNavigate()
  const { ms: windowMs, label } = useWindow()
  const group = groupingOf(useSearchParam('g'))
  const { sorting, pick, sortBy, dirOf } = useUrlSort(CACHE_KEYS, 'rate', cacheFirst)
  const environment = useSearchParam('env') ?? ''
  const [typedEnv, setTypedEnv] = useState(environment)
  const settledEnv = useSettled(typedEnv)
  const [q, setQ] = useState('')
  const zoom = useZoom()
  const { placement, place } = usePlacement()
  const { operations, pending, failed } = useCacheOperations(group, windowMs, settledEnv, placement)
  const { series, pending: seriesPending } = useCacheSeries(windowMs, settledEnv, placement)

  const show = (part: Record<string, string | undefined>) =>
    void goTo({
      to: '.' as never,
      search: ((was: Record<string, unknown>) => ({ ...was, ...part })) as never,
      replace: true,
    })
  const zoomTo = (from: number, to: number | undefined) =>
    void goTo({
      to: '.' as never,
      search: ((was: Record<string, unknown>) => ({
        ...was,
        from: to === undefined ? undefined : Math.round(from),
        to: to === undefined ? undefined : Math.round(to),
      })) as never,
      replace: true,
    })

  const rows = useMemo(
    () =>
      sorted(
        operations.filter((row) => `${row.group} ${row.store}`.toLowerCase().includes(q.trim().toLowerCase())),
        sorting,
        cacheValue,
      ),
    [operations, sorting, q],
  )
  const bars = useMemo<Bar[]>(
    () => (series?.points ?? []).map((point) => ({ at: point.atMs, count: point.calls, errors: point.misses })),
    [series],
  )
  const { noun, field } = groupingNoun(group)
  const calls = series?.calls ?? 0
  const judged = (series?.hits ?? 0) + (series?.misses ?? 0)
  const seconds = zoom ? (zoom.to - zoom.from) / 1000 : windowMs / 1000
  const span = zoom ? `${Math.max(1, Math.round(seconds))} s` : label
  const placing = placedCount(placement)
  const sifting = placing > 0 || settledEnv.trim() !== '' || q.trim() !== ''
  const paged = usePaged(rows, `${group}|${sorting.key}|${sorting.dir}|${q}|${settledEnv}`)

  return (
    <>
      <PageHeader
        title="Cache"
        meta={
          <Pills><Pill>Cache client spans</Pill><Pill>by <span className="font-mono">{field}</span></Pill><Pill>last {span}</Pill></Pills>
        }
      >
        <Segmented label="Group by" value={group} onChange={(next) => show({ g: next === 'operation' ? undefined : next })} options={GROUPINGS.map((one) => ({ value: one.value, label: one.label }))} />
      </PageHeader>

      <div className={KPI_GRID}>
        <Kpi
          label="Hit rate"
          value={percent(series?.hitRate ?? null)}
          sub={judged === 0 ? 'no cache.hit in range' : `over ${judged.toLocaleString()} judged ${judged === 1 ? 'call' : 'calls'}`}
          tone={series?.hitRate !== null && series?.hitRate !== undefined && series.hitRate < COLD ? 'warn' : undefined}
        />
        <Kpi label="Operations" value={calls === 0 ? '—' : `${(calls / seconds).toFixed(1)}/s`} sub={`${calls.toLocaleString()} in the last ${span}`} />
        <Kpi label="Misses" value={(series?.misses ?? 0).toLocaleString()} sub={judged === 0 ? 'nothing judged yet' : `of ${judged.toLocaleString()} judged`} />
        <Kpi
          label="p95"
          value={series?.p95Ms === null || series?.p95Ms === undefined ? '—' : dur(series.p95Ms)}
          sub={series?.p99Ms === null || series?.p99Ms === undefined ? 'no p99 yet' : `p99 ${dur(series.p99Ms)}`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {zoom ? (
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <span>Zoomed on a period of {Math.max(1, Math.round(seconds))} s.</span>
            <Button size="sm" variant="ghost" onClick={() => zoomTo(0, undefined)}>Back to the last {label}</Button>
          </div>
        ) : null}
        <Bars bars={bars} loading={seriesPending} onZoom={(from, to) => zoomTo(from, to)} noun="operations" title="Cache operations over time" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{noun === 'store' ? 'Stores' : noun === 'key pattern' ? 'Key patterns' : 'Operations'}</CardTitle>
          <CardKind>Table</CardKind>
          <span className="text-caption text-muted-foreground">
            {rows.length} {noun}
            {rows.length === 1 ? '' : 's'}
          </span>
        </CardHeader>
        <PanelToolbar>
          <InputGroup className={SEARCH}>
            <Search aria-hidden />
            <input aria-label="Filter rows" placeholder={`Filter ${noun}s`} value={q} onChange={(e) => setQ(e.target.value)} />
            <Kbd>/</Kbd>
          </InputGroup>
          <InputGroup className="w-[220px] max-w-full max-md:w-full">
            <input aria-label="Environment" placeholder="Environment, e.g. production" value={typedEnv} onChange={(e) => setTypedEnv(e.target.value)} />
          </InputGroup>
          <NativeSelect aria-label="Sort by" value={sorting.key} onChange={(e) => pick(e.target.value as typeof sorting.key)} className="w-auto max-md:flex-1">
            {SORTS.map((one) => <option key={one.value} value={one.value}>Sort: {one.label}</option>)}
          </NativeSelect>
          <span className="flex-1 max-md:hidden" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Kubernetes placement">
                <Boxes />Kubernetes
                {placing > 0 ? <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">{placing}</span> : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(560px,calc(100vw-32px))] p-3">
              <PlacementPicker placement={placement} onChange={place} windowMs={windowMs} />
            </PopoverContent>
          </Popover>
        </PanelToolbar>

        {failed ? (
          <PanelEmpty title="The cache could not be read">{because(failed, 'The span store did not answer')}</PanelEmpty>
        ) : null}

        {!failed && pending && operations.length === 0 ? <SkeletonRows label="Reading the cache operations" /> : null}

        {!failed && !pending && operations.length === 0 ? (
          <PanelEmpty
            title={sifting ? 'No cache operations match' : `No cache operations in the last ${span}`}
            code={sifting ? undefined : 'npm i @opentelemetry/instrumentation-ioredis'}
            actions={sifting ? <Button size="sm" onClick={() => { setTypedEnv(''); setQ(''); place({ cluster: '', namespace: '', workload: '', pod: '', node: '' }) }}>Reset filters</Button> : null}
          >
            {sifting ? (
              'Try a wider window, no placement, or no environment.'
            ) : (
              <>
                Operations appear once your Redis or Memcached client is instrumented. FerrisTrace reads a client span that names{' '}
                <span className="font-mono">redis</span>, <span className="font-mono">memcached</span> or <span className="font-mono">valkey</span> in{' '}
                <span className="font-mono">db.system.name</span>, or that carries <span className="font-mono">cache.hit</span>.
              </>
            )}
          </PanelEmpty>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table aria-label={`Cache ${noun}s`}>
              <thead>
                <tr>
                  <SortTh label={noun === 'store' ? 'Store' : noun === 'key pattern' ? 'Key pattern' : 'Operation'} dir={dirOf(group === 'store' ? 'store' : 'name')} onSort={() => sortBy(group === 'store' ? 'store' : 'name')} />
                  {group === 'store' ? null : <SortTh label="Store" dir={dirOf('store')} onSort={() => sortBy('store')} className="w-[130px]" />}
                  <SortTh label="Calls" numeric dir={dirOf('calls')} onSort={() => sortBy('calls')} className="w-[100px]" />
                  <SortTh label="Hits" numeric dir={dirOf('hits')} onSort={() => sortBy('hits')} className="w-[90px]" />
                  <SortTh label="Misses" numeric dir={dirOf('misses')} onSort={() => sortBy('misses')} className="w-[90px]" />
                  <SortTh label="Hit rate" dir={dirOf('rate')} onSort={() => sortBy('rate')} className="w-[160px]" />
                  <Th numeric className="w-[80px]">p50</Th>
                  <Th numeric className="w-[80px]">p95</Th>
                </tr>
              </thead>
              <tbody>
                {paged.shown.map((row) => {
                  const cold = row.hitRate !== null && row.hitRate < COLD
                  return (
                    <Tr key={`${row.group} ${row.store}`}>
                      <Td><span className="font-mono font-semibold">{row.group}</span></Td>
                      {group === 'store' ? null : <Td className="text-control text-muted-foreground">{row.store}</Td>}
                      <Td numeric>{row.rps}</Td>
                      <Td numeric>{row.hits.toLocaleString()}</Td>
                      <Td numeric className={cn(cold && 'font-semibold text-warning-text')}>{row.misses.toLocaleString()}</Td>
                      <Td>
                        {row.hitRate === null ? (
                          <span className="text-caption text-muted-foreground">no verdict</span>
                        ) : (
                          <span className="inline-flex max-w-full items-center gap-1.5">
                            <span className="inline-flex h-1.5 w-14 shrink-0 overflow-hidden rounded bg-muted">
                              <span className={cn('rounded', barBg(cold ? 'bar-w' : 'bar-o'))} style={{ width: `${Math.min(100, row.hitRate)}%` }} />
                            </span>
                            <span className={cn('font-mono text-caption', cold && 'font-semibold text-warning-text')}>{percent(row.hitRate)}</span>
                          </span>
                        )}
                      </Td>
                      <Td numeric>{row.p50}</Td>
                      <Td numeric>{row.p95}</Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        ) : null}

        {rows.length === 0 && operations.length > 0 ? (
          <PanelEmpty title={`No ${noun} matches`} actions={<Button size="sm" onClick={() => setQ('')}>Clear the filter</Button>}>
            Nothing matches the text typed in the filter.
          </PanelEmpty>
        ) : null}

        <PagedFooter paged={paged} noun={`${noun}s`} />

        <Note>
          A hit is <span className="font-mono">cache.hit = true</span> and a miss <span className="font-mono">false</span>; a span carrying neither counts in the calls and in no hit rate, which then reads{' '}
          <span className="font-mono">no verdict</span> rather than nought per cent.{' '}
          {group === 'key' ? (
            <>
              A key pattern is <span className="font-mono">cache.key</span> with its numbers and identifiers replaced by{' '}
              <span className="font-mono">*</span>, so <span className="font-mono">cart:4812</span> reads <span className="font-mono">cart:*</span>. A span carrying no key reads{' '}
              <span className="font-mono">unknown</span>.
            </>
          ) : (
            <>
              The operation is the span name, so a write such as <span className="font-mono">SET</span> is a row of its own.
            </>
          )}{' '}
          Amber under {COLD} %.
        </Note>
      </Card>
    </>
  )
}
