import { BellOff, BellRing, Plus, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { because } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Alert, Table, Td, Tr, SortTh } from '@/components/ui/misc'
import { Pager } from '@/components/ui/pager'
import { Switch } from '@/components/ui/switch'
import { EmptyState, PageHeader } from '@/components/ft/bits'
import { STATUSES, conditionOf, isForbidden, isNotConfigured, scopeOf, useAlerts, useChannels, useToggleRule, type AlertStatus, type Rule } from '@/data/alerts'
import { useProjects } from '@/data/projects'
import { stamp } from '@/lib/format'
import { pagesOf } from '@/lib/paging'
import { sorted, toggled, type Sorting } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import { FiltersButton } from './alerting/FiltersButton'
import { notifiesLabel, ruleValue, type RuleKey, type RuleLine } from './alerting/sorting'
import { StateBadge } from './alerts/bits'
import { RuleDetail } from './alerts/RuleDetail'
import { RuleEditor } from './alerts/RuleEditor'

type Open = { view: 'detail'; id: string } | { view: 'edit'; id: string | null } | null

export function Alerts() {
  const { active } = useOrganisations()
  const { alerts, failed, nothing } = useAlerts()
  const projects = useProjects()
  const toggle = useToggleRule()
  const { channels } = useChannels()
  const [state, setState] = useState<AlertStatus | ''>('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [sorting, setSorting] = useState<Sorting<RuleKey> | null>(null)
  const [filtering, setFiltering] = useState(false)
  const [open, setOpen] = useState<Open>(() => {
    const asked = new URLSearchParams(window.location.search).get('rule')
    return asked ? { view: 'detail', id: asked } : null
  })
  const mayChange = active?.role === 'owner' || active?.role === 'admin'
  const projectName = (id: string | null) => (id === null ? 'All projects' : projects.find((one) => one.id === id)?.name ?? id)
  const needle = query.trim().toLowerCase()
  const namesOf = (rule: Rule) => rule.channels.map((id) => channels?.find((one) => one.id === id)?.name ?? id)
  const rows: (RuleLine & { rule: Rule })[] = (alerts ?? [])
    .filter((rule) => (state === '' || rule.state.status === state) && (needle === '' || rule.name.toLowerCase().includes(needle)))
    .map((rule) => ({ name: rule.name, signal: rule.signal.kind, severity: rule.severity, status: rule.state.status, since_ms: rule.state.since_ms, project: projectName(rule.project), notifies: namesOf(rule), enabled: rule.enabled, rule }))
  const shown = sorted(rows, sorting, ruleValue)
  const current = Math.min(page, pagesOf(shown.length, size))
  const visible = shown.slice((current - 1) * size, current * size)
  const sortBy = (key: RuleKey, first?: 'asc' | 'desc') => { setSorting((was) => toggled(was, key, first)); setPage(1) }
  const dirOf = (key: RuleKey) => (sorting?.key === key ? sorting.dir : null)
  const selected = open ? alerts?.find((rule) => rule.id === open.id) ?? null : null
  const firing = (alerts ?? []).filter((rule) => rule.enabled && rule.state.status === 'firing').length

  return (
    <>
      <PageHeader title="Alerts" meta={alerts ? <>{firing > 0 ? <Badge variant="destructive" className="mr-2">{firing} firing</Badge> : null}{alerts.length} {alerts.length === 1 ? 'rule' : 'rules'}</> : 'Rules on traces, logs and metrics'}>
        {mayChange ? <Button variant="primary" size="sm" onClick={() => setOpen({ view: 'edit', id: null })}><Plus />New alert</Button> : null}
      </PageHeader>
      <div className="flex flex-wrap items-center gap-2" role="search">
        <InputGroup className="w-[320px] max-w-full max-md:flex-1"><Search aria-hidden /><input aria-label="Search rules" placeholder="Search rules" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} /></InputGroup>
        <FiltersButton open={filtering} count={state === '' ? 0 : 1} controls="alert-filters" onToggle={() => setFiltering((was) => !was)} />
        <NativeSelect id="alert-filters" aria-label="Filter by state" value={state} onChange={(e) => { setState(e.target.value as AlertStatus | ''); setPage(1) }} className={cn('w-[150px] max-md:w-full', !filtering && 'max-md:hidden')}>
          <option value="">State: any</option>
          {STATUSES.map((one) => <option key={one} value={one}>{one.replace('_', ' ')}</option>)}
        </NativeSelect>
      </div>
      {alerts && !mayChange ? <span className="text-control text-muted-foreground">Read only. Only an owner or an administrator can change a rule.</span> : null}

      {isNotConfigured(failed) ? (
        <Alert variant="warning" icon={<TriangleAlert />} title="Alerting is not configured">This server does not run the alert evaluator. Ask the operator to enable it.</Alert>
      ) : isForbidden(failed) ? (
        <Alert variant="warning" icon={<TriangleAlert />} title="You may not read alert rules">Your role in this organisation does not allow it.</Alert>
      ) : !alerts ? (
        <Card className="px-4 py-3 text-control text-muted-foreground">{nothing}</Card>
      ) : alerts.length === 0 ? (
        <EmptyState icon={<BellRing />} title="No alert rules yet" actions={mayChange ? <Button variant="primary" size="sm" onClick={() => setOpen({ view: 'edit', id: null })}><Plus />New alert</Button> : undefined}>
          A rule watches a trace, log or metric query and notifies a channel when it crosses a threshold.
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <Table aria-label="Alert rules">
            <thead>
              <tr>
                <SortTh label="Rule" dir={dirOf('rule')} onSort={() => sortBy('rule', 'asc')} />
                <SortTh label="Signal" dir={dirOf('signal')} onSort={() => sortBy('signal', 'asc')} className="w-[90px]" />
                <SortTh label="Severity" dir={dirOf('severity')} onSort={() => sortBy('severity')} className="w-[100px]" />
                <SortTh label="State" dir={dirOf('state')} onSort={() => sortBy('state')} className="w-[210px]" />
                <SortTh label="Notifies" dir={dirOf('notifies')} onSort={() => sortBy('notifies', 'asc')} className="w-[170px]" />
                <SortTh label="Project" dir={dirOf('project')} onSort={() => sortBy('project', 'asc')} className="w-[140px]" />
                {mayChange ? <SortTh numeric label="On" dir={dirOf('on')} onSort={() => sortBy('on')} className="w-[70px]" /> : null}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? <Tr><Td colSpan={mayChange ? 7 : 6} className="text-muted-foreground">No rule matches these filters.</Td></Tr> : null}
              {visible.map(({ rule, project, notifies }) => <RuleRow key={rule.id} rule={rule} project={project} notifies={notifies} mayChange={mayChange} busy={toggle.isPending} onOpen={() => setOpen({ view: 'detail', id: rule.id })} onToggle={(enabled) => toggle.mutate({ id: rule.id, enabled }, { onError: (error) => toast.error(because(error, 'The rule was not changed')) })} />)}
            </tbody>
          </Table>
          <Pager total={shown.length} page={current} size={size} onPage={setPage} onSize={(next) => { setSize(next); setPage(1) }} noun="rules" className="border-t" />
        </Card>
      )}

      <RuleDetail rule={open?.view === 'detail' ? selected : null} project={selected ? projectName(selected.project) : ''} mayChange={mayChange} onEdit={() => selected && setOpen({ view: 'edit', id: selected.id })} onClose={() => setOpen(null)} />
      <RuleEditor rule={open?.view === 'edit' ? selected : null} open={open?.view === 'edit'} onClose={() => setOpen(null)} />
    </>
  )
}

