import type { Bucket, Cell, HeatRange, Labels, Pair, SeriesData } from '@/data/dashboards'

export const PALETTE = ['#4f46e5', '#0891b2', '#d97706', '#059669', '#db2777', '#7c3aed', '#65a30d', '#dc2626', '#0284c7', '#a16207']

export function maxOf(values: number[], floor = -Infinity): number {
  let best = floor
  for (const value of values) if (value > best) best = value
  return best
}

export function minOf(values: number[], ceil = Infinity): number {
  let best = ceil
  for (const value of values) if (value < best) best = value
  return best
}

export const colourOf = (index: number): string => PALETTE[index % PALETTE.length]

export type Table = { times: number[]; rows: (number | null)[][] }

export function alignSeries(series: SeriesData[]): Table {
  const times = [...new Set(series.flatMap((one) => one.points.map((point) => point[0])))].sort((a, b) => a - b)
  const at = new Map(times.map((time, index) => [time, index]))
  const rows = series.map((one) => {
    const row = new Array<number | null>(times.length).fill(null)
    for (const [time, value] of one.points) row[at.get(time) ?? 0] = value
    return row
  })
  return { times, rows }
}

export function stepOf(times: number[]): number {
  if (times.length < 2) return 0
  const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

export type Frame = { t0: number; t1: number; lo: number; hi: number }

export function frameOf(table: Table, hidden: boolean[], stacked: boolean, padded: boolean): Frame {
  const { times, rows } = table
  const step = padded ? stepOf(times) : 0
  const t0 = times.length ? times[0] - step / 2 : 0
  const t1 = times.length ? times[times.length - 1] + step / 2 : 1
  let lo = 0
  let hi = 0
  if (stacked) {
    for (let at = 0; at < times.length; at++) {
      let up = 0
      let down = 0
      rows.forEach((row, index) => {
        const value = hidden[index] ? null : row[at]
        if (value === null || value === undefined) return
        if (value >= 0) up += value
        else down += value
      })
      hi = Math.max(hi, up)
      lo = Math.min(lo, down)
    }
  } else {
    rows.forEach((row, index) => {
      if (hidden[index]) return
      for (const value of row) {
        if (value === null) continue
        hi = Math.max(hi, value)
        lo = Math.min(lo, value)
      }
    })
  }
  return { t0, t1: t1 > t0 ? t1 : t0 + 1, lo, hi: hi > lo ? hi : lo + 1 }
}

export const xFraction = (time: number, frame: Frame): number => (time - frame.t0) / (frame.t1 - frame.t0)

export const yFraction = (value: number, frame: Frame): number => 1 - (value - frame.lo) / (frame.hi - frame.lo)

export const valueAtFraction = (fraction: number, frame: Frame): number => frame.hi - fraction * (frame.hi - frame.lo)

export function segmentsOf(points: [number, number | null][], x: (time: number) => number, y: (value: number) => number): [number, number][][] {
  const out: [number, number][][] = []
  let run: [number, number][] = []
  for (const [time, value] of points) {
    if (value === null) {
      if (run.length) out.push(run)
      run = []
    } else {
      run.push([x(time), y(value)])
    }
  }
  if (run.length) out.push(run)
  return out
}

export type Layer = { lower: number[]; upper: number[] }

export function stackLayers(table: Table, hidden: boolean[]): Layer[] {
  const up = new Array<number>(table.times.length).fill(0)
  const down = new Array<number>(table.times.length).fill(0)
  return table.rows.map((row, index) => {
    const lower: number[] = []
    const upper: number[] = []
    row.forEach((cell, at) => {
      const value = hidden[index] || cell === null ? 0 : cell
      const side = value >= 0 ? up : down
      lower.push(side[at])
      side[at] += value
      upper.push(side[at])
    })
    return { lower, upper }
  })
}

export function nearestIndex(times: number[], time: number): number {
  if (times.length === 0) return -1
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < time) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(times[lo - 1] - time) <= Math.abs(times[lo] - time)) return lo - 1
  return lo
}

export type TooltipEntry = { key: string; colour: string; value: number | null; anchor?: number }

export type TooltipRow = TooltipEntry & { at: number; nearest: boolean }

export function tooltipRows(entries: TooltipEntry[], pointer: number | null): TooltipRow[] {
  const rows = entries.map((entry, at) => ({ ...entry, at, nearest: false }))
  rows.sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === b.value ? a.at - b.at : a.value === null ? 1 : -1
    return b.value - a.value || a.at - b.at
  })
  const known = rows.filter((row) => row.value !== null)
  if (known.length === 0) return rows
  let best = known[0]
  if (pointer !== null) {
    const place = (row: (typeof known)[number]) => row.anchor ?? (row.value as number)
    for (const row of known) if (Math.abs(place(row) - pointer) < Math.abs(place(best) - pointer)) best = row
  }
  best.nearest = true
  return rows
}

export type Slice = { label: string; value: number; share: number; start: number; end: number; labels: Labels; other: boolean }

