import { useId } from 'react'
import { Input, NativeSelect } from '@/components/ui/input'
import type { BuiltIn, Column, QuerySignal } from '@/data/dashboards'
import { useKeySuggestions } from '@/data/dashboardCatalogue'
import { BUILT_INS, BUILT_IN_LABEL, NUMERIC } from './kinds'
import { useEditorEnv } from './env'

const ATTRIBUTE = '@attribute'

export function KeyInput({ value, onChange, signal, metric, label, placeholder = 'attribute key', className }: { value: string; onChange: (value: string) => void; signal: QuerySignal; metric: string; label: string; placeholder?: string; className?: string }) {
  const { fixture } = useEditorEnv()
  const keys = useKeySuggestions(signal, metric, fixture)
  const list = useId()
  return (
    <>
      <Input mono aria-label={label} placeholder={placeholder} list={list} value={value} onChange={(event) => onChange(event.target.value)} className={className} />
      <datalist id={list}>{keys.slice(0, 200).map((key) => <option key={key} value={key} />)}</datalist>
    </>
  )
}

export function ColumnPicker({ value, onChange, signal, metric = '', label, numericOnly = false, className }: { value: Column | null; onChange: (column: Column) => void; signal: QuerySignal; metric?: string; label: string; numericOnly?: boolean; className?: string }) {
  const builtIns: BuiltIn[] = BUILT_INS[signal].filter((one) => !numericOnly || NUMERIC.includes(one))
  const current = value === null ? '' : 'attr' in value ? ATTRIBUTE : value.field
  const known = value !== null && 'field' in value && !builtIns.includes(value.field)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <NativeSelect
        aria-label={label}
        value={current}
        onChange={(event) => {
          const next = event.target.value
          if (next === ATTRIBUTE) onChange({ attr: value !== null && 'attr' in value ? value.attr : '' })
          else if (next !== '') onChange({ field: next as BuiltIn })
        }}
        className={className ?? 'w-[160px]'}
      >
        {value === null ? <option value="">Choose a field</option> : null}
        {known ? <option value={current}>{BUILT_IN_LABEL[(value as { field: BuiltIn }).field]}</option> : null}
        {builtIns.length > 0 ? (
          <optgroup label="Fields">
            {builtIns.map((one) => <option key={one} value={one}>{BUILT_IN_LABEL[one]}</option>)}
          </optgroup>
        ) : null}
        <optgroup label="Attributes">
          <option value={ATTRIBUTE}>Attribute…</option>
        </optgroup>
      </NativeSelect>
      {value !== null && 'attr' in value ? <KeyInput value={value.attr} onChange={(attr) => onChange({ attr })} signal={signal} metric={metric} label={`${label} attribute key`} className="w-[190px]" /> : null}
    </span>
  )
}
