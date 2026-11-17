import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Sorting } from '@/lib/sorting'
import {
  defaultVisible,
  filterRows,
  kept,
  nextSorting,
  pageOf,
  selectionOf,
  sortRows,
  storedVisible,
  toggledAll,
  toggledColumn,
  toggledOne,
  visibleColumns,
  withFilter,
  withoutFilter,
  type ColumnModel,
  type Filter,
} from './model'

export type Column<Row> = ColumnModel<Row> & {
  cell: (row: Row) => ReactNode
  numeric?: boolean
  className?: string
  headClassName?: string
  tag?: ReactNode
}

export type DataTableOptions<Row> = {
  rows: readonly Row[]
  columns: readonly Column<Row>[]
  rowKey: (row: Row) => string
  storageKey?: string
  defaultColumns?: readonly string[]
  sorting?: Sorting<string> | null
  onSorting?: (sorting: Sorting<string> | null) => void
  pageSize?: number
  resetKey?: string
}

const read = (key: string | undefined): string | null => {
  if (!key) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string | undefined, value: string | null) => {
  if (!key) return
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    return
  }
}

export function useDataTable<Row>({ rows, columns, rowKey, storageKey, defaultColumns, sorting: controlled, onSorting, pageSize = 10, resetKey = '' }: DataTableOptions<Row>) {
  const ids = useMemo(() => columns.map((column) => column.id), [columns])
  const defaults = useMemo(() => defaultVisible(columns, defaultColumns), [columns, defaultColumns])
  const [visible, setVisibleState] = useState<string[]>(() => storedVisible(read(storageKey), ids) ?? defaults)
  const [search, setSearchState] = useState('')
  const [filters, setFilters] = useState<Filter[]>([])
  const [own, setOwn] = useState<Sorting<string> | null>(controlled ?? null)
  const [page, setPage] = useState(1)
  const [size, setSizeState] = useState(pageSize)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const sorting = controlled === undefined ? own : controlled

  useEffect(() => setPage(1), [resetKey])

  const setVisible = (next: string[]) => {
    setVisibleState(next)
    write(storageKey, JSON.stringify(next))
  }
  const shown = useMemo(() => visibleColumns<Row, Column<Row>>(columns, visible), [columns, visible])
  const filtered = useMemo(() => filterRows(rows, columns, filters, search), [rows, columns, filters, search])
  const view = useMemo(() => sortRows(filtered, columns, sorting), [filtered, columns, sorting])
  const paged = pageOf(view, page, size)
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey])
  const selected = useMemo(() => kept(chosen, keys), [chosen, keys])
  const pageKeys = paged.rows.map(rowKey)

  const setSorting = (next: Sorting<string> | null) => {
    if (controlled === undefined) setOwn(next)
    onSorting?.(next)
    setPage(1)
  }

  return {
    rows,
    columns,
    rowKey,
    shown,
    visible,
    toggleColumn: (id: string, on: boolean) => setVisible(toggledColumn(visible, id, on)),
    resetColumns: () => {
      setVisibleState(defaults)
      write(storageKey, null)
    },
    search,
    setSearch: (next: string) => { setSearchState(next); setPage(1) },
    filters,
    setFilter: (next: Filter) => { setFilters((was) => withFilter(was, next)); setPage(1) },
    removeFilter: (column: string) => { setFilters((was) => withoutFilter(was, column)); setPage(1) },
    clearFilters: () => { setFilters([]); setSearchState(''); setPage(1) },
    sorting,
    setSorting,
    sortBy: (column: Column<Row>) => setSorting(nextSorting(sorting, column)),
    view,
    pageRows: paged.rows,
    page: paged.page,
    pages: paged.pages,
    setPage,
    size,
    setSize: (next: number) => { setSizeState(next); setPage(1) },
    selected,
    selectedRows: rows.filter((row) => selected.has(rowKey(row))),
    pageSelection: selectionOf(pageKeys, selected),
    selectedOnPage: pageKeys.filter((key) => selected.has(key)).length,
    toggleRow: (key: string) => setChosen(toggledOne(selected, key)),
    togglePage: () => setChosen(toggledAll(pageKeys, selected)),
    clearSelection: () => setChosen(new Set()),
  }
}

export type DataTableState<Row> = ReturnType<typeof useDataTable<Row>>
