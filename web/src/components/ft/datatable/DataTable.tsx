import { useState, type ReactNode } from 'react'
import { ChevronLeft, Funnel, Search, X, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Skeleton, Table, Td, Th } from '@/components/ui/misc'
import { Pager } from '@/components/ui/pager'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { csvOf, filterLabel, type Filter } from './model'
import { downloadCsv } from './download'
import { Check, ColumnsMenu, FilterMenu, MENU, MenuTitle } from './menus'
import type { Column, DataTableState } from './useDataTable'

const SIZES = [10, 25, 50, 100]

const TOOL = 'h-[34px]'

function SortGlyph({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <span aria-hidden className={cn('inline-flex flex-col gap-px text-faint-foreground opacity-0 transition-opacity group-hover/th:opacity-100', dir && 'text-accent-text opacity-100')}>
      <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 5L4 0l4 5z" fill="currentColor" opacity={dir === 'asc' ? 1 : dir ? 0.3 : 0.6} /></svg>
      <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0l4 5 4-5z" fill="currentColor" opacity={dir === 'desc' ? 1 : dir ? 0.3 : 0.6} /></svg>
    </span>
  )
}

export function FilterChip({ field, text, onRemove }: { field: string; text: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-card pr-1.5 pl-2.5 text-caption">
      <b className="font-medium text-muted-foreground">{field}</b>
      <span className="min-w-0 truncate text-foreground">{text}</span>
      <button type="button" aria-label={`Remove the ${field} filter`} onClick={onRemove} className="inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full text-faint-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3"><X aria-hidden /></button>
    </span>
  )
}

function Chips<Row>({ table, center }: { table: DataTableState<Row>; center?: boolean }) {
  const byId = new Map(table.columns.map((column) => [column.id, column]))
  if (table.filters.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-2', center && 'justify-center')}>
      {table.filters.map((filter) => {
        const label = filterLabel(filter, byId.get(filter.column))
        return <FilterChip key={filter.column} field={label.field} text={label.text} onRemove={() => table.removeFilter(filter.column)} />
      })}
      {center ? null : <button type="button" onClick={table.clearFilters} className="cursor-pointer px-1 text-caption text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">Clear all</button>}
    </div>
  )
}

function apply<Row>(table: DataTableState<Row>, column: string, next: Filter | null) {
  if (next) table.setFilter(next)
  else table.removeFilter(column)
}

