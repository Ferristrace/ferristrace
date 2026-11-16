import { useMemo } from 'react'
import { TIME_LABELS } from '@/data/series'
import { ChartFrame } from './ChartFrame'
import { clamp01, finite, fractionOf, lineRows, runsOf, stackRows, type Reading } from './chartMath'

export type Marker = { at: number; label: string; to?: string }

const WIDTH = 600

const plainFormat = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2))

const joined = (run: [number, number][]) => run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

const rowFormat = (format: (value: number) => string) => (row: { value: number | null }) => (row.value === null ? 'no data' : format(row.value))

export function LineChart({ title, legend, values, second, secondLabel, threshold, lo = 0, hi, yLabels, aria, height = 140, markers = [], xLabels = TIME_LABELS, times, format = plainFormat, onZoom }: {
  title: string; legend?: string; values: Reading[]; second?: Reading[]; secondLabel?: string; threshold?: number; lo?: number; hi: number; yLabels: [string, string, string]; aria: string; height?: number; markers?: Marker[]; xLabels?: string[]
  times?: number[]; format?: (value: number) => string; onZoom?: (fromMs: number, toMs: number) => void
}) {
  const count = values.length
  const span = hi - lo || 1
  const rise = (value: number) => clamp01((value - lo) / span)
  const drawn = useMemo(() => {
    const x = (at: number) => fractionOf(at, count) * WIDTH
    const y = (value: number) => height - clamp01((value - lo) / span) * height
    const main = runsOf(values, x, y)
    const other = second ? runsOf(second, x, y) : []
    const ty = threshold !== undefined ? height - clamp01((threshold - lo) / span) * height : null
    return (
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden className="absolute inset-0 block overflow-visible">
        <line x1="0" y1="0.5" x2={WIDTH} y2="0.5" stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height / 2} x2={WIDTH} y2={height / 2} stroke="var(--chart-grid)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height - 0.5} x2={WIDTH} y2={height - 0.5} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        {ty !== null ? <line x1="0" y1={ty} x2={WIDTH} y2={ty} stroke="var(--warning-text)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
        {main.map((run, at) => (run.length > 1 ? <polygon key={`fill-${at}`} points={`${run[0][0]},${height} ${joined(run)} ${run[run.length - 1][0]},${height}`} fill="var(--chart-fill)" /> : null))}
        {other.map((run, at) => (run.length > 1 ? <polyline key={`second-${at}`} points={joined(run)} fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null))}
        {main.map((run, at) => (run.length > 1
          ? <polyline key={`line-${at}`} points={joined(run)} fill="none" stroke="var(--chart-line)" strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          : <circle key={`dot-${at}`} cx={run[0][0]} cy={run[0][1]} r="2" fill="var(--chart-line)" />))}
      </svg>
    )
  }, [values, second, threshold, lo, span, height, count])
  return (
    <ChartFrame
      title={title}
      legend={legend}
      headline={(at) => {
        const value = finite(values[at ?? count - 1])
        return value === null ? '—' : format(value)
      }}
      count={count}
      times={times}
      xLabels={xLabels}
      markers={markers}
      aria={aria}
      height={height}
      gutter="narrow"
      yLabels={yLabels}
      drawn={drawn}
      rows={(at) => lineRows({ title, values, second, secondLabel, threshold }, at)}
      dots={(at) => {
        const main = finite(values[at])
        const other = second ? finite(second[at]) : null
        return [
          ...(other === null ? [] : [{ frac: 1 - rise(other), colour: 'var(--muted-foreground)' }]),
          ...(main === null ? [] : [{ frac: 1 - rise(main), colour: 'var(--chart-line)' }]),
        ]
      }}
      format={rowFormat(format)}
      onZoom={onZoom}
    />
  )
}

const STACK_PALETTE = ['#4f46e5', '#0891b2', '#d97706', '#059669', '#db2777', '#7c3aed', '#65a30d', '#dc2626']

export const stackColour = (index: number) => STACK_PALETTE[index % STACK_PALETTE.length]

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
      gutter="wide"
      yLabels={yLabels(top)}
      drawn={drawn}
      rows={(at) => stackRows(layers, at, colours)}
      format={rowFormat(format)}
      onZoom={onZoom}
    />
  )
}
