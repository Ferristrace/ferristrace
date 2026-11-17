import type { Issue } from '@/data/issues'
import type { Release } from '@/data/releases'
import { CRITICAL_FACTOR, ERROR_THRESHOLD, elapsed, tracesOf, tracesQuery, withSearch, type Delta, type Effect, type Item, type Kind, type Tone } from './attention'
import type { Figure } from './figures'

export type Fill = 'error' | 'warning' | null

export type Tile = { key: string; label: string; value: string | null; sub: string; fill: Fill; to: string }

export type ServiceRow = { name: string; requests: number; errors: number; err: number | null; perSecond: number; p99: string }

export type Heat = 'bad' | 'mid' | 'none'

export const SERVICES_SHOWN = 5

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const pad = (value: number) => String(value).padStart(2, '0')

export function clock(ms: number): string {
  const at = new Date(ms)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function when(ms: number, now: number): string {
  const age = now - ms
  if (age < DAY_MS && new Date(ms).toDateString() === new Date(now).toDateString()) return clock(ms)
  if (age < DAY_MS) return `${Math.max(1, Math.round(age / HOUR_MS))} h ago`
  return `${Math.floor(age / DAY_MS)} d ago`
}

export function heat(err: number | null): Heat {
  if (err === null) return 'none'
  if (err >= ERROR_THRESHOLD * CRITICAL_FACTOR) return 'bad'
  if (err >= ERROR_THRESHOLD) return 'mid'
  return 'none'
}

export function worst<T extends ServiceRow>(services: T[], shown = SERVICES_SHOWN): T[] {
  return services
    .filter((service) => service.requests > 0)
    .sort((a, b) => (b.err ?? -1) - (a.err ?? -1) || b.requests - a.requests || a.name.localeCompare(b.name))
    .slice(0, shown)
}

export function lastRelease(service: string, releases: Release[], now: number): string | null {
  const latest = releases.filter((release) => release.service === service).sort((a, b) => b.firstSeenMs - a.firstSeenMs)[0]
  return latest ? `${latest.version}, ${when(latest.firstSeenMs, now)}` : null
}

export function openIssues(issues: Issue[], windowMs: number, now: number): { open: number; fresh: number } {
  const open = issues.filter((issue) => issue.status === 'unresolved')
  return { open: open.length, fresh: open.filter((issue) => issue.first_seen_at_ms >= now - windowMs).length }
}

export function pill(effect: Effect): { text: string; tone: Tone } | null {
  if (effect.delta === null) return null
  const rounded = Math.round(effect.delta * 10) / 10
  const text = `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${Math.abs(rounded).toFixed(1)} pp`
  return { text, tone: effect.tone === 'worse' || effect.tone === 'better' ? effect.tone : 'same' }
}

const versus = (delta: Delta, short: string) => `${delta.text} vs previous ${short}`

function subOf(figure: Figure, short: string): string {
  if (figure.delta.text !== '') return figure.caveat ? `${versus(figure.delta, short)}. ${figure.caveat}` : versus(figure.delta, short)
  return figure.note ?? (figure.value === null ? 'No data.' : 'No previous period to compare.')
}

export type Counted = { value: number | null; note: string | null }

export function tilesOf(figures: Figure[], failed: Counted, issues: Counted & { fresh: number; cut: boolean }, windowMs: number, now: number, short: string, place: Record<string, string> = {}): Tile[] {
  const byKey = new Map(figures.map((figure) => [figure.key, figure]))
  const errors = byKey.get('errors')
  const rate = byKey.get('rate')
  const p95 = byKey.get('p95')
  const errorSub = errors && failed.value !== null ? subOf(errors, short) : (failed.note ?? 'No data.')
  return [
    {
      key: 'failed',
      label: 'Failed spans',
      value: failed.value === null ? null : failed.value.toLocaleString('en-US'),
      sub: errorSub,
      fill: failed.value !== null && failed.value > 0 && errors?.delta.tone === 'worse' ? 'error' : null,
      to: withSearch(tracesQuery('status = "error"'), place),
    },
    { key: 'requests', label: 'Requests', value: rate?.value ?? null, sub: rate ? subOf(rate, short) : 'No data.', fill: null, to: withSearch('/services', place) },
    { key: 'p95', label: 'p95 latency', value: p95?.value ?? null, sub: p95 ? subOf(p95, short) : 'No data.', fill: p95?.delta.tone === 'worse' ? 'warning' : null, to: withSearch('/services', place) },
    {
      key: 'issues',
      label: 'Open issues',
      value: issues.value === null ? null : `${issues.value.toLocaleString('en-US')}${issues.cut ? '+' : ''}`,
      sub: issues.value === null ? (issues.note ?? 'No data.') : `+${issues.fresh.toLocaleString('en-US')} since ${clock(now - windowMs)}`,
      fill: null,
      to: '/issues',
    },
  ]
}

const ACTION: Record<Kind, string> = {
  incident: 'Open incident',
  alert: 'Open alert',
  service: 'Open traces',
  issue: 'Open issue',
  pods: 'Open pods',
  silent: 'Open service',
}

export function actionOf(item: Item): { label: string; to: string } {
  if (item.kind === 'service') return { label: ACTION.service, to: item.evidence?.to ?? tracesOf(item.title, true) }
  return { label: ACTION[item.kind], to: item.to }
}

export function extraOf(item: Item): { label: string; to: string } | null {
  if (!item.evidence) return null
  const action = actionOf(item)
  return item.evidence.to === action.to ? null : item.evidence
}

export function timeOf(item: Item, now: number): string | null {
  if (item.since === null) return null
  if (item.kind === 'incident') return `open ${elapsed(now - item.since)}`
  if (item.kind === 'alert') return now - item.since < DAY_MS ? `since ${clock(item.since)}` : when(item.since, now)
  if (item.kind === 'silent') return elapsed(now - item.since)
  return when(item.since, now)
}
