import { CardHeader, CardKind } from '@/components/ui/card'
import { gutterOf, YAxis } from '@/components/ft/ChartFrame'
import { SIGNAL_COLOUR } from './colours'
import { dayLabel, LABEL, STACK, type Bar } from './shape'
import type { Signal } from '@/data/usage'
import { useScrub } from './useScrub'

const HEIGHT = 200

export function SpendBars({ title, bars, shown, format, axis }: {
  title: string
  bars: Bar[]
  shown: Signal[]
  format: (value: number) => string
  axis: (value: number) => string
}) {
  const { at, handlers } = useScrub(bars.length, 'band')
  const peak = Math.max(0, ...bars.map((bar) => bar.total))
  const span = peak || 1
  const yLabels = [axis(peak), axis(peak / 2), axis(0)]
  const gutter = gutterOf(yLabels)
  const bar = at === null ? null : bars[at]
  const centre = at === null ? 0 : ((at + 0.5) / bars.length) * 100
  const layers = STACK.filter((signal) => shown.includes(signal))
  const summary = `${title}, ${bars.length} days, busiest day ${format(peak)}`
  return (
    <figure className="m-0 flex min-w-0 flex-col rounded-md border bg-card">
      <figcaption>
        <CardHeader className="flex-wrap gap-y-0.5">
          <span className="min-w-0 text-[13px] font-semibold leading-5">{title}</span>
          <CardKind>Stacked bar</CardKind>
          <span className="ml-auto whitespace-nowrap text-caption text-muted-foreground">peak {format(peak)}</span>
        </CardHeader>
      </figcaption>
      <div className="grid gap-x-1.5 px-3 pt-3" style={{ gridTemplateColumns: `${gutter}px minmax(0,1fr)` }}>
        <YAxis labels={yLabels} height={HEIGHT} />
        <div
          tabIndex={0}
          role="group"
          aria-label={`${summary}. Left and right arrow keys move between days, Escape clears the reading.`}
          className="relative cursor-crosshair touch-pan-y select-none rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          style={{ height: HEIGHT }}
          {...handlers}
        >
          <div aria-hidden className="absolute inset-0">
            <span className="absolute inset-x-0 top-0 border-t border-chart-grid" />
            <span className="absolute inset-x-0 top-1/2 border-t border-chart-grid" />
            <span className="absolute inset-x-0 bottom-0 border-t" />
          </div>
          <div aria-hidden className="absolute inset-0 flex items-end gap-[2px]">
            {bars.map((one, index) => (
              <div key={one.at} className={`flex h-full min-w-0 flex-1 flex-col-reverse ${at !== null && at !== index ? 'opacity-60' : ''}`}>
                {layers.map((signal) => (
                  <span key={signal} className="block w-full first:rounded-b-none last:rounded-t-[3px]" style={{ height: `${(one.parts[signal] / span) * 100}%`, background: SIGNAL_COLOUR[signal] }} />
                ))}
              </div>
            ))}
          </div>
          {bar ? (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 min-w-[170px] rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md"
              style={centre > 55 ? { right: `${100 - centre + 2}%` } : { left: `${centre + 2}%` }}
            >
              <div className="pb-1.5 text-control font-semibold">{dayLabel(bar.at)}</div>
              {[...layers].reverse().map((signal) => (
                <div key={signal} className="flex items-center gap-2 border-t border-dashed pt-1.5 text-control">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: SIGNAL_COLOUR[signal] }} aria-hidden />
                  <span className="text-muted-foreground">{LABEL[signal]}</span>
                  <span className="mx-1 flex-1 border-b border-dotted" aria-hidden />
                  <span className="font-mono font-semibold">{format(bar.parts[signal])}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-dashed pt-1.5 text-control">
                <span className="text-muted-foreground">Total</span>
                <span className="mx-1 flex-1 border-b border-dotted" aria-hidden />
                <span className="font-mono font-semibold">{format(bar.total)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex justify-between whitespace-nowrap px-3 pt-1.5 font-mono text-micro tabular-nums text-chart-axis" style={{ paddingLeft: gutter + 6 + 12 }} aria-hidden>
        <span>{bars.length > 0 ? dayLabel(bars[0].at) : ''}</span>
        <span>{bars.length > 1 ? dayLabel(bars[bars.length - 1].at) : ''}</span>
      </div>
      <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 px-3.5 pb-3 pt-2 text-caption text-muted-foreground">
        {layers.map((signal) => (
          <li key={signal} className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: SIGNAL_COLOUR[signal] }} aria-hidden />
            {LABEL[signal]}
          </li>
        ))}
      </ul>
    </figure>
  )
}
