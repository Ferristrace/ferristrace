import { Fragment, useId, useMemo } from 'react'
import { TIME_LABELS } from '@/data/series'
import { ChartFrame, type FrameStatus } from './ChartFrame'
import { clamp01, finite, fractionOf, headlineOf, LINE_COLOUR, linesRows, liveSummary, runsOf, stackRows, type Line, type Reading } from './chartMath'
import { PALETTE } from './panels/geometry'

export type Marker = { at: number; label: string; to?: string }

const WIDTH = 600

const plainFormat = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2))

const joined = (run: [number, number][]) => run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

const rowFormat = (format: (value: number) => string) => (row: { value: number | null }) => (row.value === null ? 'no data' : format(row.value))

export type { Line } from './chartMath'

const gradientId = (raw: string) => `fill-${raw.replace(/[^a-zA-Z0-9]/g, '')}`

function LiveLegend({ lines, at, format }: { lines: Line[]; at: number | null; format: (value: number) => string }) {
  return (
    <div role="group" aria-label={liveSummary(lines, at, format)} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption">
      {lines.map((line, index) => {
        const value = at === null ? line.overall ?? null : finite(line.values[at])
        return (
          <Fragment key={line.key}>
            {index > 0 ? <span aria-hidden className="text-muted-foreground">·</span> : null}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <svg width="14" height="8" aria-hidden className="shrink-0">
                <line x1="0" y1="4" x2="14" y2="4" stroke={line.colour ?? LINE_COLOUR} strokeWidth={Math.max(1.5, line.weight ?? 1.5)} strokeOpacity={line.opacity ?? 1} strokeDasharray={line.dash} />
              </svg>
              <span className="text-muted-foreground">{line.key}</span>
              <span className="font-mono font-semibold tabular-nums text-foreground">{value === null ? '—' : format(value)}</span>
            </span>
          </Fragment>
        )
      })}
    </div>
  )
}

export function LineChart({ title, legend, values, second, secondLabel, lines, live = false, overall, windowLabel, status, threshold, lo = 0, hi, yLabels, aria, height = 200, markers = [], xLabels = TIME_LABELS, times, format = plainFormat, onZoom }: {
  title: string; legend?: string; values?: Reading[]; second?: Reading[]; secondLabel?: string; lines?: Line[]; live?: boolean; overall?: number | null; windowLabel?: string; status?: FrameStatus
  threshold?: number; lo?: number; hi: number; yLabels: [string, string, string]; aria: string; height?: number; markers?: Marker[]; xLabels?: string[]
  times?: number[]; format?: (value: number) => string; onZoom?: (fromMs: number, toMs: number) => void
}) {
  const raw = useId()
  const shown = useMemo<Line[]>(
    () => lines ?? [
      { key: title, values: values ?? [], overall },
      ...(second ? [{ key: secondLabel ?? 'Comparison', values: second, colour: 'var(--muted-foreground)', dash: '3 3' }] : []),
    ],
    [lines, title, values, overall, second, secondLabel],
  )
  const count = shown.reduce((most, line) => Math.max(most, line.values.length), 0)
  const span = hi - lo || 1
  const rise = (value: number) => clamp01((value - lo) / span)
  const gradient = gradientId(raw)
  const drawn = useMemo(() => {
    const x = (at: number) => fractionOf(at, count) * WIDTH
    const y = (value: number) => height - clamp01((value - lo) / span) * height
    const runs = shown.map((line) => runsOf(line.values, x, y))
    const ty = threshold !== undefined ? height - clamp01((threshold - lo) / span) * height : null
    const filled = shown.length === 1
    return (
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden className="absolute inset-0 block overflow-visible">
        {filled ? (
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={shown[0].colour ?? LINE_COLOUR} stopOpacity="0.18" />
              <stop offset="1" stopColor={shown[0].colour ?? LINE_COLOUR} stopOpacity="0" />
            </linearGradient>
          </defs>
        ) : null}
        <line x1="0" y1="0.5" x2={WIDTH} y2="0.5" stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height / 2} x2={WIDTH} y2={height / 2} stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height - 0.5} x2={WIDTH} y2={height - 0.5} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        {ty !== null ? <line x1="0" y1={ty} x2={WIDTH} y2={ty} stroke="var(--warning-text)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
        {filled ? runs[0].map((run, at) => (run.length > 1 ? <polygon key={`fill-${at}`} points={`${run[0][0]},${height} ${joined(run)} ${run[run.length - 1][0]},${height}`} fill={`url(#${gradient})`} /> : null)) : null}
        {shown.map((line, which) => runs[which].map((run, at) => (run.length > 1
          ? <polyline key={`${line.key}-${at}`} points={joined(run)} fill="none" stroke={line.colour ?? LINE_COLOUR} strokeWidth={line.weight ?? 1.5} strokeOpacity={line.opacity ?? 1} strokeDasharray={line.dash} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          : <circle key={`${line.key}-dot-${at}`} cx={run[0][0]} cy={run[0][1]} r="2" fill={line.colour ?? LINE_COLOUR} />)))}
      </svg>
    )
  }, [shown, threshold, lo, span, height, count, gradient])
  return (
    <ChartFrame
      title={title}
      legend={legend}
      headline={live ? undefined : (at) => headlineOf(shown[0]?.overall, shown[0]?.values ?? [], at, format)}
      windowLabel={windowLabel}
      live={live ? (at) => <LiveLegend lines={shown} at={at} format={format} /> : undefined}
      status={status}
      count={count}
      times={times}
      xLabels={xLabels}
      markers={markers}
      aria={aria}
      height={height}
      yLabels={yLabels}
      drawn={drawn}
      rows={(at) => linesRows(shown, threshold, at)}
      dots={(at) => shown.flatMap((line) => {
        const value = finite(line.values[at])
        return value === null ? [] : [{ frac: 1 - rise(value), colour: line.colour ?? LINE_COLOUR }]
      })}
      format={rowFormat(format)}
      onZoom={onZoom}
    />
  )
}

