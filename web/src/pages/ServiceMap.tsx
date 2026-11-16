import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Link } from '@/lib/router'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup } from '@/components/ui/input'
import { Table, Td, Tr, SortTh } from '@/components/ui/misc'
import { EmptyState, PageHeader, ServiceDot } from '@/components/ft/bits'
import { ERROR_THRESHOLD, useServiceDependencies, useServiceTable } from '@/data/services'
import { svcIndex } from '@/lib/otel'
import { useWindow } from '@/lib/window'
import { placementSearch, usePlacement } from '@/data/placement'
import { PlacementPicker } from '@/components/ft/Placement'
import { because } from '@/auth/client'
import { useSettled } from '@/lib/settle'
import { sorted, toggled, type Sorting } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import { Note, PagedFooter, Pill, Pills, SkeletonRows, Toolbar, usePaged } from './backend/kit'
import { edgeFirst, edgeValue, type EdgeKey } from './backend/sortKeys'
import { NodePanel } from './services/NodePanel'
import { neighbours } from './services/serviceView'

const SIZE = 560
const CENTER = SIZE / 2
const RADIUS = CENTER - 64

function layout(names: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  names.forEach((name, index) => {
    const angle = (index / Math.max(1, names.length)) * 2 * Math.PI - Math.PI / 2
    positions.set(name, { x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) })
  })
  return positions
}

function nodeRadius(calls: number, max: number): number {
  if (max <= 0) return 12
  return 11 + (calls / max) * 15
}

