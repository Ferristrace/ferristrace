import { Boxes, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Kbd, Table, Td, Tr } from '@/components/ui/misc'
import { Kpi, PageHeader, barBg } from '@/components/ft/bits'
import { MetricChart } from '@/components/ft/MetricChart'
import { PlacementPicker, placedCount } from '@/components/ft/Placement'
import { usePlacement } from '@/data/placement'
import { HOST_KEY, useHosts } from '@/data/hosts'
import { sorted } from '@/lib/sorting'
import { useWindow } from '@/lib/window'
import { because } from '@/auth/client'
import { cn } from '@/lib/utils'
import { KPI_GRID, Note, PagedFooter, PanelEmpty, PanelToolbar, Pill, Pills, SEARCH, SkeletonRows, SortHead, usePaged } from './kit'
import { HOST_KEYS, hostValue, textFirst } from './sortKeys'
import { useUrlSort } from './useUrlSort'

const HOT_CPU = 75
const FULL_DISK = 85

const SORTS = [
  { value: 'cpu', label: 'CPU' },
  { value: 'memory', label: 'Memory' },
  { value: 'disk', label: 'Disk' },
  { value: 'load', label: 'Load 1m' },
  { value: 'name', label: 'Name' },
] as const

const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(0)} %`)

const num = (value: number | null) => (value === null ? '—' : value.toFixed(2))

const known = (values: (number | null)[]) => values.filter((one): one is number => one !== null)

const mean = (values: (number | null)[]) => {
  const seen = known(values)
  return seen.length === 0 ? null : seen.reduce((a, b) => a + b, 0) / seen.length
}

const peak = (values: (number | null)[]) => {
  const seen = known(values)
  return seen.length === 0 ? null : Math.max(...seen)
}

function Meter({ value, hot }: { value: number | null; hot: boolean }) {
  if (value === null) return <span className="text-caption text-muted-foreground">not reported</span>
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="inline-flex h-1.5 w-14 shrink-0 overflow-hidden rounded bg-muted">
        <span
          className={cn('rounded', barBg(hot ? 'bar-w' : 'bar-o'))}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
      <span className={cn('font-mono text-caption', hot && 'font-semibold text-warning-text')}>{pct(value)}</span>
    </span>
  )
}

export function SystemPage() {
  const { ms: windowMs, label } = useWindow()
  const { sorting, pick, sortBy, dirOf } = useUrlSort(HOST_KEYS, 'cpu', textFirst)
  const [q, setQ] = useState('')
  const { placement, place } = usePlacement()
  const { hosts, busy, pending, failed, instrumented } = useHosts(windowMs, placement)

  const rows = useMemo(
    () => sorted(hosts.filter((host) => host.name.toLowerCase().includes(q.trim().toLowerCase())), sorting, hostValue),
    [hosts, sorting, q],
  )
  const placing = placedCount(placement)
  const sifting = placing > 0 || q.trim() !== ''
  const paged = usePaged(rows, `${sorting.key}|${sorting.dir}|${q}`)
  const cpus = hosts.map((host) => host.cpu)
  const disks = hosts.map((host) => host.disk)
  const hottest = peak(cpus)
  const fullest = peak(disks)
  const busiest = hosts.find((host) => host.cpu !== null && host.cpu === hottest)
  const tightest = hosts.find((host) => host.disk !== null && host.disk === fullest)

  return (
    <>
      <PageHeader
        title="System metrics"
        meta={<Pills><Pill>Hosts and containers</Pill><Pill>from <span className="font-mono">system.*</span> metrics</Pill><Pill>last {label}</Pill></Pills>}
      />

      <div className={KPI_GRID}>
        <Kpi
          label="Hosts"
          value={hosts.length === 0 ? '—' : String(hosts.length)}
          sub={`reporting ${HOST_KEY} in the last ${label}`}
        />
        <Kpi
          label="CPU"
          value={pct(mean(cpus))}
          sub={busiest === undefined ? 'no host reports cpu' : `average · peak ${pct(busiest.cpu)} on ${busiest.name}`}
          tone={(mean(cpus) ?? 0) >= HOT_CPU ? 'warn' : undefined}
        />
        <Kpi label="Memory" value={pct(mean(hosts.map((host) => host.memory)))} sub="average of the used state" />
        <Kpi
          label="Disk"
          value={pct(fullest)}
          sub={tightest === undefined ? 'no host reports a filesystem' : `fullest · ${tightest.name}`}
          tone={(fullest ?? 0) >= FULL_DISK ? 'warn' : undefined}
        />
      </div>

      {busy.length > 0 ? (
        <MetricChart
          series={busy}
          exemplars={[]}
          unit="%"
          threshold={HOT_CPU}
          aria={`Line chart of the busy share of cpu per host over the last ${label}`}
        />
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Hosts</CardTitle>
          <CardKind>Table</CardKind>
          <span className="text-caption text-muted-foreground">
            {rows.length} host{rows.length === 1 ? '' : 's'}
          </span>
        </CardHeader>
        <PanelToolbar>
          <InputGroup className={SEARCH}>
            <Search aria-hidden />
            <input
              aria-label="Filter hosts"
              placeholder="Filter hosts"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Kbd>/</Kbd>
          </InputGroup>
          <NativeSelect aria-label="Sort by" value={sorting.key} onChange={(e) => pick(e.target.value as typeof sorting.key)} className="w-auto max-md:flex-1">
            {SORTS.map((one) => <option key={one.value} value={one.value}>Sort: {one.label}</option>)}
          </NativeSelect>
          <span className="flex-1 max-md:hidden" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Kubernetes placement">
                <Boxes />
                Kubernetes
                {placing > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">
                    {placing}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(560px,calc(100vw-32px))] p-3">
              <PlacementPicker placement={placement} onChange={place} windowMs={windowMs} />
            </PopoverContent>
          </Popover>
        </PanelToolbar>

        {failed ? (
          <PanelEmpty title="The host metrics could not be read">
              {because(failed, 'The metric store did not answer')}
          </PanelEmpty>
        ) : null}

        {!failed && pending && hosts.length === 0 ? <SkeletonRows label="Reading the host metrics" /> : null}

        {!failed && !pending && hosts.length === 0 ? (
          <PanelEmpty
            title={
              sifting ? 'No hosts match' : instrumented ? `No host reported in the last ${label}` : 'No system metrics yet'
            }
            code={sifting || instrumented ? undefined : 'receivers:\n  hostmetrics:\n    scrapers: [cpu, memory, filesystem, load]'}
            actions={
              sifting ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setQ('')
                    place({ cluster: '', namespace: '', workload: '', pod: '', node: '' })
                  }}
                >
                  Reset filters
                </Button>
              ) : null
            }
          >
            {sifting ? (
              'Try a wider window or no placement.'
            ) : instrumented ? (
              <>
                A <span className="font-mono">system.*</span> metric arrived but none carried{' '}
                <span className="font-mono">{HOST_KEY}</span>, so no host can be named. Set it as a resource attribute
                on the collector.
              </>
            ) : (
              <>
                Add the <span className="font-mono">hostmetrics</span> receiver to your OpenTelemetry Collector and
                point its exporter at FerrisTrace.
              </>
            )}
          </PanelEmpty>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table aria-label="Hosts">
              <thead>
                <tr>
                  <SortHead label="Host" dir={dirOf('name')} onSort={() => sortBy('name')} />
                  <SortHead label="CPU" dir={dirOf('cpu')} onSort={() => sortBy('cpu')} className="w-[160px]" />
                  <SortHead label="Memory" dir={dirOf('memory')} onSort={() => sortBy('memory')} className="w-[160px]" />
                  <SortHead label="Disk" dir={dirOf('disk')} onSort={() => sortBy('disk')} className="w-[160px]" />
                  <SortHead label="Load 1m" numeric dir={dirOf('load')} onSort={() => sortBy('load')} className="w-[90px]" />
                </tr>
              </thead>
              <tbody>
                {paged.shown.map((host) => (
                  <Tr key={host.name}>
                    <Td>
                      <span className="font-mono font-semibold">{host.name}</span>
                    </Td>
                    <Td>
                      <Meter value={host.cpu} hot={host.cpu !== null && host.cpu >= HOT_CPU} />
                    </Td>
                    <Td>
                      <Meter value={host.memory} hot={false} />
                    </Td>
                    <Td>
                      <Meter value={host.disk} hot={host.disk !== null && host.disk >= FULL_DISK} />
                    </Td>
                    <Td numeric>{num(host.load)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}

        {rows.length === 0 && hosts.length > 0 ? (
          <PanelEmpty title="No host matches" actions={<Button size="sm" onClick={() => setQ('')}>Clear the filter</Button>}>
            Nothing matches the text typed in the filter.
          </PanelEmpty>
        ) : null}

        <PagedFooter paged={paged} noun="hosts" />

        <Note>
          A host is a value of <span className="font-mono">{HOST_KEY}</span>. CPU is{' '}
          <span className="font-mono">1 − avg(system.cpu.utilization)</span> over the{' '}
          <span className="font-mono">idle</span> state, averaged across cores, so it is the busy share of one core on
          average and not the sum of them. Memory is the <span className="font-mono">used</span> state of{' '}
          <span className="font-mono">system.memory.utilization</span>, and disk the fullest mounted filesystem. A
          column reads <span className="font-mono">not reported</span> when the scraper for it is off. Amber from{' '}
          {HOT_CPU} % CPU and {FULL_DISK} % disk.
        </Note>
      </Card>
    </>
  )
}
