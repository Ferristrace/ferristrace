import { useMemo, useState } from 'react'
import { DailyBars } from '@/components/ft/DailyBars'
import { Meter } from '@/components/ft/Meter'
import { PageHeader } from '@/components/ft/bits'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { Pager } from '@/components/ui/pager'
import { Segmented } from '@/components/ui/segmented'
import { Table, Td, Tr, SortTh } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { HOUR, SIGNALS, bytes, count, dailyOf, projected, startOfMonth, startOfNextMonth, useMetered, type Signal } from '@/data/usage'
import { pagesOf } from '@/lib/paging'
import { Link } from '@/lib/router'
import { sorted } from '@/lib/sorting'
import { useSortState } from './useSortState'

const DAY = 86_400_000

const month = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const hourLabel = (at: number) => `${dayLabel(at)}, ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`
const HOURLY_UP_TO = 7 * DAY
const DEFAULT_SIZE = 25

const TOTALS: Record<Signal, 'spans_bytes' | 'logs_bytes' | 'metrics_points'> = {
  spans: 'spans_bytes',
  logs: 'logs_bytes',
  metrics: 'metrics_points',
}

export function Cost() {
  const [period, setPeriod] = useState('this')
  const now = Date.now()

  const [zoom, setZoom] = useState<[number, number] | null>(null)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [page, setPage] = useState(1)
  const { sorting, dir, on } = useSortState<string>()

  const [from, to] = useMemo(() => {
    if (zoom) return zoom
    const start = startOfMonth(now)
    return period === 'this' ? [start, startOfNextMonth(now)] : [startOfMonth(start - DAY), start]
  }, [period, now, zoom])

  const { metered, nothing } = useMetered(from, to)
  const step = to - from <= HOURLY_UP_TO ? HOUR : DAY
  const until = Math.min(to, now + step)
  const series = useMemo(
    () => SIGNALS.map((signal) => ({ signal, days: metered ? dailyOf(metered.hours, signal.read, from, until, step) : [] })),
    [metered, from, until, step],
  )
  const stampOf = step === HOUR ? hourLabel : dayLabel
  const choose = (from: number, to: number) => {
    setPage(1)
    setZoom([from, to])
  }
  const split = metered ? metered.hours.length - metered.by_signal.unsplit_hours : 0
  const show = (unit: 'bytes' | 'points', value: number) => (unit === 'bytes' ? bytes(value) : count(value))
  const rows = useMemo(() => {
    const all = series[0].days.map((_, at) => ({ at: series[0].days[at].at, cells: series.map((one) => one.days[at].bytes) })).reverse()
    return sorted(all, sorting, (row, key) => (key === 'at' ? row.at : (row.cells[SIGNALS.findIndex((signal) => signal.key === key)] ?? null)))
  }, [series, sorting])
  const shown = Math.min(page, pagesOf(rows.length, size))

  return (
    <>
      <PageHeader title="Cost meter" meta={<><CardKind>{zoom ? `${hourLabel(from)} to ${hourLabel(to)} UTC` : month(from)}</CardKind> <span className="max-md:hidden">what was ingested, by signal, for the whole organisation</span></>}>
        {zoom ? <Button size="sm" onClick={() => setZoom(null)}>Reset zoom</Button> : null}
        <Segmented
          label="Period"
          value={zoom ? '' : period}
          onChange={(value) => {
            setZoom(null)
            setPage(1)
            setPeriod(value)
          }}
          options={[{ value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' }]}
        />
      </PageHeader>
      {metered ? (
        split === 0 ? (
          <Card className="px-4 py-3 text-control text-muted-foreground">
            No finished hour of this month carries a split yet. Hours are rolled up once they end, so the first figures appear within the hour after a payload arrives.
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
              {SIGNALS.map((signal) => {
                const total = metered.by_signal[TOTALS[signal.key]]
                const ahead = projected(total, now)
                const ofAll = signal.unit === 'bytes' && metered.ingested_bytes > 0 ? (total / metered.ingested_bytes) * 100 : null
                return (
                  <Meter
                    key={signal.key}
                    label={signal.label}
                    used={show(signal.unit, total)}
                    of={signal.unit === 'bytes' ? 'decompressed' : 'datapoints'}
                    share={ofAll}
                    note={
                      period === 'this' && !zoom
                        ? `About ${show(signal.unit, ahead)} at month end, at this rate.`
                        : zoom ? 'Every finished hour of the range selected.' : ofAll === null ? 'Every finished hour of that month.' : `${ofAll.toFixed(0)} % of what that month ingested.`
                    }
                  />
                )
              })}
            </div>
            {metered.by_signal.unsplit_hours > 0 ? (
              <p className="m-0 text-caption text-muted-foreground">
                {metered.by_signal.unsplit_hours} {metered.by_signal.unsplit_hours === 1 ? 'hour was' : 'hours were'} rolled up before signals were counted apart. They are in the <Link to="/settings/usage">usage total</Link> and left out of these figures.
              </p>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
              {series.map(({ signal, days }) => (
                <DailyBars
                  key={signal.key}
                  title={`${signal.label} per ${step === HOUR ? 'hour' : 'day'}`}
                  what={signal.label}
                  label={signal.unit === 'bytes' ? 'size' : 'datapoints'}
                  days={days}
                  step={step}
                  onSelect={choose}
                  format={(value) => show(signal.unit, value)}
                />
              ))}
            </div>
            <Card className="overflow-hidden">
              <CardHeader><CardTitle>{step === HOUR ? 'By hour' : 'By day'}</CardTitle><CardKind>Table</CardKind></CardHeader>
              <div className="overflow-x-auto">
                <Table aria-label="Ingested per period and signal">
                  <thead>
                    <tr>
                      <SortTh label={step === HOUR ? 'Hour' : 'Day'} dir={dir('at')} onSort={on('at', 'desc')} />
                      {SIGNALS.map((signal) => <SortTh key={signal.key} numeric label={signal.label} dir={dir(signal.key)} onSort={on(signal.key, 'desc')} className="w-[160px]" />)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice((shown - 1) * size, shown * size).map((row) => (
                      <Tr key={row.at}>
                        <Td className="font-mono">{stampOf(row.at)}</Td>
                        {row.cells.map((cell, index) => <Td key={SIGNALS[index].key} numeric className="font-mono">{show(SIGNALS[index].unit, cell)}</Td>)}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <Pager total={rows.length} page={shown} size={size} onPage={setPage} onSize={(next) => { setSize(next); setPage(1) }} noun={step === HOUR ? 'hours' : 'days'} className="border-t" />
            </Card>
          </>
        )
      ) : (
        <Card className="px-4 py-3 text-control text-muted-foreground">{nothing}</Card>
      )}
      <p className="m-0 text-caption text-muted-foreground">
        Logs and spans are counted in decompressed payload bytes, metrics in datapoints, when a payload is accepted. Hours from before that can be rebuilt from what the span store holds with <code>ferristrace backfill-usage</code>; those figures are measured on stored rows and sit a few percent under the payload bytes. A payload refused at the ceiling counts in none of them. The total the <Link to="/settings/billing">plan</Link> is measured against stays on <Link to="/settings/usage">Usage</Link>.
      </p>
    </>
  )
}
