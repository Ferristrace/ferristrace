import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ft/bits'
import { PlacementPicker } from '@/components/ft/Placement'
import { useAlerts } from '@/data/alerts'
import { useIncidents } from '@/data/incidents'
import { isReporting, useCluster } from '@/data/infra'
import { ANY as ANY_ISSUE, useIssues } from '@/data/issues'
import { isPlaced, placementSearch, usePlacement } from '@/data/placement'
import { useProjects } from '@/data/projects'
import { useReleases } from '@/data/releases'
import { useServiceSeries, useServiceTable } from '@/data/services'
import { useScope } from '@/lib/scope'
import { useWindow } from '@/lib/window'
import { Attention } from './AttentionList'
import { Changes } from './Changes'
import { EmptyProject } from './EmptyProject'
import { Figures, figuresOf } from './Figures'
import { StatusLine } from './StatusLine'
import { ISSUE_LIMIT, SEEN_MS, alertItems, incidentItems, issueItems, lastSpan, notes, oldest, podItems, serviceItems, silentItems, stateOf, status, unchecked, type Source } from './attention'

const TICK_MS = 15_000
const POLL = { refetchInterval: 30_000 }
const CHANGES_FLOOR_MS = 24 * 60 * 60 * 1000

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function Home() {
  const { ms: windowMs, label, short } = useWindow()
  const { project } = useScope()
  const projects = useProjects()
  const { placement, place } = usePlacement()
  const now = useNow()
  const incidents = useIncidents('open')
  const alerts = useAlerts()
  const inWindow = useServiceTable('', windowMs, placement, POLL)
  const lately = useServiceTable('', SEEN_MS, placement, POLL)
  const issues = useIssues({ ...ANY_ISSUE, rangeMs: windowMs, limit: ISSUE_LIMIT }, POLL)
  const cluster = useCluster(placement.cluster, placement.namespace)
  const changesMs = Math.max(windowMs, CHANGES_FLOOR_MS)
  const releases = useReleases(changesMs, '', POLL)
  const series = useServiceSeries(null, '', windowMs, placement, 0, POLL)
  const previous = useServiceSeries(null, '', windowMs, placement, windowMs, POLL)

  const scope = projects.find((p) => p.id === project)?.name ?? 'all projects'
  const servicesFailed = inWindow.failed ?? lately.failed
  const cut = issues.issues.length >= ISSUE_LIMIT
  const issuesState = stateOf(!issues.pending, issues.failed)
  const sources: Source[] = [
    { name: 'incidents', state: stateOf(incidents.incidents !== undefined, incidents.failed) },
    { name: 'alerts', state: stateOf(alerts.alerts !== undefined, alerts.failed) },
    { name: 'services', state: stateOf(!inWindow.pending && !lately.pending, servicesFailed) },
    { name: 'issues', state: issuesState === 'ok' && cut ? 'partial' : issuesState },
    { name: 'pods', state: stateOf(!cluster.pending, cluster.failed, [503]) },
  ]
  const missing = unchecked(sources)

  const answered = !inWindow.pending && !lately.pending && !servicesFailed && !series.pending && !series.failed
  if (answered && !lately.services.length && !inWindow.services.length && !series.series?.requests && !isPlaced(placement)) return <EmptyProject />

  const fetchedAt = lately.updatedAt || now
  const open = incidentItems(incidents.incidents ?? [])
  const items = [
    ...open,
    ...alertItems(alerts.alerts ?? [], now),
    ...serviceItems(inWindow.services, label),
    ...issueItems(issues.issues, releases.releases, windowMs, issues.updatedAt || now),
    ...podItems(cluster.view),
    ...silentItems(lately.services, fetchedAt),
  ]
  const overall = status(items, sources, lastSpan(lately.services), fetchedAt)
  const checked = {
    services: lately.services.length,
    rules: alerts.alerts === undefined ? null : alerts.alerts.filter((rule) => rule.enabled).length,
    pods: isReporting(cluster.view) ? cluster.view.pods.length : null,
    incidents: incidents.incidents === undefined ? null : open.length,
  }
  const updatedMs = oldest([
    { at: incidents.updatedAt, failed: incidents.failed },
    { at: alerts.updatedAt, failed: alerts.failed },
    { at: inWindow.updatedAt, failed: inWindow.failed },
    { at: lately.updatedAt, failed: lately.failed },
    { at: issues.updatedAt, failed: issues.failed },
    { at: cluster.updatedAt, failed: cluster.failed },
    { at: series.updatedAt, failed: series.failed },
    { at: previous.updatedAt, failed: previous.failed },
    { at: releases.updatedAt, failed: releases.failed },
  ])
  const read = (one: typeof series) => (one.failed ? 'failed' : one.pending ? 'pending' : 'ok')
  const figures = figuresOf(series.series, previous.series, windowMs, label, read(series), placementSearch(placement), read(previous))

  return (
    <>
      <PageHeader title="Overview" meta={`${scope} · last ${label}`} />
      <PlacementPicker collapsible placement={placement} onChange={place} windowMs={windowMs} />
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <StatusLine status={overall} checked={checked} missing={missing} notes={notes(sources)} updatedMs={updatedMs} windowLabel={label} now={now} />
        </div>
        <div className="lg:order-3">
          <Attention items={items} status={overall} missing={missing} />
        </div>
        <div className="lg:order-4">
          <Changes releases={releases.releases} pending={releases.pending} failed={Boolean(releases.failed)} windowMs={changesMs} now={now} />
        </div>
        <div className="lg:order-2 lg:col-span-2">
          <Figures figures={figures} short={short} />
        </div>
      </div>
    </>
  )
}
