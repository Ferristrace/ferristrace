import { Gauge, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { Alert, Table, Td, Tr } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState, Kpi, PageHeader } from '@/components/ft/bits'
import { isForbidden, isNotConfigured } from '@/data/alerts'
import { useIncidentInsights, type InsightGroup, type Timing } from '@/data/incidents'
import { sorted, toggled, type Sorting } from '@/lib/sorting'
import { groupValue, type GroupKey } from './alerting/sorting'
import { SortHead } from './alerting/SortHead'
import { SeverityPill } from './Incidents'

const DAYS = [7, 30, 90] as const

export function span(ms: number | null): string {
  if (ms === null) return '–'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return '< 1 m'
  if (minutes < 60) return `${minutes} m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ${minutes % 60} m`
  return `${Math.round(hours / 24)} d`
}

const times = (timing: Timing) => (timing.samples === 0 ? '–' : `${span(timing.median_ms)} median · ${span(timing.mean_ms)} mean`)

function Row({ label, group }: { label: React.ReactNode; group: InsightGroup }) {
  return (
    <Tr>
      <Td className="font-semibold">{label}</Td>
      <Td numeric>{group.incidents}</Td>
      <Td numeric>{group.open}</Td>
      <Td className="font-mono text-caption">{times(group.acknowledge)}</Td>
      <Td className="font-mono text-caption">{times(group.resolve)}</Td>
    </Tr>
  )
}

type Sort = { sorting: Sorting<GroupKey> | null; set: (next: Sorting<GroupKey> | null) => void }

function useSort(): Sort {
  const [sorting, set] = useState<Sorting<GroupKey> | null>(null)
  return { sorting, set }
}

const grouped = <G extends InsightGroup>(groups: { label: string; group: G }[], { sorting }: Sort) =>
  sorted(groups, sorting, (one, key) => groupValue({ label: one.label, incidents: one.group.incidents, open: one.group.open, acknowledgeMs: one.group.acknowledge.median_ms, resolveMs: one.group.resolve.median_ms }, key))

function Header({ title, sort }: { title: string; sort: Sort }) {
  const dirOf = (key: GroupKey) => (sort.sorting?.key === key ? sort.sorting.dir : null)
  const by = (key: GroupKey, first?: 'asc' | 'desc') => () => sort.set(toggled(sort.sorting, key, first))
  return (
    <thead>
      <tr>
        <SortHead label={title} dir={dirOf('label')} onSort={by('label', 'asc')} />
        <SortHead label="Incidents" dir={dirOf('incidents')} onSort={by('incidents')} className="w-[90px]" />
        <SortHead label="Open" dir={dirOf('open')} onSort={by('open')} className="w-[70px]" />
        <SortHead label="Time to acknowledge" dir={dirOf('acknowledge')} onSort={by('acknowledge', 'asc')} />
        <SortHead label="Time to resolve" dir={dirOf('resolve')} onSort={by('resolve', 'asc')} />
      </tr>
    </thead>
  )
}

export function IncidentInsights() {
  const [days, setDays] = useState<(typeof DAYS)[number]>(30)
  const { insights, failed } = useIncidentInsights(days)
  const severitySort = useSort()
  const serviceSort = useSort()
  const peak = Math.max(1, ...(insights?.per_day.map((day) => day.incidents) ?? [1]))

  return (
    <>
      <PageHeader title="Incident insights" meta={<Badge variant="neutral" className="rounded-full">last {days} days</Badge>}>
        <Segmented<string> label="Window" value={String(days)} onChange={(value) => setDays(Number(value) as (typeof DAYS)[number])} options={DAYS.map((one) => ({ value: String(one), label: `${one} days` }))} />
      </PageHeader>

      {isNotConfigured(failed) ? (
        <Alert variant="warning" icon={<TriangleAlert />} title="Incidents are not available">This server has no control plane to keep incidents.</Alert>
      ) : isForbidden(failed) ? (
        <Alert variant="warning" icon={<TriangleAlert />} title="You may not read incidents">Your role in this organisation does not allow it.</Alert>
      ) : !insights ? (
        <Card className="px-4 py-3 text-control text-muted-foreground">Reading the incidents…</Card>
      ) : insights.overall.incidents === 0 ? (
        <EmptyState icon={<Gauge />} title="No incident in this window">Incidents opened in the last {days} days are counted here, with how long they took to be acknowledged and resolved.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Incidents" value={String(insights.overall.incidents)} sub={`${insights.overall.open} still open`} tone={insights.overall.open > 0 ? 'warn' : undefined} />
            <Kpi label="Time to acknowledge" value={span(insights.overall.acknowledge.median_ms)} sub={`median of ${insights.overall.acknowledge.samples} · first status change, owner or acknowledged page`} />
            <Kpi label="Time to resolve" value={span(insights.overall.resolve.median_ms)} sub={`median of ${insights.overall.resolve.samples} resolved`} />
            <Kpi label="Mean time to resolve" value={span(insights.overall.resolve.mean_ms)} sub="resolved incidents only" />
          </div>

          <Card>
            <CardHeader><CardTitle>Incidents per day</CardTitle><CardKind>Bar</CardKind><span className="ml-auto text-caption text-muted-foreground">opened, UTC</span></CardHeader>
            <div className="flex h-24 items-end gap-0.5 px-4 pb-3 pt-2" role="img" aria-label="Incidents opened per day">
              {insights.per_day.map((day) => (
                <div key={day.day_ms} title={`${new Date(day.day_ms).toISOString().slice(0, 10)}: ${day.incidents}`} className="flex-1 rounded-t-[4px] bg-chart-line" style={{ height: `${Math.max(day.incidents === 0 ? 2 : 8, (day.incidents / peak) * 100)}%`, opacity: day.incidents === 0 ? 0.25 : 1 }} />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>By severity</CardTitle><CardKind>Table</CardKind></CardHeader>
            <div className="overflow-x-auto">
              <Table aria-label="Incidents by severity">
                <Header title="Severity" sort={severitySort} />
                <tbody>{grouped(insights.by_severity.map((group) => ({ label: group.severity, group })), severitySort).map(({ group }) => <Row key={group.severity} label={<SeverityPill severity={group.severity} />} group={group} />)}</tbody>
              </Table>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>By service</CardTitle><CardKind>Table</CardKind><span className="ml-auto text-caption text-muted-foreground">the services of the alert that opened the incident</span></CardHeader>
            <div className="overflow-x-auto">
              <Table aria-label="Incidents by service">
                <Header title="Service" sort={serviceSort} />
                <tbody>{grouped(insights.by_service.map((group) => ({ label: group.service ?? '', group })), serviceSort).map(({ group }) => <Row key={group.service ?? 'none'} label={group.service ?? <span className="font-normal text-muted-foreground">Declared by hand</span>} group={group} />)}</tbody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