export const stackColour = (index: number) => PALETTE[index % PALETTE.length]

export type StackLayer = { key: string; values: number[] }

export function StackedChart({ title, legend, layers, yLabels, aria, height = 160, markers = [], xLabels, times, format = plainFormat, onZoom }: {
  title: string; legend?: string; layers: StackLayer[]; yLabels: (top: number) => [string, string, string]; aria: string; height?: number; markers?: Marker[]; xLabels: string[]
  times?: number[]; format?: (value: number) => string; onZoom?: (fromMs: number, toMs: number) => void
}) {
  const count = layers[0]?.values.length ?? 0
  const totals = useMemo(() => Array.from({ length: count }, (_, at) => layers.reduce((sum, layer) => sum + (finite(layer.values[at]) ?? 0), 0)), [layers, count])
  const top = Math.max(...totals, 1e-9)
  const colours = useMemo(() => layers.map((_, index) => stackColour(index)), [layers])
  const drawn = useMemo(() => {
    const x = (at: number) => (fractionOf(at, count) * WIDTH)
    const y = (value: number) => height - (value / top) * height
    const below = new Array<number>(count).fill(0)
    const bands = layers.map((layer, index) => {
      const lower = [...below]
      layer.values.forEach((value, at) => { below[at] += finite(value) ?? 0 })
      const upper = [...below]
      const outline = upper.map((value, at) => `${x(at).toFixed(1)},${y(value).toFixed(1)}`)
      const back = lower.map((value, at) => `${x(at).toFixed(1)},${y(value).toFixed(1)}`).reverse()
      return { key: layer.key, colour: colours[index], points: [...outline, ...back].join(' ') }
    })
    return (
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden className="absolute inset-0 block overflow-visible">
        <line x1="0" y1="0.5" x2={WIDTH} y2="0.5" stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height / 2} x2={WIDTH} y2={height / 2} stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height - 0.5} x2={WIDTH} y2={height - 0.5} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        {bands.map((band) => <polygon key={band.key} points={band.points} fill={band.colour} fillOpacity="0.55" stroke={band.colour} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
      </svg>
    )
  }, [layers, colours, count, top, height])
  return (
    <ChartFrame
      title={title}
      kind="Stacked area"
      legend={legend}
      headline={(at) => {
        if (count === 0) return '—'
        return format(totals[at ?? count - 1])
      }}
      count={count}
      times={times}
      xLabels={xLabels}
      markers={markers}
      aria={aria}
      height={height}
      yLabels={yLabels(top)}
      drawn={drawn}
      rows={(at) => stackRows(layers, at, colours)}
      format={rowFormat(format)}
      onZoom={onZoom}
    />
  )
}
