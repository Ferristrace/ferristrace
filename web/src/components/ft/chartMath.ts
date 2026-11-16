import { stepOf, type TooltipRow } from './panels/geometry'

export type Reading = number | null | undefined

export const finite = (value: Reading): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export const fractionOf = (at: number, count: number): number => (count > 1 ? at / (count - 1) : 0.5)

export function nearestPoint(count: number, fraction: number): number {
  if (count <= 0) return -1
  return Math.round(clamp01(fraction) * (count - 1))
}

export function stepIndex(current: number | null, key: string, count: number): number | null {
  if (count <= 0) return null
  const last = count - 1
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (key === 'ArrowRight') return Math.min(last, (current ?? -1) + 1)
  if (key === 'ArrowLeft') return Math.max(0, current === null ? last : current - 1)
  return null
}

export function lineRows(line: { title: string; values: Reading[]; second?: Reading[]; secondLabel?: string; threshold?: number }, at: number): TooltipRow[] {
  const rows: TooltipRow[] = [{ key: line.title, colour: 'var(--chart-line)', value: finite(line.values[at]), at: 0, nearest: false }]
  if (line.second) rows.push({ key: line.secondLabel ?? 'Comparison', colour: 'var(--muted-foreground)', value: finite(line.second[at]), at: 0, nearest: false })
  if (line.threshold !== undefined) rows.push({ key: 'threshold', colour: 'var(--warning-text)', value: line.threshold, at: 0, nearest: false })
  return rows.map((row, index) => ({ ...row, at: index }))
}

export function stackRows(layers: { key: string; values: number[] }[], at: number, colours: string[]): TooltipRow[] {
  const parts = layers
    .map((layer, index) => ({ key: layer.key || '(none)', colour: colours[index], value: finite(layer.values[at]) }))
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
  const total = layers.reduce((sum, layer) => sum + (finite(layer.values[at]) ?? 0), 0)
  return [{ key: 'total', colour: 'var(--muted-foreground)', value: total }, ...parts].map((row, index) => ({ ...row, at: index, nearest: false }))
}

export function timeAtIndex(times: number[], at: number): number | null {
  if (times.length === 0) return null
  const last = times.length - 1
  const clamped = Math.min(last, Math.max(0, at))
  const low = Math.floor(clamped)
  const high = Math.min(last, low + 1)
  return times[low] + (times[high] - times[low]) * (clamped - low)
}

const pad = (n: number) => String(n).padStart(2, '0')

const DAY_MS = 86_400_000

export function clockOf(ms: number, stepMs: number, spanMs: number): string {
  const at = new Date(ms)
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const exact = stepMs > 0 && stepMs < 60_000 ? `${clock}:${pad(at.getSeconds())}` : clock
  return spanMs > DAY_MS ? `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${exact}` : exact
}

export function timeText(times: number[], ms: number): string {
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0
  return clockOf(ms, stepOf(times), span)
}

export function headerOf(times: number[] | undefined, xLabels: string[], at: number, count = times?.length ?? 0): string | null {
  if (times && times.length > 0) return timeText(times, times[Math.min(Math.max(0, at), times.length - 1)])
  if (count < 2 || xLabels.length < 2) return null
  const across = (at / (count - 1)) * (xLabels.length - 1)
  const near = Math.round(across)
  return Math.abs(across - near) * ((count - 1) / (xLabels.length - 1)) < 0.5 ? xLabels[near] : null
}

export function placeTooltip(guide: number, width: number, min: number, max: number, gap = 8): number {
  const right = guide + gap
  const x = right + width <= max ? right : guide - gap - width
  return Math.max(min, Math.min(x, max - width))
}

export const clampInto = (start: number, size: number, min: number, max: number): number => Math.max(min, Math.min(start, max - size))

export function zoomRange(a: number, b: number, times: number[]): { fromMs: number; toMs: number } | null {
  if (times.length < 2) return null
  const first = times[0]
  const span = times[times.length - 1] - first
  const lo = clamp01(Math.min(a, b))
  const hi = clamp01(Math.max(a, b))
  const fromMs = Math.floor(first + lo * span)
  const toMs = Math.ceil(first + hi * span)
  return toMs > fromMs ? { fromMs, toMs } : null
}

export function runsOf(values: Reading[], x: (at: number) => number, y: (value: number) => number): [number, number][][] {
  const out: [number, number][][] = []
  let run: [number, number][] = []
  values.forEach((raw, at) => {
    const value = finite(raw)
    if (value === null) {
      if (run.length) out.push(run)
      run = []
    } else {
      run.push([x(at), y(value)])
    }
  })
  if (run.length) out.push(run)
  return out
}
