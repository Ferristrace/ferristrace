import { useMemo, useState } from 'react'
import { Rocket, Search, SearchX, TriangleAlert } from 'lucide-react'
import { Link, useNavigate, useParams } from '@/lib/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Kbd, Table, Td, Tr, SortTh } from '@/components/ui/misc'
import { EmptyState, Kpi, PageHeader, ServiceDot } from '@/components/ft/bits'
import { RELEASE_WINDOWS, errorRateOf, releasePath, useRelease, useReleases, type Release, type Traffic } from '@/data/releases'
import { ApiError, because } from '@/auth/client'
import { num, pct, stamp } from '@/lib/format'
import { sorted, toggled, type Sorting } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import { NotFound } from './NotFound'
import { Note, PagedFooter, PanelEmpty, Pill, Pills, SEARCH, SkeletonRows, Toolbar, usePaged } from './backend/kit'
import { releaseFirst, releaseValue, type ReleaseKey } from './backend/sortKeys'
import { ReleaseAround } from './services/ReleaseAround'

const HOT_RATE_POINTS = 1

const rateOf = (release: Release) => errorRateOf(release.requests, release.errors)

const shown = (rate: number | null) => (rate === null ? '—' : pct(rate))

const envs = (release: Release) => (release.environments.length ? release.environments.join(', ') : '—')

