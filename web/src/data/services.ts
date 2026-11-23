import { useQuery } from '@tanstack/react-query'
import { get, json } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import { useScope } from '@/lib/scope'
import { dur } from '@/lib/format'
import { NOWHERE, placed, type Placement } from '@/data/placement'

export type Service = {
  name: string
  requests: number
  errors: number
  perSecond: number
  p50Us: number
  p95Us: number
  p99Us: number
  rps: string
  err: number | null
  p50: string
  p95: string
  p99: string
  seen: string
  lastSeenMs: number
}

export type Operation = {
  name: string
  requests: number
  errors: number
  perSecond: number
  rps: string
  err: number | null
  p50: string
  p95: string
  p99: string
  seen: string
}

export type Edge = { caller: string; callee: string; calls: number; errors: number; err: number | null }

export type Point = { atMs: number; requests: number; errors: number; p95Ms: number | null; p50Ms: number | null; p99Ms: number | null }

export type Stepped = { stepMs: number; requests: number; errors: number; p95Ms: number | null; p50Ms: number | null; p99Ms: number | null; spread: boolean; points: Point[] }

type Serving = {
  name: string
  requests: number
  errors: number
  per_second: number
  error_rate: number
  p50_us: number
  p95_us: number
  p99_us: number
  last_seen_ms: number
}

type Edged = {
  caller: string
  callee: string
  calls: number
  errors: number
  error_rate: number
}

type Operated = {
  name: string
  requests: number
  errors: number
  p50_ns: number
  p95_ns: number
  p99_ns: number
  last_seen_ns: number
}

type Moment = [number, number, number, number | null] | [number, number, number, number | null, number | null, number | null]

export type Steps = {
  step_ns: number
  requests: number
  errors: number
  p95_ns: number | null
  p50_ns?: number | null
  p99_ns?: number | null
  points: Moment[]
}

export const WINDOW_MS = 60 * 60 * 1000
export const ERROR_THRESHOLD = 2
const FRESH_MS = 15_000
const NS_PER_MS = 1_000_000

export function since(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 5) return 'now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

export const perSecond = (rate: number) => `${rate < 0.1 && rate > 0 ? rate.toFixed(3) : rate.toFixed(1)}/s`

export const serving = (service: Serving): Service => ({
  name: service.name,
  requests: service.requests,
  errors: service.errors,
  perSecond: service.per_second,
  p50Us: service.p50_us,
  p95Us: service.p95_us,
  p99Us: service.p99_us,
  rps: perSecond(service.per_second),
  err: service.requests === 0 ? null : service.error_rate * 100,
  p50: dur(service.p50_us / 1000),
  p95: dur(service.p95_us / 1000),
  p99: dur(service.p99_us / 1000),
  seen: since(service.last_seen_ms),
  lastSeenMs: service.last_seen_ms,
})

const edged = (edge: Edged): Edge => ({
  caller: edge.caller,
  callee: edge.callee,
  calls: edge.calls,
  errors: edge.errors,
  err: edge.calls === 0 ? null : edge.error_rate * 100,
})

const operated = (operation: Operated, windowMs: number): Operation => {
  const rate = operation.requests / (windowMs / 1000)
  return {
    name: operation.name,
    requests: operation.requests,
    errors: operation.errors,
    perSecond: rate,
    rps: perSecond(rate),
    err: operation.requests === 0 ? null : (operation.errors / operation.requests) * 100,
    p50: dur(operation.p50_ns / NS_PER_MS),
    p95: dur(operation.p95_ns / NS_PER_MS),
    p99: dur(operation.p99_ns / NS_PER_MS),
    seen: since(operation.last_seen_ns / NS_PER_MS),
  }
}

const nanos = (value: number | null | undefined): number | null => (typeof value === 'number' ? value / NS_PER_MS : null)

export const stepped = (steps: Steps): Stepped => ({
  stepMs: steps.step_ns / NS_PER_MS,
  requests: steps.requests,
  errors: steps.errors,
  p95Ms: nanos(steps.p95_ns),
  p50Ms: nanos(steps.p50_ns),
  p99Ms: nanos(steps.p99_ns),
  spread: steps.p50_ns !== undefined || steps.points.some((point) => point.length >= 6),
  points: steps.points.map((point) => ({
    atMs: Math.floor(point[0] / NS_PER_MS),
    requests: point[1],
    errors: point[2],
    p95Ms: nanos(point[3]),
    p50Ms: nanos(point[4]),
    p99Ms: nanos(point[5]),
  })),
})

function spanning(windowMs: number, project: string | undefined, environment: string, placement: Placement, shiftMs = 0): URLSearchParams {
  const to = Date.now() - shiftMs
  const params = new URLSearchParams({ from: String(to - windowMs), to: String(to) })
  if (project) params.set('project', project)
  if (environment.trim()) params.set('environment', environment.trim())
  return placed(params, placement)
}

