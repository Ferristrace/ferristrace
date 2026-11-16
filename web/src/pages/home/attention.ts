import { ApiError } from '@/auth/client'
import { conditionOf, signalLink, type Rule } from '@/data/alerts'
import type { ClusterView } from '@/data/infra'
import type { Incident } from '@/data/incidents'
import type { Issue } from '@/data/issues'
import { releasePath, type Release } from '@/data/releases'
import { ERROR_THRESHOLD } from '@/data/services'

export { ERROR_THRESHOLD }

export type Kind = 'incident' | 'alert' | 'service' | 'issue' | 'pods' | 'silent'

export type Severity = 'critical' | 'warning' | 'info'

export type Item = {
  id: string
  kind: Kind
  severity: Severity
  title: string
  detail: string
  since: number | null
  to: string
  evidence: { label: string; to: string } | null
  magnitude: number
}

export type Source = { name: string; state: 'ok' | 'failed' | 'pending' | 'hidden' | 'unavailable' | 'partial' }

export type Status =
  | { kind: 'calm' }
  | { kind: 'attention'; count: number; worst: Severity }
  | { kind: 'unchecked'; names: string[] }
  | { kind: 'partial'; names: string[] }
  | { kind: 'checking' }
  | { kind: 'nodata'; sinceMs: number | null }

export type Tone = 'worse' | 'better' | 'same' | 'none'

export type Measure = 'traffic' | 'error' | 'latency'

export type Delta = { text: string; tone: Tone; word: string }

export type Effect = { before: number | null; after: number | null; delta: number | null; tone: Tone; introduced: number }

export type Traffic = { requests: number; errors: number; errorRate: number | null }

export const MIN_REQUESTS = 20
export const SILENT_MS = 10 * 60 * 1000
export const SEEN_MS = 24 * 60 * 60 * 1000
export const RELEASE_LINK_MS = 30 * 60 * 1000
export const MAX_ITEMS = 8
export const ISSUE_LIMIT = 200
export const SAME_BAND = 0.05
export const SAME_POINTS = 0.1
export const CRITICAL_FACTOR = 3

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'info']
const KIND_ORDER: Kind[] = ['incident', 'alert', 'service', 'issue', 'pods', 'silent']

export const PAGES: Record<Kind, string> = {
  incident: '/incidents',
  alert: '/alerts',
  service: '/services',
  issue: '/issues',
  pods: '/infra/kubernetes',
  silent: '/services',
}

export const KIND_LABEL: Record<Kind, string> = {
  incident: 'Incident',
  alert: 'Alert',
  service: 'Service',
  issue: 'Issue',
  pods: 'Pods',
  silent: 'No data',
}

export const KIND_PLURAL: Record<Kind, string> = {
  incident: 'incidents',
  alert: 'alerts',
  service: 'services',
  issue: 'issues',
  pods: 'pods',
  silent: 'silent services',
}

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' }

const href = (to: string, search?: Record<string, string>) => (search ? `${to}?${new URLSearchParams(search).toString()}` : to)

export function linkOf(to: string): { path: string; search?: Record<string, string> } {
  const at = to.indexOf('?')
  if (at < 0) return { path: to }
  return { path: to.slice(0, at), search: Object.fromEntries(new URLSearchParams(to.slice(at + 1))) }
}

export function withSearch(to: string, extra: Record<string, string>): string {
  const { path, search } = linkOf(to)
  const merged = { ...search, ...extra }
  return Object.keys(merged).length ? href(path, merged) : path
}

export const tracesQuery = (q: string) => href('/traces', { q })

const escaped = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

export const tracesOf = (service: string, errorsOnly: boolean) =>
  href('/traces', { q: errorsOnly ? `service = "${escaped(service)}" AND status = "error"` : `service = "${escaped(service)}"` })

export function rank(items: Item[]): Item[] {
  return [...items].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      b.magnitude - a.magnitude,
  )
}

