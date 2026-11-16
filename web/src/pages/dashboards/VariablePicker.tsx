import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { useAttributeValues } from '@/data/attributes'
import type { VariableDoc } from '@/data/dashboards'
import { MetricProvider, SignalProvider } from '@/lib/signal'
import type { Choice } from './variables'

const SEARCHABLE = 10

export function VariablePicker({ variable, choice, rangeMs, metric, onChange }: {
  variable: VariableDoc
  choice: Choice
  rangeMs: number
  metric: string
  onChange: (choice: Choice) => void
}) {
  const signal = variable.source.kind === 'attribute' ? variable.source.signal : 'traces'
  return (
    <SignalProvider value={signal}>
      <MetricProvider value={metric}>
        <Picker variable={variable} choice={choice} rangeMs={rangeMs} onChange={onChange} />
      </MetricProvider>
    </SignalProvider>
  )
}

function Picker({ variable, choice, rangeMs, onChange }: { variable: VariableDoc; choice: Choice; rangeMs: number; onChange: (choice: Choice) => void }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const seen = useAttributeValues(variable.source.kind === 'attribute' ? variable.source.key : undefined, rangeMs, '')
  const chosen = 'values' in choice ? choice.values : []
  const listed = variable.source.kind === 'static' ? variable.source.values : seen.values.map((one) => one.value)
  const options = [...new Set([...chosen, ...listed])]
  const shown = options.filter((one) => one.toLowerCase().includes(typed.trim().toLowerCase()))
  const label = variable.label || variable.name
  const summary = 'all' in choice ? 'All' : chosen.length === 0 ? 'None' : chosen.length === 1 ? chosen[0] : `${chosen[0]} +${chosen.length - 1}`

  const pick = (value: string, on: boolean) => {
    if (!variable.multi) return onChange({ values: [value] })
    const next = on ? [...chosen, value] : chosen.filter((one) => one !== value)
    onChange(next.length === 0 && variable.all ? { all: true } : { values: next })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button aria-label={`${label}: ${summary}`} className="max-w-[260px] bg-card font-normal">
          <span className="text-muted-foreground">{label}:</span>
          <span className="truncate">{summary}</span>
          <ChevronDown className="text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-1">
        {options.length > SEARCHABLE ? <Input aria-label={`Search ${label}`} placeholder="Search" value={typed} onChange={(event) => setTyped(event.target.value)} className="mb-1 h-7" /> : null}
        <fieldset className="m-0 flex max-h-[280px] flex-col overflow-auto border-0 p-0">
          <legend className="sr-only">{label}</legend>
          {variable.all ? (
            <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-control hover:bg-muted">
              <input type={variable.multi ? 'checkbox' : 'radio'} name={variable.name} checked={'all' in choice} onChange={() => onChange({ all: true })} />
              All
            </label>
          ) : null}
          {shown.map((value) => {
            const on = chosen.includes(value)
            return (
              <label key={value} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-control hover:bg-muted">
                <input type={variable.multi ? 'checkbox' : 'radio'} name={variable.name} checked={on} onChange={(event) => pick(value, event.target.checked)} />
                <span className="truncate font-mono text-[12px]">{value}</span>
              </label>
            )
          })}
          {shown.length === 0 && !variable.all ? <span className="px-2 py-1.5 text-caption text-muted-foreground">{seen.loading ? 'Reading values…' : 'No values seen in this range.'}</span> : null}
        </fieldset>
      </PopoverContent>
    </Popover>
  )
}
