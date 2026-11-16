import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { Copy, Download, LayoutDashboard, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { because } from '@/auth/client'
import { EmptyState, PageHeader } from '@/components/ft/bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Pager } from '@/components/ui/pager'
import { InputGroup } from '@/components/ui/input'
import { Skeleton, Table, Td, Th, Tr } from '@/components/ui/misc'
import { FIXTURE_ID, useCloneDashboard, useDashboards, useDeleteDashboard, type DashboardSummary } from '@/data/dashboards'
import { stamp } from '@/lib/format'
import { pagesOf } from '@/lib/paging'
import { Link } from '@/lib/router'
import { cn } from '@/lib/utils'
import { exportDashboard } from './editor/actions'
import { ConfirmDelete, ImportDialog, NewDashboardDialog } from './editor/DashboardDialogs'
import { describeSave, type SaveFailure } from './editor/saveError'
import { PickProject } from './PickProject'

export const matching = (dashboards: DashboardSummary[], text: string, tags: string[]): DashboardSummary[] => {
  const needle = text.trim().toLowerCase()
  return dashboards.filter((one) => (needle === '' || one.name.toLowerCase().includes(needle)) && tags.every((tag) => one.tags.includes(tag)))
}

export function Dashboards() {
  const { dashboards, project, pending, failed } = useDashboards()
  const navigate = useRouterNavigate()
  const clone = useCloneDashboard()
  const remove = useDeleteDashboard()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [target, setTarget] = useState<DashboardSummary | null>(null)
  const [deleteFailure, setDeleteFailure] = useState<SaveFailure | null>(null)
  const open = (id: string, edit: boolean) => void navigate({ to: `/dashboards/${id}` as never, search: (edit ? { edit: 'on' } : {}) as never })
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const tags = useMemo(() => [...new Set(dashboards.flatMap((one) => one.tags))].sort(), [dashboards])
  const shown = useMemo(() => matching(dashboards, text, picked), [dashboards, text, picked])
  const toggle = (tag: string) => {
    setPage(1)
    setPicked((current) => (current.includes(tag) ? current.filter((one) => one !== tag) : [...current, tag]))
  }
  const at = Math.min(page, pagesOf(shown.length, size))
  const visible = useMemo(() => shown.slice((at - 1) * size, at * size), [shown, at, size])

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboards" meta={project ? <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-caption font-semibold text-muted-foreground">{dashboards.length} {dashboards.length === 1 ? 'dashboard' : 'dashboards'}</span> : undefined}>
        <Button size="sm" variant="primary" disabled={!project} onClick={() => setCreating(true)}><Plus aria-hidden />New dashboard</Button>
      </PageHeader>
      {!project ? (
        <PickProject />
      ) : failed ? (
        <EmptyState title="The dashboards could not be listed">{because(failed, 'The server did not answer.')}</EmptyState>
      ) : pending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Reading the dashboards">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <>
          {dashboards.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" role="search">
              <InputGroup className="w-[320px] max-w-full max-md:w-full"><Search aria-hidden /><input aria-label="Search dashboards by name" placeholder="Search dashboards" value={text} onChange={(event) => { setPage(1); setText(event.target.value) }} /></InputGroup>
              {tags.map((tag) => (
                <button key={tag} type="button" aria-pressed={picked.includes(tag)} onClick={() => toggle(tag)} className={cn('inline-flex h-8 cursor-pointer items-center rounded-md border px-2.5 font-mono text-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', picked.includes(tag) ? 'border-transparent bg-accent-subtle text-accent-text' : 'border-line-strong text-muted-foreground')}>{tag}</button>
              ))}
              {picked.length > 0 ? <Button size="sm" variant="ghost" onClick={() => { setPage(1); setPicked([]) }}>Clear tags</Button> : null}
              <span className="flex-1" />
              <Button disabled={!project} onClick={() => setImporting(true)}><Upload aria-hidden />Import JSON</Button>
            </div>
          ) : null}
          {dashboards.length === 0 ? (
            <EmptyState icon={<LayoutDashboard />} title="No dashboards yet">A dashboard puts traces, logs and metrics side by side with a shared time range and variables.</EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState title="No dashboard matches" actions={<Button size="sm" onClick={() => { setPage(1); setText(''); setPicked([]) }}>Clear filters</Button>}>Try another name or fewer tags.</EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table aria-label="Dashboards" className="min-w-[560px]">
                  <thead>
                    <tr>
                      <Th className="pl-4">Name</Th>
                      <Th>Tags</Th>
                      <Th>Last edited</Th>
                      <Th className="w-[120px] pr-4"><span className="sr-only">Actions</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((one) => (
                      <Tr key={one.id}>
                        <Td className="max-w-[360px] truncate pl-4"><Link to={`/dashboards/${one.id}`} className="font-semibold text-accent-text no-underline hover:underline">{one.name}</Link></Td>
                        <Td><span className="flex gap-1">{one.tags.map((tag) => <Badge key={tag} variant="outline" mono>{tag}</Badge>)}</span></Td>
                        <Td className="font-mono text-caption text-muted-foreground"><time dateTime={new Date(one.updated_at_ms).toISOString()}>{stamp(one.updated_at_ms)}</time></Td>
                        <Td className="pr-4">
                          <span className="flex justify-end gap-0.5">
                            <Button size="icon-sm" variant="ghost" title="Export as JSON" aria-label={`Export ${one.name}`} onClick={() => void exportDashboard(one.id, one.name).catch((error) => toast.error(because(error, 'The dashboard could not be exported')))}><Download aria-hidden /></Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Clone"
                              aria-label={`Clone ${one.name}`}
                              disabled={clone.isPending}
                              onClick={() => clone.mutate(one.id, { onSuccess: (made) => toast.success(`Cloned as ${made.name}`, { action: { label: 'Open', onClick: () => open(made.id, false) } }), onError: (error) => toast.error(describeSave(error).message) })}
                            >
                              <Copy aria-hidden />
                            </Button>
                            <Button size="icon-sm" variant="ghost" title="Delete" aria-label={`Delete ${one.name}`} onClick={() => { setDeleteFailure(null); setTarget(one) }}><Trash2 aria-hidden /></Button>
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <Pager total={shown.length} page={at} size={size} onPage={setPage} onSize={(next) => { setPage(1); setSize(next) }} noun="dashboards" className="border-t" />
            </Card>
          )}
        </>
      )}
      <NewDashboardDialog open={creating} onOpenChange={setCreating} onCreated={(made) => { setCreating(false); open(made.id, true) }} />
      <ImportDialog open={importing} onOpenChange={setImporting} onImported={(made) => { setImporting(false); toast.success(`Imported ${made.name}`); open(made.id, false) }} />
      <ConfirmDelete
        open={target !== null}
        onOpenChange={(next) => { if (!next) setTarget(null) }}
        name={target?.name ?? ''}
        pending={remove.isPending}
        failure={deleteFailure}
        onConfirm={() => target && remove.mutate(target.id, { onSuccess: () => { toast.success(`Deleted ${target.name}`); setTarget(null) }, onError: (error) => setDeleteFailure(describeSave(error)) })}
      />
      <FixtureHelp />
    </div>
  )
}

export function FixtureHelp({ dev = import.meta.env.DEV }: { dev?: boolean }) {
  if (!dev) return null
  return (
    <p className="m-0 text-caption text-muted-foreground">
      Sample data: <Link to={`/dashboards/${FIXTURE_ID}`}>open the fixture dashboard</Link>, which renders all eleven panel kinds from built-in data, or <Link to={`/dashboards/${FIXTURE_ID}`} search={{ empty: '' }}>the same with every query empty</Link>.
    </p>
  )
}
