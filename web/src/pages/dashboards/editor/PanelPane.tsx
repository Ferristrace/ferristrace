import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Mark, Range } from '@/components/ft/panels/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import type { Legend, PanelDoc, PanelKind, Source } from '@/data/dashboards'
import { useSettled } from '@/lib/settle'
import { PanelCard } from '../PanelCard'
import { QueriesSection } from './QueryBuilder'
import { KIND_GROUPS, KIND_INFO, LIMITS, points, changeKind, kindChangeNotes, optionSupport, panelIssues, queryIssues } from './kinds'

const NO_MARKS: Mark[] = []

const NO_ZOOM = () => undefined

const LEGENDS: { value: Legend; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'right', label: 'Right' },
  { value: 'hidden', label: 'Hidden' },
]

export function PanelPane({ initial, fresh, range, sent, source, onApply, onCancel }: { initial: PanelDoc; fresh: boolean; range: Range; sent: Record<string, string[]>; source: Source; onApply: (panel: PanelDoc) => void; onCancel: () => void }) {
  const [work, setWork] = useState<PanelDoc>(initial)
  const [notes, setNotes] = useState<string[]>([])
  const support = optionSupport(work.kind)
  const issues = useMemo(() => panelIssues(work), [work])
  const settledQueries = useSettled(work.queries, 500)
  const previewIssues = useMemo(() => (work.kind === 'text' ? [] : settledQueries.flatMap((query) => queryIssues(work.kind, query))), [settledQueries, work.kind])
  const preview = useMemo<PanelDoc>(() => ({ ...work, queries: previewIssues.length > 0 ? [] : settledQueries }), [work, settledQueries, previewIssues])
  const set = (change: Partial<PanelDoc>) => setWork((was) => ({ ...was, ...change }))
  const setOptions = (change: Partial<PanelDoc['options']>) => setWork((was) => ({ ...was, options: { ...was.options, ...change } }))
  const noOptions = !support.unit && !support.legend && !support.stacked && !support.content && !support.centre
  const contentBytes = new TextEncoder().encode(work.options.content ?? '').length

  const switchKind = (kind: PanelKind) => {
    const next = changeKind(work, kind)
    setNotes(kindChangeNotes(work, next))
    setWork(next)
  }

  return (
    <div className="flex flex-col gap-4" data-pane="panel">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="ghost" aria-label="Back to the dashboard without applying" onClick={onCancel}><ArrowLeft aria-hidden /></Button>
        <h2 className="m-0 min-w-0 flex-1 truncate text-heading">{fresh ? `New ${KIND_INFO[work.kind].name}` : `Edit ${work.title || 'panel'}`}</h2>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={issues.length > 0} title={issues[0]} onClick={() => onApply(work)}>{fresh ? 'Add panel' : 'Apply'}</Button>
      </div>

      <section aria-label="Preview" className="flex flex-col gap-2">
        <div className="h-[340px] min-w-0">
          {previewIssues.length > 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-md border bg-card p-4 text-center" role="status">
              <span className="text-sub">Nothing to preview yet</span>
              <span className="max-w-[460px] text-control text-muted-foreground">{previewIssues[0]}</span>
            </div>
          ) : (
            <PanelCard panel={preview} range={range} sent={sent} source={source} markers={NO_MARKS} onZoom={NO_ZOOM} />
          )}
        </div>
        <p className="m-0 text-caption text-muted-foreground">The preview runs on the time range of the dashboard and refreshes shortly after you stop typing.</p>
      </section>

      {issues.length > 0 ? (
        <ul aria-label="Problems with this panel" role="status" className="m-0 flex list-none flex-col gap-1 rounded-md bg-warning-subtle p-3 text-control text-warning-text">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}

      <Card className="flex flex-col gap-4 p-4">
        <h3 className="m-0 text-sub">General</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title" htmlFor="panel-title" hint={`${points(work.title)} of ${LIMITS.title}`}>
            <Input id="panel-title" value={work.title} onChange={(event) => set({ title: event.target.value })} aria-invalid={points(work.title) > LIMITS.title ? true : undefined} />
          </Field>
          <Field label="Panel type" htmlFor="panel-kind">
            <NativeSelect id="panel-kind" value={work.kind} onChange={(event) => switchKind(event.target.value as PanelKind)}>
              {KIND_GROUPS.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.kinds.map((kind) => <option key={kind} value={kind}>{KIND_INFO[kind].name}</option>)}
                </optgroup>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {notes.length > 0 ? (
          <ul role="status" aria-label="What changing the type adjusted" className="m-0 flex list-none flex-col gap-1 rounded-md bg-accent-subtle p-2 text-caption text-accent-text">
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : null}
        <Field label="Description" htmlFor="panel-description" hint="Shown in the tooltip of the panel header.">
          <Textarea id="panel-description" rows={2} value={work.description} onChange={(event) => set({ description: event.target.value })} className="min-h-16" />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <h3 className="m-0 text-sub">Display</h3>
        {noOptions ? <p className="m-0 text-control text-muted-foreground">A {KIND_INFO[work.kind].name} panel has no display options.</p> : null}
        {support.unit || support.decimals ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit" htmlFor="panel-unit" hint="Appended to values, such as ms or req.">
              <Input id="panel-unit" mono value={work.options.unit ?? ''} onChange={(event) => setOptions({ unit: event.target.value })} />
            </Field>
            <Field label="Decimals" htmlFor="panel-decimals" hint="Blank keeps the automatic precision.">
              <Input
                id="panel-decimals"
                type="number"
                inputMode="numeric"
                min={0}
                max={LIMITS.decimals}
                placeholder="Auto"
                value={work.options.decimals ?? ''}
                onChange={(event) => setOptions({ decimals: event.target.value === '' ? null : Number(event.target.value) })}
              />
            </Field>
          </div>
        ) : null}
        {support.legend ? (
          <Field label="Legend">
            <div><Segmented<Legend> label="Legend position" value={work.options.legend ?? (work.kind === 'pie' ? 'right' : 'bottom')} onChange={(legend) => setOptions({ legend })} options={LEGENDS} /></div>
          </Field>
        ) : null}
        {support.stacked ? <Switch label="Stack the series" checked={work.options.stacked === true} onCheckedChange={(stacked) => setOptions({ stacked })} /> : null}
        {!support.stacked && support.legend ? <p className="m-0 text-caption text-muted-foreground">Stacking is for Area and Bar charts.</p> : null}
        {support.centre ? (
          <Field label="Centre label" htmlFor="panel-centre" hint={`Written under the total in the middle of the chart, such as memory. Blank shows the total alone. ${points(work.options.content ?? '')} of ${LIMITS.centre} characters.`}>
            <Input id="panel-centre" value={work.options.content ?? ''} onChange={(event) => setOptions({ content: event.target.value })} />
          </Field>
        ) : null}
        {support.content ? (
          <Field label="Content" htmlFor="panel-content" hint={`Markdown. The preview above updates as you type. ${contentBytes} of ${LIMITS.content} bytes.`}>
            <Textarea id="panel-content" rows={10} value={work.options.content ?? ''} onChange={(event) => setOptions({ content: event.target.value })} className="font-mono text-[12.5px]" />
          </Field>
        ) : null}
      </Card>

      <section aria-label="Queries" className="flex flex-col gap-2">
        <h3 className="m-0 text-sub">Data</h3>
        <QueriesSection panel={work} onChange={setWork} />
      </section>

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={issues.length > 0} title={issues[0]} onClick={() => onApply(work)}>{fresh ? 'Add panel' : 'Apply'}</Button>
      </div>
    </div>
  )
}
