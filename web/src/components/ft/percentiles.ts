import type { Line, Reading } from './chartMath'

export const P50_OPACITY = 0.7

export type Spread = {
  p50: Reading[]
  p95: Reading[]
  p99: Reading[]
  overall: { p50: number | null; p95: number | null; p99: number | null }
  spread: boolean
}

export function percentileLines({ p50, p95, p99, overall, spread }: Spread): Line[] {
  const main: Line = { key: 'p95', values: p95, colour: 'var(--chart-p95)', weight: 1.75, overall: overall.p95 }
  if (!spread) return [main]
  return [
    { key: 'p50', values: p50, colour: 'var(--chart-p50)', weight: 1, opacity: P50_OPACITY, overall: overall.p50 },
    main,
    { key: 'p99', values: p99, colour: 'var(--chart-p99)', weight: 1, dash: '4 3', overall: overall.p99 },
  ]
}
