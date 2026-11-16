import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { ArrowLeft, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, because } from '@/auth/client'
import { EmptyState } from '@/components/ft/bits'
import { FIXTURE_DOC } from '@/components/ft/panels/fixtures'
import type { Mark } from '@/components/ft/panels/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { FIXTURE_ID, useDashboard, type DashboardDoc, type Source } from '@/data/dashboards'
import { firstDeploys, releasePath, useDeploys } from '@/data/releases'
import { boundsOf, useZoom } from '@/lib/bounds'
import { stamp } from '@/lib/format'
import { Link, useParams, useSearchParam } from '@/lib/router'
import { windowOf } from '@/lib/window'
import { placed } from './layout'
import { PanelCard } from './PanelCard'
import { VariablePicker } from './VariablePicker'
import { choiceOf, decodeVars, encodeVars, isReserved, sentVariables, type Choice } from './variables'

const ROW_PX = 56
const GAP_PX = 12

const REFRESH = [
  { value: '0', label: 'Off' },
  { value: '10', label: '10 s' },
  { value: '30', label: '30 s' },
  { value: '60', label: '1 min' },
  { value: '300', label: '5 min' },
]

const firstMetric = (doc: DashboardDoc): string =>
  doc.panels.flatMap((panel) => panel.queries).flatMap((query) => query.aggregations).flatMap((one) => ('metric' in one ? [one.metric] : []))[0] ?? ''