export function listed(items: Item[]): { shown: Item[]; more: number; to: string; kind: Kind | null } {
  const ranked = rank(items)
  const rest = ranked.slice(MAX_ITEMS)
  const counts = new Map<Kind, number>()
  for (const item of rest) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
  const dominant = KIND_ORDER.filter((kind) => counts.has(kind)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0]
  return { shown: ranked.slice(0, MAX_ITEMS), more: rest.length, to: dominant ? PAGES[dominant] : '', kind: dominant ?? null }
}

const named = (sources: Source[], state: Source['state']) => sources.filter((source) => source.state === state).map((source) => source.name)

export const unchecked = (sources: Source[]) => named(sources, 'failed')

export const partial = (sources: Source[]) => named(sources, 'partial')

export function stateOf(answered: boolean, error: unknown, tolerated: number[] = []): Source['state'] {
  if (error instanceof ApiError && error.status === 403) return 'hidden'
  if (error instanceof ApiError && tolerated.includes(error.status)) return 'unavailable'
  if (error) return 'failed'
  return answered ? 'ok' : 'pending'
}

export function oldest(entries: { at: number; failed: unknown }[]): number | null {
  const live = entries.filter((entry) => !entry.failed)
  if (live.length === 0 || live.some((entry) => entry.at === 0)) return null
  return Math.min(...live.map((entry) => entry.at))
}

export function notes(sources: Source[]): string[] {
  const hidden = named(sources, 'hidden')
  const unavailable = named(sources, 'unavailable')
  const cut = partial(sources)
  return [
    ...(hidden.length ? [`Not visible to you: ${hidden.join(', ')}.`] : []),
    ...(unavailable.length ? [`Not available on this server: ${unavailable.join(', ')}.`] : []),
    ...(cut.length ? [`List truncated: ${cut.join(', ')}.`] : []),
  ]
}

export function status(items: Item[], sources: Source[], lastSpanMs: number | null, now: number): Status {
  if (items.length) {
    const ranked = rank(items)
    return { kind: 'attention', count: items.length, worst: ranked[0].severity }
  }
  const failed = unchecked(sources)
  if (failed.length) return { kind: 'unchecked', names: failed }
  if (sources.some((source) => source.state === 'pending')) return { kind: 'checking' }
  const cut = partial(sources)
  if (cut.length) return { kind: 'partial', names: cut }
  if (lastSpanMs === null || now - lastSpanMs > SILENT_MS) return { kind: 'nodata', sinceMs: lastSpanMs }
  return { kind: 'calm' }
}

