import { useEffect, useState } from 'react'
import { useOrganisations } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ft/bits'
import { useAlerts } from '@/data/alerts'
import { useIncidents } from '@/data/incidents'
import { isReporting, useCluster } from '@/data/infra'
import { ANY as ANY_ISSUE, useIssues } from '@/data/issues'
import { isPlaced, placementSearch, usePlacement } from '@/data/placement'
import { useProjects } from '@/data/projects'
import { useReleases } from '@/data/releases'
import { since, useServiceSeries, useServiceTable } from '@/data/services'
import { useSearchParam } from '@/lib/router'
import { useScope } from '@/lib/scope'
import { WINDOWS, openOn, openingWindow, useWindow } from '@/lib/window'
import { RuleEditor } from '@/pages/alerts/RuleEditor'
import { DeclareIncident } from '@/pages/Incidents'
import { Attention } from './AttentionList'
import { Changes } from './Changes'
import { EmptyProject } from './EmptyProject'
import { figuresOf } from './figures'
import { openIssues, tilesOf } from './hub'
import { Placing } from './Placing'
import { ServicesTable } from './ServicesTable'
import { Tiles } from './Tiles'
import { ISSUE_LIMIT, SEEN_MS, alertItems, incidentItems, issueItems, lastSpan, notes, oldest, podItems, serviceItems, silentItems, stateOf, status, unchecked, type Source } from './attention'

const TICK_MS = 15_000
const POLL = { refetchInterval: 30_000 }
const CHANGES_FLOOR_MS = 24 * 60 * 60 * 1000
const WIDEST_MS = WINDOWS[WINDOWS.length - 1].ms

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
  const asked = useSearchParam('window')
  const { project } = useScope()
  const projects = useProjects()
  const { placement, place } = usePlacement()
  const { active } = useOrganisations()
  const [creating, setCreating] = useState(false)
  const [declaring, setDeclaring] = useState(false)
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
  const quiet = !inWindow.pending && !lately.pending && !servicesFailed && !inWindow.services.length && !lately.services.length
  const older = useServiceTable('', WIDEST_MS, placement, { enabled: quiet })

  useEffect(() => {
    if (asked !== undefined || isPlaced(placement) || inWindow.pending || lately.pending || servicesFailed) return
    if (inWindow.services.length) openOn(null)
    else if (lately.services.length) openOn(openingWindow(lastSpan(lately.services), Date.now()))
    else if (!older.pending) openOn(older.failed ? null : openingWindow(lastSpan(older.services), Date.now()))
  })

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

  const neverSeen = quiet && !older.pending && !older.failed && !older.services.length
  if (neverSeen && !series.pending && !series.failed && !series.series?.requests && !isPlaced(placement)) return <EmptyProject />

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
  const where = placementSearch(placement)
  const figures = figuresOf(series.series, previous.series, windowMs, label, read(series), where, read(previous))
  const failedSpans = inWindow.failed || inWindow.pending ? null : inWindow.services.reduce((sum, service) => sum + service.errors, 0)
  const counted = openIssues(issues.issues, windowMs, issues.updatedAt || now)
  const tiles = tilesOf(
    figures,
    { value: failedSpans, note: inWindow.failed ? 'Could not read the services.' : inWindow.pending ? 'Reading the services…' : null },
    { value: issues.failed || issues.pending ? null : counted.open, note: issues.failed ? 'Could not read the issues.' : issues.pending ? 'Reading the issues…' : null, fresh: counted.fresh, cut },
    windowMs,
    now,
    short,
    where,
  )
  const total = inWindow.services.length
  const meta = `${scope} · ${total.toLocaleString('en-US')} ${total === 1 ? 'service' : 'services'} · ${updatedMs === null ? 'not updated yet' : `updated ${since(updatedMs)}`}`
  const mayChange = active?.role === 'owner' || active?.role === 'admin'

  return (
    <>
      <div className="relative flex flex-col gap-3">
        <PageHeader title="Overview" meta={meta}>
          {mayChange ? <Button onClick={() => setCreating(true)}>Create an alert</Button> : null}
          {active ? <Button variant="primary" onClick={() => setDeclaring(true)}>Declare an incident</Button> : null}
        </PageHeader>
        <Placing placement={placement} onChange={place} windowMs={windowMs} />
      </div>
      <div className="grid min-w-0 grid-cols-12 gap-3.5 max-[1100px]:grid-cols-1">
        <Tiles tiles={tiles} />
        <Attention className="col-span-8 max-[1100px]:col-span-full" items={items} status={overall} missing={missing} notes={notes(sources)} checked={checked} now={now} />
        <Changes className="col-span-4 max-[1100px]:col-span-full" releases={releases.releases} pending={releases.pending} failed={Boolean(releases.failed)} windowMs={changesMs} now={now} />
        <ServicesTable services={inWindow.services} total={total} releases={releases.releases} pending={inWindow.pending} failed={Boolean(inWindow.failed)} place={where} now={now} />
      </div>
      {mayChange ? <RuleEditor rule={null} open={creating} onClose={() => setCreating(false)} /> : null}
      <DeclareIncident open={declaring} onClose={() => setDeclaring(false)} />
    </>
  )
}
