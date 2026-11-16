import { CardHeader, CardKind } from '@/components/ui/card'
import { gutterOf, YAxis } from '@/components/ft/ChartFrame'
import { SIGNAL_COLOUR } from './colours'
import { dayLabel, DAY } from './shape'
import { useScrub } from './useScrub'

const WIDTH = 600
const HEIGHT = 200

const joined = (points: [number, number][]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

export function SpendLine({ title, noun, from, last, actual, ahead, format, axis }: {
  title: string
  noun: string
  from: number
  last: number
  actual: (number | null)[]
  ahead: (number | null)[]
  format: (value: number) => string
  axis: (value: number) => string
}) {
  const slots = actual.length
  const { at, handlers } = useScrub(slots, 'point')
  const top = Math.max(0, ...actual.map((value) => value ?? 0), ...ahead.map((value) => value ?? 0))
  const span = top || 1
  const x = (index: number) => (slots > 1 ? (index / (slots - 1)) * WIDTH : WIDTH / 2)
  const y = (value: number) => HEIGHT - (value / span) * HEIGHT
  const run = (values: (number | null)[]): [number, number][] => values.flatMap((value, index): [number, number][] => (value === null ? [] : [[x(index), y(value)]]))
  const done = run(actual)
  const coming = run(ahead)
  const labelled = [...new Set([0, 1, 2, 3, 4].map((step) => Math.round((step * Math.max(0, slots - 1)) / 4)))].map((index) => dayLabel(from + index * DAY))
  const yLabels = [axis(top), axis(top / 2), axis(0)]
  const gutter = gutterOf(yLabels)
  const now = last >= 0 ? actual[last] : null
  const end = ahead[slots - 1]
  const centre = at === null ? 0 : slots > 1 ? (at / (slots - 1)) * 100 : 50
  const spoken = `${title}: ${now === null ? 'nothing yet' : `${format(now)} so far`}${end !== null && end !== undefined ? `, ${format(end)} projected at the month end` : ''}`
  const shownActual = at === null ? null : actual[at]
  const shownAhead = at === null || at < last ? null : ahead[at]
  return (
    <figure className="m-0 flex min-w-0 flex-col rounded-md border bg-card">
      <figcaption>
        <CardHeader className="flex-wrap gap-y-0.5">
          <span className="min-w-0 text-[13px] font-semibold leading-5">{title}</span>
          <CardKind>Time series</CardKind>
          <span className="ml-auto whitespace-nowrap font-mono text-heading font-semibold tabular-nums">{now === null ? '—' : format(now)}</span>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3.5 pt-2 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <svg width="14" height="8" aria-hidden><line x1="0" y1="4" x2="14" y2="4" stroke={SIGNAL_COLOUR.spans} strokeWidth="2" /></svg>
            {noun} to date
          </span>
          {coming.length > 1 ? (
            <span className="inline-flex items-center gap-1.5">
              <svg width="14" height="8" aria-hidden><line x1="0" y1="4" x2="14" y2="4" stroke={SIGNAL_COLOUR.spans} strokeWidth="2" strokeDasharray="3 2" strokeOpacity="0.7" /></svg>
              Projected to month end{end === null || end === undefined ? '' : `, ${format(end)}`}
            </span>
          ) : null}
        </div>
      </figcaption>
      <div className="grid gap-x-1.5 px-3 pt-3" style={{ gridTemplateColumns: `${gutter}px minmax(0,1fr)` }}>
        <YAxis labels={yLabels} height={HEIGHT} />
        <div
          tabIndex={0}
          role="group"
          aria-label={`${spoken}. Left and right arrow keys move between days, Escape clears the reading.`}
          className="relative cursor-crosshair touch-pan-y select-none rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          style={{ height: HEIGHT }}
          {...handlers}
        >
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" width="100%" height={HEIGHT} aria-hidden className="absolute inset-0 block overflow-visible">
            <line x1="0" y1="0.5" x2={WIDTH} y2="0.5" stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            {done.length > 1 ? <polyline points={joined(done)} fill="none" stroke={SIGNAL_COLOUR.spans} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : done.length === 1 ? <circle cx={done[0][0]} cy={done[0][1]} r="2" fill={SIGNAL_COLOUR.spans} /> : null}
            {coming.length > 1 ? <polyline points={joined(coming)} fill="none" stroke={SIGNAL_COLOUR.spans} strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="4 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {at !== null ? (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground" style={{ left: `${centre}%` }} />
              {[shownActual, shownAhead].map((value, index) => (value === null || value === undefined ? null : (
                <span key={index} aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background" style={{ left: `${centre}%`, top: `${(y(value) / HEIGHT) * 100}%`, background: SIGNAL_COLOUR.spans }} />
              )))}
              <div
                role="status"
                className="pointer-events-none absolute top-1 z-10 min-w-[160px] rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md"
                style={centre > 55 ? { right: `${100 - centre + 2}%` } : { left: `${centre + 2}%` }}
              >
                <div className="pb-1.5 text-control font-semibold">{dayLabel(from + at * DAY)}</div>
                {shownActual !== null && shownActual !== undefined ? <Reading label={`${noun} to date`} value={format(shownActual)} /> : null}
                {shownAhead !== null && shownAhead !== undefined && at > last ? <Reading label="Projected" value={format(shownAhead)} /> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex justify-between whitespace-nowrap px-3 pb-2.5 pt-1.5 font-mono text-micro tabular-nums text-chart-axis" style={{ paddingLeft: gutter + 6 + 12 }} aria-hidden>
        {labelled.map((label, index) => <span key={`${index}-${label}`}>{label}</span>)}
      </div>
    </figure>
  )
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-dashed pt-1.5 text-control">
      <span className="text-muted-foreground">{label}</span>
      <span className="mx-1 flex-1 border-b border-dotted" aria-hidden />
      <span className="font-mono font-semibold">{value}</span>
    </div>
  )
}
