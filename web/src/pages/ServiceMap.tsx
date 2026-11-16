import { useId, useMemo, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Link } from '@/lib/router'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup } from '@/components/ui/input'
import { Table, Td, Th, Tr } from '@/components/ui/misc'
import { EmptyState, PageHeader, ServiceDot } from '@/components/ft/bits'
import { ERROR_THRESHOLD, useServiceDependencies } from '@/data/services'
import { svcIndex } from '@/lib/otel'
import { useWindow } from '@/lib/window'
import { placementSearch, usePlacement } from '@/data/placement'
import { PlacementPicker } from '@/components/ft/Placement'
import { because } from '@/auth/client'
import { useSettled } from '@/lib/settle'
import { cn } from '@/lib/utils'
import { Note, PagedFooter, Pill, Pills, SkeletonRows, Toolbar, usePaged } from './backend/kit'

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
  const rows = useMemo(() => [...edges].sort((a, b) => b.calls - a.calls), [edges])
  const paged = usePaged(rows, '', 10)
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
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height={SIZE} role="img" aria-label={`Service dependency map, ${edges.length} call paths, last ${label}`} className="block overflow-visible">
              <defs>
                <marker id={`${markerId}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
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
                return (
                  <line
                    key={`${edge.caller}->${edge.callee}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={bad ? 'var(--destructive-text)' : 'var(--border)'}
                    strokeWidth={width}
                    strokeLinecap="round"
                    markerEnd={`url(#${markerId}-arrow)`}
                  >
                    <title>{`${edge.caller} → ${edge.callee}: ${edge.calls} calls${bad ? `, ${(edge.err ?? 0).toFixed(1)} % errors` : ''}`}</title>
                  </line>
                )
              })}
              {names.map((name) => {
                const at = positions.get(name)
                if (!at) return null
                const r = nodeRadius(callsOf.get(name) ?? 0, maxCalls)
                return (
                  <g key={name}>
                    <circle cx={at.x} cy={at.y} r={r} fill={`var(--svc-${svcIndex(name)})`} stroke="var(--card)" strokeWidth="2" />
                    <text x={at.x} y={at.y + r + 14} textAnchor="middle" className="fill-foreground text-[11px] font-mono font-semibold">{name}</text>
                  </g>
                )
              })}
            </svg>
          </figure>
          </Card>
          <Card className="min-w-0 overflow-hidden">
            <CardHeader><CardTitle>Dependencies</CardTitle><CardKind>Table</CardKind><span className="text-caption text-muted-foreground">{rows.length} call {rows.length === 1 ? 'path' : 'paths'}</span></CardHeader>
            <div className="overflow-x-auto">
            <Table aria-label="Dependencies">
              <thead><tr><Th>Caller</Th><Th>Callee</Th><Th numeric className="w-[90px]">Calls</Th><Th numeric className="w-[100px]">Error rate</Th></tr></thead>
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
            <Note>Built from each span whose parent lives in another service. Highlighted from {ERROR_THRESHOLD} % errors, the status page threshold.</Note>
          </Card>
        </div>
      ) : null}
    </>
  )
}
