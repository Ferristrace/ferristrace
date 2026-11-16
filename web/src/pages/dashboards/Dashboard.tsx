import { useBlocker, useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { ArrowLeft, Download, Pencil, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, because, get, json } from '@/auth/client'
import { EmptyState } from '@/components/ft/bits'
import type { Mark } from '@/components/ft/panels/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { FIXTURE_ID, useDashboard, useDeleteDashboard, useReplaceDashboard, type Dashboard, type DashboardDoc, type Source } from '@/data/dashboards'
import { firstDeploys, releasePath, useDeploys } from '@/data/releases'
import { boundsOf, useZoom } from '@/lib/bounds'
import { stamp } from '@/lib/format'
import { Link, useLocation, useParams, useSearchParam } from '@/lib/router'
import { windowOf } from '@/lib/window'
import { exportDashboard } from './editor/actions'
import { EditBar } from './editor/EditBar'
import { EditorEnvProvider } from './editor/env'
import { GridEditor } from './editor/GridEditor'
import { PanelPane } from './editor/PanelPane'
import { PanelPicker } from './editor/PanelPicker'
import { SettingsDialog } from './editor/SettingsDialog'
import { VariablesDialog } from './editor/VariablesDialog'
import { addPanel, canAddPanel, deletePanel, draftIssues, draftOf, duplicatePanel, fileOf, isDirty, makePanel, setDoc, setLayout, updatePanel, type Draft } from './editor/draft'
import { formatDuration } from './editor/duration'
import { nudge, reorder, resizeBy, setSize, type SizeKey } from './editor/grid'
import { saveFixture, useFixtureDraft } from './editor/fixtureStore'
import { KIND_INFO } from './editor/kinds'
import { cannotWrite, describeSave, type SaveFailure } from './editor/saveError'
import { beginPanel, edit, endPanel, failed, hasConflict, hasUnsaved, openSession, saved, select, type Session } from './editor/session'
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

function useTextParam(name: string): string | undefined {
  const search = useLocation().search as Record<string, unknown>
  const value = search[name]
  return value === undefined || value === null ? undefined : String(value)
}

const where = (item: { x: number; y: number; w: number; h: number } | undefined, title: string): string => (item ? `${title}: column ${item.x + 1}, row ${item.y + 1}, ${item.w} wide, ${item.h} high.` : '')

export function DashboardPage() {
  const { id } = useParams()
  return <DashboardBody key={id} />
}

function DashboardBody() {
  const { id } = useParams()
  const fixture = id === FIXTURE_ID
  const emptyFixture = useSearchParam('empty') !== undefined
  const live = useDashboard(fixture ? undefined : id)
  const sample = useFixtureDraft()
  const stored = useMemo<Draft | null>(() => (fixture ? sample : live.dashboard ? draftOf(live.dashboard) : null), [fixture, sample, live.dashboard])

  const navigate = useRouterNavigate()
  const wantsEdit = useTextParam('edit') === 'on'
  const panelParam = useTextParam('panel')
  const [session, setSession] = useState<Session | null>(null)
  const [denied, setDenied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [settings, setSettingsOpen] = useState(false)
  const [variablesOpen, setVariablesOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const leaving = useRef(false)
  const [deleteFailure, setDeleteFailure] = useState<SaveFailure | null>(null)
  const replace = useReplaceDashboard()
  const client = useQueryClient()
  const [conflict, setConflict] = useState<Dashboard | null>(null)
  const remove = useDeleteDashboard()

  const editing = wantsEdit && session !== null
  const draft = editing ? session.draft : null
  const doc: DashboardDoc | null = draft ? draft.doc : stored?.doc ?? null
  const name = draft ? draft.name : stored?.name ?? ''
  const tags = draft ? draft.tags : stored?.tags ?? []
  const source: Source = fixture ? (emptyFixture ? 'fixture-empty' : 'fixture') : 'server'
  const windowKey = useSearchParam('window')
  const rawVars = useSearchParam('vars')
  const zoom = useZoom()
  const rangeMs = windowKey ? windowOf(windowKey).ms : (doc?.duration ?? 3600) * 1000
  const [tick, setTick] = useState(0)
  const [every, setEvery] = useState('0')

  const current = fixture || !live.fetching
  useEffect(() => {
    if (wantsEdit && !session && stored && !denied && current) setSession(openSession(stored, panelParam ?? null))
    if (!wantsEdit && session) setSession(null)
  }, [wantsEdit, session, stored, denied, panelParam, current])

  useEffect(() => {
    if (session && stored && current && !saving && !hasUnsaved(session) && stored.updatedAt !== session.base.updatedAt) setSession(openSession(stored, session.selected))
  }, [session, stored, current, saving])

  const dirty = hasUnsaved(session)
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirty && !leaving.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  })

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
  const env = useMemo(() => ({ fixture, source, variables: doc?.variables ?? [], range, sent }), [fixture, source, doc, range, sent])

  const patch = useCallback(
    (part: Record<string, string | undefined>) => void navigate({ to: '.' as never, search: ((was: Record<string, unknown>) => ({ ...was, ...part })) as never, replace: true }),
    [navigate],
  )
  const setChoice = (variable: string, choice: Choice) => {
    if (!isReserved(variable)) patch({ vars: encodeVars({ ...chosen, [variable]: choice }) })
  }
  const zoomTo = useCallback((from: number, to: number) => patch({ from: String(Math.round(from)), to: String(Math.round(to)) }), [patch])
  const refresh = () => setTick((value) => value + 1)

  const change = (fn: (draft: Draft) => Draft, status = '') => setSession((was) => (was ? edit(was, fn, status) : was))
  const startEditing = () => patch({ edit: 'on' })
  const stopEditing = () => {
    patch({ edit: undefined, panel: undefined })
  }

  const save = async (overwrite = false) => {
    if (!session || !id) return
    if (draftIssues(session.draft).length > 0) return
    const file = fileOf(session.draft)
    setSaving(true)
    try {
      if (!fixture && !overwrite) {
        const remote = await json<Dashboard>(await get(`/api/v1/dashboards/${encodeURIComponent(id)}`))
        if (hasConflict(session.base.updatedAt, remote.updated_at_ms)) {
          setConflict(remote)
          return
        }
      }
      const next = fixture ? saveFixture(file, true) : draftOf(await replace.mutateAsync({ id, ...file }))
      setSession((was) => (was ? saved(was, next) : was))
      toast.success('Dashboard saved')
    } catch (error) {
      const failure = describeSave(error)
      setSession((was) => (was ? failed(was, failure) : was))
      if (cannotWrite(failure)) setDenied(true)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (session && isDirty(session.base, session.draft)) setDiscarding(true)
    else stopEditing()
  }

  const removeDashboard = () => {
    if (!id) return
    setDeleteFailure(null)
    remove.mutate(id, {
      onSuccess: () => {
        leaving.current = true
        toast.success(`Deleted ${name}`)
        void navigate({ to: '/dashboards' as never })
      },
      onError: (error) => setDeleteFailure(describeSave(error)),
    })
  }

  const actionsFor = (panelId: string) => {
    const panel = session?.draft.doc.panels.find((one) => one.id === panelId)
    const title = panel?.title || 'Panel'
    const moved = (layout: DashboardDoc['layout']) => where(layout.find((item) => item.panel === panelId), title)
    return {
      onEdit: () => panel && setSession((was) => (was ? beginPanel(was, panel, false) : was)),
      onDuplicate: () =>
        setSession((was) => {
          if (!was || !canAddPanel(was.draft)) return was
          const out = duplicatePanel(was.draft, panelId)
          return { ...select(edit(was, () => out.draft, `Duplicated ${title}.`), out.id) }
        }),
      onDelete: () => setSession((was) => (was ? select(edit(was, (current) => deletePanel(current, panelId), `Deleted ${title}.`), null) : was)),
      onSize: (key: SizeKey) => setSession((was) => (was ? select(edit(was, (current) => { const layout = setSize(current.doc.layout, panelId, key); return setLayout(current, layout) }, moved(setSize(was.draft.doc.layout, panelId, key))), panelId) : was)),
      onNudge: (dx: number, dy: number) => setSession((was) => (was ? select(edit(was, (current) => setLayout(current, nudge(current.doc.layout, panelId, dx, dy)), moved(nudge(was.draft.doc.layout, panelId, dx, dy))), panelId) : was)),
      onResize: (dw: number, dh: number) => setSession((was) => (was ? select(edit(was, (current) => setLayout(current, resizeBy(current.doc.layout, panelId, dw, dh)), moved(resizeBy(was.draft.doc.layout, panelId, dw, dh))), panelId) : was)),
      onReorder: (by: number) => setSession((was) => (was ? select(edit(was, (current) => setLayout(current, reorder(current.doc.layout, panelId, by)), `Moved ${title} ${by < 0 ? 'earlier' : 'later'}.`), panelId) : was)),
    }
  }

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
  const pane = editing ? session.editing : null

  return (
    <EditorEnvProvider value={env}>
      <div className="flex flex-col gap-3" inert={saving || undefined}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link to="/dashboards" aria-label="All dashboards" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft className="size-4" aria-hidden /></Link>
          <h1 className="m-0 min-w-0 truncate text-title">{name || 'Untitled dashboard'}</h1>
          {tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
          <span className="flex-1" />
          {zoom ? (
            <Button size="sm" onClick={() => patch({ from: undefined, to: undefined })}>
              <X aria-hidden />Reset zoom
            </Button>
          ) : null}
          <span className="font-mono text-caption text-muted-foreground" aria-label="Time range">
            {zoom ? `${stamp(zoom.from)} to ${stamp(zoom.to)}` : `Last ${windowKey ? windowOf(windowKey).label : formatDuration(doc.duration)}`}
          </span>
          <NativeSelect aria-label="Auto-refresh" value={every} onChange={(event) => setEvery(event.target.value)} className="h-7 w-[112px] text-[12.5px]">
            {REFRESH.map((option) => <option key={option.value} value={option.value}>{option.value === '0' ? 'No refresh' : `Every ${option.label}`}</option>)}
          </NativeSelect>
          <Button size="icon-sm" variant="outline" aria-label="Refresh the panels" title="Refresh the panels" onClick={refresh}><RefreshCw aria-hidden /></Button>
          {!editing && id ? (
            <>
              <Button size="sm" onClick={() => void exportDashboard(id, name).catch((error) => toast.error(because(error, 'The dashboard could not be exported')))}><Download aria-hidden />Export</Button>
              {!denied ? <Button size="sm" variant="primary" onClick={startEditing}><Pencil aria-hidden />Edit</Button> : null}
            </>
          ) : null}
        </div>

        {editing && draft && !pane ? (
          <EditBar
            dirty={isDirty(session.base, session.draft)}
            saving={saving}
            issues={draftIssues(draft)}
            failure={session.failure}
            panels={draft.doc.panels.length}
            variables={draft.doc.variables.length}
            onAdd={() => setPicking(true)}
            onVariables={() => setVariablesOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onSave={() => void save()}
            onDiscard={discard}
          />
        ) : null}

        {pane && editing ? (
          <PanelPane
            key={pane.panel.id}
            initial={pane.panel}
            fresh={pane.fresh}
            range={range}
            sent={sent}
            source={source}
            onCancel={() => setSession((was) => (was ? endPanel(was) : was))}
            onApply={(panel) =>
              setSession((was) => {
                if (!was) return was
                const next = pane.fresh ? addPanel(was.draft, panel) : updatePanel(was.draft, panel)
                return endPanel(select(edit(was, () => next, `${panel.title || KIND_INFO[panel.kind].name} ${pane.fresh ? 'added' : 'updated'}.`), panel.id))
              })
            }
          />
        ) : (
          <>
            {doc.variables.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Variables">
                {doc.variables.map((variable) => (
                  <VariablePicker key={variable.name} variable={variable} choice={choiceOf(variable, chosen)} rangeMs={rangeMs} metric={metric} onChange={(choice) => setChoice(variable.name, choice)} />
                ))}
              </div>
            ) : null}
            {items.length === 0 ? (
              <EmptyState
                title="This dashboard has no panels yet"
                actions={editing ? <Button size="sm" variant="primary" onClick={() => setPicking(true)}>Add the first panel</Button> : undefined}
              >
                {editing ? 'Pick how the data is drawn, then choose what to show.' : 'Choose Edit to add the first panel.'}
              </EmptyState>
            ) : editing && draft ? (
              <GridEditor
                panels={draft.doc.panels}
                layout={draft.doc.layout}
                range={range}
                sent={sent}
                source={source}
                markers={markers}
                selected={session.selected}
                status={session.status}
                onSelect={(selected) => setSession((was) => (was ? select(was, selected) : was))}
                onLayout={(layout) => change((current) => setLayout(current, layout), 'Layout changed.')}
                canDuplicate={canAddPanel(draft)}
                actionsFor={actionsFor}
              />
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
            <p className="m-0 hidden text-caption text-muted-foreground md:block">
              {editing
                ? 'Drag the grip to move a panel and the corner to resize it. With the keyboard, focus the grip: arrows move, Shift with arrows resizes. Double click a panel to edit it.'
                : 'Drag a range on a chart to zoom every panel. Hover a chart and press P to pin its tooltip.'}
            </p>
          </>
        )}
      </div>

      {editing && draft ? (
        <>
          <PanelPicker
            open={picking}
            onOpenChange={setPicking}
            onPick={(kind) => {
              setPicking(false)
              setSession((was) => (was ? beginPanel(was, makePanel(was.draft.doc, kind), true) : was))
            }}
          />
          <VariablesDialog open={variablesOpen} onOpenChange={setVariablesOpen} doc={draft.doc} onChange={(next) => change((current) => setDoc(current, next))} />
          <SettingsDialog
            open={settings}
            onOpenChange={setSettingsOpen}
            draft={draft}
            onChange={(next) => change(() => next)}
            onDelete={fixture ? null : removeDashboard}
            deleting={remove.isPending}
            deleteFailure={deleteFailure}
          />
          <Dialog open={discarding} onOpenChange={setDiscarding}>
            <DialogContent title="Discard your changes?" description="The dashboard goes back to its last saved state.">
              <DialogFooter>
                <Button onClick={() => setDiscarding(false)}>Keep editing</Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDiscarding(false)
                    stopEditing()
                  }}
                >
                  Discard changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <Dialog open={conflict !== null} onOpenChange={(open) => { if (!open) setConflict(null) }}>
        <DialogContent title="This dashboard changed since you opened it" description="Someone saved it after you started editing. Saving now would replace their changes with yours.">
          <DialogFooter>
            <Button onClick={() => setConflict(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!conflict || !id) return
                client.setQueryData(['dashboard', id], conflict)
                setSession(openSession(draftOf(conflict), session?.selected ?? null))
                setConflict(null)
              }}
            >
              Reload (discard my edits)
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConflict(null)
                void save(true)
              }}
            >
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blocker.status === 'blocked'} onOpenChange={(open) => { if (!open) blocker.reset?.() }}>
        <DialogContent title="Leave without saving?" description="This dashboard has changes that are not saved. Leaving now loses them.">
          <DialogFooter>
            <Button onClick={() => blocker.reset?.()}>Stay and keep editing</Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>Leave and lose the changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EditorEnvProvider>
  )
}
