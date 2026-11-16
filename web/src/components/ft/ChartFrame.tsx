import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { Marker } from './charts'
import { clamp01, clampInto, fractionOf, headerOf, nearestPoint, placeTooltip, stepIndex, timeAtIndex, timeText, zoomRange } from './chartMath'
import { MarkerLayer } from './MarkerLayer'
import { nearbyBy, type TooltipRow } from './panels/geometry'
import { SeriesTooltip, useHoverPin } from './panels/Tooltip'

const DRAG_PIXELS = 4
const EDGE = 4

type Spot = { at: number; by: 'key' | 'pointer' }

export type Dot = { frac: number; colour: string }

const sameSpot = (a: Spot | null, b: Spot): Spot => (a && a.at === b.at && a.by === b.by ? a : b)

const GLYPH = 6.7
const GAP = 6

export const gutterOf = (labels: string[]): number => Math.ceil(Math.max(0, ...labels.map((label) => label.length)) * GLYPH) + 4

export function YAxis({ labels, height }: { labels: string[]; height?: number }) {
  const last = Math.max(1, labels.length - 1)
  return (
    <div className="relative whitespace-nowrap font-mono text-micro tabular-nums text-chart-axis" style={height === undefined ? undefined : { height }} aria-hidden>
      {labels.map((label, index) => <span key={index} className="absolute right-0 -translate-y-1/2" style={{ top: `${(index / last) * 100}%` }}>{label}</span>)}
    </div>
  )
}

export type FrameStatus = { kind: 'loading' | 'empty' | 'error'; text: string }

