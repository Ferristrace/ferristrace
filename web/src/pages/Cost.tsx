import { useMemo, useState } from 'react'
import { Kpi, PageHeader } from '@/components/ft/bits'
import { Card, CardKind } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { useMetered, type Signal } from '@/data/usage'
import { Link } from '@/lib/router'
import { cn } from '@/lib/utils'
import { ProjectTable } from './cost/ProjectTable'
import { QuotaBars } from './cost/QuotaBars'
import { SpendBars } from './cost/SpendBars'
import { SpendDonut } from './cost/SpendDonut'
import { SpendLine } from './cost/SpendLine'
import { ALL, DAY, choicesOf, dayLabel, pillOf, previousWindow, rowsOf, viewOf, windowOf } from './cost/shape'

const MINUTE = 60_000

export function Cost() {
  const [period, setPeriod] = useState<'this' | 'last'>('this')
  const [chosen, setChosen] = useState(ALL)
  const [signal, setSignal] = useState<Signal | typeof ALL>(ALL)
  const now = Math.floor(Date.now() / MINUTE) * MINUTE
  const [from, to] = windowOf(period, now)
  const [then, until] = previousWindow(from, to, now)
  const { metered, nothing } = useMetered(from, to)
  const { metered: before } = useMetered(then, until)
  const running = now >= from && now < to

  const choices = useMemo(() => choicesOf(metered), [metered])
  const choice = choices.some((one) => one.value === chosen) ? chosen : ALL
  const view = useMemo(() => (metered ? viewOf({ metered, before, choice, from, to, now }) : null), [metered, before, choice, from, to, now])
  const rows = useMemo(() => (metered ? rowsOf({ metered, before, signal, from, to, now }) : []), [metered, before, signal, from, to, now])
  const split = metered ? metered.hours.length - metered.by_signal.unsplit_hours : 0
  const noun = view === null ? 'Spend' : view.priced ? 'Usage value' : 'Ingested'
  const when = running ? 'this month' : `in ${new Date(from).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })}`

  return (
    <>
      <PageHeader title="Cost meter" meta={<CardKind>{pillOf(from, to, now)}</CardKind>}>
        <Segmented label="Period" value={period} onChange={(value) => { setPeriod(value); setChosen(ALL) }} options={[{ value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' }]} />
        <NativeSelect aria-label="Project" value={choice} onChange={(event) => setChosen(event.target.value)} className="w-auto min-w-[160px] max-w-full">
          {choices.map((one) => <option key={one.value} value={one.value}>{one.value === ALL ? 'Project: all' : one.label}</option>)}
        </NativeSelect>
      </PageHeader>
      {metered && view ? (
        split === 0 ? (
          <Card className="px-4 py-3 text-control text-muted-foreground">
            No finished hour of this month carries a split yet. Hours are rolled up once they end, so the first figures appear within the hour after a payload arrives.
          </Card>
        ) : (
          <>
            {view.priced ? null : (
              <Card className="px-4 py-3 text-control text-muted-foreground">
                This server has no prices configured, so the meter shows volumes. Whoever runs the server sets them in the <code>[billing]</code> section of its configuration.
              </Card>
            )}
            {view.single && view.priced ? (
              <p className="m-0 text-caption text-muted-foreground">
                One project is picked: figures are the value of its usage. What the plan includes belongs to the organisation, so the bill and the allowances are left out.
              </p>
            ) : null}
            <div className={cn('grid grid-cols-2 gap-3', view.tiles.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
              {view.tiles.map((tile) => <Kpi key={tile.key} label={tile.label} value={tile.value} sub={tile.sub} tone={tile.tone} />)}
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <SpendLine title={`${noun} ${when}`} noun={noun} from={from} last={view.last} actual={view.actual} ahead={view.ahead} format={view.format} axis={view.axis} />
              <SpendDonut title={`${noun} by signal`} slices={view.slices} total={view.total} format={view.format} caption={view.last >= 0 ? `${dayLabel(from)} – ${dayLabel(from + view.last * DAY)}` : ''} />
            </div>
            <div className={cn('grid gap-3', view.quotas.length > 0 && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
              <SpendBars title={`${noun} per day by signal`} bars={view.bars} shown={view.shown} format={view.format} axis={view.axis} />
              {view.quotas.length > 0 ? <QuotaBars title={view.priced ? 'Usage against what is included' : 'Usage by signal'} quotas={view.quotas} /> : null}
            </div>
            <ProjectTable rows={rows} pricing={metered.pricing ?? null} signal={signal} onSignal={setSignal} from={from} since={running ? 'last month' : 'month before'} noun={view.priced ? 'Spend' : 'Usage'} />
            {metered.by_signal.unsplit_hours > 0 ? (
              <p className="m-0 text-caption text-muted-foreground">
                {metered.by_signal.unsplit_hours} {metered.by_signal.unsplit_hours === 1 ? 'hour was' : 'hours were'} rolled up before signals were counted apart. They are in the <Link to="/settings/usage">usage total</Link> and count for nothing in money or in these figures.
              </p>
            ) : null}
          </>
        )
      ) : (
        <Card className="px-4 py-3 text-control text-muted-foreground">{nothing}</Card>
      )}
      <p className="m-0 text-caption text-muted-foreground">
        Logs and spans are counted in decompressed payload bytes, metrics in datapoints, when a payload is accepted. Money is the volume times the price the server is configured with, in whole millionths of the currency, rounded half up. Hours from before that can be rebuilt from what the span store holds with <code>ferristrace backfill-usage</code>; those figures are measured on stored rows and sit a few percent under the payload bytes. A payload refused at the ceiling counts in none of them. The total the <Link to="/settings/billing">plan</Link> is measured against stays on <Link to="/settings/usage">Usage</Link>.
      </p>
    </>
  )
}
