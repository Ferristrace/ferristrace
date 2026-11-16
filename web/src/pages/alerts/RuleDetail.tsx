import { BellOff, Pencil, Siren, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { because } from '@/auth/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, Td, Th, Tr, SortTh } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segmented } from '@/components/ui/segmented'
import { conditionOf, duration, scopeOf, signalLink, unitOf, useAlertHistory, useChannels, useDeleteRule, useSilenceRule, useUnsilenceRule, withUnit, SILENCE_MAX_DAYS, type AlertStatus, type Rule } from '@/data/alerts'
import { useMetricCatalogue } from '@/data/metrics'
import { useDeclareIncident } from '@/data/incidents'
import { useState } from 'react'
import { stamp } from '@/lib/format'
import { sorted, toggled, type Sorting } from '@/lib/sorting'
import { Link, useNavigate } from '@/lib/router'
import { labelOf } from '@/components/ft/MetricChart'
import { eventValue, seriesValue, type EventKey, type SeriesKey } from '../alerting/sorting'
import { AlertContext, StateBadge } from './bits'

const SHOWN = 100

const PRESETS = [
  { value: '1h', label: '1 h', ms: 3_600_000 },
  { value: '4h', label: '4 h', ms: 4 * 3_600_000 },
  { value: '24h', label: '24 h', ms: 24 * 3_600_000 },
  { value: 'custom', label: 'Custom', ms: 0 },
] as const

function SilenceControl({ rule }: { rule: Rule }) {
  const silence = useSilenceRule()
  const unsilence = useUnsilenceRule()
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['value']>('1h')
  const [custom, setCustom] = useState('')
  const active = rule.silenced_until_ms !== null && rule.silenced_until_ms > Date.now()

  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-warning-border bg-warning-subtle px-2 py-1 text-caption text-warning-text">
        <BellOff className="size-3.5 shrink-0" aria-hidden />
        Silenced until {stamp(rule.silenced_until_ms as number)}
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1.5 text-inherit"
          disabled={unsilence.isPending}
          onClick={() =>
            unsilence.mutate(rule.id, {
              onSuccess: () => toast.success('Silence lifted'),
              onError: (error) => toast.error(because(error, 'The silence was not lifted')),
            })
          }
        >
          Lift
        </Button>
      </span>
    )
  }

  const untilMs = preset === 'custom' ? Date.parse(custom) : Date.now() + PRESETS.find((p) => p.value === preset)!.ms
  const ready = Number.isFinite(untilMs) && untilMs > Date.now()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost"><BellOff />Silence</Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-[260px] flex-col gap-2.5 p-3">
        <Segmented label="Duration" value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} />
        {preset === 'custom' ? <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Silenced until" /> : null}
        <span className="text-caption text-muted-foreground">Up to {SILENCE_MAX_DAYS} days. No notification or page fires until then.</span>
        <Button
          size="sm"
          variant="primary"
          disabled={!ready || silence.isPending}
          onClick={() =>
            silence.mutate({ id: rule.id, until_ms: untilMs }, {
              onSuccess: () => { setOpen(false); toast.success('Rule silenced') },
              onError: (error) => toast.error(because(error, 'The rule was not silenced')),
            })
          }
        >
          Silence
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export function RuleDetail({ rule, project, mayChange, onEdit, onClose }: { rule: Rule | null; project: string; mayChange: boolean; onEdit: () => void; onClose: () => void }) {
  const history = useAlertHistory(rule?.id ?? null)
  const { channels } = useChannels()
  const remove = useDeleteRule()
  const declare = useDeclareIncident()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [seriesSorting, setSeriesSorting] = useState<Sorting<SeriesKey> | null>(null)
  const [eventSorting, setEventSorting] = useState<Sorting<EventKey> | null>(null)
  const catalogue = useMetricCatalogue(rule?.signal.kind === 'metrics' ? rule.signal.name : '', rule?.project ?? undefined)
  const metricName = rule?.signal.kind === 'metrics' ? rule.signal.name : ''
  const metricUnit = metricName ? catalogue.metrics.find((one) => one.name === metricName)?.unit ?? '' : ''
  const unit = rule ? unitOf(rule.signal, metricUnit) : ''
  const link = rule ? signalLink(rule.signal) : null
  const named = rule ? rule.channels.map((id) => channels?.find((one) => one.id === id)?.name ?? id) : []
  const state = rule?.state
  const seriesDir = (key: SeriesKey) => (seriesSorting?.key === key ? seriesSorting.dir : null)
  const eventDir = (key: EventKey) => (eventSorting?.key === key ? eventSorting.dir : null)
  const word = (status: AlertStatus) => status.replace('_', ' ')

  return (
    <>
    <Dialog open={rule !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={rule?.name ?? 'Alert rule'} description={rule ? conditionOf(rule, metricUnit) : undefined}>
        {rule && state && link ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge status={state.status} />
              <Badge variant="outline">{rule.signal.kind}</Badge>
              <Badge variant={rule.severity === 'critical' ? 'destructive' : rule.severity === 'warning' ? 'warning' : 'neutral'}>{rule.severity}</Badge>
              {rule.enabled ? null : <Badge variant="outline">Disabled</Badge>}
              {mayChange ? <SilenceControl rule={rule} /> : null}
              <Button asChild variant="ghost" size="sm" className="ml-auto"><Link to={link.to} search={link.search}>{link.label}</Link></Button>
            </div>
            {state.status === 'firing' ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive-border bg-destructive-subtle px-3 py-2 text-control">
                <span className="flex-1">This alert is firing. An incident declared from it follows its later changes in its timeline.</span>
                <Button size="sm" variant="primary" disabled={declare.isPending} onClick={() => declare.mutate({ alert: rule.id }, {
                  onSuccess: (incident) => { toast.success('Incident declared', { description: incident.title }); onClose(); navigate(`/incidents/${incident.id}`) },
                  onError: (error) => toast.error(because(error, 'The incident was not declared')),
                })}><Siren />Declare incident from this alert</Button>
              </div>
            ) : null}
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border bg-card px-3 py-2.5 text-control">
              <dt className="text-muted-foreground">Scope</dt><dd className="m-0 font-mono">{scopeOf(rule.signal)}</dd>
              <dt className="text-muted-foreground">Project</dt><dd className="m-0">{project}</dd>
              <dt className="text-muted-foreground">Value</dt><dd className="m-0 font-mono">{withUnit(state.value, unit)}</dd>
              <dt className="text-muted-foreground">Since</dt><dd className="m-0 font-mono">{stamp(state.since_ms)}</dd>
              <dt className="text-muted-foreground">Evaluated</dt><dd className="m-0 font-mono">{state.evaluated_ms === null ? 'not yet' : stamp(state.evaluated_ms)}</dd>
              <dt className="text-muted-foreground">Window</dt><dd className="m-0 font-mono">{duration(rule.window_s)}, pending {duration(rule.pending_s)}, no data: {rule.no_data}</dd>
              <dt className="text-muted-foreground">Notifies</dt><dd className="m-0">{named.length ? named.join(', ') : 'nobody'}</dd>
            </dl>
            {state.series.length > 1 ? (
              <Card className="overflow-x-auto">
                <Table aria-label="State per series">
                  <thead><tr>
                    <SortTh label="Series" dir={seriesDir('series')} onSort={() => setSeriesSorting((was) => toggled(was, 'series', 'asc'))} />
                    <SortTh label="State" dir={seriesDir('state')} onSort={() => setSeriesSorting((was) => toggled(was, 'state'))} className="w-[110px]" />
                    <SortTh numeric label="Value" dir={seriesDir('value')} onSort={() => setSeriesSorting((was) => toggled(was, 'value'))} className="w-[140px]" />
                  </tr></thead>
                  <tbody>{sorted(state.series, seriesSorting, (one, key) => seriesValue({ label: labelOf(one.labels), status: one.status, value: one.value }, key)).map((one) => (
                    <Tr key={labelOf(one.labels)}><Td className="font-mono">{labelOf(one.labels)}</Td><Td><StateBadge status={one.status} /></Td><Td numeric>{withUnit(one.value, unit)}</Td></Tr>
                  ))}</tbody>
                </Table>
              </Card>
            ) : null}
            <Card>
              <CardHeader><CardTitle>History, last 30 days</CardTitle><CardKind>Table</CardKind></CardHeader>
              {history.events ? (
                history.events.length === 0 ? <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">No state change in the last 30 days.</p> : (
                  <div className="max-h-[260px] overflow-auto">
                    <Table aria-label="Rule history">
                      <thead><tr>
                        <SortTh label="When" dir={eventDir('when')} onSort={() => setEventSorting((was) => toggled(was, 'when'))} className="w-[170px]" />
                        <Th>Change</Th>
                        <SortTh numeric label="Value" dir={eventDir('value')} onSort={() => setEventSorting((was) => toggled(was, 'value'))} className="w-[110px]" />
                      </tr></thead>
                      <tbody>{sorted(history.events, eventSorting, (one, key) => eventValue(one, key)).slice(0, SHOWN).map((one) => (
                        <Tr key={`${one.at_ms}-${labelOf(one.labels)}-${one.to}`}>
                          <Td className="font-mono">{stamp(one.at_ms)}</Td>
                          <Td><span className="flex flex-wrap items-center gap-1.5">{word(one.from)} <span aria-hidden>→</span> <StateBadge status={one.to} />{Object.keys(one.labels).length ? <span className="font-mono text-caption text-muted-foreground">{labelOf(one.labels)}</span> : null}{one.context ? <span className="basis-full"><AlertContext context={one.context} /></span> : null}</span></Td>
                          <Td numeric>{withUnit(one.value, unit)}</Td>
                        </Tr>
                      ))}</tbody>
                    </Table>
                  </div>
                )
              ) : <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">{history.failed ? because(history.failed, 'The history could not be read.') : 'Reading the history…'}</p>}
            </Card>
            {mayChange ? (
              <DialogFooter>
                <Button className="text-destructive-text" onClick={() => setConfirming(true)}><Trash2 />Delete</Button>
                <Button variant="primary" onClick={onEdit}><Pencil />Edit</Button>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent role="alertdialog" title={`Delete ${rule?.name ?? 'this rule'}?`} description="Its history is deleted with it and nobody is notified again. This cannot be undone.">
          <DialogFooter>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => {
              if (!rule) return
              remove.mutate(rule.id, { onSuccess: () => { setConfirming(false); toast.success('Rule deleted', { description: rule.name }); onClose() }, onError: (error) => toast.error(because(error, 'The rule was not deleted')) })
            }}>Delete rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