export function ChartFrame({ title, legend, headline, windowLabel, live, status, count, times, xLabels, markers, aria, height, yLabels, drawn, rows, dots, format, onZoom }: {
  title: string
  legend?: string
  headline?: (at: number | null) => string
  windowLabel?: string
  live?: (at: number | null) => ReactNode
  status?: FrameStatus
  count: number
  times?: number[]
  xLabels: string[]
  markers: Marker[]
  aria: string
  height: number
  yLabels: string[]
  drawn: ReactNode
  rows: (at: number) => TooltipRow[]
  dots?: (at: number) => Dot[]
  format: (row: TooltipRow) => string
  onZoom?: (fromMs: number, toMs: number) => void
}) {
  const { hover, setHover, leave, pinned, setPinned, unpin, shown } = useHoverPin<Spot>(`${count}:${times?.[0] ?? ''}:${times?.[times.length - 1] ?? ''}`)
  const plot = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const down = useRef<{ x: number; from: number; moved: boolean } | null>(null)
  const [band, setBand] = useState<{ a: number; b: number } | null>(null)
  const zoomable = onZoom !== undefined && times !== undefined && times.length > 1
  const last = Math.max(1, count - 1)

  const layer = useMemo(
    () => <MarkerLayer popover={false} pins={markers.map((mark) => ({ frac: mark.at / last, label: mark.label, to: mark.to }))} />,
    [markers, last],
  )

  const at = shown && shown.at >= 0 && shown.at < count ? shown.at : null
  const guide = at === null ? null : fractionOf(at, count) * 100
  const header = at === null ? null : headerOf(times, xLabels, at, count)
  const tipRows = at === null ? [] : rows(at)
  const releases = at === null ? [] : nearbyBy(markers, (mark) => mark.at, at, last).map((mark) => ({ label: mark.label, to: mark.to, when: times ? timeText(times, timeAtIndex(times, mark.at) ?? 0) : '' }))

  useLayoutEffect(() => {
    const wrap = tip.current
    const area = plot.current
    if (!wrap || !area) return
    const a = area.getBoundingClientRect()
    const c = (area.closest('figure') ?? area).getBoundingClientRect()
    wrap.style.left = `${placeTooltip(fractionOf(at ?? 0, count) * a.width, wrap.offsetWidth, c.left - a.left + EDGE, c.right - a.left - EDGE)}px`
    wrap.style.top = `${clampInto(EDGE, wrap.offsetHeight, c.top - a.top + EDGE, c.bottom - a.top - EDGE)}px`
  })

  const fractionIn = (event: PointerEvent<HTMLDivElement>): number | null => {
    const box = event.currentTarget.getBoundingClientRect()
    return box.width === 0 ? null : clamp01((event.clientX - box.left) / box.width)
  }
  const follow = (fraction: number) => {
    const index = nearestPoint(count, fraction)
    if (index >= 0) setHover((current) => sameSpot(current, { at: index, by: 'pointer' }))
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('a,button'))) return
    const fraction = fractionIn(event)
    if (fraction === null) return
    down.current = { x: event.clientX, from: fraction, moved: false }
    if (event.pointerType === 'touch') follow(fraction)
    else if (zoomable) event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const fraction = fractionIn(event)
    if (fraction === null) return
    const press = down.current
    if (press && Math.abs(event.clientX - press.x) > DRAG_PIXELS) press.moved = true
    if (press?.moved && zoomable && event.pointerType !== 'touch') {
      setBand({ a: press.from, b: fraction })
      return
    }
    follow(fraction)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const press = down.current
    down.current = null
    setBand(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!press) return
    if (event.pointerType === 'touch') {
      if (press.moved) return
      if (pinned !== null) unpin()
      else if (count > 0) setPinned({ at: nearestPoint(count, press.from), by: 'pointer' })
      return
    }
    const fraction = fractionIn(event)
    if (press.moved && zoomable && fraction !== null && times && onZoom) {
      const range = zoomRange(press.from, fraction, times)
      if (range) onZoom(range.fromMs, range.toMs)
    }
  }
  const onPointerCancel = () => {
    down.current = null
    setBand(null)
    leave()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Escape') {
      leave()
      return
    }
    const next = stepIndex(shown?.at ?? null, event.key, count)
    if (next === null) return
    event.preventDefault()
    setHover((current) => sameSpot(current, { at: next, by: 'key' }))
  }

  const gutter = gutterOf(yLabels)

  const spoken = shown?.by === 'key' && at !== null ? `${header ? `${header}: ` : ''}${tipRows.map((row) => `${row.key} ${row.value === null ? 'no data' : format(row)}`).join(', ')}` : ''

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 pb-2 pt-3">
      <figcaption className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="min-w-0 flex-1 text-control font-semibold">{title}</span>
          {headline ? <span className="whitespace-nowrap font-mono text-heading font-semibold tabular-nums">{headline(at)}</span> : null}
          {windowLabel ? <span className="whitespace-nowrap font-mono text-micro tabular-nums text-muted-foreground">{header ?? windowLabel}</span> : null}
        </div>
        {legend ? <span className="text-caption text-muted-foreground">{legend}</span> : null}
        {live ? live(at) : null}
      </figcaption>
      <div className="grid gap-x-1.5 pt-2" style={{ gridTemplateColumns: `${gutter}px minmax(0,1fr)` }}>
        <YAxis labels={yLabels} height={height} />
        <div
          ref={plot}
          tabIndex={0}
          role="group"
          aria-label={`${aria}. Left and right arrow keys move between points, Home and End jump to the first and last, P pins the tooltip, Escape clears it.`}
          className="relative cursor-crosshair touch-pan-y select-none rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          style={{ height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={(event) => { if (!down.current && event.pointerType !== 'touch') leave() }}
          onKeyDown={onKeyDown}
          onBlur={(event) => { if (event.target === event.currentTarget) leave() }}
        >
          {drawn}
          {status ? (
            <div role={status.kind === 'error' ? 'alert' : 'status'} data-state={status.kind} className="pointer-events-none absolute inset-0 grid place-items-center px-3 text-center text-caption text-muted-foreground">{status.text}</div>
          ) : null}
          {layer}
          {guide !== null ? <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground" style={{ left: `${guide}%` }} /> : null}
          {at !== null && dots
            ? dots(at).map((dot, index) => <span key={index} aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background" style={{ left: `${guide}%`, top: `${dot.frac * 100}%`, background: dot.colour }} />)
            : null}
          {band ? <span aria-hidden className="pointer-events-none absolute inset-y-0 rounded-sm border-x border-series bg-series/15" style={{ left: `${Math.min(band.a, band.b) * 100}%`, width: `${Math.abs(band.b - band.a) * 100}%` }} /> : null}
          {at !== null && !band ? (
            <div ref={tip} className="pointer-events-none absolute z-10 w-max" style={{ left: `${guide}%`, top: EDGE }}>
              <SeriesTooltip header={header} rows={tipRows} format={(row) => (row.value === null ? 'no data' : format(row))} pinned={pinned !== null} drillable={false} releases={releases} className="static" />
            </div>
          ) : null}
          {pinned !== null ? <button type="button" onClick={unpin} className="absolute bottom-1 right-1 rounded-sm border bg-background px-1.5 text-caption text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Unpin</button> : null}
          {hover === null && pinned === null ? null : <span className="sr-only" aria-live="polite">{spoken}</span>}
        </div>
      </div>
      <div className="flex justify-between whitespace-nowrap font-mono text-micro tabular-nums text-chart-axis" style={{ paddingLeft: gutter + GAP }}>{xLabels.map((label, index) => <span key={`${index}-${label}`}>{label}</span>)}</div>
    </figure>
  )
}
