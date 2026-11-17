export type Health = 'down' | 'degraded' | 'healthy'

export const HEALTH_LABEL: Record<Health, string> = { down: 'Down', degraded: 'Degraded', healthy: 'Healthy' }

export function healthOf(err: number | null, threshold: number, criticalFactor: number): Health | null {
  if (err === null) return null
  if (err >= threshold * criticalFactor) return 'down'
  if (err >= threshold) return 'degraded'
  return 'healthy'
}

export type Seen = { service: string; version: string; firstSeenMs: number; lastSeenMs: number }

export function latestReleases(releases: readonly Seen[]): Map<string, string> {
  const best = new Map<string, Seen>()
  for (const release of releases) {
    const was = best.get(release.service)
    if (!was || release.lastSeenMs > was.lastSeenMs || (release.lastSeenMs === was.lastSeenMs && release.firstSeenMs > was.firstSeenMs)) best.set(release.service, release)
  }
  return new Map([...best].map(([service, release]) => [service, release.version]))
}

export function deltaOf(now: number | null, before: number | null | undefined): number | null {
  if (now === null || before === null || before === undefined) return null
  const delta = Math.round((now - before) * 10) / 10
  return delta === 0 ? null : delta
}

export const deltaText = (delta: number) => `${delta > 0 ? '▲ +' : '▼ '}${delta.toFixed(1)} pt`

export type Metric = 'p50' | 'p95' | 'p99' | 'err' | 'rps'

export const METRICS: { value: Metric; label: string }[] = [
  { value: 'p95', label: 'p95 latency' },
  { value: 'p50', label: 'p50 latency' },
  { value: 'p99', label: 'p99 latency' },
  { value: 'err', label: 'Error rate' },
  { value: 'rps', label: 'Requests' },
]

export type ChartStyle = 'line' | 'area' | 'bars'

export type ChartSpec = { metric: Metric; style: ChartStyle }

export const chartId = (spec: ChartSpec) => `chart:${spec.metric}:${spec.style}`

const isMetric = (value: unknown): value is Metric => METRICS.some((one) => one.value === value)
const isStyle = (value: unknown): value is ChartStyle => value === 'line' || value === 'area' || value === 'bars'

export function storedCharts(raw: string | null): ChartSpec[] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: ChartSpec[] = []
    for (const one of parsed) {
      if (typeof one !== 'object' || one === null) continue
      const { metric, style } = one as { metric?: unknown; style?: unknown }
      if (isMetric(metric) && isStyle(style) && !out.some((spec) => chartId(spec) === chartId({ metric, style }))) out.push({ metric, style })
    }
    return out
  } catch {
    return []
  }
}

export function withChart(specs: readonly ChartSpec[], next: ChartSpec, taken: readonly string[] = []): ChartSpec[] {
  const id = chartId(next)
  if (taken.includes(id) || specs.some((spec) => chartId(spec) === id)) return [...specs]
  return [...specs, next]
}
