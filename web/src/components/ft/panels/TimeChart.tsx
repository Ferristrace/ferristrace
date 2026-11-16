import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { SeriesData } from '@/data/dashboards'
import { cn } from '@/lib/utils'
import { Filled, PanelEmpty } from './Empty'
import {
  alignSeries, axisTime, axisValue, clockOf, colourOf, formatValue, frameOf, nearestIndex, segmentsOf, selectRange, stackLayers, stepOf, tooltipRows, valueAtFraction, xFraction, yFraction,
  type TooltipRow,
} from './geometry'
import { Legend } from './Legend'
import { MarkerLayer, releasesNear } from './MarkerLayer'
import { labelOf, isEmpty } from './result'
import { SeriesTooltip, useHoverPin } from './Tooltip'
import type { Of, PanelProps } from './types'

const WIDTH = 600
const HEIGHT = 200
const DRAG_PIXELS = 4

type Mode = 'line' | 'area' | 'bar'

type Spot = { at: number; focus: number | null }

const clamp = (value: number) => Math.min(1, Math.max(0, value))

const points = (parts: [number, number][]) => parts.map(([x, y]) => `${(x * WIDTH).toFixed(1)},${(y * HEIGHT).toFixed(1)}`).join(' ')

const sameSpot = (a: Spot | null, b: Spot): Spot => (a && a.at === b.at && a.focus === b.focus ? a : b)

