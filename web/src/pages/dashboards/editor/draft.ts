import type { Aggregation, DashboardDoc, DashboardFile, LayoutItem, OptionsDoc, PanelDoc, PanelKind, QueryDoc, VariableDoc } from '@/data/dashboards'
import { DURATION_MAX, DURATION_MIN } from './duration'
import { pruneFilter, variablesUsed } from './filterTree'
import { append, compact, duplicate, remove } from './grid'
import { LIMITS, newPanel } from './kinds'
import { allVariableIssues } from './variablesEdit'

export type Draft = { name: string; tags: string[]; doc: DashboardDoc; updatedAt?: number }

export const MAX_DOC_BYTES = 256 * 1024

export const emptyDoc = (): DashboardDoc => ({ schema_version: 1, variables: [], panels: [], layout: [], duration: 3600 })

export const SIZE_OF: Record<PanelKind, { w: number; h: number }> = {
  time_series: { w: 6, h: 5 },
  area: { w: 6, h: 5 },
  bar: { w: 6, h: 5 },
  pie: { w: 4, h: 5 },
  scatter: { w: 6, h: 5 },
  histogram: { w: 6, h: 5 },
  heatmap: { w: 6, h: 5 },
  number: { w: 3, h: 3 },
  table: { w: 6, h: 5 },
  list: { w: 6, h: 6 },
  text: { w: 4, h: 3 },
}

export function parseTags(text: string): string[] {
  const tags = text.split(/[,\n]/).map((tag) => tag.trim()).filter((tag) => tag !== '')
  return [...new Set(tags)]
}

function laidOut(panels: PanelDoc[], layout: LayoutItem[], tidy = false): LayoutItem[] {
  const known = new Set(panels.map((panel) => panel.id))
  const seen = new Set<string>()
  const items = layout.filter((item) => {
    if (!known.has(item.panel) || seen.has(item.panel)) return false
    seen.add(item.panel)
    return true
  })
  let bottom = Math.max(0, ...items.map((item) => item.y + item.h))
  for (const panel of panels) {
    if (seen.has(panel.id)) continue
    const size = SIZE_OF[panel.kind]
    items.push({ panel: panel.id, x: 0, y: bottom, w: size.w, h: size.h })
    bottom += size.h
  }
  const placed = tidy ? compact(items) : items
  return panels.flatMap((panel) => {
    const found = placed.find((item) => item.panel === panel.id)
    return found ? [found] : []
  })
}

export const draftOf = (source: { name: string; tags: string[]; doc: DashboardDoc; updated_at_ms?: number }): Draft => ({
  name: source.name,
  tags: [...source.tags],
  doc: { ...source.doc, layout: laidOut(source.doc.panels, source.doc.layout) },
  updatedAt: source.updated_at_ms,
})

function cleanOptions(options: OptionsDoc): OptionsDoc {
  const out: OptionsDoc = {}
  if (options.unit) out.unit = options.unit
  if (options.decimals !== null && options.decimals !== undefined) out.decimals = options.decimals
  if (options.legend) out.legend = options.legend
  if (options.stacked) out.stacked = true
  if (options.content) out.content = options.content
  return out
}

function cleanQuery(query: QueryDoc): QueryDoc {
  return {
    name: query.name,
    signal: query.signal,
    aggregations: query.aggregations,
    filter: pruneFilter(query.filter ?? null),
    group_by: query.group_by ?? [],
    order: query.order ?? null,
    limit: query.limit ?? null,
    step: query.step,
  }
}