export function pieSlices(items: { label: string; value: number; labels: Labels }[], keep = 10): Slice[] {
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value)
  const head = positive.slice(0, keep).map((item) => ({ ...item, other: false }))
  const tail = positive.slice(keep)
  if (tail.length > 0) head.push({ label: `Other (${tail.length})`, value: tail.reduce((sum, item) => sum + item.value, 0), labels: {}, other: true })
  const total = head.reduce((sum, item) => sum + item.value, 0)
  let angle = -Math.PI / 2
  return head.map((item) => {
    const share = total > 0 ? item.value / total : 0
    const start = angle
    angle += share * Math.PI * 2
    return { ...item, share, start, end: angle }
  })
}

const point = (cx: number, cy: number, radius: number, angle: number): string => `${(cx + radius * Math.cos(angle)).toFixed(3)} ${(cy + radius * Math.sin(angle)).toFixed(3)}`

export function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  if (end - start >= Math.PI * 2 - 1e-6) {
    const mid = start + Math.PI
    return `M ${point(cx, cy, outer, start)} A ${outer} ${outer} 0 1 1 ${point(cx, cy, outer, mid)} A ${outer} ${outer} 0 1 1 ${point(cx, cy, outer, start)} Z M ${point(cx, cy, inner, start)} A ${inner} ${inner} 0 1 0 ${point(cx, cy, inner, mid)} A ${inner} ${inner} 0 1 0 ${point(cx, cy, inner, start)} Z`
  }
  const large = end - start > Math.PI ? 1 : 0
  return `M ${point(cx, cy, outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(cx, cy, outer, end)} L ${point(cx, cy, inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(cx, cy, inner, start)} Z`
}

export type PieItem = { label: string; value: number; labels: Labels }

export function pieItems(columns: string[], rows: Cell[][]): PieItem[] {
  if (columns.length === 0) return []
  const valueAt = columns.length - 1
  return rows.flatMap((row) => {
    const value = row[valueAt]
    if (typeof value !== 'number' || !Number.isFinite(value)) return []
    const labels: Labels = {}
    columns.slice(0, valueAt).forEach((column, index) => {
      labels[column] = String(row[index] ?? '')
    })
    const parts = Object.values(labels)
    return [{ label: parts.length ? parts.join(' · ') : columns[valueAt], value, labels }]
  })
}

export type Bar = { x0: number; x1: number; height: number; count: number; from: number; to: number }

export function histogramBars(buckets: Bucket[]): { bars: Bar[]; peak: number } {
  const peak = maxOf(buckets.map((bucket) => bucket.count), 0)
  const lo = minOf(buckets.map((bucket) => bucket.from))
  const hi = maxOf(buckets.map((bucket) => bucket.to))
  const even = !(hi > lo)
  const bars = buckets.map((bucket, index) => ({
    x0: even ? index / buckets.length : (bucket.from - lo) / (hi - lo),
    x1: even ? (index + 1) / buckets.length : (bucket.to - lo) / (hi - lo),
    height: peak > 0 ? bucket.count / peak : 0,
    count: bucket.count,
    from: bucket.from,
    to: bucket.to,
  }))
  return { bars, peak }
}

export type HeatCell = { x0: number; x1: number; y0: number; y1: number; count: number; intensity: number; xi: number; yi: number }

export function heatCells(x: number[], y: HeatRange[], cells: [number, number, number][]): { cells: HeatCell[]; peak: number } {
  const peak = maxOf(cells.map((cell) => cell[2]), 0)
  const out = cells
    .filter(([xi, yi, count]) => xi >= 0 && xi < x.length && yi >= 0 && yi < y.length && count > 0)
    .map(([xi, yi, count]) => ({
      xi,
      yi,
      count,
      x0: xi / x.length,
      x1: (xi + 1) / x.length,
      y0: 1 - (yi + 1) / y.length,
      y1: 1 - yi / y.length,
      intensity: peak > 0 ? count / peak : 0,
    }))
  return { cells: out, peak }
}

export const topCells = (cells: HeatCell[], count: number): HeatCell[] => [...cells].sort((a, b) => b.count - a.count || a.xi - b.xi || a.yi - b.yi).slice(0, count)

export type ScatterFrame = { xLo: number; xHi: number; yLo: number; yHi: number }

export function scatterFrame(points: Pair[]): ScatterFrame {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xLo = minOf(xs, 0)
  const yLo = minOf(ys, 0)
  const xHi = maxOf(xs, xLo + 1e-9)
  const yHi = maxOf(ys, yLo + 1e-9)
  return { xLo, xHi: xHi > xLo ? xHi : xLo + 1, yLo, yHi: yHi > yLo ? yHi : yLo + 1 }
}

export const MAX_DOTS = 2000

export function capPoints<T>(points: T[], max = MAX_DOTS): T[] {
  if (points.length <= max) return points
  const stride = points.length / max
  return Array.from({ length: max }, (_, at) => points[Math.floor(at * stride)])
}