export function ServiceMap() {
  const { ms: windowMs, label } = useWindow()
  const [typedEnv, setTypedEnv] = useState('')
  const settledEnv = useSettled(typedEnv)
  const { placement, place } = usePlacement()
  const { edges, pending, failed } = useServiceDependencies(settledEnv, windowMs, placement)
  const kept = { ...(settledEnv.trim() ? { env: settledEnv.trim() } : {}), ...placementSearch(placement) }
  const markerId = useId()

  const names = useMemo(() => {
    const seen = new Set<string>()
    edges.forEach((edge) => { seen.add(edge.caller); seen.add(edge.callee) })
    return [...seen].sort()
  }, [edges])
  const positions = useMemo(() => layout(names), [names])
  const callsOf = useMemo(() => {
    const totals = new Map<string, number>()
    edges.forEach((edge) => {
      totals.set(edge.caller, (totals.get(edge.caller) ?? 0) + edge.calls)
      totals.set(edge.callee, (totals.get(edge.callee) ?? 0) + edge.calls)
    })
    return totals
  }, [edges])
  const maxCalls = Math.max(1, ...callsOf.values())
  const [sorting, setSorting] = useState<Sorting<EdgeKey> | null>({ key: 'calls', dir: 'desc' })
  const rows = useMemo(() => sorted(edges, sorting, edgeValue), [edges, sorting])
  const dirOf = (key: EdgeKey) => (sorting?.key === key ? sorting.dir : null)
  const sortBy = (key: EdgeKey) => setSorting(toggled(sorting, key, edgeFirst(key)))
  const paged = usePaged(rows, `${sorting?.key}|${sorting?.dir}`, 10)
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked !== null && names.includes(picked) ? picked : null
  const nodes = useRef(new Map<string, SVGGElement>())
  const { services } = useServiceTable(settledEnv, windowMs, placement)
  const around = useMemo(() => (selected === null ? null : neighbours(edges, selected)), [edges, selected])
  const close = () => {
    if (selected !== null) nodes.current.get(selected)?.focus()
    setPicked(null)
  }
  useEffect(() => {
    if (selected === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { nodes.current.get(selected)?.focus(); setPicked(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])
  const pressured = edges.filter((edge) => (edge.err ?? 0) >= ERROR_THRESHOLD).length

  return (
    <>
      <PageHeader title="Service map" meta={<Pills><Pill>{names.length} {names.length === 1 ? 'service' : 'services'}</Pill><Pill>{edges.length} call {edges.length === 1 ? 'path' : 'paths'}</Pill>{pressured > 0 ? <Pill tone="err">{pressured} above {ERROR_THRESHOLD} % errors</Pill> : null}<Pill>last {label}</Pill></Pills>} />
      <Toolbar role="search">
        <InputGroup className="w-[220px] max-w-full max-md:w-full"><input aria-label="Environment" placeholder="Environment, e.g. production" value={typedEnv} onChange={(e) => setTypedEnv(e.target.value)} /></InputGroup>
      </Toolbar>
      <PlacementPicker collapsible placement={placement} onChange={place} windowMs={windowMs} />
      {failed ? <EmptyState title="The dependency map could not be read">{because(failed, 'The span store did not answer')}</EmptyState> : null}
      {!failed && !pending && edges.length === 0 ? (
        <EmptyState title={settledEnv.trim() ? `No cross-service calls in ${settledEnv.trim()} in the last ${label}` : `No cross-service calls in the last ${label}`}>
          An edge appears once a server or consumer span's parent was recorded under a different service.name.
        </EmptyState>
      ) : null}
      {!failed && pending && edges.length === 0 ? <Card className="overflow-hidden"><SkeletonRows label="Reading the dependency map" /></Card> : null}
      {edges.length > 0 ? (
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_440px]">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Call graph</CardTitle><CardKind>Graph</CardKind></CardHeader>
          <figure className="m-0 flex min-w-0 flex-1 flex-col gap-2 p-3">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height={SIZE} role="group" aria-label={`Service dependency map, ${edges.length} call paths, last ${label}`} className="block overflow-visible">
              <defs>
                <marker id={`${markerId}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" />
                </marker>
              </defs>
              {rows.map((edge) => {
                const from = positions.get(edge.caller)
                const to = positions.get(edge.callee)
                if (!from || !to) return null
                const dx = to.x - from.x
                const dy = to.y - from.y
                const length = Math.hypot(dx, dy) || 1
                const toR = nodeRadius(callsOf.get(edge.callee) ?? 0, maxCalls) + 8
                const fromR = nodeRadius(callsOf.get(edge.caller) ?? 0, maxCalls) + 2
                const x1 = from.x + (dx / length) * fromR
                const y1 = from.y + (dy / length) * fromR
                const x2 = to.x - (dx / length) * toR
                const y2 = to.y - (dy / length) * toR
                const bad = (edge.err ?? 0) >= ERROR_THRESHOLD
                const width = Math.min(8, 1.5 + Math.log2(edge.calls + 1))
                const faded = selected !== null && edge.caller !== selected && edge.callee !== selected
                return (
                  <line
                    key={`${edge.caller}->${edge.callee}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={bad ? 'var(--destructive-text)' : 'var(--border)'}
                    strokeWidth={width}
                    strokeLinecap="round"
                    markerEnd={`url(#${markerId}-arrow)`}
                    className={cn(faded && 'opacity-30')}
                  >
                    <title>{`${edge.caller} → ${edge.callee}: ${edge.calls} calls${bad ? `, ${(edge.err ?? 0).toFixed(1)} % errors` : ''}`}</title>
                  </line>
                )
              })}
              {names.map((name) => {
                const at = positions.get(name)
                if (!at) return null
                const r = nodeRadius(callsOf.get(name) ?? 0, maxCalls)
                const on = selected === name
                return (
                  <g
                    key={name}
                    ref={(node) => { if (node) nodes.current.set(name, node); else nodes.current.delete(name) }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    aria-label={`${name}, show details`}
                    onClick={() => setPicked(on ? null : name)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(on ? null : name) } }}
                    className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-ring"
                  >
                    <circle cx={at.x} cy={at.y} r={r} fill={`var(--svc-${svcIndex(name)})`} stroke={on ? 'var(--foreground)' : 'var(--card)'} strokeWidth={on ? 3 : 2} />
                    <text x={at.x} y={at.y + r + 14} textAnchor="middle" className="fill-foreground text-[11px] font-mono font-semibold">{name}</text>
                  </g>
                )
              })}
            </svg>
          </figure>
          </Card>
          <div className="flex min-w-0 flex-col gap-3">
          {selected !== null && around ? <NodePanel name={selected} service={services.find((one) => one.name === selected)} callers={around.callers} callees={around.callees} kept={kept} label={label} onClose={close} /> : null}
          <Card className="min-w-0 overflow-hidden">
            <CardHeader><CardTitle>Dependencies</CardTitle><CardKind>Table</CardKind><span className="text-caption text-muted-foreground">{rows.length} call {rows.length === 1 ? 'path' : 'paths'}</span></CardHeader>
            <div className="overflow-x-auto">
            <Table aria-label="Dependencies">
              <thead><tr><SortTh label="Caller" dir={dirOf('caller')} onSort={() => sortBy('caller')} /><SortTh label="Callee" dir={dirOf('callee')} onSort={() => sortBy('callee')} /><SortTh label="Calls" numeric dir={dirOf('calls')} onSort={() => sortBy('calls')} className="w-[90px]" /><SortTh label="Error rate" numeric dir={dirOf('err')} onSort={() => sortBy('err')} className="w-[100px]" /></tr></thead>
              <tbody>
                {paged.shown.map((edge) => {
                  const bad = (edge.err ?? 0) >= ERROR_THRESHOLD
                  return (
                    <Tr key={`${edge.caller}->${edge.callee}`}>
                      <Td><Link to={`/services/${edge.caller}`} search={kept} className="inline-flex items-center gap-2 text-foreground no-underline"><ServiceDot name={edge.caller} /><span className="font-mono">{edge.caller}</span></Link></Td>
                      <Td><Link to={`/services/${edge.callee}`} search={kept} className="inline-flex items-center gap-2 text-foreground no-underline"><ServiceDot name={edge.callee} /><span className="font-mono">{edge.callee}</span></Link></Td>
                      <Td numeric>{edge.calls}</Td>
                      <Td numeric className={cn(bad && 'font-semibold text-warning-text')}>
                        <span className="inline-flex items-center gap-1">{bad ? <TriangleAlert className="size-3.5" aria-hidden /> : null}{edge.err === null ? '—' : `${edge.err.toFixed(1)} %`}</span>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
            </div>
            <PagedFooter paged={paged} noun="call paths" />
            <Note>Built from each span whose parent lives in another service. Highlighted from {ERROR_THRESHOLD} % errors, the status page threshold. Select a service on the map to see its figures.</Note>
          </Card>
          </div>
        </div>
      ) : null}
    </>
  )
}
