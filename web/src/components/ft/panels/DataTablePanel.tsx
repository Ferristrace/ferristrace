import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Table, Td, Th, Tr } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import { Filled, PanelEmpty } from './Empty'
import { durationColumns, durationText, formatValue, isNumericColumn, sortRows } from './geometry'
import { isEmpty } from './result'
import type { Of, PanelProps } from './types'

type Sort = { column: number; direction: 'asc' | 'desc' } | null

export function DataTablePanel({ panel, result }: PanelProps<Of<'rows'>>) {
  const [sort, setSort] = useState<Sort>(null)
  const numeric = useMemo(() => result.columns.map((_, index) => isNumericColumn(result.rows, index)), [result])
  const durations = useMemo(() => durationColumns(panel.queries[0], result.columns), [panel.queries, result.columns])
  const rows = useMemo(() => (sort ? sortRows(result.rows, sort.column, sort.direction) : result.rows), [result, sort])
  if (isEmpty(result)) return <PanelEmpty />
  const toggle = (column: number) =>
    setSort((current) => {
      const first = numeric[column] ? 'desc' : 'asc'
      if (current?.column !== column) return { column, direction: first }
      return current.direction === first ? { column, direction: first === 'asc' ? 'desc' : 'asc' } : null
    })
  return (
    <Filled className="gap-1.5">
      <div className="min-h-0 flex-1 overflow-auto">
        <Table aria-label={panel.title || 'Table'}>
          <thead>
            <tr>
              {result.columns.map((column, index) => {
                const on = sort?.column === index ? sort.direction : null
                return (
                  <Th key={`${index}-${column}`} numeric={numeric[index]} aria-sort={on === 'asc' ? 'ascending' : on === 'desc' ? 'descending' : 'none'} className="px-2">
                    <button type="button" onClick={() => toggle(index)} className={cn('inline-flex cursor-pointer items-center gap-1 font-semibold hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring', numeric[index] && 'flex-row-reverse')}>
                      {column}
                      {on === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : on === 'desc' ? <ArrowDown className="size-3" aria-hidden /> : null}
                    </button>
                  </Th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, at) => (
              <Tr key={at}>
                {result.columns.map((column, index) => {
                  const cell = row[index] ?? null
                  return (
                    <Td key={`${index}-${column}`} numeric={numeric[index]} className={cn('px-2', !numeric[index] && 'max-w-[320px] truncate')}>
                      {cell === null ? <span className="text-faint-foreground">none</span> : typeof cell === 'number' ? (durations[index] ? durationText(cell) : formatValue(cell, '', panel.options.decimals)) : String(cell)}
                    </Td>
                  )
                })}
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      {result.truncated ? (
        <p role="status" className="m-0 rounded-sm bg-warning-subtle px-2 py-1 text-caption text-warning-text">
          Showing the first {rows.length.toLocaleString('en-US')} rows; the query matched more. Filter it down or lower the limit to see the rest.
        </p>
      ) : null}
    </Filled>
  )
}
