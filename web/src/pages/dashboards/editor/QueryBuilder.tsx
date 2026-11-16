import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { aggLabel } from '@/components/ft/panels/result'
import { Button } from '@/components/ui/button'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import type { Aggregation, Column, EventFunction, PanelDoc, QueryDoc, QuerySignal } from '@/data/dashboards'
import { useMetricNames } from '@/data/dashboardCatalogue'
import { useSettled } from '@/lib/settle'
import { ColumnPicker } from './ColumnPicker'
import { useEditorEnv } from './env'
import { FilterBuilder } from './FilterBuilder'
import {
  EVENT_FUNCTIONS,
  KIND_INFO,
  LIMITS,
  columnIsNumeric,
  groupRule,
  maxGroupBy,
  needsField,
  needsNumber,
  queryIssues,
  stepRule,
  withSignal,
  adaptQuery,
  addQuery,
} from './kinds'

const SIGNALS: { value: QuerySignal; label: string }[] = [
  { value: 'traces', label: 'Traces' },
  { value: 'logs', label: 'Logs' },
  { value: 'metrics', label: 'Metrics' },
]

const TIMES = ['avg', 'sum', 'min', 'max', 'rate', 'increase'] as const

const SPACES = ['sum', 'avg', 'min', 'max', 'count'] as const

const SERIES_KINDS = new Set(['time_series', 'area', 'bar'])

type Metric = Extract<Aggregation, { metric: string }>

const defaultField = (fn: EventFunction, signal: QuerySignal): Column | undefined => {
  if (!needsField(fn)) return undefined
  if (needsNumber(fn)) return signal === 'traces' ? { field: 'duration' } : { attr: '' }
  return { field: 'service' }
}

function aggregationFor(previous: Extract<Aggregation, { function: EventFunction }>, fn: EventFunction, signal: QuerySignal): Aggregation {
  if (!needsField(fn)) return { function: fn }
  const field = previous.field ?? null
  const keep = field !== null && (!needsNumber(fn) || columnIsNumeric(field))
  return { function: fn, field: keep ? field : defaultField(fn, signal) }
}

function MetricRow({ aggregation, onChange }: { aggregation: Metric; onChange: (next: Metric) => void }) {
  const { fixture } = useEditorEnv()
  const typed = useSettled(aggregation.metric)
  const { names } = useMetricNames(typed, fixture)
  const list = useId()
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Input mono aria-label="Metric name" placeholder="Metric name" list={list} value={aggregation.metric} onChange={(event) => onChange({ ...aggregation, metric: event.target.value })} className="w-[260px]" />
      <datalist id={list}>{names.slice(0, 100).map((name) => <option key={name} value={name} />)}</datalist>
      <NativeSelect aria-label="Time aggregation" value={aggregation.time} onChange={(event) => onChange({ ...aggregation, time: event.target.value as Metric['time'] })} className="w-[120px]">
        {TIMES.map((one) => <option key={one} value={one}>{one} over time</option>)}
      </NativeSelect>
      <NativeSelect aria-label="Space aggregation" value={aggregation.space} onChange={(event) => onChange({ ...aggregation, space: event.target.value as Metric['space'] })} className="w-[120px]">
        {SPACES.map((one) => <option key={one} value={one}>{one} across series</option>)}
      </NativeSelect>
    </span>
  )
}

