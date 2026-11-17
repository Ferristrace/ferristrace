export type SparkStyle = 'line' | 'area' | 'bars'

export type Spot = { x: number; y: number; at: number }

export function spotsOf(values: readonly (number | null)[], width: number, height: number, pad = 2): Spot[] {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (known.length === 0) return []
  const top = Math.max(...known)
  const bottom = Math.min(0, ...known)
  const span = top - bottom || 1
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const out: Spot[] = []
  values.forEach((value, at) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    out.push({ x: values.length > 1 ? at * step : width / 2, y: pad + (1 - (value - bottom) / span) * (height - pad * 2), at })
  })
  return out
}

export function linePath(spots: readonly Spot[]): string {
  return spots.map((spot, i) => `${i === 0 ? 'M' : 'L'}${spot.x.toFixed(1)} ${spot.y.toFixed(1)}`).join(' ')
}

export function areaPath(spots: readonly Spot[], height: number): string {
  if (spots.length === 0) return ''
  const first = spots[0]
  const last = spots[spots.length - 1]
  return `${linePath(spots)} L${last.x.toFixed(1)} ${height} L${first.x.toFixed(1)} ${height} Z`
}

export type Bar = { x: number; y: number; width: number; height: number; at: number }

export function barsOf(values: readonly (number | null)[], width: number, height: number, gap = 2): Bar[] {
  if (values.length === 0) return []
  const top = Math.max(0, ...values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))
  const slot = width / values.length
  const wide = Math.max(1, slot - gap)
  return values.map((value, at) => {
    const share = top > 0 && typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) / top : 0
    const tall = Math.max(share > 0 ? 2 : 1, share * height)
    return { x: at * slot + (slot - wide) / 2, y: height - tall, width: wide, height: tall, at }
  })
}

export function indexAt(fraction: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))))
}

export function bucketAt(fraction: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)))
}