function RuleRow({ rule, project, notifies, mayChange, busy, onOpen, onToggle }: { rule: Rule; project: string; notifies: readonly string[]; mayChange: boolean; busy: boolean; onOpen: () => void; onToggle: (enabled: boolean) => void }) {
  const { state } = rule
  return (
    <Tr className={cn(!rule.enabled && 'opacity-60')}>
      <Td className="whitespace-normal py-2">
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={onOpen} className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-control font-semibold text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">{rule.name}</button>
          <span className="text-caption text-muted-foreground"><span className="font-mono">{conditionOf(rule)}</span> · {scopeOf(rule.signal)}</span>
        </div>
      </Td>
      <Td><Badge variant="outline">{rule.signal.kind}</Badge></Td>
      <Td><span className={cn('text-control font-semibold', rule.severity === 'critical' ? 'text-destructive-text' : rule.severity === 'warning' ? 'text-warning-text' : 'text-muted-foreground')}>{rule.severity}</span></Td>
      <Td><span className="flex flex-wrap items-center gap-1.5"><StateBadge status={state.status} />{rule.silenced_until_ms !== null && rule.silenced_until_ms > Date.now() ? <BellOff className="size-3.5 shrink-0 text-warning-text" aria-label="Silenced" /> : null}<span className="font-mono text-caption text-muted-foreground">since {stamp(state.since_ms)}</span></span></Td>
      <Td className="text-control" title={notifies.join(', ')}>{notifies.length ? notifiesLabel(notifies) : <span className="text-faint-foreground">nobody</span>}</Td>
      <Td className="text-control">{project}</Td>
      {mayChange ? <Td numeric><Switch checked={rule.enabled} disabled={busy} onCheckedChange={onToggle} aria-label={`Enable ${rule.name}`} /></Td> : null}
    </Tr>
  )
}
