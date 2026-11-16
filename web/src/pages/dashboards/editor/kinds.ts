import type { Aggregation, BuiltIn, Column, EventFunction, FilterDoc, PanelDoc, PanelKind, QueryDoc, QuerySignal } from '@/data/dashboards'
import { aggLabel } from '@/components/ft/panels/result'
import { pruneFilter, withoutFields } from './filterTree'

export const LIMITS = {
  panels: 30,
  variables: 20,
  queries: 10,
  aggregations: 10,
  groupBy: 3,
  rows: 1000,
  title: 120,
  description: 1000,
  unit: 32,
  decimals: 10,
  content: 20_000,
  centre: 40,
  name: 120,
  tags: 10,
  tag: 32,
  label: 80,
  choices: 100,
  choice: 512,
} as const

export type KindGroup = { key: string; label: string; kinds: PanelKind[] }

export const KIND_GROUPS: KindGroup[] = [
  { key: 'trends', label: 'Trends over time', kinds: ['time_series', 'area'] },
  { key: 'compare', label: 'Compare & rank', kinds: ['bar', 'pie', 'scatter'] },
  { key: 'distributions', label: 'Distributions', kinds: ['histogram', 'heatmap'] },
  { key: 'single', label: 'Single values', kinds: ['number'] },
  { key: 'raw', label: 'Raw records', kinds: ['table', 'list'] },
  { key: 'docs', label: 'Documentation', kinds: ['text'] },
]

export const KIND_INFO: Record<PanelKind, { name: string; description: string }> = {
  time_series: { name: 'Time Series', description: 'Lines over time, one per group. The default for rates and latencies.' },
  area: { name: 'Area Chart', description: 'Filled lines over time. Stack them to see how parts add up to a whole.' },
  bar: { name: 'Bar Chart', description: 'Bars per time interval, stacked or side by side.' },
  pie: { name: 'Pie Chart', description: 'The share of a total that each group holds.' },
  scatter: { name: 'Scatter Plot', description: 'One dot per group, plotting one aggregation against another.' },
  histogram: { name: 'Histogram', description: 'How many values fall in each range, such as span durations.' },
  heatmap: { name: 'Heatmap', description: 'Value ranges over time, darker where more events land.' },
  number: { name: 'Number', description: 'One big value for the whole range.' },
  table: { name: 'Table', description: 'Rows of groups with one column per aggregation.' },
  list: { name: 'List', description: 'The newest raw spans or logs that match a filter.' },
  text: { name: 'Text', description: 'Markdown notes, runbook links and headings. Runs no query.' },
}

export const points = (text: string): number => Array.from(text).length

export const groupOf = (kind: PanelKind): KindGroup => KIND_GROUPS.find((group) => group.kinds.includes(kind)) ?? KIND_GROUPS[0]

export function searchKinds(text: string, group: string | null): PanelKind[] {
  const needle = text.trim().toLowerCase()
  return KIND_GROUPS.filter((one) => group === null || one.key === group).flatMap((one) =>
    one.kinds.filter((kind) => needle === '' || `${KIND_INFO[kind].name} ${KIND_INFO[kind].description} ${one.label}`.toLowerCase().includes(needle)),
  )
}

export const BUILT_INS: Record<QuerySignal, BuiltIn[]> = {
  traces: ['service', 'name', 'status', 'kind', 'duration', 'http_status_code', 'trace_id', 'span_id'],
  logs: ['service', 'severity', 'body', 'trace_id', 'span_id'],
  metrics: ['service'],
}

export const BUILT_IN_LABEL: Record<BuiltIn, string> = {
  service: 'Service',
  name: 'Span name',
  status: 'Status',
  kind: 'Kind',
  duration: 'Duration',
  http_status_code: 'HTTP status code',
  trace_id: 'Trace id',
  span_id: 'Span id',
  severity: 'Severity',
  body: 'Body',
}

export const NUMERIC: BuiltIn[] = ['duration', 'http_status_code']

export const EVENT_FUNCTIONS: EventFunction[] = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'p50', 'p90', 'p95', 'p99', 'rate']

export const needsField = (fn: EventFunction): boolean => fn !== 'count' && fn !== 'rate'

export const needsNumber = (fn: EventFunction): boolean => needsField(fn) && fn !== 'count_distinct'