export function TimeChart({ mode, panel, result, range, markers = [], onZoom, drill }: PanelProps<Of<'series'>> & { mode: Mode }) {
  const { options } = panel
  const series: SeriesData[] = result.series
  const names = useMemo(() => series.map((one) => labelOf(one.labels)), [series])
  const [off, setOff] = useState<string[]>([])
  const hidden = useMemo(() => names.map((name) => off.includes(name)), [names, off])
  const table = useMemo(() => alignSeries(series), [series])
  const stacked = mode !== 'line' && options.stacked === true
  const frame = useMemo(() => frameOf(table, hidden, stacked, mode === 'bar'), [table, hidden, stacked, mode])
  const layers = useMemo(() => (stacked ? stackLayers(table, hidden) : []), [table, hidden, stacked])
  const step = useMemo(() => stepOf(table.times), [table])
  const visible = useMemo(() => names.map((_, index) => index).filter((index) => !hidden[index]), [names, hidden])
  const { hover, setHover, leave, pinned, unpin, shown } = useHoverPin<Spot>(result)
  const plot = useRef<HTMLDivElement>(null)
  const down = useRef<{ x: number; from: number; moved: boolean } | null>(null)
  const [band, setBand] = useState<{ a: number; b: number } | null>(null)

  const x = (time: number) => xFraction(time, frame)
  const y = (value: number) => yFraction(value, frame)
  const slot = table.times.length > 0 ? 1 / table.times.length : 1

  const drawn = useMemo(() => {
    const y0 = yFraction(0, frame)
    const px = (time: number) => xFraction(time, frame)
    const py = (value: number) => yFraction(value, frame)
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden className="absolute inset-0 block size-full overflow-visible">
        <line x1="0" y1="0.5" x2={WIDTH} y2="0.5" stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        {mode === 'bar'
          ? visible.flatMap((index, order) =>
              table.times.map((time, column) => {
                const value = table.rows[index][column]
                if (value === null) return null
                const lower = stacked ? layers[index].lower[column] : Math.min(0, value)
                const upper = stacked ? layers[index].upper[column] : Math.max(0, value)
                const width = stacked ? slot * 0.8 : (slot * 0.8) / visible.length
                const left = px(time) - (slot * 0.8) / 2 + (stacked ? 0 : order * width)
                const top = py(Math.max(lower, upper))
                const bottom = py(Math.min(lower, upper))
                return <rect key={`${index}-${time}`} x={left * WIDTH} y={top * HEIGHT} width={Math.max(0.5, width * WIDTH - 0.5)} height={Math.max(0.5, (bottom - top) * HEIGHT)} fill={colourOf(index)} fillOpacity={0.9} />
              }),
            )
          : null}
        {mode === 'area' && stacked
          ? visible.map((index) => {
              const top = table.times.map((time, column): [number, number] => [px(time), py(layers[index].upper[column])])
              const bottom = table.times.map((time, column): [number, number] => [px(time), py(layers[index].lower[column])]).reverse()
              return <polygon key={index} points={points([...top, ...bottom])} fill={colourOf(index)} fillOpacity="0.55" stroke={colourOf(index)} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            })
          : null}
        {mode !== 'bar' && !stacked
          ? visible.map((index) => segmentsOf(series[index].points, px, py).map((part, run) => (
              <g key={`${index}-${run}`}>
                {mode === 'area' && part.length > 1 ? <polygon points={points([[part[0][0], y0], ...part, [part[part.length - 1][0], y0]])} fill={colourOf(index)} fillOpacity="0.14" /> : null}
                {part.length > 1
                  ? <polyline points={points(part)} fill="none" stroke={colourOf(index)} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  : <circle cx={part[0][0] * WIDTH} cy={part[0][1] * HEIGHT} r="2" fill={colourOf(index)} />}
              </g>
            )))
          : null}
      </svg>
    )
  }, [mode, visible, table, layers, stacked, series, frame, slot])

  const at = shown && shown.at >= 0 && shown.at < table.times.length ? shown.at : null
  const when = at === null ? null : table.times[at]
  const focus = shown?.focus ?? null
  const rows: TooltipRow[] = useMemo(() => {
    if (at === null) return []
    const listed = tooltipRows(visible.map((index) => ({ key: names[index], colour: colourOf(index), value: table.rows[index][at] })), null).map((row) => ({ ...row, at: visible[row.at] }))
    return focus === null ? listed : listed.map((row) => ({ ...row, nearest: row.at === focus }))
  }, [at, focus, visible, names, table])

  if (isEmpty(result)) return <PanelEmpty />

  const span = frame.t1 - frame.t0
  const nearest = rows.find((row) => row.nearest)

  const open = (index: number) => {
    if (!drill || when === null) return
    drill(series[index].labels, { atNs: when, stepNs: step })
  }

  const focusAt = (index: number, fy: number): number | null => {
    const pointer = valueAtFraction(fy, frame)
    const found = tooltipRows(
      visible.map((one) => {
        const value = table.rows[one][index]
        const anchor = stacked && value !== null ? Math.min(Math.max(pointer, Math.min(layers[one].lower[index], layers[one].upper[index])), Math.max(layers[one].lower[index], layers[one].upper[index])) : undefined
        return { key: names[one], colour: '', value, anchor }
      }),
      pointer,
    ).find((row) => row.nearest)
    return found ? visible[found.at] : null
  }

  const place = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return null
    return { fx: clamp((event.clientX - box.left) / box.width), fy: clamp((event.clientY - box.top) / box.height) }
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('a,button'))) return
    const found = place(event)
    if (!found) return
    event.currentTarget.setPointerCapture(event.pointerId)
    down.current = { x: event.clientX, from: found.fx, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const found = place(event)
    if (!found) return
    const press = down.current
    if (press && (press.moved || Math.abs(event.clientX - press.x) > DRAG_PIXELS)) {
      press.moved = true
      setBand({ a: press.from, b: found.fx })
      return
    }
    const index = nearestIndex(table.times, frame.t0 + found.fx * span)
    if (index >= 0) {
      const next = { at: index, focus: focusAt(index, found.fy) }
      setHover((current) => sameSpot(current, next))
    }
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const press = down.current
    down.current = null
    setBand(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const found = place(event)
    if (!press || !found) return
    if (press.moved) {
      const picked = selectRange(press.from, found.fx, frame)
      if (picked && onZoom) onZoom(Math.floor(picked.fromNs / 1e6), Math.ceil(picked.toNs / 1e6))
      return
    }
    const index = nearestIndex(table.times, frame.t0 + found.fx * span)
    const one = index >= 0 ? focusAt(index, found.fy) : null
    if (one !== null && drill) drill(series[one].labels, { atNs: table.times[index], stepNs: step })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const last = table.times.length - 1
    const current = shown?.at ?? -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = event.key === 'ArrowRight' ? Math.min(last, current + 1) : Math.max(0, current < 0 ? last : current - 1)
      setHover((was) => sameSpot(was, { at: next, focus: null }))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setHover({ at: event.key === 'Home' ? 0 : last, focus: null })
    } else if (event.key === 'Enter' && nearest) {
      event.preventDefault()
      open(nearest.at)
    } else if (event.key === 'Escape') {
      leave()
    }
  }

  const guide = when === null ? null : x(when) * 100
  const flip = guide !== null && guide > 50
  const tick = [frame.hi, (frame.hi + frame.lo) / 2, frame.lo]
  const aria = `${mode === 'bar' ? 'Bar' : mode === 'area' ? 'Area' : 'Line'} chart of ${panel.title || 'a panel'}, ${names.length} series: ${names.slice(0, 6).join('; ')}`
  const legend = options.legend ?? 'bottom'
  const emphasis = nearest && at !== null ? nearest.at : null

  return (
    <Filled className={cn('gap-2', legend === 'right' && 'md:flex-row')}>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[44px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-1.5 gap-y-1">
        <div className="flex flex-col justify-between text-right font-mono text-[10px] leading-3 text-faint-foreground" aria-hidden>
          {tick.map((value, index) => <span key={index}>{axisValue(value, options.unit)}</span>)}
        </div>
        <div
          ref={plot}
          tabIndex={0}
          role="group"
          aria-label={`${aria}. Arrow keys move between times, P pins the tooltip, Enter opens the explorer.`}
          data-chart={mode}
          className="relative min-h-[96px] cursor-crosshair touch-none select-none rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { down.current = null; setBand(null) }}
          onPointerLeave={() => { if (!down.current) leave() }}
          onKeyDown={onKeyDown}
          onBlur={(event) => { if (event.target === event.currentTarget) leave() }}
        >
          {drawn}
          {emphasis !== null && at !== null ? (
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-0 block size-full overflow-visible">
              {mode === 'bar'
                ? (() => {
                    const value = table.rows[emphasis][at]
                    if (value === null) return null
                    const lower = stacked ? layers[emphasis].lower[at] : Math.min(0, value)
                    const upper = stacked ? layers[emphasis].upper[at] : Math.max(0, value)
                    const width = stacked ? slot * 0.8 : (slot * 0.8) / visible.length
                    const left = x(table.times[at]) - (slot * 0.8) / 2 + (stacked ? 0 : visible.indexOf(emphasis) * width)
                    const top = y(Math.max(lower, upper))
                    const bottom = y(Math.min(lower, upper))
                    return <rect x={left * WIDTH} y={top * HEIGHT} width={Math.max(0.5, width * WIDTH - 0.5)} height={Math.max(0.5, (bottom - top) * HEIGHT)} fill="none" stroke="var(--foreground)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  })()
                : stacked
                  ? <polyline points={points(table.times.map((time, column): [number, number] => [x(time), y(layers[emphasis].upper[column])]))} fill="none" stroke="var(--foreground)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  : segmentsOf(series[emphasis].points, x, y).map((part, run) => (part.length > 1 ? <polyline key={run} points={points(part)} fill="none" stroke={colourOf(emphasis)} strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null))}
            </svg>
          ) : null}
          {guide !== null ? <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground" style={{ left: `${guide}%` }} /> : null}
          {mode !== 'bar' ? <MarkerLayer marks={markers} frame={frame} /> : null}
          {at !== null && !stacked && mode !== 'bar'
            ? rows.map((row, index) => (row.value === null ? null : (
                <span key={`${index}-${row.key}`} aria-hidden className={cn('pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background', row.nearest ? 'size-3' : 'size-2')} style={{ left: `${guide ?? 0}%`, top: `${y(row.value) * 100}%`, background: row.colour }} />
              )))
            : null}
          {band ? <span aria-hidden className="pointer-events-none absolute inset-y-0 rounded-sm border-x border-series bg-series/15" style={{ left: `${Math.min(band.a, band.b) * 100}%`, width: `${Math.abs(band.b - band.a) * 100}%` }} /> : null}
          {when !== null && !band ? (
            <SeriesTooltip
              header={clockOf(when)}
              rows={rows}
              format={(row) => (row.value === null ? 'no data' : formatValue(row.value, options.unit, options.decimals))}
              pinned={pinned !== null}
              drillable={drill !== undefined}
              onOpen={(row) => open(row.at)}
              releases={releasesNear(markers, when, frame.t1 - frame.t0).map((mark) => ({ label: mark.label, to: mark.to, when: axisTime(mark.atNs, frame.t1 - frame.t0) }))}
              className="top-1"
              style={{ left: `${guide}%`, transform: flip ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}
            />
          ) : null}
          {pinned !== null ? <button type="button" onClick={unpin} className="absolute bottom-1 right-1 rounded-sm border bg-background px-1.5 text-caption text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Unpin</button> : null}
          {hover === null && pinned === null ? null : <span className="sr-only" aria-live="polite">{when === null ? '' : `${clockOf(when)}: ${rows.slice(0, 3).map((row) => `${row.key} ${row.value === null ? 'no data' : formatValue(row.value, options.unit, options.decimals)}`).join(', ')}`}</span>}
        </div>
        <span />
        <div className="flex justify-between font-mono text-[10px] text-faint-foreground" aria-hidden>
          <span>{axisTime(frame.t0, span)}</span>
          <span>{axisTime((frame.t0 + frame.t1) / 2, span)}</span>
          <span>{axisTime(frame.t1, span)}</span>
        </div>
      </div>
      <Legend
        items={names.map((key, index) => ({ key, colour: colourOf(index), hidden: hidden[index] }))}
        position={legend}
        active={nearest?.key ?? null}
        onToggle={(key) => setOff((current) => (current.includes(key) ? current.filter((one) => one !== key) : [...current, key]))}
      />
      <span className="sr-only">{`Range ${clockOf(range.fromNs)} to ${clockOf(range.toNs)}`}</span>
    </Filled>
  )
}