const signed = (value: number, digits: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`

export function deltaOf(now: number | null, before: number | null, measure: Measure): Delta {
  const none: Delta = { text: '', tone: 'none', word: '' }
  if (now === null || before === null) return none
  if (measure !== 'error' && before === 0) return none
  const change = now - before
  const relative = before === 0 ? (change === 0 ? 0 : Infinity) : Math.abs(change) / before
  const flat = relative < SAME_BAND || (measure === 'error' && Math.abs(change) < SAME_POINTS)
  const text = measure === 'error' ? `${signed(change, 1)} pp` : `${signed((change / before) * 100, 0)} %`
  if (flat) return { text, tone: 'same', word: 'unchanged' }
  if (measure === 'traffic') return { text, tone: 'same', word: '' }
  return change > 0 ? { text, tone: 'worse', word: 'worse' } : { text, tone: 'better', word: 'better' }
}

export function releaseEffect(detail: { before: Traffic; after: Traffic; issues: unknown[] }): Effect {
  const before = detail.before.errorRate === null ? null : detail.before.errorRate * 100
  const after = detail.after.errorRate === null ? null : detail.after.errorRate * 100
  const introduced = detail.issues.length
  const delta = before === null || after === null ? null : after - before
  const thin = detail.before.requests < MIN_REQUESTS || detail.after.requests < MIN_REQUESTS
  if (thin || delta === null) return { before, after, delta, tone: 'none', introduced }
  return { before, after, delta, tone: deltaOf(after, before, 'error').tone, introduced }
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

const upper = (value: string) => value.toUpperCase()

export function incidentItems(incidents: Incident[]): Item[] {
  return incidents
    .filter((incident) => incident.status !== 'resolved')
    .map((incident) => {
      const severity: Severity = incident.severity === 'sev1' || incident.severity === 'sev2' ? 'critical' : incident.severity === 'sev3' ? 'warning' : 'info'
      const owner = incident.owner ? (incident.owner.name ?? incident.owner.email ?? 'an owner') : 'no owner'
      const where = incident.services.length ? `, ${incident.services.join(', ')}` : ''
      return {
        id: `incident:${incident.id}`,
        kind: 'incident' as const,
        severity,
        title: incident.title,
        detail: `${upper(incident.severity)}, ${incident.status}, ${owner}${where}`,
        since: incident.opened_ms,
        to: `/incidents/${incident.id}`,
        evidence: incident.alert ? { label: 'Open alert', to: href('/alerts', { rule: incident.alert.id }) } : null,
        magnitude: -incident.opened_ms,
      }
    })
}

export function alertItems(rules: Rule[], now: number): Item[] {
  return rules
    .filter((rule) => rule.enabled && (rule.state.status === 'firing' || rule.state.status === 'no_data'))
    .map((rule) => {
      const firing = rule.state.status === 'firing'
      const link = signalLink(rule.signal)
      const silenced = rule.silenced_until_ms !== null && rule.silenced_until_ms > now
      const reading = firing
        ? `${conditionOf(rule)}${rule.state.value === null ? '' : `, now ${rule.state.value.toLocaleString('en-US', { maximumFractionDigits: 3 })}`}`
        : `No data received for ${conditionOf(rule)}`
      return {
        id: `alert:${rule.id}`,
        kind: 'alert' as const,
        severity: firing ? rule.severity : ('warning' as const),
        title: rule.name,
        detail: silenced ? `${reading}. Notifications are silenced.` : reading,
        since: rule.state.since_ms,
        to: href('/alerts', { rule: rule.id }),
        evidence: { label: link.label, to: href(link.to, link.search) },
        magnitude: now - rule.state.since_ms,
      }
    })
}

export function serviceItems(services: { name: string; requests: number; errors: number; err: number | null }[], windowLabel: string): Item[] {
  return services
    .filter((service) => service.requests >= MIN_REQUESTS && service.err !== null && service.err >= ERROR_THRESHOLD)
    .map((service) => {
      const err = service.err ?? 0
      return {
        id: `service:${service.name}`,
        kind: 'service' as const,
        severity: err >= ERROR_THRESHOLD * CRITICAL_FACTOR ? ('critical' as const) : ('warning' as const),
        title: service.name,
        detail: `${err.toFixed(1)} % of ${service.requests.toLocaleString('en-US')} requests failed in the last ${windowLabel}, the threshold is ${ERROR_THRESHOLD} %`,
        since: null,
        to: `/services/${encodeURIComponent(service.name)}`,
        evidence: { label: 'Open traces', to: tracesOf(service.name, true) },
        magnitude: err,
      }
    })
}

export function releaseBefore(issue: Issue, releases: Release[]): Release | null {
  const near = releases
    .filter((release) => release.service === issue.service && release.firstSeenMs <= issue.first_seen_at_ms && issue.first_seen_at_ms - release.firstSeenMs <= RELEASE_LINK_MS)
    .sort((a, b) => b.firstSeenMs - a.firstSeenMs)
  return near[0] ?? null
}

export function issueItems(issues: Issue[], releases: Release[], windowMs: number, now: number): Item[] {
  return issues
    .filter((issue) => issue.status === 'unresolved' && issue.first_seen_at_ms >= now - windowMs)
    .map((issue) => {
      const release = releaseBefore(issue, releases)
      const after = release ? ` First seen ${Math.max(1, Math.round((issue.first_seen_at_ms - release.firstSeenMs) / 60_000))} min after release ${release.version}.` : ''
      return {
        id: `issue:${issue.fingerprint}`,
        kind: 'issue' as const,
        severity: 'warning' as const,
        title: `${issue.exception_type} in ${issue.service}`,
        detail: `${issue.events.toLocaleString('en-US')} ${issue.events === 1 ? 'event' : 'events'}.${after}${issue.message ? ` ${issue.message}` : ''}`.trim(),
        since: issue.first_seen_at_ms,
        to: `/issues/${issue.fingerprint}`,
        evidence: release ? { label: 'Open release', to: releasePath(release.service, release.version) } : null,
        magnitude: issue.events,
      }
    })
}

export function podItems(view: ClusterView): Item[] {
  const down = new Set(view.nodes.filter((node) => node.ready === false).map((node) => node.name))
  const byNamespace = new Map<string, ClusterView['pods']>()
  for (const pod of view.pods.filter((one) => one.unhealthy)) byNamespace.set(pod.namespace, [...(byNamespace.get(pod.namespace) ?? []), pod])
  const covered = new Set(view.pods.filter((one) => one.unhealthy).map((pod) => pod.node))
  const nodes: Item[] = view.nodes
    .filter((node) => node.ready === false && !covered.has(node.name))
    .map((node) => ({
      id: `pods:node:${node.name}`,
      kind: 'pods' as const,
      severity: node.pods > 0 ? ('critical' as const) : ('warning' as const),
      title: `Node ${node.name} is not ready`,
      detail: node.pods > 0 ? `${node.pods} ${node.pods === 1 ? 'pod runs' : 'pods run'} on it` : 'No pod runs on it',
      since: null,
      to: `/infra/kubernetes/nodes/${encodeURIComponent(node.name)}`,
      evidence: null,
      magnitude: node.pods,
    }))
  const namespaces = [...byNamespace.entries()].map(([namespace, pods]) => {
    const nodeDown = pods.some((pod) => (pod.node !== null && down.has(pod.node)) || pod.reason === 'node not ready')
    const reasons = new Map<string, number>()
    for (const pod of pods) reasons.set(pod.reason ?? 'unhealthy', (reasons.get(pod.reason ?? 'unhealthy') ?? 0) + 1)
    const worst = [...pods].sort((a, b) => b.restarts - a.restarts || a.name.localeCompare(b.name))[0]
    const label = namespace || 'no namespace'
    return {
      id: `pods:${namespace}`,
      kind: 'pods' as const,
      severity: nodeDown ? ('critical' as const) : ('warning' as const),
      title: `${pods.length} unhealthy ${pods.length === 1 ? 'pod' : 'pods'} in ${label}`,
      detail: `${[...reasons.entries()].map(([reason, count]) => `${count} ${reason}`).join(', ')}${nodeDown ? ', a node is not ready' : ''}`,
      since: null,
      to: href('/infra/kubernetes', { ...(namespace ? { namespace } : {}), problems: '1' }),
      evidence: { label: 'Open pod', to: href('/infra/kubernetes', { ...(namespace ? { namespace } : {}), q: worst.name }) },
      magnitude: pods.length,
    }
  })
  return [...nodes, ...namespaces]
}

export const lastSpan = (services: { lastSeenMs: number }[]): number | null => (services.length ? Math.max(...services.map((service) => service.lastSeenMs)) : null)

export function silentItems(services: { name: string; lastSeenMs: number }[], now: number): Item[] {
  const quiet = (service: { lastSeenMs: number }) => now - service.lastSeenMs > SILENT_MS
  if (services.length && services.every(quiet)) return []
  return services
    .filter((service) => quiet(service) && now - service.lastSeenMs <= SEEN_MS)
    .map((service) => ({
      id: `silent:${service.name}`,
      kind: 'silent' as const,
      severity: 'warning' as const,
      title: service.name,
      detail: `No span for ${elapsed(now - service.lastSeenMs)}, it reported in the last 24 hours`,
      since: service.lastSeenMs,
      to: `/services/${encodeURIComponent(service.name)}`,
      evidence: { label: 'Open traces', to: tracesOf(service.name, false) },
      magnitude: now - service.lastSeenMs,
    }))
}