export function fileOf(draft: Draft): DashboardFile {
  const { doc } = draft
  return {
    name: draft.name.trim(),
    tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter((tag) => tag !== ''))],
    doc: {
      schema_version: 1,
      variables: doc.variables,
      panels: doc.panels.map((panel) => ({ id: panel.id, title: panel.title, description: panel.description, kind: panel.kind, queries: panel.queries.map(cleanQuery), options: cleanOptions(panel.options) })),
      layout: laidOut(doc.panels, doc.layout),
      duration: doc.duration,
    },
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, held]) => held !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${stable(held)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export const isDirty = (base: Draft, draft: Draft): boolean => stable(fileOf(base)) !== stable(fileOf(draft))

export const documentBytes = (draft: Draft): number => new TextEncoder().encode(JSON.stringify(fileOf(draft).doc)).length

export function newPanelId(panels: PanelDoc[], kind: PanelKind): string {
  const stem = kind.replace('_', '-')
  for (let at = panels.length + 1; ; at += 1) {
    const candidate = `${stem}-${at}`
    if (!panels.some((panel) => panel.id === candidate)) return candidate
  }
}

export const makePanel = (doc: DashboardDoc, kind: PanelKind): PanelDoc => newPanel(kind, newPanelId(doc.panels, kind))

export const canAddPanel = (draft: Draft): boolean => draft.doc.panels.length < LIMITS.panels

export function addPanel(draft: Draft, panel: PanelDoc): Draft {
  const size = SIZE_OF[panel.kind]
  return { ...draft, doc: { ...draft.doc, panels: [...draft.doc.panels, panel], layout: append(laidOut(draft.doc.panels, draft.doc.layout), panel.id, size.w, size.h) } }
}

export function updatePanel(draft: Draft, panel: PanelDoc): Draft {
  if (!draft.doc.panels.some((one) => one.id === panel.id)) return draft
  return { ...draft, doc: { ...draft.doc, panels: draft.doc.panels.map((one) => (one.id === panel.id ? panel : one)) } }
}

export function deletePanel(draft: Draft, id: string): Draft {
  return { ...draft, doc: { ...draft.doc, panels: draft.doc.panels.filter((panel) => panel.id !== id), layout: remove(draft.doc.layout, id) } }
}

export function duplicatePanel(draft: Draft, id: string): { draft: Draft; id: string } {
  const original = draft.doc.panels.find((panel) => panel.id === id)
  if (!original) return { draft, id }
  const stem = id.slice(0, 50)
  let copy = `${stem}-copy`
  for (let at = 2; draft.doc.panels.some((panel) => panel.id === copy); at += 1) copy = `${stem}-copy-${at}`
  const suffix = ' (copy)'
  const letters = Array.from(original.title)
  const title = letters.length + suffix.length > LIMITS.title ? `${letters.slice(0, LIMITS.title - suffix.length).join('')}${suffix}` : `${original.title}${suffix}`
  const at = draft.doc.panels.findIndex((panel) => panel.id === id)
  const panels = [...draft.doc.panels.slice(0, at + 1), { ...structuredClone(original), id: copy, title }, ...draft.doc.panels.slice(at + 1)]
  return { draft: { ...draft, doc: { ...draft.doc, panels, layout: duplicate(laidOut(draft.doc.panels, draft.doc.layout), id, copy) } }, id: copy }
}

export const setLayout = (draft: Draft, layout: LayoutItem[]): Draft => ({ ...draft, doc: { ...draft.doc, layout: laidOut(draft.doc.panels, layout, true) } })

export const moveItem = (layout: LayoutItem[], id: string, x: number, y: number): LayoutItem[] => compact(layout.map((item) => (item.panel === id ? { ...item, x, y } : item)), id)

export const setSettings = (draft: Draft, change: { name?: string; tags?: string[]; duration?: number }): Draft => ({
  ...draft,
  name: change.name ?? draft.name,
  tags: change.tags ?? draft.tags,
  doc: change.duration === undefined ? draft.doc : { ...draft.doc, duration: change.duration },
})

export const setVariables = (draft: Draft, variables: VariableDoc[]): Draft => ({ ...draft, doc: { ...draft.doc, variables } })

export const setDoc = (draft: Draft, doc: DashboardDoc): Draft => ({ ...draft, doc })

export function draftIssues(draft: Draft): string[] {
  const issues: string[] = []
  const file = fileOf(draft)
  if (file.name === '') issues.push('A dashboard needs a name.')
  else if ([...file.name].length > LIMITS.name) issues.push(`A dashboard name is at most ${LIMITS.name} characters.`)
  if (file.tags.length > LIMITS.tags) issues.push(`A dashboard holds at most ${LIMITS.tags} tags.`)
  if (file.tags.some((tag) => [...tag].length > LIMITS.tag)) issues.push(`A tag is 1 to ${LIMITS.tag} characters.`)
  const { duration } = draft.doc
  if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) issues.push('The default duration is between one minute and 31 days.')
  if (draft.doc.panels.length > LIMITS.panels) issues.push(`A dashboard holds at most ${LIMITS.panels} panels.`)
  issues.push(...allVariableIssues(draft.doc.variables))
  const declared = new Set(draft.doc.variables.map((variable) => variable.name))
  for (const panel of draft.doc.panels) {
    const missing = [...new Set(panel.queries.flatMap((query) => variablesUsed(query.filter ?? null)))].filter((name) => !declared.has(name))
    for (const name of missing) issues.push(`Panel ${panel.title || panel.id} uses the variable ${name}, which is not declared.`)
  }
  if (documentBytes(draft) > MAX_DOC_BYTES) issues.push('A dashboard document is at most 256 KB.')
  return issues
}

export function metricAggregation(metric: string, agg: string): Aggregation {
  switch (agg) {
    case 'rate':
      return { metric, time: 'rate', space: 'sum' }
    case 'sum':
      return { metric, time: 'sum', space: 'sum' }
    case 'min':
      return { metric, time: 'min', space: 'min' }
    case 'max':
      return { metric, time: 'max', space: 'max' }
    default:
      return { metric, time: 'avg', space: 'avg' }
  }
}

export function panelFromMetric(doc: DashboardDoc, from: { metric: string; agg: string; groupBy: string[]; unit?: string }): PanelDoc {
  const panel = makePanel(doc, 'time_series')
  const query: QueryDoc = {
    name: 'a',
    signal: 'metrics',
    aggregations: [metricAggregation(from.metric, from.agg)],
    filter: null,
    group_by: from.groupBy.slice(0, LIMITS.groupBy).map((attr) => ({ attr })),
    order: null,
    limit: null,
    step: 'auto',
  }
  return { ...panel, title: from.metric.slice(0, LIMITS.title), queries: [query], options: from.unit ? { unit: from.unit } : {} }
}
