import { CircleCheck, CircleMinus, CircleQuestionMark, LoaderCircle, TriangleAlert } from 'lucide-react'
import { since } from '@/data/services'
import { cn } from '@/lib/utils'
import { elapsed, type Status } from './attention'

export type Checked = { services: number; rules: number | null; pods: number | null; incidents: number | null }

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`

export const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

export function checkedText(checked: Checked): string {
  const parts = [
    plural(checked.services, 'service'),
    ...(checked.rules === null ? [] : [plural(checked.rules, 'alert rule')]),
    ...(checked.pods === null ? [] : [plural(checked.pods, 'pod')]),
    ...(checked.incidents === null ? [] : [`${checked.incidents.toLocaleString('en-US')} open ${checked.incidents === 1 ? 'incident' : 'incidents'}`]),
  ]
  return `Checked ${parts.join(', ')}`
}

export function StatusLine({ status, checked, missing, notes = [], updatedMs, windowLabel, now }: { status: Status; checked: Checked; missing: string[]; notes?: string[]; updatedMs: number | null; windowLabel: string; now: number }) {
  const failed = missing.length ? `Could not check ${listOf(missing)}. This list may be incomplete.` : null
  const view =
    status.kind === 'calm'
      ? { Icon: CircleCheck, tone: 'text-success-text', box: '', sentence: 'Nothing needs attention', detail: checkedText(checked) }
      : status.kind === 'attention'
        ? {
            Icon: TriangleAlert,
            tone: status.worst === 'critical' ? 'text-destructive-text' : status.worst === 'warning' ? 'text-warning-text' : 'text-muted-foreground',
            box: status.worst === 'critical' ? 'border-destructive-border bg-destructive-subtle' : status.worst === 'warning' ? 'border-warning-border bg-warning-subtle' : '',
            sentence: status.count === 1 ? '1 thing needs attention' : `${status.count} things need attention`,
            detail: failed,
          }
        : status.kind === 'unchecked'
          ? { Icon: CircleQuestionMark, tone: 'text-warning-text', box: 'border-warning-border bg-warning-subtle', sentence: `Could not check ${listOf(status.names)}`, detail: 'Nothing is shown as healthy until every source answers.' }
          : status.kind === 'partial'
            ? { Icon: CircleQuestionMark, tone: 'text-warning-text', box: 'border-warning-border bg-warning-subtle', sentence: `Only part of ${listOf(status.names)} was checked`, detail: 'The list was truncated, so something may be missing.' }
            : status.kind === 'nodata'
              ? {
                  Icon: CircleMinus,
                  tone: 'text-muted-foreground',
                  box: '',
                  sentence: status.sinceMs === null ? 'No span received in the last 24 hours' : `No span received for ${elapsed(now - status.sinceMs)}`,
                  detail: 'Services are not sending traces, or the ingest endpoint is unreachable.',
                }
              : { Icon: LoaderCircle, tone: 'text-muted-foreground', box: '', sentence: 'Checking incidents, alerts, services, issues and pods', detail: null }
  return (
    <section aria-label="Status" className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-1 rounded-md border bg-card px-3.5 py-3', view.box)}>
      <div className="flex min-w-0 flex-[1_1_320px] items-start gap-2.5">
        <view.Icon className={cn('mt-0.5 size-5 shrink-0', view.tone)} aria-hidden />
        <div className="flex min-w-0 flex-col">
          <div role="status" data-state={status.kind}>
            <h2 className="text-heading">{view.sentence}</h2>
          </div>
          {view.detail ? <p className="m-0 text-control font-normal text-muted-foreground">{view.detail}</p> : null}
          {notes.map((note) => <p key={note} className="m-0 text-caption text-muted-foreground">{note}</p>)}
        </div>
      </div>
      <p className="m-0 text-caption text-muted-foreground">{updatedMs === null ? 'Not updated yet' : `Updated ${since(updatedMs)}`} · last {windowLabel}</p>
    </section>
  )
}
