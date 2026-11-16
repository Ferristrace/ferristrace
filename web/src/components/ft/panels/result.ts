import type { Aggregation, Labels, PanelResult, SeriesData } from '@/data/dashboards'

export const QUERY_LABEL = '__query'

export function isEmpty(result: PanelResult): boolean {
  switch (result.kind) {
    case 'series':
      return result.series.every((one) => one.points.every((point) => point[1] === null))
    case 'scalar':
      return result.value === null
    case 'rows':
      return result.rows.length === 0
    case 'buckets':
      return result.buckets.every((bucket) => bucket.count === 0)
    case 'heat':
      return result.cells.every((cell) => cell[2] === 0) || result.x.length === 0 || result.y.length === 0
    case 'pairs':
      return result.points.length === 0
  }
}

export function mergeResults(results: PanelResult[], names: string[]): PanelResult | null {
  const first = results[0]
  if (!first) return null
  if (first.kind !== 'series') return first
  const several = results.length > 1
  const series: SeriesData[] = []
  results.forEach((result, at) => {
    if (result.kind !== 'series') return
    for (const one of result.series) series.push(several ? { labels: { ...Object.fromEntries(Object.entries(one.labels).filter(([key]) => key !== QUERY_LABEL)), [QUERY_LABEL]: names[at] ?? `query ${at + 1}` }, points: one.points } : one)
  })
  return { kind: 'series', series }
}

export function droppedQueries(results: PanelResult[]): number {
  const first = results[0]
  if (!first) return 0
  return results.filter((one, at) => at > 0 && (first.kind !== 'series' || one.kind !== 'series')).length
}

export function labelOf(labels: Labels): string {
  const shown = Object.entries(labels).filter(([key]) => key !== QUERY_LABEL)
  const query = labels[QUERY_LABEL]
  const text = shown.length === 0 ? 'all' : shown.length === 1 ? shown[0][1] : shown.map(([key, value]) => `${key}=${value}`).join(', ')
  if (query === undefined) return text
  return shown.length === 0 ? query : `${query}: ${text}`
}

export function aggLabel(aggregation: Aggregation | undefined): string {
  if (!aggregation) return 'value'
  if ('metric' in aggregation) return `${aggregation.space}(${aggregation.time}(${aggregation.metric}))`
  const field = aggregation.field ? ('attr' in aggregation.field ? aggregation.field.attr : aggregation.field.field) : ''
  return field ? `${aggregation.function}(${field})` : aggregation.function
}

export type Failure = { kind: 'invalid' | 'too_many_series' | 'timeout' | 'unavailable' | 'other'; message: string }

export function describeFailure(status: number | null, body: string): Failure {
  let parsed: { error?: string; reason?: string; count?: number; max?: number } = {}
  try {
    const value: unknown = JSON.parse(body)
    if (value && typeof value === 'object') parsed = value as typeof parsed
  } catch {
    parsed = {}
  }
  if (parsed.error === 'too_many_series') {
    const count = typeof parsed.count === 'number' ? parsed.count : null
    const max = typeof parsed.max === 'number' ? parsed.max : 50
    return { kind: 'too_many_series', message: `This query returns ${count === null ? 'too many' : count} series, and a panel draws at most ${max}. Group by fewer fields or filter it down.` }
  }
  if (parsed.error === 'invalid' || status === 422) {
    return { kind: 'invalid', message: parsed.reason ? `This query is not valid: ${parsed.reason}.` : 'This query is not valid.' }
  }
  if (status === 408 || status === 504 || parsed.error === 'timeout') {
    return { kind: 'timeout', message: 'The store did not answer in time. Try a narrower range or a coarser step.' }
  }
  if (status === 503) return { kind: 'unavailable', message: 'The store this panel reads is not configured on this deployment.' }
  return { kind: 'other', message: body.length > 0 && body.length < 200 && !body.startsWith('{') ? body : 'The panel could not be read.' }
}