export function useServices(environment = '', windowMs = WINDOW_MS): Service[] {
  return useServiceTable(environment, windowMs).services
}

export type Polling = { refetchInterval?: number | false; enabled?: boolean }

export function useServiceTable(environment = '', windowMs = WINDOW_MS, placement: Placement = NOWHERE, polling: Polling = {}) {
  const { active } = useOrganisations()
  const { project } = useScope()
  const { data, isPending, error, dataUpdatedAt } = useQuery({
    queryKey: ['services', active?.org, project, environment.trim(), windowMs, placement],
    enabled: Boolean(active) && polling.enabled !== false,
    staleTime: FRESH_MS,
    refetchInterval: polling.refetchInterval ?? false,
    queryFn: async () => {
      const params = spanning(windowMs, project, environment, placement)
      const found = await json<{ services: Serving[] }>(
        await get(`/api/orgs/${active?.org}/services?${params.toString()}`),
      )
      return found.services.map(serving)
    },
  })
  return { services: data ?? [], pending: isPending, failed: error, updatedAt: dataUpdatedAt }
}

export function useServiceDependencies(environment = '', windowMs = WINDOW_MS, placement: Placement = NOWHERE) {
  const { active } = useOrganisations()
  const { project } = useScope()
  const { data, isPending, error } = useQuery({
    queryKey: ['services', active?.org, project, 'dependencies', environment.trim(), windowMs, placement],
    enabled: Boolean(active),
    staleTime: FRESH_MS,
    queryFn: async () => {
      const params = spanning(windowMs, project, environment, placement)
      const found = await json<{ edges: Edged[] }>(
        await get(`/api/orgs/${active?.org}/services/dependencies?${params.toString()}`),
      )
      return found.edges.map(edged)
    },
  })
  return { edges: data ?? [], pending: isPending, failed: error }
}

export function useOperations(service: string, environment = '', windowMs = WINDOW_MS, placement: Placement = NOWHERE) {
  const { active } = useOrganisations()
  const { project } = useScope()
  const { data, isPending, error } = useQuery({
    queryKey: ['services', active?.org, project, 'operations', service, environment.trim(), windowMs, placement],
    enabled: Boolean(active && service),
    staleTime: FRESH_MS,
    queryFn: async () => {
      const params = spanning(windowMs, project, environment, placement)
      const found = await json<{ operations: Operated[] }>(
        await get(`/api/orgs/${active?.org}/services/${encodeURIComponent(service)}/operations?${params.toString()}`),
      )
      return found.operations.map((operation) => operated(operation, windowMs))
    },
  })
  return { operations: data ?? [], pending: isPending, failed: error }
}

export function useServiceSeries(service: string | null, environment = '', windowMs = WINDOW_MS, placement: Placement = NOWHERE, shiftMs = 0, polling: Polling = {}) {
  const { active } = useOrganisations()
  const { project } = useScope()
  const { data, isPending, error, dataUpdatedAt } = useQuery({
    queryKey: ['services', active?.org, project, 'series', service, environment.trim(), windowMs, placement, shiftMs],
    enabled: Boolean(active),
    staleTime: FRESH_MS,
    refetchInterval: polling.refetchInterval ?? false,
    queryFn: async () => {
      const params = spanning(windowMs, project, environment, placement, shiftMs)
      const path = service === null ? 'series' : `services/${encodeURIComponent(service)}/series`
      return stepped(await json<Steps>(await get(`/api/orgs/${active?.org}/${path}?${params.toString()}`)))
    },
  })
  return { series: data ?? null, pending: isPending, failed: error, updatedAt: dataUpdatedAt }
}

export function useServiceNames(windowMs: number): { names: string[]; unreachable: unknown } {
  const { active } = useOrganisations()
  const { project } = useScope()
  const { data, error } = useQuery({
    queryKey: ['service-names', active?.org, project, windowMs],
    enabled: Boolean(active),
    staleTime: FRESH_MS,
    queryFn: async () => {
      const to = Date.now()
      const within = project ? `&project=${project}` : ''
      const found = await json<{ services: Serving[] }>(
        await get(`/api/orgs/${active?.org}/services?from=${to - windowMs}&to=${to}${within}`),
      )
      return found.services.map((service) => service.name).sort()
    },
  })
  return { names: data ?? [], unreachable: error }
}

export function charted(series: Stepped | null) {
  const points = series?.points ?? []
  const seconds = Math.max(1, (series?.stepMs ?? 1000) / 1000)
  return {
    perSecond: points.map((point) => point.requests / seconds),
    errorRate: points.map((point) => (point.requests ? (point.errors / point.requests) * 100 : null)),
    p50: points.map((point) => point.p50Ms),
    p95: points.map((point) => point.p95Ms),
    p99: points.map((point) => point.p99Ms),
  }
}