export const columnLabel = (column: Column): string => ('attr' in column ? column.attr : column.field)

export const columnBelongs = (column: Column, signal: QuerySignal): boolean => ('attr' in column ? true : BUILT_INS[signal].includes(column.field))

export const columnIsNumeric = (column: Column): boolean => ('attr' in column ? true : NUMERIC.includes(column.field))

const sameColumn = (a: Column, b: Column): boolean => columnLabel(a) === columnLabel(b) && 'attr' in a === 'attr' in b

type Rule = { step: 'timed' | 'total'; groupBy: 'free' | 'none' | 'one'; field: boolean; aggregations: number }

const SERIES: Rule = { step: 'timed', groupBy: 'free', field: false, aggregations: 1 }

const ROWS: Rule = { step: 'total', groupBy: 'free', field: false, aggregations: 1 }

const RULES: Record<Exclude<PanelKind, 'text'>, Rule> = {
  time_series: SERIES,
  area: SERIES,
  bar: SERIES,
  pie: ROWS,
  table: ROWS,
  list: ROWS,
  number: { step: 'total', groupBy: 'none', field: false, aggregations: 1 },
  histogram: { step: 'total', groupBy: 'none', field: true, aggregations: 1 },
  heatmap: { step: 'timed', groupBy: 'none', field: true, aggregations: 1 },
  scatter: { step: 'total', groupBy: 'one', field: false, aggregations: 2 },
}

const ruleOf = (kind: PanelKind): Rule | null => (kind === 'text' ? null : RULES[kind])

export const runsQueries = (kind: PanelKind): boolean => kind !== 'text'

export const stepRule = (kind: PanelKind): 'timed' | 'total' | null => ruleOf(kind)?.step ?? null

export const groupRule = (kind: PanelKind): 'free' | 'none' | 'one' => ruleOf(kind)?.groupBy ?? 'free'

export const maxGroupBy = (kind: PanelKind): number => {
  const rule = groupRule(kind)
  return rule === 'none' ? 0 : rule === 'one' ? 1 : LIMITS.groupBy
}

export const OPTION_KINDS = {
  unit: ['time_series', 'area', 'bar', 'pie', 'scatter', 'histogram', 'heatmap', 'number'],
  decimals: ['time_series', 'area', 'bar', 'pie', 'scatter', 'histogram', 'heatmap', 'number'],
  legend: ['time_series', 'area', 'bar', 'pie', 'scatter'],
  stacked: ['area', 'bar'],
  content: ['text'],
  centre: ['pie'],
} as const satisfies Record<string, readonly PanelKind[]>

export type OptionSupport = { unit: boolean; decimals: boolean; legend: boolean; stacked: boolean; content: boolean; centre: boolean }

export const optionSupport = (kind: PanelKind): OptionSupport => ({
  unit: (OPTION_KINDS.unit as readonly PanelKind[]).includes(kind),
  decimals: (OPTION_KINDS.decimals as readonly PanelKind[]).includes(kind),
  legend: (OPTION_KINDS.legend as readonly PanelKind[]).includes(kind),
  stacked: (OPTION_KINDS.stacked as readonly PanelKind[]).includes(kind),
  content: (OPTION_KINDS.content as readonly PanelKind[]).includes(kind),
  centre: (OPTION_KINDS.centre as readonly PanelKind[]).includes(kind),
})

const isEvent = (aggregation: Aggregation): aggregation is Extract<Aggregation, { function: EventFunction }> => 'function' in aggregation

const emptyMetric = (): Aggregation => ({ metric: '', time: 'avg', space: 'avg' })

const countEvents = (): Aggregation => ({ function: 'count' })

export function defaultQuery(kind: PanelKind, signal: QuerySignal = 'traces', name = 'a'): QueryDoc {
  const base: QueryDoc = { name, signal, aggregations: [signal === 'metrics' ? emptyMetric() : countEvents()], filter: null, group_by: [], order: null, limit: null, step: 'auto' }
  return adaptQuery(kind, base)
}

function fieldAggregation(signal: QuerySignal): Aggregation {
  if (signal === 'metrics') return emptyMetric()
  return { function: 'avg', field: signal === 'traces' ? { field: 'duration' } : { attr: '' } }
}

