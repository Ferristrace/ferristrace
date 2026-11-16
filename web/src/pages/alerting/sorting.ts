type Value = string | number | null

const SEVERITY_RANK: Record<string, number> = { critical: 2, warning: 1, info: 0 }
const STATE_RANK: Record<string, number> = { firing: 3, pending: 2, no_data: 1, ok: 0 }
const INCIDENT_SEVERITY_RANK: Record<string, number> = { sev1: 3, sev2: 2, sev3: 1, sev4: 0 }
const INCIDENT_STATUS_RANK: Record<string, number> = { investigating: 3, identified: 2, monitoring: 1, resolved: 0 }
const PAGE_STATE_RANK: Record<string, number> = { triggered: 3, escalated: 2, acknowledged: 1, resolved: 0 }

export const notifiesLabel = (names: readonly string[]): string => {
  if (names.length === 0) return ''
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
}

export type RuleLine = {
  name: string
  signal: string
  severity: string
  status: string
  since_ms: number
  project: string
  notifies: readonly string[]
  enabled: boolean
}

export type RuleKey = 'rule' | 'signal' | 'severity' | 'state' | 'project' | 'notifies' | 'on'

export const ruleValue = (row: RuleLine, key: RuleKey): Value => {
  switch (key) {
    case 'rule': return row.name
    case 'signal': return row.signal
    case 'severity': return SEVERITY_RANK[row.severity] ?? null
    case 'state': return (STATE_RANK[row.status] ?? 0) * 1e15 + row.since_ms
    case 'project': return row.project
    case 'notifies': return row.notifies[0] ?? null
    case 'on': return row.enabled ? 1 : 0
  }
}

export type IncidentRow = {
  title: string
  severity: string
  status: string
  owner: string | null
  project: string
  opened_ms: number
}

export type IncidentKey = 'incident' | 'severity' | 'status' | 'owner' | 'project' | 'opened'

export const incidentValue = (row: IncidentRow, key: IncidentKey): Value => {
  switch (key) {
    case 'incident': return row.title
    case 'severity': return INCIDENT_SEVERITY_RANK[row.severity] ?? null
    case 'status': return INCIDENT_STATUS_RANK[row.status] ?? null
    case 'owner': return row.owner
    case 'project': return row.project
    case 'opened': return row.opened_ms
  }
}

export type IssueRow = {
  exception_type: string
  service: string
  events: number
  last_seen_at_ms: number
  owner: string | null
}

export type IssueKey = 'issue' | 'service' | 'events' | 'last' | 'owner'

export const issueValue = (row: IssueRow, key: IssueKey, owner: string | null): Value => {
  switch (key) {
    case 'issue': return row.exception_type
    case 'service': return row.service
    case 'events': return row.events
    case 'last': return row.last_seen_at_ms
    case 'owner': return owner
  }
}

export type PageRow = {
  headline: string
  state: string
  target: string
  step: number
  acknowledgeMs: number | null
  created_ms: number
}

export type PageKey = 'page' | 'status' | 'paged' | 'step' | 'acknowledge' | 'when'

export const pageValue = (row: PageRow, key: PageKey): Value => {
  switch (key) {
    case 'page': return row.headline
    case 'status': return PAGE_STATE_RANK[row.state] ?? null
    case 'paged': return row.target
    case 'step': return row.step
    case 'acknowledge': return row.acknowledgeMs
    case 'when': return row.created_ms
  }
}

export type OverrideRow = { who: string; schedule: string; from_ms: number; to_ms: number }

export type OverrideKey = 'who' | 'schedule' | 'from' | 'to'

export const overrideValue = (row: OverrideRow, key: OverrideKey): Value => {
  switch (key) {
    case 'who': return row.who
    case 'schedule': return row.schedule
    case 'from': return row.from_ms
    case 'to': return row.to_ms
  }
}

export type SeriesRow = { label: string; status: string; value: number | null }

export type SeriesKey = 'series' | 'state' | 'value'

export const seriesValue = (row: SeriesRow, key: SeriesKey): Value => {
  switch (key) {
    case 'series': return row.label
    case 'state': return STATE_RANK[row.status] ?? null
    case 'value': return row.value
  }
}

export type EventRow = { at_ms: number; value: number | null }

export type EventKey = 'when' | 'value'

export const eventValue = (row: EventRow, key: EventKey): Value => (key === 'when' ? row.at_ms : row.value)

export type GroupRow = {
  label: string
  incidents: number
  open: number
  acknowledgeMs: number | null
  resolveMs: number | null
}

export type GroupKey = 'label' | 'incidents' | 'open' | 'acknowledge' | 'resolve'

export const groupValue = (row: GroupRow, key: GroupKey): Value => {
  switch (key) {
    case 'label': return row.label
    case 'incidents': return row.incidents
    case 'open': return row.open
    case 'acknowledge': return row.acknowledgeMs
    case 'resolve': return row.resolveMs
  }
}

export type OccurrenceRow = { at_ms: number; trace_id: string; message: string }

export type OccurrenceKey = 'time' | 'trace' | 'message'

export const occurrenceValue = (row: OccurrenceRow, key: OccurrenceKey): Value => {
  switch (key) {
    case 'time': return row.at_ms
    case 'trace': return row.trace_id
    case 'message': return row.message
  }
}