function AggregationRow({ query, at, onChange, onRemove }: { query: QueryDoc; at: number; onChange: (next: Aggregation) => void; onRemove: (() => void) | null }) {
  const aggregation = query.aggregations[at]
  const metric = query.aggregations.flatMap((one) => ('metric' in one ? [one.metric] : []))[0] ?? ''
  return (
    <div role="group" aria-label={`Aggregation ${at + 1}`} className="flex flex-wrap items-center gap-1.5">
      {'metric' in aggregation ? (
        <MetricRow aggregation={aggregation} onChange={onChange} />
      ) : (
        <>
          <NativeSelect aria-label="Function" value={aggregation.function} onChange={(event) => onChange(aggregationFor(aggregation, event.target.value as EventFunction, query.signal))} className="w-[150px]">
            {EVENT_FUNCTIONS.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
          </NativeSelect>
          {needsField(aggregation.function) ? (
            <ColumnPicker value={aggregation.field ?? null} onChange={(field) => onChange({ ...aggregation, field })} signal={query.signal} metric={metric} label="Field to aggregate" numericOnly={needsNumber(aggregation.function)} className="w-[160px]" />
          ) : null}
        </>
      )}
      {onRemove ? <Button size="icon-sm" variant="ghost" aria-label={`Remove aggregation ${at + 1}`} onClick={onRemove}><Trash2 aria-hidden /></Button> : null}
    </div>
  )
}

function QueryCard({ panel, query, onChange, onRemove }: { panel: PanelDoc; query: QueryDoc; onChange: (next: QueryDoc) => void; onRemove: (() => void) | null }) {
  const kind = panel.kind
  const name = KIND_INFO[kind].name
  const groups = query.group_by ?? []
  const cap = maxGroupBy(kind)
  const rule = stepRule(kind)
  const issues = queryIssues(kind, query)
  const set = (change: Partial<QueryDoc>) => onChange({ ...query, ...change })
  const metric = query.aggregations.flatMap((one) => ('metric' in one ? [one.metric] : []))[0] ?? ''
  const step = query.step
  const stepKind = typeof step === 'object' ? 'fixed' : step
  const id = useId()
  const [rawLimit, setRawLimit] = useState<string | null>(null)
  const orderValue = !query.order ? 'none' : query.order.by === 'group' ? 'group' : `agg:${query.order.by.aggregation}`
  const setOrder = (value: string, direction: 'asc' | 'desc') => {
    if (value === 'none') set({ order: null })
    else set({ order: { by: value === 'group' ? 'group' : { aggregation: Number(value.slice(4)) }, direction } })
  }

  return (
    <section aria-label={`Query ${query.name}`} className="flex flex-col gap-4 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sub">Query</h3>
        <Input mono aria-label="Query name" value={query.name} onChange={(event) => set({ name: event.target.value })} className="w-[90px]" />
        <Segmented<QuerySignal> label="Signal" value={query.signal} onChange={(signal) => onChange(adaptQuery(kind, withSignal(query, signal)))} options={SIGNALS} />
        <span className="flex-1" />
        {onRemove ? <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 aria-hidden />Remove query</Button> : null}
      </div>

      <Field label="Aggregations" hint={kind === 'scatter' ? 'One aggregation per axis: the first is x, the second is y.' : undefined}>
        <div className="flex flex-col gap-2">
          {query.aggregations.map((_, at) => (
            <AggregationRow
              key={at}
              query={query}
              at={at}
              onChange={(next) => set({ aggregations: query.aggregations.map((one, index) => (index === at ? next : one)) })}
              onRemove={query.aggregations.length > 1 ? () => set({ aggregations: query.aggregations.filter((_, index) => index !== at), order: null }) : null}
            />
          ))}
          <div>
            <Button
              size="sm"
              disabled={query.aggregations.length >= LIMITS.aggregations}
              onClick={() => set({ aggregations: [...query.aggregations, query.signal === 'metrics' ? { metric, time: 'avg', space: 'avg' } : { function: 'count' }] })}
            >
              <Plus aria-hidden />Aggregation
            </Button>
          </div>
        </div>
      </Field>

      <Field label="Filter">
        <FilterBuilder value={query.filter ?? null} onChange={(filter) => set({ filter })} signal={query.signal} metric={metric} />
      </Field>

      <Field label="Group by" hint={cap === 0 ? `A ${name} panel takes no group by.` : cap === 1 ? `A ${name} panel groups by at most one field.` : `Up to ${cap} fields.`}>
        <div className="flex flex-col gap-2">
          {groups.map((column, at) => (
            <div key={at} className="flex flex-wrap items-center gap-1.5">
              <ColumnPicker value={column} onChange={(next) => set({ group_by: groups.map((one, index) => (index === at ? next : one)) })} signal={query.signal} metric={metric} label={`Group by ${at + 1}`} />
              <Button size="icon-sm" variant="ghost" aria-label={`Remove group by ${at + 1}`} onClick={() => set({ group_by: groups.filter((_, index) => index !== at), order: query.order && query.order.by === 'group' && groups.length === 1 ? null : query.order })}><Trash2 aria-hidden /></Button>
            </div>
          ))}
          <div>
            <Button size="sm" disabled={groups.length >= cap} title={groups.length >= cap ? `A ${name} panel allows ${cap === 0 ? 'no group by' : `at most ${cap} group by`}.` : undefined} onClick={() => set({ group_by: [...groups, { field: 'service' }] })}>
              <Plus aria-hidden />Group by
            </Button>
          </div>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Order" htmlFor={`${id}-order`}>
          <div className="flex gap-1.5">
            <NativeSelect id={`${id}-order`} value={orderValue} disabled={groupRule(kind) === 'none'} onChange={(event) => setOrder(event.target.value, query.order?.direction ?? 'desc')}>
              <option value="none">Default</option>
              {groups.length > 0 ? <option value="group">By group</option> : null}
              {query.aggregations.map((one, at) => <option key={at} value={`agg:${at}`}>By {aggLabel(one)}</option>)}
            </NativeSelect>
            <NativeSelect aria-label="Direction" value={query.order?.direction ?? 'desc'} disabled={!query.order} onChange={(event) => setOrder(orderValue, event.target.value as 'asc' | 'desc')} className="w-[84px]">
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </NativeSelect>
          </div>
        </Field>
        <Field label="Limit" htmlFor={`${id}-limit`} hint="1 to 1000 rows or series.">
          <Input
            id={`${id}-limit`}
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMITS.rows}
            placeholder="Default"
            value={rawLimit ?? (query.limit ?? '')}
            aria-invalid={query.limit !== null && query.limit !== undefined && (query.limit < 1 || query.limit > LIMITS.rows) ? true : undefined}
            onChange={(event) => {
              setRawLimit(event.target.value)
              set({ limit: event.target.value === '' ? null : Number(event.target.value) })
            }}
            onBlur={() => setRawLimit(null)}
          />
        </Field>
        <Field label="Step" htmlFor={`${id}-step`} hint={rule === 'total' ? `A ${name} panel reads one value for the whole range.` : rule === 'timed' ? `A ${name} panel needs a timed step.` : undefined}>
          <div className="flex gap-1.5">
            <NativeSelect
              id={`${id}-step`}
              value={stepKind}
              onChange={(event) => set({ step: event.target.value === 'fixed' ? { fixed: typeof step === 'object' ? step.fixed : 60 } : (event.target.value as 'auto' | 'total') })}
            >
              <option value="auto" disabled={rule === 'total'}>Auto</option>
              <option value="total" disabled={rule === 'timed'}>Total</option>
              <option value="fixed" disabled={rule === 'total'}>Fixed</option>
            </NativeSelect>
            {typeof step === 'object' ? (
              <Input aria-label="Step in seconds" type="number" inputMode="numeric" min={1} value={step.fixed} onChange={(event) => set({ step: { fixed: Number(event.target.value) } })} className="w-[84px]" />
            ) : null}
          </div>
        </Field>
      </div>

      {issues.length > 0 ? (
        <ul aria-label="Problems with this query" role="status" className="m-0 flex list-none flex-col gap-1 rounded-md bg-warning-subtle p-2 text-caption text-warning-text">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}
    </section>
  )
}

export function QueriesSection({ panel, onChange }: { panel: PanelDoc; onChange: (next: PanelDoc) => void }) {
  const several = SERIES_KINDS.has(panel.kind)
  if (panel.kind === 'text') return <p className="m-0 text-control text-muted-foreground">A Text panel runs no query.</p>
  return (
    <div className="flex flex-col gap-3">
      {panel.queries.map((query, at) => (
        <QueryCard
          key={at}
          panel={panel}
          query={query}
          onChange={(next) => onChange({ ...panel, queries: panel.queries.map((one, index) => (index === at ? next : one)) })}
          onRemove={panel.queries.length > 1 ? () => onChange({ ...panel, queries: panel.queries.filter((_, index) => index !== at) }) : null}
        />
      ))}
      {several ? (
        <div>
          <Button size="sm" disabled={panel.queries.length >= LIMITS.queries} onClick={() => onChange(addQuery(panel))}><Plus aria-hidden />Add a query</Button>
        </div>
      ) : (
        <p className="m-0 text-caption text-muted-foreground">A {KIND_INFO[panel.kind].name} panel reads one query. Series panels can draw several.</p>
      )}
    </div>
  )
}