function secondAggregation(first: Aggregation, signal: QuerySignal): Aggregation {
  if (signal === 'metrics') return { ...(first as Extract<Aggregation, { metric: string }>), space: 'max' }
  return signal === 'traces' ? { function: 'p95', field: { field: 'duration' } } : { function: 'rate' }
}

const hasField = (aggregation: Aggregation | undefined): boolean => aggregation !== undefined && (!isEvent(aggregation) || (aggregation.field !== undefined && aggregation.field !== null))

export function adaptQuery(kind: PanelKind, query: QueryDoc): QueryDoc {
  const rule = ruleOf(kind)
  if (!rule) return query
  let out: QueryDoc = { ...query }
  if (rule.step === 'total') out.step = 'total'
  else if (out.step === 'total') out.step = 'auto'
  const cap = rule.groupBy === 'none' ? 0 : rule.groupBy === 'one' ? 1 : LIMITS.groupBy
  const groups = (out.group_by ?? []).slice(0, cap)
  out.group_by = groups
  let aggregations = out.aggregations.length > 0 ? [...out.aggregations] : [out.signal === 'metrics' ? emptyMetric() : countEvents()]
  if (rule.field && !hasField(aggregations[0])) aggregations = [fieldAggregation(out.signal), ...aggregations.slice(1)]
  while (aggregations.length < rule.aggregations) aggregations.push(secondAggregation(aggregations[0], out.signal))
  out.aggregations = aggregations
  const order = out.order
  if (order && ((order.by === 'group' && groups.length === 0) || (order.by !== 'group' && order.by.aggregation >= aggregations.length) || rule.groupBy === 'none')) out = { ...out, order: null }
  return out
}

export function withSignal(query: QueryDoc, signal: QuerySignal): QueryDoc {
  if (query.signal === signal) return query
  let aggregations: Aggregation[]
  if (signal === 'metrics') aggregations = [emptyMetric()]
  else if (query.signal === 'metrics') aggregations = [countEvents()]
  else {
    const kept = query.aggregations.filter((aggregation) => !isEvent(aggregation) || !aggregation.field || columnBelongs(aggregation.field, signal))
    aggregations = kept.length > 0 ? kept : [countEvents()]
  }
  const group_by = (query.group_by ?? []).filter((column) => columnBelongs(column, signal))
  const filter = pruneFilter(withoutFields(query.filter ?? null, (column) => !columnBelongs(column, signal)))
  const held = query.order ?? null
  const order = held && (held.by === 'group' ? group_by.length === 0 : held.by.aggregation >= aggregations.length) ? null : held
  return { ...query, signal, aggregations, group_by, filter, order }
}

