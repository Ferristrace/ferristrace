import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Pager } from '@/components/ui/pager'
import { SortTh, Table, Td, Th, Tr } from '@/components/ui/misc'
import type { Pricing, Signal } from '@/data/usage'
import { pagesOf } from '@/lib/paging'
import { sorted } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import { useSortState } from '../useSortState'
import { SIGNAL_COLOUR } from './colours'
import { signed } from './money'
import { ALL, DAY, LABEL, dayLabel, figureText, volumeText, type Row } from './shape'

type Key = 'name' | Signal | 'figure' | 'change'

function PerDay({ days, from, format, name }: { days: number[]; from: number; format: (value: number) => string; name: string }) {
  const peak = Math.max(0, ...days)
  return (
    <div className="flex h-5 w-[120px] items-end gap-px" role="img" aria-label={`${name}, ${days.length} days, busiest ${format(peak)}`}>
      {days.map((value, index) => (
        <span key={index} title={`${dayLabel(from + index * DAY)}: ${format(value)}`} className="min-w-px flex-1 rounded-t-[1px]" style={{ height: `${Math.max(value === 0 ? 4 : 10, peak > 0 ? (value / peak) * 100 : 0)}%`, background: value === 0 ? 'var(--border)' : SIGNAL_COLOUR.spans }} />
      ))}
    </div>
  )
}

export function ProjectTable({ rows, pricing, signal, onSignal, from, since, noun }: {
  rows: Row[]
  pricing: Pricing | null
  signal: Signal | typeof ALL
  onSignal: (signal: Signal | typeof ALL) => void
  from: number
  since: string
  noun: string
}) {
  const [query, setQuery] = useState('')
  const [size, setSize] = useState(10)
  const [page, setPage] = useState(1)
  const { sorting, dir, on } = useSortState<Key>({ key: 'figure', dir: 'desc' })
  const shownRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const found = needle === '' ? rows : rows.filter((row) => row.name.toLowerCase().includes(needle))
    return sorted(found, sorting, (row, key) => (key === 'name' ? row.name : key === 'figure' ? row.figure : key === 'change' ? row.change : row.volumes[key]))
  }, [rows, query, sorting])
  const at = Math.min(page, pagesOf(shownRows.length, size))
  const format = (value: number) => figureText(pricing, signal, value)
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>{noun} by project</CardTitle><CardKind>Table</CardKind></CardHeader>
      <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-3">
        <InputGroup className="w-full md:w-[280px]">
          <Search aria-hidden />
          <input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
        </InputGroup>
        <NativeSelect aria-label="Signal" value={signal} onChange={(event) => { onSignal(event.target.value as Signal | typeof ALL); setPage(1) }} className="w-auto min-w-[140px]">
          <option value={ALL}>Signal: all</option>
          {(['spans', 'logs', 'metrics'] as const).map((one) => <option key={one} value={one}>Signal: {LABEL[one].toLowerCase()}</option>)}
        </NativeSelect>
      </div>
      <div className="overflow-x-auto">
        <Table aria-label={`${noun} by project`} className="min-w-[760px]">
          <thead>
            <tr>
              <SortTh label="Project" dir={dir('name')} onSort={on('name', 'asc')} />
              {(['spans', 'logs', 'metrics'] as const).map((one) => <SortTh key={one} numeric label={LABEL[one]} dir={dir(one)} onSort={on(one, 'desc')} />)}
              <SortTh numeric label={pricing ? 'Usage value' : 'Ingested'} dir={dir('figure')} onSort={on('figure', 'desc')} />
              <Th numeric>Per day</Th>
              <SortTh numeric label={`vs ${since}`} dir={dir('change')} onSort={on('change', 'desc')} />
            </tr>
          </thead>
          <tbody>
            {shownRows.slice((at - 1) * size, at * size).map((row) => (
              <Tr key={row.key}>
                <Td className="font-semibold">{row.name}</Td>
                {(['spans', 'logs', 'metrics'] as const).map((one) => <Td key={one} numeric>{volumeText(one, row.volumes[one])}</Td>)}
                <Td numeric>{format(row.figure)}</Td>
                <Td><div className="ml-auto w-[120px]"><PerDay days={row.days} from={from} format={format} name={`${row.name} per day`} /></div></Td>
                <Td numeric className={cn(row.change === null ? 'text-muted-foreground' : row.change > 0 ? 'text-destructive-text' : row.change < 0 ? 'text-success-text' : '')}>{row.change === null ? '—' : signed(row.change)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      {rows.length === 0 ? <p className="m-0 border-t px-4 py-3 text-control text-muted-foreground">No project carried volume this month, or the server does not split usage per project yet.</p> : null}
      <Pager total={shownRows.length} page={at} size={size} onPage={setPage} onSize={(next) => { setSize(next); setPage(1) }} noun="projects" className="border-t" />
    </Card>
  )
}