export type Dot = { x: number; y: number; group: string; labels: Labels; colour: string; raw: Pair }

export function scatterDots(points: Pair[], frame: ScatterFrame, key: (labels: Labels) => string): Dot[] {
  const order: string[] = []
  return points.map((pair) => {
    const group = key(pair.group)
    if (!order.includes(group)) order.push(group)
    return {
      x: (pair.x - frame.xLo) / (frame.xHi - frame.xLo),
      y: 1 - (pair.y - frame.yLo) / (frame.yHi - frame.yLo),
      group,
      labels: pair.group,
      colour: colourOf(order.indexOf(group)),
      raw: pair,
    }
  })
}

const MINUTE_MS = 60_000

export function drillRange(atNs: number, stepNs: number, spanNs: number): { fromMs: number; toMs: number } {
  const width = stepNs > 0 ? stepNs : Math.max(MINUTE_MS * 1e6, spanNs / 60)
  return { fromMs: Math.floor(atNs / 1e6), toMs: Math.ceil((atNs + width) / 1e6) }
}

export function selectRange(a: number, b: number, frame: Frame): { fromNs: number; toNs: number } | null {
  const lo = Math.max(0, Math.min(a, b, 1))
  const hi = Math.min(1, Math.max(a, b, 0))
  if (hi - lo <= 0) return null
  const span = frame.t1 - frame.t0
  return { fromNs: Math.round(frame.t0 + lo * span), toNs: Math.round(frame.t0 + hi * span) }
}

const TIME_UNITS: Record<string, number> = { ns: 1, us: 1e3, µs: 1e3, ms: 1e6, s: 1e9 }
const BYTE_UNITS = ['bytes', 'by', 'b']

export const isScaledUnit = (unit?: string | null): boolean => {
  const key = (unit ?? '').trim().toLowerCase()
  return key in TIME_UNITS || BYTE_UNITS.includes(key)
}

const significant = (value: number): string => {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return Number(value.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits })
}

function scaled(value: number, unit: string): string | null {
  const key = unit.trim().toLowerCase()
  if (key in TIME_UNITS) {
    const ns = value * TIME_UNITS[key]
    const abs = Math.abs(ns)
    if (abs < 1e3) return `${significant(ns)} ns`
    if (abs < 1e6) return `${significant(ns / 1e3)} µs`
    if (abs < 1e9) return `${significant(ns / 1e6)} ms`
    if (abs < 60e9) return `${significant(ns / 1e9)} s`
    if (abs < 3600e9) return `${significant(ns / 60e9)} min`
    return `${significant(ns / 3600e9)} h`
  }
  if (BYTE_UNITS.includes(key)) {
    const names = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
    let at = 0
    let size = value
    while (Math.abs(size) >= 1024 && at < names.length - 1) {
      size /= 1024
      at += 1
    }
    return `${significant(size)} ${names[at]}`
  }
  return null
}

export function formatValue(value: number, unit?: string | null, decimals?: number | null): string {
  if (!Number.isFinite(value)) return '—'
  const human = unit ? scaled(value, unit) : null
  if (human !== null) return human
  const abs = Math.abs(value)
  const options: Intl.NumberFormatOptions =
    decimals === null || decimals === undefined
      ? { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 4 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  const text = value.toLocaleString('en-US', options)
  if (!unit) return text
  return unit === '%' ? `${text}%` : `${text} ${unit}`
}

export const axisValue = (value: number, unit?: string | null): string => {
  const human = unit ? scaled(value, unit) : null
  if (human !== null) return human
  return Math.abs(value) >= 10_000 ? value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }) : value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 })
}

const pad = (n: number) => String(n).padStart(2, '0')

export function clockOf(ns: number): string {
  const at = new Date(ns / 1e6)
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} UTC`
}

export function axisTime(ns: number, spanNs: number): string {
  const at = new Date(ns / 1e6)
  const hours = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`
  return spanNs <= 36 * 3_600e9 ? hours : `${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${hours}`
}

export type Tone = 'neutral' | 'warn' | 'critical'

export type Thresholds = { warn?: number; critical?: number }

export function thresholdTone(value: number | null, thresholds?: Thresholds): Tone {
  if (value === null || !thresholds) return 'neutral'
  if (thresholds.critical !== undefined && value >= thresholds.critical) return 'critical'
  if (thresholds.warn !== undefined && value >= thresholds.warn) return 'warn'
  return 'neutral'
}

export function isNumericColumn(rows: Cell[][], index: number): boolean {
  const cells = rows.map((row) => row[index]).filter((cell) => cell !== null && cell !== undefined)
  return cells.length > 0 && cells.every((cell) => typeof cell === 'number')
}

export function sortRows(rows: Cell[][], index: number, direction: 'asc' | 'desc'): Cell[][] {
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = a[index] ?? null
    const right = b[index] ?? null
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign
    return String(left).localeCompare(String(right), 'en', { numeric: true }) * sign
  })
}
