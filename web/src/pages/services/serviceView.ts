import type { Edge } from '@/data/services'

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'traces', label: 'Traces' },
  { id: 'logs', label: 'Logs' },
  { id: 'dependencies', label: 'Dependencies' },
] as const

export type Tab = (typeof TABS)[number]['id']

export const tabOf = (raw: string | undefined): Tab => TABS.find((one) => one.id === raw)?.id ?? 'overview'

export const tabSearch = (tab: Tab): string | undefined => (tab === 'overview' ? undefined : tab)

export const serviceQuery = (service: string) => `service = "${service.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

export function neighbours(edges: Edge[], name: string): { callers: Edge[]; callees: Edge[] } {
  const byCalls = (a: Edge, b: Edge) => b.calls - a.calls || a.caller.localeCompare(b.caller) || a.callee.localeCompare(b.callee)
  return {
    callers: edges.filter((edge) => edge.callee === name && edge.caller !== name).sort(byCalls),
    callees: edges.filter((edge) => edge.caller === name && edge.callee !== name).sort(byCalls),
  }
}

export const AROUND_RELEASE_MS = 3 * 60 * 60 * 1000

export function releaseWindow(atMs: number, nowMs: number, aroundMs = AROUND_RELEASE_MS): { windowMs: number; shiftMs: number; fromMs: number; toMs: number } {
  const toMs = Math.min(nowMs, atMs + aroundMs)
  const fromMs = atMs - aroundMs
  return { windowMs: toMs - fromMs, shiftMs: Math.max(0, nowMs - toMs), fromMs, toMs }
}

export const pointOf = (atMs: number, firstMs: number, stepMs: number): number => (stepMs > 0 ? (atMs - firstMs) / stepMs : 0)

export type TraceKey = 'root' | 'code' | 'started' | 'duration' | 'spans' | 'errors'

export const traceValue = (row: { root: string; code: number | null; startedAtMs: number; durationMs: number; spans: number; errors: number }, key: TraceKey): string | number | null =>
  key === 'root' ? row.root : key === 'code' ? row.code : key === 'started' ? row.startedAtMs : key === 'duration' ? row.durationMs : key === 'spans' ? row.spans : row.errors

export const traceFirst = (key: TraceKey): 'asc' | 'desc' => (key === 'root' ? 'asc' : 'desc')

export type LogKey = 'time' | 'severity' | 'body'

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

export const logValue = (row: { time_ns: number; severity: string; body: string }, key: LogKey): string | number => (key === 'time' ? row.time_ns : key === 'severity' ? LEVELS.indexOf(row.severity) : row.body)

export const logFirst = (key: LogKey): 'asc' | 'desc' => (key === 'body' ? 'asc' : 'desc')