function HeadFilter<Row>({ table, column }: { table: DataTableState<Row>; column: Column<Row> }) {
  const [open, setOpen] = useState(false)
  const current = table.filters.find((filter) => filter.column === column.id)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter ${column.header}${current ? ' (active)' : ''}`}
          className={cn('relative inline-flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm text-faint-foreground opacity-0 group-hover/th:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted data-[state=open]:opacity-100 max-md:opacity-100 [&_svg]:size-[13px]', current && 'text-accent-text opacity-100')}
        >
          <Funnel aria-hidden />
          {current ? <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU}>
        <FilterMenu column={column} rows={table.rows} current={current} onApply={(next) => { apply(table, column.id, next); setOpen(false) }} />
      </PopoverContent>
    </Popover>
  )
}

function Head<Row>({ table, column }: { table: DataTableState<Row>; column: Column<Row> }) {
  const dir = column.sort && table.sorting?.key === column.id ? table.sorting.dir : null
  return (
    <Th numeric={column.numeric} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : column.sort ? 'none' : undefined} className={cn('group/th h-11 bg-card', column.headClassName)}>
      <span className={cn('inline-flex h-[22px] items-center gap-1.5 align-middle', column.numeric && 'flex-row-reverse')}>
        {column.tag && column.numeric ? <span className="font-mono text-[11px] font-normal text-faint-foreground">{column.tag}</span> : null}
        {column.sort ? (
          <button type="button" onClick={() => table.sortBy(column)} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-transparent p-0 font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring', column.numeric && 'flex-row-reverse')}>
            {column.header}<SortGlyph dir={dir} />
          </button>
        ) : column.header}
        {column.tag && !column.numeric ? <span className="font-mono text-[11px] font-normal text-faint-foreground">{column.tag}</span> : null}
        {column.filter ? <HeadFilter table={table} column={column} /> : null}
      </span>
    </Th>
  )
}

function AddFilter<Row>({ table }: { table: DataTableState<Row> }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const filterable = table.columns.filter((column) => column.filter)
  const column = filterable.find((one) => one.id === picked)
  if (filterable.length === 0) return null
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setPicked(null) }}>
      <PopoverTrigger asChild>
        <Button className={TOOL}><Funnel aria-hidden />Add filter</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU}>
        {column ? (
          <>
            <button type="button" onClick={() => setPicked(null)} className="mb-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 text-caption text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3"><ChevronLeft aria-hidden />All fields</button>
            <FilterMenu column={column} rows={table.rows} current={table.filters.find((filter) => filter.column === column.id)} onApply={(next) => { apply(table, column.id, next); setOpen(false); setPicked(null) }} />
          </>
        ) : (
          <div role="menu" aria-label="Filter on">
            <MenuTitle>Filter on</MenuTitle>
            {filterable.map((one) => (
              <button key={one.id} type="button" role="menuitem" onClick={() => setPicked(one.id)} className="flex h-[30px] w-full cursor-pointer items-center rounded-sm px-1.5 text-left text-control hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                {one.header}
                {table.filters.some((filter) => filter.column === one.id) ? <span aria-label="active" className="ml-auto size-1.5 rounded-full bg-primary" /> : null}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Columns<Row>({ table }: { table: DataTableState<Row> }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button className={TOOL}>Columns</Button></PopoverTrigger>
      <PopoverContent align="end" className={MENU}>
        <ColumnsMenu columns={table.columns} visible={table.visible} onToggle={table.toggleColumn} onReset={table.resetColumns} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

export function SkeletonBody({ columns, rows = 6, selectable }: { columns: number; rows?: number; selectable?: boolean }) {
  const widths = ['w-[120px]', 'w-[156px]', 'w-[134px]', 'w-[170px]', 'w-[148px]', 'w-[124px]']
  return (
    <tbody aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          {selectable ? <Td className="w-9" /> : null}
          {Array.from({ length: columns }, (_, cell) => (
            <Td key={cell} className="h-[45px]"><Skeleton className={cell === 0 ? widths[row % widths.length] : cell === 1 ? 'w-[110px]' : 'w-[50px]'} /></Td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export type DataTableProps<Row> = {
  table: DataTableState<Row>
  label: string
  noun: string
  searchLabel?: string
  toolbar?: ReactNode
  actions?: ReactNode
  exportName?: string
  selectable?: boolean
  bulk?: (rows: Row[]) => ReactNode
  loading?: boolean
  error?: ReactNode
  empty?: ReactNode
  note?: ReactNode
  footnote?: ReactNode
  sizes?: number[]
  onRowClick?: (row: Row) => void
  activeKey?: string
  rowClassName?: (row: Row) => string | undefined
}

export function DataTable<Row>({ table, label, noun, searchLabel = 'Search in results', toolbar, actions, exportName, selectable, bulk, loading, error, empty, note, footnote, sizes = SIZES, onRowClick, activeKey, rowClassName }: DataTableProps<Row>) {
  const shown = table.shown
  const reading = Boolean(loading) && table.rows.length === 0 && !error
  const nothing = !reading && !error && table.rows.length === 0
  const filteredOut = !reading && !error && table.rows.length > 0 && table.view.length === 0
  const exportRows = (rows: readonly Row[], suffix = '') => exportName && downloadCsv(`${exportName}${suffix}`, csvOf(rows, shown))
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5" role="search">
        <InputGroup className={cn(TOOL, 'w-[320px] max-w-full max-md:w-full max-md:flex-[1_1_100%]')}>
          <Search aria-hidden />
          <input aria-label={searchLabel} placeholder={searchLabel} value={table.search} onChange={(event) => table.setSearch(event.target.value)} />
        </InputGroup>
        <AddFilter table={table} />
        {toolbar}
        <span className="flex-1" />
        {actions}
        <Columns table={table} />
        {exportName ? <Button className={TOOL} disabled={table.view.length === 0} onClick={() => exportRows(table.view)}>Export CSV</Button> : null}
      </div>
      <Chips table={table} />
      {error ? error : nothing && empty ? empty : (
        <section aria-label={label} className="min-w-0 overflow-hidden rounded-md border bg-card">
          {selectable && table.selected.size > 0 ? (
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-accent-subtle px-3.5 py-2">
              <span className="text-control"><b className="font-semibold">{table.selected.size} selected</b><span className="ml-2 text-muted-foreground">{table.selectedOnPage === table.selected.size ? 'on this page' : `${table.selectedOnPage} on this page`}</span></span>
              <span className="flex-1" />
              {bulk ? bulk(table.selectedRows) : null}
              {exportName ? <Button className={TOOL} onClick={() => exportRows(table.selectedRows, '-selected')}>Export</Button> : null}
              <Button className={TOOL} onClick={table.clearSelection}>Clear selection</Button>
            </div>
          ) : null}
          {filteredOut ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <ZoomOut className="size-6 text-muted-foreground" aria-hidden />
              <h3 className="text-[14px] font-semibold">No {noun} match these filters</h3>
              <p className="m-0 max-w-[300px] text-control text-muted-foreground">Try another search or remove a filter. {table.rows.length.toLocaleString('en-US')} {noun} are loaded.</p>
              <Chips table={table} center />
              <Button className={cn(TOOL, 'mt-1')} onClick={table.clearFilters}>Clear all filters</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label={label} aria-busy={reading || undefined} className="max-md:min-w-[540px]">
                <thead>
                  <tr>
                    {selectable ? <Th className="h-11 w-9 bg-card pr-0">{reading ? null : <Check state={table.pageSelection} label={`Select every ${noun.replace(/s$/, '')} on this page`} onChange={table.togglePage} />}</Th> : null}
                    {shown.map((column) => <Head key={column.id} table={table} column={column} />)}
                  </tr>
                </thead>
                {reading ? <SkeletonBody columns={shown.length} selectable={selectable} /> : (
                  <tbody>
                    {table.pageRows.map((row) => {
                      const key = table.rowKey(row)
                      const on = table.selected.has(key)
                      return (
                        <tr
                          key={key}
                          onClick={onRowClick ? () => onRowClick(row) : undefined}
                          className={cn('hover:[&>td]:bg-row-hover', onRowClick && 'cursor-pointer', on && '[&>td]:bg-accent-subtle', key === activeKey && '[&>td]:bg-accent-subtle', rowClassName?.(row))}
                        >
                          {selectable ? <Td className="h-[45px] w-9 pr-0"><Check state={on} label={`Select ${key}`} onChange={() => table.toggleRow(key)} /></Td> : null}
                          {shown.map((column) => <Td key={column.id} numeric={column.numeric} className={cn('h-[45px]', column.numeric && 'font-sans', column.className)}>{column.cell(row)}</Td>)}
                        </tr>
                      )
                    })}
                  </tbody>
                )}
              </Table>
            </div>
          )}
          {reading ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3.5 py-2.5 text-control text-muted-foreground" role="status">
              <span>Loading…</span>
              <span className="flex-1" />
              <label className="flex items-center gap-2">Rows per page
                <NativeSelect value={table.size} onChange={(event) => table.setSize(Number(event.target.value))} className="h-[30px] w-auto">{sizes.map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect>
              </label>
            </div>
          ) : table.view.length > 0 ? (
            <Pager spread className="border-t" total={table.view.length} page={table.page} size={table.size} sizes={sizes} onPage={table.setPage} onSize={table.setSize} noun="" note={note} />
          ) : null}
        </section>
      )}
      {footnote ? <p className="m-0 text-caption text-muted-foreground">{footnote}</p> : null}
    </div>
  )
}