export function queryIssues(kind: PanelKind, query: QueryDoc): string[] {
  const name = KIND_INFO[kind].name
  const issues: string[] = []
  const rule = ruleOf(kind)
  const groups = query.group_by ?? []
  if (rule) {
    if (rule.step === 'total' && query.step !== 'total') issues.push(`A ${name} panel needs the step set to Total.`)
    if (rule.step === 'timed' && query.step === 'total') issues.push(`A ${name} panel needs a timed step (Auto or a fixed number of seconds).`)
    if (rule.groupBy === 'none' && groups.length > 0) issues.push(`A ${name} panel takes no group by.`)
    if (rule.groupBy === 'one' && groups.length > 1) issues.push(`A ${name} panel groups by at most one field.`)
    if (rule.field && !hasField(query.aggregations[0])) issues.push(`A ${name} panel needs the first aggregation to run over a field, such as avg(duration).`)
    if (query.aggregations.length < rule.aggregations) issues.push(`A ${name} panel needs at least two aggregations, one per axis.`)
  }
  if (query.aggregations.length === 0 || query.aggregations.length > LIMITS.aggregations) issues.push(`A query holds 1 to ${LIMITS.aggregations} aggregations.`)
  for (const aggregation of query.aggregations) {
    if (isEvent(aggregation)) {
      if (query.signal === 'metrics') {
        issues.push('A metrics query aggregates a metric, not events.')
        continue
      }
      const field = aggregation.field ?? null
      if (!needsField(aggregation.function) && field) issues.push(`${aggregation.function} takes no field.`)
      if (needsField(aggregation.function) && !field) issues.push(`${aggregation.function} needs a field.`)
      if (field && 'attr' in field && field.attr.trim() === '') issues.push(`${aggregation.function} needs a field. Pick an attribute key.`)
      if (field && !columnBelongs(field, query.signal)) issues.push(`${columnLabel(field)} is not a field of ${query.signal}.`)
      if (field && needsNumber(aggregation.function) && !columnIsNumeric(field)) issues.push(`${aggregation.function} needs a numeric field.`)
    } else if (query.signal !== 'metrics') {
      issues.push(`A ${query.signal} query aggregates events, not a metric.`)
    } else if (aggregation.metric.trim() === '') {
      issues.push('Pick a metric.')
    }
  }
  if (groups.length > LIMITS.groupBy) issues.push(`A query groups by at most ${LIMITS.groupBy} fields.`)
  groups.forEach((column, at) => {
    if (!columnBelongs(column, query.signal)) issues.push(`${columnLabel(column)} is not a field of ${query.signal}.`)
    else if ('attr' in column && column.attr.trim() === '') issues.push('Pick the attribute to group by.')
    else if (groups.slice(0, at).some((earlier) => sameColumn(earlier, column))) issues.push('Group by each field once.')
  })
  if (query.limit !== null && query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > LIMITS.rows)) issues.push(`A limit is 1 to ${LIMITS.rows} rows.`)
  if (typeof query.step === 'object' && (!Number.isInteger(query.step.fixed) || query.step.fixed < 1)) issues.push('A fixed step is a whole number of seconds, 1 or more.')
  const order = query.order
  if (order) {
    if (order.by === 'group' && groups.length === 0) issues.push('Ordering by group needs a group by.')
    if (order.by !== 'group' && order.by.aggregation >= query.aggregations.length) issues.push('The order names an aggregation the query does not have.')
  }
  issues.push(...filterIssues(query.filter ?? null, query.signal))
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(query.name)) issues.push('A query name is 1 to 32 letters, digits, - or _.')
  return issues
}

function filterIssues(filter: FilterDoc | null, signal: QuerySignal): string[] {
  if (!filter) return []
  if ('all' in filter) return filter.all.flatMap((part) => filterIssues(part, signal))
  if ('any' in filter) return filter.any.flatMap((part) => filterIssues(part, signal))
  if ('not' in filter) return filterIssues(filter.not, signal)
  const column: Column | null = filter.attr !== undefined ? { attr: filter.attr } : filter.field ? { field: filter.field } : null
  const label = column ? columnLabel(column) : 'a field'
  if (!column || ('attr' in column && column.attr.trim() === '')) return ['Pick the field of every filter condition.']
  const issues: string[] = []
  if (!columnBelongs(column, signal)) issues.push(`${label} is not a field of ${signal}.`)
  const bare = filter.op === 'exists' || filter.op === 'not_exists'
  const value = filter.value
  const empty = value === undefined || (Array.isArray(value) ? value.length === 0 : typeof value === 'string' && value === '')
  if (!bare && empty) issues.push(`Filter on ${label} needs a value.`)
  if (bare && value !== undefined) issues.push(`Filter on ${label} takes no value.`)
  if ((filter.op === 'in' || filter.op === 'not_in') && !Array.isArray(value) && !empty) issues.push(`Filter on ${label} takes a list of values.`)
  return issues
}

export function panelIssues(panel: PanelDoc): string[] {
  const name = KIND_INFO[panel.kind].name
  const issues: string[] = []
  if (points(panel.title) > LIMITS.title) issues.push(`A panel title is at most ${LIMITS.title} characters.`)
  if (points(panel.description) > LIMITS.description) issues.push(`A description is at most ${LIMITS.description} characters.`)
  if (!runsQueries(panel.kind)) {
    if (panel.queries.length > 0) issues.push(`A ${name} panel runs no query.`)
  } else {
    if (panel.queries.length === 0) issues.push(`A ${name} panel needs a query.`)
    if (panel.queries.length > LIMITS.queries) issues.push(`A panel holds at most ${LIMITS.queries} queries.`)
    const names = panel.queries.map((query) => query.name)
    if (new Set(names).size !== names.length) issues.push('Each query of a panel has its own name.')
    for (const query of panel.queries) issues.push(...queryIssues(panel.kind, query).map((issue) => (panel.queries.length > 1 ? `${query.name}: ${issue}` : issue)))
  }
  const { unit, decimals, content } = panel.options
  if (unit && points(unit) > LIMITS.unit) issues.push(`A unit is at most ${LIMITS.unit} characters.`)
  if (decimals !== null && decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > LIMITS.decimals)) issues.push(`Decimals are 0 to ${LIMITS.decimals}.`)
  if (panel.kind === 'text' && content && new TextEncoder().encode(content).length > LIMITS.content) issues.push(`A text panel holds at most ${LIMITS.content} bytes.`)
  if (panel.kind === 'pie' && content && points(content) > LIMITS.centre) issues.push(`A centre label is at most ${LIMITS.centre} characters.`)
  return issues
}

