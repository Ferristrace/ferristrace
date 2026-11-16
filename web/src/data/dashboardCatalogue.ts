import { useQuery } from '@tanstack/react-query'
import { get, json } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import { useMetricCatalogue } from '@/data/metrics'
import type { QuerySignal } from '@/data/dashboards'
import { useScope } from '@/lib/scope'

const DAY_MS = 24 * 60 * 60 * 1000

const HOUR_MS = 60 * 60 * 1000

const STALE_MS = 60_000

const FIXTURE_KEYS: Record<QuerySignal, string[]> = {
  traces: ['http.route', 'http.method', 'deployment.environment', 'k8s.pod.name', 'db.system'],
  logs: ['k8s.namespace.name', 'k8s.pod.name', 'log.level', 'logger', 'host.name'],
  metrics: ['node', 'zone', 'pod', 'namespace'],
}

const FIXTURE_METRICS = ['node_memory_bytes', 'node_cpu_seconds_total', 'http_server_request_duration', 'process_resident_memory_bytes']

const pathOf = (signal: QuerySignal, metric: string): string => (signal === 'metrics' ? `metrics/${encodeURIComponent(metric)}/attributes` : signal === 'logs' ? 'log-attributes' : 'attributes')

export function useKeySuggestions(signal: QuerySignal, metric: string, fixture: boolean): string[] {
  const { active } = useOrganisations()
  const { project } = useScope()
  const hour = Math.floor(Date.now() / HOUR_MS)
  const found = useQuery({
    queryKey: ['dashboard-keys', signal, metric, active?.org, project, hour],
    enabled: !fixture && Boolean(active) && (signal !== 'metrics' || metric !== ''),
    staleTime: STALE_MS,
    queryFn: async () => {
      const to = hour * HOUR_MS + HOUR_MS
      const params = new URLSearchParams({ from: String(to - DAY_MS), to: String(to) })
      if (project) params.set('project', project)
      return (await json<{ attributes: { key: string }[] }>(await get(`/api/orgs/${active?.org}/${pathOf(signal, metric)}?${params.toString()}`))).attributes.map((one) => one.key)
    },
  })
  return fixture ? FIXTURE_KEYS[signal] : (found.data ?? [])
}

export function useMetricNames(text: string, fixture: boolean): { names: string[]; units: Record<string, string> } {
  const live = useMetricCatalogue(text)
  if (fixture) {
    const needle = text.trim().toLowerCase()
    return { names: FIXTURE_METRICS.filter((name) => name.includes(needle)), units: {} }
  }
  return { names: live.metrics.map((one) => one.name), units: Object.fromEntries(live.metrics.map((one) => [one.name, one.unit])) }
}
