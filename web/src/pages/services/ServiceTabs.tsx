import { ScrollText, TriangleAlert, Waypoints } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { Link } from '@/lib/router'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { Table, Td, Tr } from '@/components/ui/misc'
import { SeverityBadge, ServiceDot } from '@/components/ft/bits'
import { ANY as ANY_LOGS, msOf, useLogs } from '@/data/logs'
import { ERROR_THRESHOLD, type Edge } from '@/data/services'
import { ANY as ANY_TRACES, useTraces } from '@/data/traces'
import type { Placement } from '@/data/placement'
import { because } from '@/auth/client'
import { num } from '@/lib/format'
import { toggled, sorted, type Sorting } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import { PagedFooter, SortHead, usePaged } from '../backend/kit'
import { edgeFirst, edgeValue, type EdgeKey } from '../backend/sortKeys'
import { TABS, logFirst, logValue, neighbours, serviceQuery, tabSearch, traceFirst, traceValue, type LogKey, type Tab, type TraceKey } from './serviceView'

const MESSAGE = 'm-0 px-3.5 py-3 text-control text-muted-foreground'

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

const clock = (ms: number) => {
  const at = new Date(ms)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(ms % 1000, 3)}`
}

export function ServiceTabStrip({ tab, service }: { tab: Tab; service: string }) {
  const goTo = useRouterNavigate()
  const open = (next: Tab) =>
    void goTo({
      to: '.' as never,
      search: ((was: Record<string, unknown>) => ({ ...was, tab: tabSearch(next) })) as never,
      replace: true,
    })
  const move = (at: number, key: string) => {
    const next = key === 'ArrowRight' ? (at + 1) % TABS.length : key === 'ArrowLeft' ? (at + TABS.length - 1) % TABS.length : key === 'Home' ? 0 : key === 'End' ? TABS.length - 1 : -1
    if (next < 0) return false
    open(TABS[next].id)
    document.getElementById(`service-tab-${TABS[next].id}`)?.focus()
    return true
  }
  return (
    <div role="tablist" aria-label={`${service} views`} className="flex gap-5 border-b">
      {TABS.map((one, at) => (
        <button
          key={one.id}
          type="button"
          role="tab"
          id={`service-tab-${one.id}`}
          aria-selected={tab === one.id}
          aria-controls={`service-panel-${one.id}`}
          tabIndex={tab === one.id ? 0 : -1}
          onClick={() => open(one.id)}
          onKeyDown={(e) => { if (move(at, e.key)) e.preventDefault() }}
          className={cn('relative flex h-10 shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-control font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', tab === one.id && 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary')}
        >
          {one.label}
        </button>
      ))}
    </div>
  )
}

export function ServicePanel({ id, children }: { id: Tab; children: React.ReactNode }) {
  return <div role="tabpanel" id={`service-panel-${id}`} aria-labelledby={`service-tab-${id}`} className="flex flex-col gap-3">{children}</div>
}

export function ServiceTraces({ name, windowMs, label, placement, where }: { name: string; windowMs: number; label: string; placement: Placement; where: Record<string, string> }) {
  const sift = useMemo(() => ({ ...ANY_TRACES, rangeMs: windowMs, service: name, limit: 50 }), [windowMs, name])
  const { rows, loading, failed } = useTraces(sift, placement)
  const [sorting, setSorting] = useState<Sorting<TraceKey> | null>(null)
  const ordered = useMemo(() => sorted(rows, sorting, traceValue), [rows, sorting])
  const paged = usePaged(ordered, `${name}|${sorting?.key}|${sorting?.dir}`, 10)
  const dirOf = (key: TraceKey) => (sorting?.key === key ? sorting.dir : null)
  const sortBy = (key: TraceKey) => setSorting(toggled(sorting, key, traceFirst(key)))
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Recent traces</CardTitle><CardKind>Table</CardKind>
        <span className="text-caption text-muted-foreground">rooted in {name}, last {label}</span>
        <span className="flex-1" />
        <Button asChild size="sm" variant="outline"><Link to="/traces" search={{ ...where, q: serviceQuery(name) }}><Waypoints />Open in Traces</Link></Button>
      </CardHeader>
      {failed ? <p className={MESSAGE}>{because(failed, 'The traces could not be read.')}</p> : null}
      {!failed && loading && rows.length === 0 ? <p role="status" className={MESSAGE}>Reading the traces…</p> : null}
      {!failed && !loading && rows.length === 0 ? <p className={MESSAGE}>No trace rooted in {name} in the last {label}.</p> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <Table aria-label={`Recent traces of ${name}`}>
            <thead>
              <tr>
                <SortHead label="Root span" dir={dirOf('root')} onSort={() => sortBy('root')} />
                <SortHead label="Status" numeric dir={dirOf('code')} onSort={() => sortBy('code')} className="w-[90px]" />
                <SortHead label="Started" dir={dirOf('started')} onSort={() => sortBy('started')} className="w-[130px]" />
                <SortHead label="Duration" numeric dir={dirOf('duration')} onSort={() => sortBy('duration')} className="w-[100px]" />
                <SortHead label="Spans" numeric dir={dirOf('spans')} onSort={() => sortBy('spans')} className="w-[80px]" />
                <SortHead label="Errors" numeric dir={dirOf('errors')} onSort={() => sortBy('errors')} className="w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {paged.shown.map((trace) => (
                <Tr key={trace.id}>
                  <Td className="max-w-[420px] truncate"><Link to={`/traces/${trace.id}`} className="font-mono font-semibold text-foreground">{trace.root || trace.id}</Link></Td>
                  <Td numeric>{trace.code ?? '—'}</Td>
                  <Td className="font-mono text-control">{trace.start}</Td>
                  <Td numeric>{trace.dur}</Td>
                  <Td numeric>{trace.spans}</Td>
                  <Td numeric className={cn(trace.errors > 0 && 'font-semibold text-destructive-text')}>{trace.errors}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : null}
      <PagedFooter paged={paged} noun="traces" />
    </Card>
  )
}

export function ServiceLogs({ name, windowMs, label, placement, where }: { name: string; windowMs: number; label: string; placement: Placement; where: Record<string, string> }) {
  const query = useMemo(() => ({ ...ANY_LOGS, rangeMs: windowMs, services: [name], limit: 50 }), [windowMs, name])
  const { records, loading, failed } = useLogs(query, false, placement)
  const [sorting, setSorting] = useState<Sorting<LogKey> | null>(null)
  const ordered = useMemo(() => sorted(records, sorting, logValue), [records, sorting])
  const paged = usePaged(ordered, `${name}|${sorting?.key}|${sorting?.dir}`, 10)
  const dirOf = (key: LogKey) => (sorting?.key === key ? sorting.dir : null)
  const sortBy = (key: LogKey) => setSorting(toggled(sorting, key, logFirst(key)))
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Recent logs</CardTitle><CardKind>Table</CardKind>
        <span className="text-caption text-muted-foreground">from {name}, last {label}</span>
        <span className="flex-1" />
        <Button asChild size="sm" variant="outline"><Link to="/logs" search={{ ...where, q: serviceQuery(name) }}><ScrollText />Open in Logs</Link></Button>
      </CardHeader>
      {failed ? <p className={MESSAGE}>{because(failed, 'The logs could not be read.')}</p> : null}
      {!failed && loading && records.length === 0 ? <p role="status" className={MESSAGE}>Reading the logs…</p> : null}
      {!failed && !loading && records.length === 0 ? <p className={MESSAGE}>No log record from {name} in the last {label}.</p> : null}
      {records.length > 0 ? (
        <div className="overflow-x-auto">
          <Table aria-label={`Recent logs of ${name}`}>
            <thead>
              <tr>
                <SortHead label="Time" dir={dirOf('time')} onSort={() => sortBy('time')} className="w-[130px]" />
                <SortHead label="Severity" dir={dirOf('severity')} onSort={() => sortBy('severity')} className="w-[100px]" />
                <SortHead label="Message" dir={dirOf('body')} onSort={() => sortBy('body')} />
              </tr>
            </thead>
            <tbody>
              {paged.shown.map((record) => (
                <Tr key={`${record.time_ns}:${record.observed_ns}:${record.span_id ?? ''}:${record.body}`}>
                  <Td className="font-mono text-caption text-muted-foreground"><time dateTime={new Date(msOf(record.time_ns)).toISOString()}>{clock(msOf(record.time_ns))}</time></Td>
                  <Td><SeverityBadge level={record.severity} /></Td>
                  <Td className={cn('max-w-[640px] truncate font-mono text-[12.5px]', (record.severity === 'error' || record.severity === 'fatal') && 'text-destructive-text')} title={record.body}>
                    {record.trace_id ? <Link to={`/traces/${record.trace_id}`} className="text-inherit no-underline hover:underline">{record.body}</Link> : record.body}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : null}
      <PagedFooter paged={paged} noun="records" />
    </Card>
  )
}

function Neighbours({ title, hint, edges, side, kept, pending }: { title: string; hint: string; edges: Edge[]; side: 'caller' | 'callee'; kept: Record<string, string>; pending: boolean }) {
  const [sorting, setSorting] = useState<Sorting<EdgeKey> | null>({ key: 'calls', dir: 'desc' })
  const ordered = useMemo(() => sorted(edges, sorting, edgeValue), [edges, sorting])
  const dirOf = (key: EdgeKey) => (sorting?.key === key ? sorting.dir : null)
  const sortBy = (key: EdgeKey) => setSorting(toggled(sorting, key, edgeFirst(key)))
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader><CardTitle>{title}</CardTitle><CardKind>Table</CardKind><span className="text-caption text-muted-foreground">{hint}</span></CardHeader>
      {edges.length === 0 ? <p className={MESSAGE}>{pending ? 'Reading the dependency map…' : side === 'caller' ? 'No service calls this one.' : 'This service calls no other service.'}</p> : (
        <div className="overflow-x-auto">
          <Table aria-label={title}>
            <thead>
              <tr>
                <SortHead label="Service" dir={dirOf(side)} onSort={() => sortBy(side)} />
                <SortHead label="Calls" numeric dir={dirOf('calls')} onSort={() => sortBy('calls')} className="w-[90px]" />
                <SortHead label="Errors" numeric dir={dirOf('errors')} onSort={() => sortBy('errors')} className="w-[80px]" />
                <SortHead label="Error rate" numeric dir={dirOf('err')} onSort={() => sortBy('err')} className="w-[100px]" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((edge) => {
                const other = edge[side]
                const bad = (edge.err ?? 0) >= ERROR_THRESHOLD
                return (
                  <Tr key={`${edge.caller}->${edge.callee}`}>
                    <Td><Link to={`/services/${other}`} search={kept} className="inline-flex items-center gap-2 text-foreground no-underline"><ServiceDot name={other} /><span className="font-mono">{other}</span></Link></Td>
                    <Td numeric>{num(edge.calls)}</Td>
                    <Td numeric>{num(edge.errors)}</Td>
                    <Td numeric className={cn(bad && 'font-semibold text-warning-text')}><span className="inline-flex items-center gap-1">{bad ? <TriangleAlert className="size-3.5" aria-hidden /> : null}{edge.err === null ? '—' : `${edge.err.toFixed(1)} %`}</span></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}

export function ServiceDependencies({ name, label, edges, pending, failed, kept, where }: { name: string; label: string; edges: Edge[]; pending: boolean; failed: unknown; kept: Record<string, string>; where: Record<string, string> }) {
  const { callers, callees } = useMemo(() => neighbours(edges, name), [edges, name])
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">Direct callers and callees of {name} in the last {label}.</span>
        <span className="flex-1" />
        <Button asChild size="sm" variant="outline"><Link to="/traces" search={{ ...where, q: serviceQuery(name) }}><Waypoints />Open in Traces</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to="/logs" search={{ ...where, q: serviceQuery(name) }}><ScrollText />Open in Logs</Link></Button>
      </div>
      {failed ? <p className={MESSAGE}>{because(failed, 'The dependency graph could not be read.')}</p> : (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <Neighbours title="Called by" hint={`if ${name} breaks, these feel it`} edges={callers} side="caller" kept={kept} pending={pending} />
          <Neighbours title="Depends on" hint={`if these break, ${name} feels it`} edges={callees} side="callee" kept={kept} pending={pending} />
        </div>
      )}
    </>
  )
}
