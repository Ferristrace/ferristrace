import type { Condition, FilterDoc, Labels, QueryDoc } from '@/data/dashboards'
import { conjuncts, itemsText, type Node } from '@/lib/queryLang'
import { BUILT_INS, type FieldRef, type Scalar } from '@/lib/traceQuery'
import { QUERY_LABEL } from './result'

export type Drill = { to: string; search: Record<string, string> }

const BUILT = new Set<string>(BUILT_INS.map((field) => field.name))
const NUMERIC = new Set<string>(['duration', 'http_status_code'])

const typed = (field: FieldRef, value: string): Scalar => {
  if ('built' in field && NUMERIC.has(field.built) && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

const own = <T>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined)

function condition(one: Condition, variables: Record<string, string[]>): Node | null {
  const field: FieldRef = one.field ? { built: one.field } : { attr: one.attr ?? '' }
  const raw = one.value
  if (raw === undefined) return { field, op: one.op }
  const listed = Array.isArray(raw)
  const values: Scalar[] = []
  for (const item of listed ? raw : [raw]) {
    if (typeof item === 'object') {
      const chosen = own(variables, item.var)
      if (!chosen || chosen.length === 0) return null
      values.push(...chosen.map((value) => typed(field, value)))
    } else {
      values.push(item)
    }
  }
  if (values.length === 0) return null
  const wantsList = one.op === 'in' || one.op === 'not_in'
  if (!listed && values.length === 1 && !wantsList) return { field, op: one.op, value: values[0] }
  if (one.op === 'eq' || one.op === 'in') return { field, op: 'in', value: values }
  if (one.op === 'ne' || one.op === 'not_in') return { field, op: 'not_in', value: values }
  const parts: Node[] = values.map((value) => ({ field, op: one.op, value }))
  if (parts.length === 1) return parts[0]
  return one.op === 'not_contains' ? { all: parts } : { any: parts }
}

export function resolveFilter(filter: FilterDoc | null | undefined, variables: Record<string, string[]>): Node | null {
  if (!filter) return null
  if ('all' in filter) {
    const parts = filter.all.map((part) => resolveFilter(part, variables)).filter((part): part is Node => part !== null)
    return parts.length === 0 ? null : parts.length === 1 ? parts[0] : { all: parts }
  }
  if ('any' in filter) {
    const parts = filter.any.map((part) => resolveFilter(part, variables))
    return parts.some((part) => part === null) ? null : { any: parts as Node[] }
  }
  if ('not' in filter) {
    const inner = resolveFilter(filter.not, variables)
    return inner === null ? null : { not: inner }
  }
  return condition(filter, variables)
}

export function labelChips(labels: Labels, query: Pick<QueryDoc, 'signal' | 'group_by'>): Node[] {
  return Object.entries(labels)
    .filter(([key]) => key !== QUERY_LABEL)
    .map(([key, value]) => {
      const column = (query.group_by ?? []).find((one) => ('attr' in one ? one.attr === key : one.field === key))
      const built = column ? 'field' in column : BUILT.has(key) && (query.signal !== 'metrics' || key === 'service')
      const field: FieldRef = built ? { built: key as never } : { attr: key }
      return { field, op: 'eq' as const, value: typed(field, value) }
    })
}

export function drillTarget(input: { query: QueryDoc; labels: Labels; variables: Record<string, string[]>; fromMs: number; toMs: number }): Drill | null {
  const { query, labels, variables } = input
  const resolved = resolveFilter(query.filter, variables)
  const items: Node[] = [...(resolved ? conjuncts(resolved) : []), ...labelChips(labels, query)]
  const text = itemsText(items)
  const from = String(Math.round(input.fromMs))
  const to = String(Math.round(input.toMs))
  if (query.signal === 'metrics') {
    const aggregation = query.aggregations.find((one) => 'metric' in one)
    if (!aggregation || !('metric' in aggregation)) return null
    const params = new URLSearchParams({ metric: aggregation.metric })
    for (const column of query.group_by ?? []) params.append('by', 'attr' in column ? column.attr : column.field)
    params.set('from', from)
    params.set('to', to)
    if (text) params.set('w', text)
    return { to: '/metrics', search: { f: params.toString() } }
  }
  const search: Record<string, string> = { from, to }
  if (text) search.q = text
  return { to: query.signal === 'logs' ? '/logs' : '/traces', search }
}

export const hrefOf = (drill: Drill): string => `${drill.to}?${new URLSearchParams(drill.search).toString()}`
