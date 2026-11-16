import { useId, useMemo, useRef, useState } from 'react'
import { CardHeader, CardKind } from '@/components/ui/card'
import { useLogSeries } from '@/data/logs'
import type { Placement } from '@/data/placement'
import { useSpanSeries } from '@/data/spanSeries'
import type { Node } from '@/lib/queryLang'
import { cn } from '@/lib/utils'
import { gutterOf, YAxis } from './ChartFrame'

const HEIGHT = 120

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const whole = new Intl.NumberFormat('en')

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8)

const day = (ms: number) => {
  const at = new Date(ms)
  return `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

const stamp = (ms: number) => `${day(ms)} ${clock(ms)}`

const TICKS = 4

const tickText = (ms: number, span: number) => (span < 600_000 ? clock(ms) : span < 86_400_000 ? clock(ms).slice(0, 5) : `${day(ms)} ${clock(ms).slice(0, 5)}`)

export type Bar = { at: number; count: number; errors: number }

export function Histogram({ items, rangeMs, onZoom }: { items: Node[]; rangeMs: number; onZoom: (from: number, to: number) => void }) {
  const total = useSpanSeries(rangeMs, 'count', '', items, true)
  const failed = useSpanSeries(rangeMs, 'errors', '', items, true)
  const bars = useMemo<Bar[]>(() => {
    const counts = total.lines[0]?.points ?? []
    const errors = failed.lines[0]?.points ?? []
    return counts.map(([ns, value], index) => ({ at: ns / 1_000_000, count: value ?? 0, errors: errors[index]?.[1] ?? 0 }))
  }, [total.lines, failed.lines])
  return <Bars bars={bars} loading={total.loading} onZoom={onZoom} noun="spans" title="Spans over time" />
}

export function LogHistogram({ items, rangeMs, onZoom, placement, live }: { items: Node[]; rangeMs: number; onZoom: (from: number, to: number) => void; placement: Placement; live: boolean }) {
  const found = useLogSeries(items, rangeMs, placement, live)
  return <Bars bars={found.bars} loading={found.loading} onZoom={onZoom} noun="records" title="Records over time" />
}

export function Bars({ bars, loading, onZoom, noun, title }: { bars: Bar[]; loading: boolean; onZoom: (from: number, to: number) => void; noun: string; title: string }) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [anchor, setAnchor] = useState<number | null>(null)

  const step = bars.length > 1 ? bars[1].at - bars[0].at : 0
  const start = bars[0]?.at ?? 0
  const end = bars.length > 0 ? bars[bars.length - 1].at + step : 0
  const peak = Math.max(1, ...bars.map((bar) => bar.count))
  const spans = bars.reduce((sum, bar) => sum + bar.count, 0)
  const errors = bars.reduce((sum, bar) => sum + bar.errors, 0)
  const axis = [compact.format(peak), compact.format(peak / 2), '0']
  const gutter = gutterOf(axis)
  const horizon = end - start

  const indexAt = (clientX: number): number => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || bars.length === 0) return 0
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.min(bars.length - 1, Math.floor(fraction * bars.length))
  }

  const apply = (a: number, b: number) => {
    if (bars.length === 0) return
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    onZoom(bars[low].at, bars[high].at + step)
  }

  const selecting = drag ?? (cursor !== null && anchor !== null ? { from: anchor, to: cursor } : null)
  const low = selecting ? Math.min(selecting.from, selecting.to) : 0
  const high = selecting ? Math.max(selecting.from, selecting.to) : 0
  const pointed = hover ?? cursor
  const bar = pointed !== null ? bars[pointed] : undefined
  const left = pointed !== null && bars.length > 0 ? ((pointed + 0.5) / bars.length) * 100 : 0

  if (bars.length === 0 || spans === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-md border border-dashed text-caption text-muted-foreground" role="status">
        {loading ? `Counting the ${noun}…` : `No ${noun.replace(/s$/, '')} matches in this window.`}
      </div>
    )
  }

  return (
    <figure className="m-0 flex flex-col rounded-md border bg-card">
      <figcaption>
        <CardHeader className="flex-wrap gap-y-0.5">
          <span className="text-[13px] font-semibold leading-5">{title}</span>
          <CardKind>Stacked bar</CardKind>
          <span className="text-caption text-muted-foreground">{whole.format(spans)} in all{errors > 0 ? `, ${whole.format(errors)} failed` : ''}</span>
          <span className="ml-auto hidden text-caption text-faint-foreground sm:inline">Drag to zoom on a period</span>
        </CardHeader>
      </figcaption>
      <div className="flex flex-col gap-2 px-3 pb-2.5 pt-3">
        <div className="grid gap-x-2" style={{ gridTemplateColumns: `${gutter}px minmax(0,1fr)` }}>
          <YAxis labels={axis} height={HEIGHT} />
          <div className="relative">
            <div
              ref={box}
              role="application"
              aria-roledescription="histogram with a time selection"
              aria-label={`${title}, from ${stamp(start)} to ${stamp(end)}, ${whole.format(spans)} in all. Drag to zoom on a period, or use the arrow keys, Shift to select, Enter to zoom, Escape to cancel.`}
              tabIndex={0}
              className="relative flex cursor-crosshair touch-none select-none items-end gap-[2px] border-b border-border focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              style={{ height: HEIGHT, backgroundImage: 'linear-gradient(to bottom, var(--chart-grid) 1px, transparent 1px)', backgroundSize: '100% 50%' }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                const at = indexAt(event.clientX)
                setDrag({ from: at, to: at })
                setCursor(null)
                setAnchor(null)
              }}
              onPointerMove={(event) => {
                const at = indexAt(event.clientX)
                setHover(at)
                if (drag) setDrag({ from: drag.from, to: at })
              }}
              onPointerUp={() => {
                if (drag) apply(drag.from, drag.to)
                setDrag(null)
              }}
              onPointerLeave={() => setHover(null)}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(event) => {
                const last = bars.length - 1
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  const next = Math.min(last, Math.max(0, (cursor ?? (event.key === 'ArrowLeft' ? last : 0)) + (event.key === 'ArrowLeft' ? -1 : 1)))
                  if (event.shiftKey) setAnchor((was) => was ?? cursor ?? next)
                  else setAnchor(null)
                  setCursor(next)
                } else if (event.key === 'Enter' && cursor !== null && anchor !== null) {
                  event.preventDefault()
                  apply(anchor, cursor)
                  setAnchor(null)
                  setCursor(null)
                } else if (event.key === 'Escape') {
                  setAnchor(null)
                  setCursor(null)
                  setDrag(null)
                }
              }}
              onBlur={() => { setAnchor(null); setCursor(null) }}
            >
              {bars.map((one, index) => {
                const tall = one.count === 0 ? 0 : Math.max(3, (one.count / peak) * 100)
                const share = one.count === 0 ? 0 : Math.min(1, one.errors / one.count)
                const dim = selecting !== null && (index < low || index > high)
                return (
                  <div key={one.at} className="relative flex h-full min-w-0 flex-1 items-end" aria-hidden>
                    <div
                      className={cn('relative flex w-full flex-col overflow-hidden rounded-t-[4px] transition-opacity', index === pointed ? 'opacity-100' : dim ? 'opacity-30' : 'opacity-90')}
                      style={{ height: `${tall}%` }}
                    >
                      {share > 0 ? <div className="shrink-0 bg-destructive" style={{ height: `${Math.max(share * 100, 12)}%` }} /> : null}
                      <div className="min-h-0 flex-1 bg-series" />
                    </div>
                  </div>
                )
              })}
              {selecting ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 rounded-sm border border-primary bg-primary/10"
                  style={{ left: `${(low / bars.length) * 100}%`, width: `${((high - low + 1) / bars.length) * 100}%` }}
                />
              ) : null}
            </div>
            {bar ? (
              <div
                id={`${id}-tip`}
                role="tooltip"
                className="pointer-events-none absolute bottom-full z-20 mb-2 flex w-max max-w-[260px] -translate-x-1/2 flex-col gap-0.5 rounded-md border bg-popover px-2.5 py-1.5 text-caption shadow-md"
                style={{ left: `clamp(70px, ${left}%, calc(100% - 70px))` }}
              >
                <span className="font-mono text-[11px] text-muted-foreground">{clock(bar.at)} to {clock(bar.at + step)}</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-series" aria-hidden /><span className="font-semibold">{whole.format(bar.count)}</span> {noun}</span>
                {bar.errors > 0 ? (
                  <span className="flex items-center gap-1.5 text-destructive-text"><span className="size-2 rounded-sm bg-destructive" aria-hidden /><span className="font-semibold">{whole.format(bar.errors)}</span> failed ({((bar.errors / Math.max(1, bar.count)) * 100).toFixed(1)}%)</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid gap-x-2 font-mono text-micro tabular-nums text-chart-axis" style={{ gridTemplateColumns: `${gutter}px minmax(0,1fr)` }} aria-hidden>
          <span />
          <span className="relative h-4">
            {Array.from({ length: TICKS + 1 }, (_, index) => (
              <span key={index} className={cn('absolute top-0 whitespace-nowrap', index % 2 === 1 && 'max-sm:hidden')} style={{ left: `${(index / TICKS) * 100}%`, transform: `translateX(-${(index / TICKS) * 100}%)` }}>{tickText(start + (index / TICKS) * horizon, horizon)}</span>
            ))}
          </span>
        </div>
        <ul className="m-0 flex list-none items-center gap-4 p-0 text-caption text-muted-foreground" style={{ paddingLeft: gutter + 8 }} aria-label="Legend">
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-series" aria-hidden />Ok</li>
          <li className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-destructive" aria-hidden />Error</li>
        </ul>
      </div>
    </figure>
  )
}
