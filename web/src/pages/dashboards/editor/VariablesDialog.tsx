import { Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Alert } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import type { DashboardDoc, QuerySignal, VariableDoc } from '@/data/dashboards'
import { KeyInput } from './ColumnPicker'
import { LIMITS } from './kinds'
import { deleteVariable, newVariable, parseValues, reconcileIds, renameVariableIn, validateVariableName, variableIssues, variableUsage } from './variablesEdit'

function NameField({ variable, others, onRename }: { variable: VariableDoc; others: string[]; onRename: (name: string) => void }) {
  const [text, setText] = useState(variable.name)
  const error = validateVariableName(text, others)
  return (
    <Field label="Name" hint={error ?? 'Used as $name in a filter. Lowercase letters, digits and _.'}>
      <Input
        mono
        aria-label="Variable name"
        aria-invalid={error ? true : undefined}
        value={text}
        maxLength={64}
        onChange={(event) => {
          setText(event.target.value)
          if (validateVariableName(event.target.value, others) === null && event.target.value !== variable.name) onRename(event.target.value)
        }}
        onBlur={() => {
          if (error) setText(variable.name)
        }}
      />
    </Field>
  )
}

function ValuesField({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join('\n'))
  return (
    <Field label="Values" hint="One per line, up to 100.">
      <Textarea aria-label="Static values" rows={4} value={text} onChange={(event) => { setText(event.target.value); onChange(parseValues(event.target.value)) }} className="font-mono text-[12.5px]" />
    </Field>
  )
}

function VariableCard({ doc, at, onChange }: { doc: DashboardDoc; at: number; onChange: (doc: DashboardDoc) => void }) {
  const variable = doc.variables[at]
  const others = doc.variables.filter((_, index) => index !== at).map((one) => one.name)
  const used = variableUsage(doc, variable.name)
  const [asking, setAsking] = useState(false)
  const set = (change: Partial<VariableDoc>) => onChange({ ...doc, variables: doc.variables.map((one, index) => (index === at ? { ...one, ...change } : one)) })
  const issues = variableIssues(variable, others).filter((issue) => !issue.startsWith('A variable name') && !issue.includes('reserved') && !issue.includes('already named') && issue !== 'A variable needs a name.')
  const source = variable.source

  return (
    <section aria-label={`Variable ${variable.name}`} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <NameField variable={variable} others={others} onRename={(name) => onChange(renameVariableIn(doc, variable.name, name))} />
        <Field label="Label" hint="Shown above the picker. Blank uses the name.">
          <Input aria-label="Variable label" value={variable.label} onChange={(event) => set({ label: event.target.value })} />
        </Field>
      </div>
      <Field label="Values come from">
        <div>
          <Segmented<'attribute' | 'static'>
            label="Source"
            value={source.kind}
            onChange={(kind) => set({ source: kind === 'attribute' ? { kind: 'attribute', signal: 'traces', key: '' } : { kind: 'static', values: [] } })}
            options={[{ value: 'attribute', label: 'An attribute' }, { value: 'static', label: 'A fixed list' }]}
          />
        </div>
      </Field>
      {source.kind === 'attribute' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <NativeSelect aria-label="Signal" value={source.signal} onChange={(event) => set({ source: { ...source, signal: event.target.value as QuerySignal } })} className="w-[120px]">
            <option value="traces">Traces</option>
            <option value="logs">Logs</option>
            <option value="metrics">Metrics</option>
          </NativeSelect>
          <KeyInput value={source.key} onChange={(key) => set({ source: { ...source, key } })} signal={source.signal} metric="" label="Attribute key" className="w-[240px]" />
        </div>
      ) : (
        <ValuesField values={source.values} onChange={(values) => set({ source: { kind: 'static', values } })} />
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Switch label="Several values at once" checked={variable.multi} onCheckedChange={(multi) => set({ multi })} />
        <Switch label="Offer an All choice" checked={variable.all} onCheckedChange={(all) => set({ all })} />
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => (used.length > 0 ? setAsking(true) : onChange(deleteVariable(doc, variable.name)))}><Trash2 aria-hidden />Delete</Button>
      </div>
      {issues.length > 0 ? <ul role="status" aria-label="Problems with this variable" className="m-0 flex list-none flex-col gap-1 rounded-md bg-warning-subtle p-2 text-caption text-warning-text">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      {asking ? (
        <Alert variant="warning" icon={<TriangleAlert aria-hidden />} title={`${variable.name} is used by ${used.length} panel${used.length === 1 ? '' : 's'}`}>
          <span>{used.map((panel) => panel.title || panel.id).join(', ')}. Deleting it removes the filter conditions that use it.</span>
          <span className="mt-2 flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => onChange(deleteVariable(doc, variable.name))}>Delete and remove those conditions</Button>
            <Button size="sm" onClick={() => setAsking(false)}>Keep it</Button>
          </span>
        </Alert>
      ) : null}
    </section>
  )
}

export function VariablesDialog({ open, onOpenChange, doc, onChange: emit }: { open: boolean; onOpenChange: (open: boolean) => void; doc: DashboardDoc; onChange: (doc: DashboardDoc) => void }) {
  const counter = useRef(0)
  const make = () => `v${(counter.current += 1)}`
  const [ids, setIds] = useState<string[]>(() => doc.variables.map(make))
  const onChange = (next: DashboardDoc) => {
    setIds(reconcileIds(ids, doc.variables, next.variables, make))
    emit(next)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Variables" description="A variable is a list of values a viewer picks from, and a panel filter can use as $name.">
        <div className="flex flex-col gap-3">
          {doc.variables.length === 0 ? <p className="m-0 text-control text-muted-foreground">This dashboard has no variables yet.</p> : null}
          {doc.variables.map((_, at) => <VariableCard key={ids[at] ?? at} doc={doc} at={at} onChange={onChange} />)}
        </div>
        <DialogFooter>
          <Button disabled={doc.variables.length >= LIMITS.variables} title={doc.variables.length >= LIMITS.variables ? `A dashboard holds at most ${LIMITS.variables} variables.` : undefined} onClick={() => onChange({ ...doc, variables: [...doc.variables, newVariable(doc.variables)] })}><Plus aria-hidden />Add a variable</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
