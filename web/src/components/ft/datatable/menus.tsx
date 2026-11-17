import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { filterValue, valueCounts, type Filter, type NumberFilterDef, type NumberOp, type SelectionState, type ValuesFilterDef } from './model'
import type { Column } from './useDataTable'

export const MENU = 'w-[260px] max-w-[calc(100vw-24px)] p-2'

export const MenuTitle = ({ children }: { children: React.ReactNode }) => <div className="px-1 pt-0.5 pb-1.5 text-[11px] font-semibold text-faint-foreground">{children}</div>

export function Check({ state, onChange, label, className }: { state: SelectionState | boolean; onChange: () => void; label: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const some = state === 'some'
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some
  }, [some])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === true || state === 'all'}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
      className={cn('size-3.5 shrink-0 cursor-pointer rounded-sm align-middle accent-[var(--color-primary)]', className)}
    />
  )
}

function Footer({ onClear, onApply, clear = 'Clear', apply = 'Apply' }: { onClear: () => void; onApply: () => void; clear?: string; apply?: string }) {
  return (
    <div className="mt-1.5 flex gap-2 border-t pt-2">
      <Button size="sm" className="h-[30px] flex-1" onClick={onClear}>{clear}</Button>
      <Button size="sm" variant="primary" className="h-[30px] flex-1" onClick={onApply}>{apply}</Button>
    </div>
  )
}

export function ValuesMenu<Row>({ column, def, rows, current, onApply }: { column: Column<Row>; def: ValuesFilterDef<Row>; rows: readonly Row[]; current: Filter | undefined; onApply: (filter: Filter | null) => void }) {
  const counts = useMemo(() => valueCounts(rows, def), [rows, def])
  const [find, setFind] = useState('')
  const [picked, setPicked] = useState<string[]>(current?.kind === 'values' ? current.values : [])
  const shown = counts.filter((one) => one.value.toLowerCase().includes(find.trim().toLowerCase()))
  const noun = def.noun ?? `${column.header.toLowerCase()} values`
  return (
    <div>
      <MenuTitle>{column.header}</MenuTitle>
      <InputGroup className="mb-1.5 h-[30px]"><Search aria-hidden /><input aria-label={`Search ${noun}`} placeholder={`Search ${noun}`} value={find} onChange={(event) => setFind(event.target.value)} /></InputGroup>
      <div className="max-h-[240px] overflow-y-auto">
        {shown.length === 0 ? <p className="m-0 px-1.5 py-2 text-caption text-muted-foreground">No {noun} in the loaded rows.</p> : null}
        {shown.map((one) => (
          <label key={one.value} className="flex h-[30px] cursor-pointer items-center gap-2.5 rounded-sm px-1.5 text-control hover:bg-muted">
            <Check state={picked.includes(one.value)} label={one.value} onChange={() => setPicked((was) => (was.includes(one.value) ? was.filter((v) => v !== one.value) : [...was, one.value]))} />
            <span className="min-w-0 flex-1 truncate">{one.value}</span>
            <span className="font-mono text-[12px] text-faint-foreground">{one.count.toLocaleString('en-US')}</span>
          </label>
        ))}
      </div>
      <Footer onClear={() => onApply(null)} onApply={() => onApply(picked.length === 0 ? null : { column: column.id, kind: 'values', values: picked })} />
    </div>
  )
}

export function NumberMenu<Row>({ column, def, current, onApply }: { column: Column<Row>; def: NumberFilterDef<Row>; current: Filter | undefined; onApply: (filter: Filter | null) => void }) {
  const [op, setOp] = useState<NumberOp>(current?.kind === 'number' ? current.op : 'above')
  const [typed, setTyped] = useState(current?.kind === 'number' ? String(current.value) : '')
  const value = Number(typed)
  const valid = typed.trim() !== '' && Number.isFinite(value)
  return (
    <div className="flex flex-col gap-2">
      <MenuTitle>{column.header}</MenuTitle>
      <div className="flex gap-2">
        <NativeSelect aria-label={`${column.header} comparison`} value={op} onChange={(event) => setOp(event.target.value === 'below' ? 'below' : 'above')} className="h-[34px] w-[94px] shrink-0">
          <option value="above">Is above</option>
          <option value="below">Is below</option>
        </NativeSelect>
        <InputGroup className="h-[34px]">
          <input aria-label={`${column.header} in ${def.unit}`} inputMode="decimal" value={typed} onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && valid) onApply({ column: column.id, kind: 'number', op, value }) }} />
          <span className="text-caption text-faint-foreground">{def.unit}</span>
        </InputGroup>
      </div>
      <div className="flex flex-wrap gap-1">
        {def.presets.map((preset) => (
          <button key={preset} type="button" onClick={() => setTyped(String(preset))} className={cn('h-[26px] cursor-pointer rounded-sm px-2 text-caption font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', typed === String(preset) && 'bg-muted')}>{filterValue(def, preset)}</button>
        ))}
      </div>
      <Footer onClear={() => onApply(null)} onApply={() => onApply(valid ? { column: column.id, kind: 'number', op, value } : null)} />
    </div>
  )
}

export function FilterMenu<Row>({ column, rows, current, onApply }: { column: Column<Row>; rows: readonly Row[]; current: Filter | undefined; onApply: (filter: Filter | null) => void }) {
  const def = column.filter
  if (!def) return null
  return def.kind === 'values'
    ? <ValuesMenu column={column} def={def} rows={rows} current={current} onApply={onApply} />
    : <NumberMenu column={column} def={def} current={current} onApply={onApply} />
}

export function ColumnsMenu<Row>({ columns, visible, onToggle, onReset, onDone }: { columns: readonly Column<Row>[]; visible: readonly string[]; onToggle: (id: string, on: boolean) => void; onReset: () => void; onDone: () => void }) {
  return (
    <div>
      <MenuTitle>Columns</MenuTitle>
      {columns.map((column) => {
        const fixed = column.hideable === false
        const on = fixed || visible.includes(column.id)
        return (
          <label key={column.id} className={cn('flex h-[30px] items-center gap-2.5 rounded-sm px-1.5 text-control hover:bg-muted', fixed ? 'cursor-default text-muted-foreground' : 'cursor-pointer')}>
            <input type="checkbox" checked={on} disabled={fixed} onChange={(event) => onToggle(column.id, event.target.checked)} className="size-3.5 shrink-0 cursor-pointer accent-[var(--color-primary)] disabled:cursor-default" />
            <span className="truncate">{column.header}</span>
          </label>
        )
      })}
      <Footer clear="Reset" apply="Done" onClear={onReset} onApply={onDone} />
    </div>
  )
}