export function DashboardPage() {
  const { id } = useParams()
  const fixture = id === FIXTURE_ID
  const emptyFixture = useSearchParam('empty') !== undefined
  const live = useDashboard(fixture ? undefined : id)
  const doc: DashboardDoc | null = fixture ? FIXTURE_DOC : live.dashboard?.doc ?? null
  const name = fixture ? 'Fixture dashboard' : live.dashboard?.name ?? ''
  const tags = fixture ? ['sample data'] : live.dashboard?.tags ?? []
  const source: Source = fixture ? (emptyFixture ? 'fixture-empty' : 'fixture') : 'server'

  const navigate = useRouterNavigate()
  const windowKey = useSearchParam('window')
  const rawVars = useSearchParam('vars')
  const zoom = useZoom()
  const rangeMs = windowKey ? windowOf(windowKey).ms : (doc?.duration ?? 3600) * 1000
  const [tick, setTick] = useState(0)
  const [every, setEvery] = useState('0')

  useEffect(() => {
    const seconds = Number(every)
    if (!seconds) return
    const timer = window.setInterval(() => {
      if (!document.hidden) setTick((value) => value + 1)
    }, seconds * 1000)
    return () => window.clearInterval(timer)
  }, [every])

  const zoomFrom = zoom?.from
  const zoomTill = zoom?.to
  const bounds = useMemo(() => boundsOf(rangeMs, zoomFrom !== undefined && zoomTill !== undefined ? { from: zoomFrom, to: zoomTill } : null), [rangeMs, zoomFrom, zoomTill, tick])
  const range = useMemo(() => ({ fromNs: bounds.from * 1e6, toNs: bounds.to * 1e6 }), [bounds])
  const chosen = useMemo(() => decodeVars(rawVars), [rawVars])
  const sent = useMemo(() => (doc ? sentVariables(doc.variables, chosen) : {}), [doc, chosen])
  const items = useMemo(() => (doc ? placed(doc) : []), [doc])

  const found = useDeploys(fixture ? null : bounds.from, fixture ? null : bounds.to)
  const deploys = useMemo(() => firstDeploys(found), [found])
  const markers: Mark[] = useMemo(
    () =>
      fixture
        ? [{ atNs: range.fromNs + (range.toNs - range.fromNs) * 0.4, label: 'checkout v2.3.1', to: '/releases' }]
        : deploys.map((deploy) => ({ atNs: deploy.atMs * 1e6, label: `${deploy.service} ${deploy.version}`, to: releasePath(deploy.service, deploy.version) })),
    [fixture, range, deploys],
  )

  const patch = useCallback(
    (part: Record<string, string | undefined>) => void navigate({ to: '.' as never, search: ((was: Record<string, unknown>) => ({ ...was, ...part })) as never, replace: true }),
    [navigate],
  )
  const setChoice = (variable: string, choice: Choice) => {
    if (!isReserved(variable)) patch({ vars: encodeVars({ ...chosen, [variable]: choice }) })
  }
  const zoomTo = useCallback((from: number, to: number) => patch({ from: String(Math.round(from)), to: String(Math.round(to)) }), [patch])
  const refresh = () => setTick((value) => value + 1)

  if (!fixture && live.pending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (!doc) {
    const missing = live.failed instanceof ApiError && live.failed.status === 404
    return (
      <EmptyState title={missing ? 'Dashboard not found' : 'The dashboard could not be read'} actions={<Button asChild size="sm"><Link to="/dashboards">All dashboards</Link></Button>}>
        {missing ? 'It was deleted, or it belongs to another project.' : because(live.failed, 'The server did not answer.')}
      </EmptyState>
    )
  }

  const metric = firstMetric(doc)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/dashboards" aria-label="All dashboards" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft className="size-4" aria-hidden /></Link>
        <h1 className="m-0 min-w-0 truncate text-title">{name}</h1>
        {tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
        <span className="flex-1" />
        {zoom ? (
          <Button size="sm" onClick={() => patch({ from: undefined, to: undefined })}>
            <X aria-hidden />Reset zoom
          </Button>
        ) : null}
        <span className="font-mono text-caption text-muted-foreground" aria-label="Time range">
          {zoom ? `${stamp(zoom.from)} to ${stamp(zoom.to)}` : `Last ${windowKey ? windowOf(windowKey).label : formatSeconds(doc.duration)}`}
        </span>
        <NativeSelect aria-label="Auto-refresh" value={every} onChange={(event) => setEvery(event.target.value)} className="h-7 w-[112px] text-[12.5px]">
          {REFRESH.map((option) => <option key={option.value} value={option.value}>{option.value === '0' ? 'No refresh' : `Every ${option.label}`}</option>)}
        </NativeSelect>
        <Button size="icon-sm" variant="outline" aria-label="Refresh the panels" title="Refresh the panels" onClick={refresh}><RefreshCw aria-hidden /></Button>
      </div>
      {doc.variables.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Variables">
          {doc.variables.map((variable) => (
            <VariablePicker key={variable.name} variable={variable} choice={choiceOf(variable, chosen)} rangeMs={rangeMs} metric={metric} onChange={(choice) => setChoice(variable.name, choice)} />
          ))}
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="This dashboard has no panels yet">Panels come with the editor. Until then a dashboard can be created over the API.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:auto-rows-[var(--row)] md:gap-[var(--gap)]" style={{ ['--row' as string]: `${ROW_PX}px`, ['--gap' as string]: `${GAP_PX}px` }}>
          {items.map(({ panel, x, y, w, h }) => (
            <div
              key={panel.id}
              className="min-h-[max(200px,calc(var(--h)*var(--row)))] min-w-0 md:min-h-0 md:[grid-column:var(--x)/span_var(--w)] md:[grid-row:var(--y)/span_var(--h)]"
              style={{ ['--x' as string]: x + 1, ['--y' as string]: y + 1, ['--w' as string]: w, ['--h' as string]: h }}
            >
              <PanelCard panel={panel} range={range} sent={sent} source={source} markers={markers} onZoom={zoomTo} />
            </div>
          ))}
        </div>
      )}
      <p className="m-0 hidden text-caption text-muted-foreground md:block">Drag a range on a chart to zoom every panel. Hover a chart and press P to pin its tooltip.</p>
    </div>
  )
}

function formatSeconds(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`
  if (seconds % 60 === 0) return `${seconds / 60} m`
  return `${seconds} s`
}