export function Releases() {
  const navigate = useNavigate()
  const [range, setRange] = useState('7d')
  const [q, setQ] = useState('')
  const windowMs = RELEASE_WINDOWS.find((w) => w.value === range)?.ms ?? RELEASE_WINDOWS[1].ms
  const windowLabel = RELEASE_WINDOWS.find((w) => w.value === range)?.label ?? RELEASE_WINDOWS[1].label
  const { releases, pending, failed } = useReleases(windowMs)
  const unconfigured = failed instanceof ApiError && failed.status === 503
  const [sorting, setSorting] = useState<Sorting<ReleaseKey> | null>(null)
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sorted(releases.filter((r) => `${r.service} ${r.version} ${r.environments.join(' ')}`.toLowerCase().includes(needle)), sorting, releaseValue)
  }, [releases, q, sorting])
  const dirOf = (key: ReleaseKey) => (sorting?.key === key ? sorting.dir : null)
  const sortBy = (key: ReleaseKey) => setSorting(toggled(sorting, key, releaseFirst(key)))
  const paged = usePaged(rows, `${q}|${range}|${sorting?.key}|${sorting?.dir}`)
  return (
    <>
      <PageHeader title="Releases" meta={<Pills><Pill>{releases.length} {releases.length === 1 ? 'release' : 'releases'}</Pill><Pill>last {windowLabel}</Pill></Pills>} />
      <Toolbar role="search">
        <InputGroup className={SEARCH}><Search aria-hidden /><input aria-label="Find release" placeholder="Search releases" value={q} onChange={(e) => setQ(e.target.value)} /><Kbd>/</Kbd></InputGroup>
        <NativeSelect aria-label="Window" value={range} onChange={(e) => setRange(e.target.value)} className="w-auto max-md:flex-1">
          {RELEASE_WINDOWS.map((w) => <option key={w.value} value={w.value}>Window: {w.label}</option>)}
        </NativeSelect>
      </Toolbar>
      {unconfigured ? (
        <EmptyState title="Releases are not configured">This deployment has no span store, so there are no releases to read. Configure one to see them here.</EmptyState>
      ) : failed ? (
        <EmptyState title="The releases could not be read">{because(failed, 'The span store did not answer.')}</EmptyState>
      ) : pending && releases.length === 0 ? (
        <Card className="overflow-hidden"><SkeletonRows label="Reading the releases" /></Card>
      ) : releases.length === 0 ? (
        <EmptyState
          icon={<Rocket />}
          title="No release in this window"
          code={'OTEL_RESOURCE_ATTRIBUTES=service.version=1.4.2,deployment.environment.name=production'}
        >
          A release appears the first time a span carries a service.version. Set it on your service, or send a log record with event.name set to deploy, the service name and service.version from your CI.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Releases</CardTitle><CardKind>Table</CardKind><span className="text-caption text-muted-foreground">{rows.length} of {releases.length}</span></CardHeader>
          {rows.length === 0 ? (
            <PanelEmpty icon={<SearchX />} title="No release matches" actions={<Button size="sm" onClick={() => setQ('')}>Clear the search</Button>}>Try another service, version or environment.</PanelEmpty>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Releases">
                <thead><tr><SortTh label="Release" dir={dirOf('release')} onSort={() => sortBy('release')} /><SortTh label="Environments" dir={dirOf('environments')} onSort={() => sortBy('environments')} className="w-[160px]" /><SortTh label="First seen" dir={dirOf('first')} onSort={() => sortBy('first')} className="w-[170px]" /><SortTh label="Last seen" dir={dirOf('last')} onSort={() => sortBy('last')} className="w-[170px]" /><SortTh label="Requests" numeric dir={dirOf('requests')} onSort={() => sortBy('requests')} className="w-[100px]" /><SortTh label="Error rate" numeric dir={dirOf('err')} onSort={() => sortBy('err')} className="w-[100px]" /><SortTh label="New issues" numeric dir={dirOf('issues')} onSort={() => sortBy('issues')} className="w-[100px]" /></tr></thead>
                <tbody>
                  {paged.shown.map((r) => {
                    const to = releasePath(r.service, r.version)
                    const rate = rateOf(r)
                    return (
                      <Tr key={`${r.service}@${r.version}`} onClick={() => navigate(to)} className="cursor-pointer">
                        <Td className="h-12">
                          <span className="flex flex-col leading-5">
                            <Link to={to} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-foreground">{r.version}</Link>
                            <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"><ServiceDot name={r.service} />{r.service}</span>
                          </span>
                        </Td>
                        <Td className="text-control">{envs(r)}</Td>
                        <Td className="font-mono text-control">{stamp(r.firstSeenMs)}</Td>
                        <Td className="font-mono text-control">{stamp(r.lastSeenMs)}</Td>
                        <Td numeric>{num(r.requests)}</Td>
                        <Td numeric>{shown(rate)}</Td>
                        <Td numeric className={cn(r.newIssues > 0 && 'font-semibold text-destructive-text')}>{r.newIssues}</Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          )}
          <PagedFooter paged={paged} noun="releases" />
          <Note>From <span className="font-mono">service.version</span> on your spans and the deploy events your CI sends. Counts are server and consumer spans since the release was first seen. New issues are exceptions first seen while the release was the newest of its service.</Note>
        </Card>
      )}
    </>
  )
}

function Around({ label, traffic }: { label: string; traffic: Traffic }) {
  const rate = traffic.errorRate === null ? null : traffic.errorRate * 100
  return <Kpi label={label} value={shown(rate)} sub={`${num(traffic.errors)} errors in ${num(traffic.requests)} requests`} />
}

export function ReleaseDetail() {
  const { service, version } = useParams()
  const { release: r, pending, failed } = useRelease(service, version)
  if (failed instanceof ApiError && failed.status === 404) return <NotFound />
  if (failed) return <EmptyState title="The release could not be read">{because(failed, 'The span store did not answer.')}</EmptyState>
  if (pending || !r) return <EmptyState title="Reading the release…">Asking the span store.</EmptyState>
  const before = r.before.errorRate === null ? null : r.before.errorRate * 100
  const after = r.after.errorRate === null ? null : r.after.errorRate * 100
  const regressed = before !== null && after !== null && after - before >= HOT_RATE_POINTS
  const change = before === null || after === null ? '—' : `${after - before >= 0 ? '+' : '−'}${Math.abs(after - before).toFixed(1)} pts`
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-control"><Link to="/releases">Releases</Link><span className="text-faint-foreground"> / </span><span className="font-mono">{r.service} {r.version}</span></nav>
      <PageHeader
        tabs={false}
        title={<span className="inline-flex items-center gap-2.5"><Rocket className="size-5 text-muted-foreground" aria-hidden /><span className="font-mono">{r.version}</span></span>}
        meta={regressed ? <Badge variant="warning"><TriangleAlert />Error rate rose after the deploy</Badge> : null}
      >
        <Button asChild size="sm"><Link to={`/services/${encodeURIComponent(r.service)}`}>Open {r.service}</Link></Button>
      </PageHeader>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-control text-muted-foreground">
        <span>Service <span className="font-mono text-foreground">{r.service}</span></span>
        <span>Environments <span className="font-mono text-foreground">{envs(r)}</span></span>
        <span>First seen <span className="font-mono text-foreground">{stamp(r.firstSeenMs)}</span></span>
        <span>Last seen <span className="font-mono text-foreground">{stamp(r.lastSeenMs)}</span></span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Around label="Error rate, hour before" traffic={r.before} />
        <Around label="Error rate, hour after" traffic={r.after} />
        <Kpi label="Change" value={change} sub="hour after vs hour before, whole service" tone={regressed ? 'warn' : undefined} />
        <Kpi label="New issues" value={String(r.issues.length)} sub="first seen with this release" tone={r.issues.length ? 'err' : undefined} />
        <Kpi label="Requests" value={num(r.requests)} sub={`${num(r.errors)} with errors`} />
      </div>
      <ReleaseAround release={r} />
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Issues introduced</CardTitle><CardKind>List</CardKind><span className="text-caption text-muted-foreground">{r.issues.length} {r.issues.length === 1 ? 'issue' : 'issues'}</span></CardHeader>
        {r.issues.length === 0 ? <p className="m-0 px-4 py-3 text-control text-muted-foreground">No exception was first seen while this release was the newest of {r.service}.</p> : null}
        {r.issues.map((issue) => (
          <Link key={issue.fingerprint} to={`/issues/${issue.fingerprint}`} className="flex flex-col gap-0.5 border-b border-border-subtle px-4 py-2 text-foreground no-underline last:border-b-0 hover:bg-row-hover">
            <span className="flex items-baseline gap-2"><span className="flex-1 truncate font-mono text-control font-semibold text-destructive-text">{issue.exceptionType}</span><span className="font-mono text-caption">{num(issue.events)}</span></span>
            <span className="flex gap-2 text-caption text-muted-foreground"><span className="truncate font-mono">{issue.message}</span><span className="ml-auto shrink-0 font-mono">{stamp(issue.firstSeenMs)}</span></span>
          </Link>
        ))}
      </Card>
    </>
  )
}
