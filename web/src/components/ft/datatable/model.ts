import { sorted, toggled, type Direction, type Sortable, type Sorting } from '@/lib/sorting'
import { pagesOf } from '@/lib/paging'

export type NumberOp = 'above' | 'below'

export type ValuesFilterDef<Row> = { kind: 'values'; value: (row: Row) => string | null; noun?: string }

export type NumberFilterDef<Row> = { kind: 'number'; value: (row: Row) => number | null; unit: string; presets: number[]; format?: (value: number) => string }

export type FilterDef<Row> = ValuesFilterDef<Row> | NumberFilterDef<Row>

export type ColumnModel<Row> = {
  id: string
  header: string
  sort?: (row: Row) => Sortable
  firstDir?: Direction
  filter?: FilterDef<Row>
  text?: (row: Row) => string | number | null
  hideable?: boolean
}

export type Filter = { column: string; kind: 'values'; values: string[] } | { column: string; kind: 'number'; op: NumberOp; value: number }

export type Counted = { value: string; count: number }

export type SelectionState = 'none' | 'some' | 'all'

export const formatMs = (ms: number): string => (ms >= 1000 ? `${Number((ms / 1000).toFixed(2))} s` : `${ms} ms`)

export function filterValue<Row>(def: NumberFilterDef<Row>, value: number): string {
  return def.format ? def.format(value) : `${value} ${def.unit}`.trim()
}

function matches<Row>(row: Row, filter: Filter, column: ColumnModel<Row> | undefined): boolean {
  const def = column?.filter
  if (!def) return true
  if (filter.kind === 'values' && def.kind === 'values') {
    if (filter.values.length === 0) return true
    const value = def.value(row)
    return value !== null && filter.values.includes(value)
  }
  if (filter.kind === 'number' && def.kind === 'number') {
    const value = def.value(row)
    if (value === null || Number.isNaN(value)) return false
    return filter.op === 'above' ? value > filter.value : value < filter.value
  }
  return true
}

export function searchText<Row>(row: Row, columns: readonly ColumnModel<Row>[]): string {
  return columns
    .map((column) => (column.text ? column.text(row) : column.sort ? column.sort(row) : null))
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase()
}

export function filterRows<Row>(rows: readonly Row[], columns: readonly ColumnModel<Row>[], filters: readonly Filter[], search: string): Row[] {
  const byId = new Map(columns.map((column) => [column.id, column]))
  const needle = search.trim().toLowerCase()
  return rows.filter((row) => {
    if (needle && !searchText(row, columns).includes(needle)) return false
    return filters.every((filter) => matches(row, filter, byId.get(filter.column)))
  })
}

export function sortRows<Row>(rows: readonly Row[], columns: readonly ColumnModel<Row>[], sorting: Sorting<string> | null): Row[] {
  const column = sorting ? columns.find((one) => one.id === sorting.key) : undefined
  if (!sorting || !column?.sort) return [...rows]
  const value = column.sort
  return sorted(rows, sorting, (row) => value(row))
}

export function nextSorting<Row>(current: Sorting<string> | null, column: ColumnModel<Row>): Sorting<string> {
  return toggled(current, column.id, column.firstDir ?? 'desc')
}

export function valueCounts<Row>(rows: readonly Row[], def: ValuesFilterDef<Row>): Counted[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = def.value(row)
    if (value === null) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, undefined, { numeric: true }))
}

export function withFilter(filters: readonly Filter[], next: Filter): Filter[] {
  const others = filters.filter((filter) => filter.column !== next.column)
  if (next.kind === 'values' && next.values.length === 0) return others
  const at = filters.findIndex((filter) => filter.column === next.column)
  if (at < 0) return [...others, next]
  const out = [...filters]
  out[at] = next
  return out
}

export const withoutFilter = (filters: readonly Filter[], column: string): Filter[] => filters.filter((filter) => filter.column !== column)

export function filterLabel<Row>(filter: Filter, column: ColumnModel<Row> | undefined): { field: string; text: string } {
  const field = column?.header ?? filter.column
  if (filter.kind === 'values') return { field, text: `is ${filter.values.join(', ')}` }
  const def = column?.filter
  const shown = def?.kind === 'number' ? filterValue(def, filter.value) : String(filter.value)
  return { field, text: `${filter.op === 'above' ? '>' : '<'} ${shown}` }
}

export function defaultVisible<Row>(columns: readonly ColumnModel<Row>[], defaults: readonly string[] | undefined): string[] {
  return columns.filter((column) => column.hideable === false || !defaults || defaults.includes(column.id)).map((column) => column.id)
}

export function visibleColumns<Row, C extends ColumnModel<Row>>(columns: readonly C[], visible: readonly string[]): C[] {
  return columns.filter((column) => column.hideable === false || visible.includes(column.id))
}

export function toggledColumn(visible: readonly string[], id: string, on: boolean): string[] {
  const rest = visible.filter((one) => one !== id)
  return on ? [...rest, id] : rest
}

export function storedVisible(raw: string | null, known: readonly string[]): string[] | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((one): one is string => typeof one === 'string' && known.includes(one))
    return ids.length > 0 ? ids : null
  } catch {
    return null
  }
}

export function pageOf<Row>(rows: readonly Row[], page: number, size: number): { rows: Row[]; page: number; pages: number } {
  const pages = pagesOf(rows.length, size)
  const at = Math.min(Math.max(1, page), pages)
  return { rows: rows.slice((at - 1) * size, at * size), page: at, pages }
}

export function selectionOf(keys: readonly string[], selected: ReadonlySet<string>): SelectionState {
  const on = keys.filter((key) => selected.has(key)).length
  return on === 0 ? 'none' : on === keys.length ? 'all' : 'some'
}

export function toggledAll(keys: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const out = new Set(selected)
  if (selectionOf(keys, selected) === 'all') for (const key of keys) out.delete(key)
  else for (const key of keys) out.add(key)
  return out
}

export function toggledOne(selected: ReadonlySet<string>, key: string): Set<string> {
  const out = new Set(selected)
  if (out.has(key)) out.delete(key)
  else out.add(key)
  return out
}

export function kept(selected: ReadonlySet<string>, present: readonly string[]): Set<string> {
  const known = new Set(present)
  return new Set([...selected].filter((key) => known.has(key)))
}

const QUOTED = /[",\r\n]/

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return QUOTED.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text
}

export function csvOf<Row>(rows: readonly Row[], columns: readonly ColumnModel<Row>[]): string {
  const usable = columns.filter((column) => column.text || column.sort)
  const head = usable.map((column) => csvField(column.header)).join(',')
  const body = rows.map((row) => usable.map((column) => csvField(column.text ? column.text(row) : column.sort?.(row))).join(','))
  return [head, ...body].join('\r\n') + '\r\n'
}