const TEXT_STARTER = '## Notes\n\nWrite **markdown** here: headings, lists, `code` and [links](/releases).'

export function newPanel(kind: PanelKind, id: string, signal: QuerySignal = 'traces'): PanelDoc {
  return {
    id,
    title: KIND_INFO[kind].name,
    description: '',
    kind,
    queries: runsQueries(kind) ? [defaultQuery(kind, signal)] : [],
    options: kind === 'text' ? { content: TEXT_STARTER } : {},
  }
}

export function pruneOptions(kind: PanelKind, options: PanelDoc['options']): PanelDoc['options'] {
  const support = optionSupport(kind)
  const out: PanelDoc['options'] = {}
  if (support.unit && options.unit !== undefined) out.unit = options.unit
  if (support.decimals && options.decimals !== undefined) out.decimals = options.decimals
  if (support.legend && options.legend !== undefined) out.legend = options.legend
  if (support.stacked && options.stacked !== undefined) out.stacked = options.stacked
  if ((support.content || support.centre) && options.content !== undefined) out.content = options.content
  return out
}

export function changeKind(panel: PanelDoc, kind: PanelKind): PanelDoc {
  const carried = (panel.kind === 'pie') !== (kind === 'pie') ? { ...panel.options, content: undefined } : panel.options
  const options = pruneOptions(kind, carried)
  if (!runsQueries(kind)) return { ...panel, kind, queries: [], options: { ...options, content: options.content ?? TEXT_STARTER } }
  const queries = panel.queries.length > 0 ? panel.queries.map((query) => adaptQuery(kind, query)) : [defaultQuery(kind)]
  return { ...panel, kind, queries, options }
}

export const nextQueryName = (queries: QueryDoc[]): string => {
  for (let at = 1; ; at += 1) {
    const candidate = at <= 26 ? String.fromCharCode(96 + at) : `q${at}`
    if (!queries.some((query) => query.name === candidate)) return candidate
  }
}

export const addQuery = (panel: PanelDoc): PanelDoc => {
  const first = panel.queries[0]
  const query = adaptQuery(panel.kind, { ...(first ? { ...first, filter: null, group_by: [...(first.group_by ?? [])] } : defaultQuery(panel.kind)), name: nextQueryName(panel.queries) })
  return { ...panel, queries: [...panel.queries, query] }
}

const stepLabel = (step: QueryDoc['step']): string => (typeof step === 'object' ? `${step.fixed} s` : step === 'total' ? 'Total' : 'Auto')

export function kindChangeNotes(from: PanelDoc, to: PanelDoc): string[] {
  const name = KIND_INFO[to.kind].name
  const notes: string[] = []
  to.queries.forEach((after, at) => {
    const before = from.queries[at]
    if (!before) return
    if (stepLabel(before.step) !== stepLabel(after.step)) notes.push(`The step is now ${stepLabel(after.step)}, which a ${name} panel needs.`)
    const was = before.group_by?.length ?? 0
    const now = after.group_by?.length ?? 0
    if (was > now) notes.push(now === 0 ? `A ${name} panel takes no group by, so it was removed.` : `A ${name} panel groups by at most one field, so the others were removed.`)
    if (JSON.stringify(before.aggregations[0]) !== JSON.stringify(after.aggregations[0])) notes.push(`The first aggregation is now ${aggLabel(after.aggregations[0])}, because a ${name} panel needs one over a field.`)
    if (after.aggregations.length > before.aggregations.length) notes.push(`A ${name} panel needs two aggregations, so one was added.`)
    if (before.order && !after.order) notes.push('The order was cleared.')
  })
  return notes
}
