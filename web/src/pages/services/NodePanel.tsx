import { TriangleAlert, X } from 'lucide-react'
import { Link } from '@/lib/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { ServiceDot } from '@/components/ft/bits'
import { ERROR_THRESHOLD, type Edge, type Service } from '@/data/services'
import { num } from '@/lib/format'
import { cn } from '@/lib/utils'

const percent = (rate: number | null) => (rate === null ? '—' : `${rate.toFixed(1)} %`)

function Figure({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-control text-muted-foreground">{label}</dt>
      <dd className={cn('m-0 font-mono text-control tabular', hot && 'font-semibold text-warning-text')}>{value}</dd>
    </div>
  )
}

function Others({ title, edges, side, kept }: { title: string; edges: Edge[]; side: 'caller' | 'callee'; kept: Record<string, string> }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="m-0 text-caption font-semibold text-muted-foreground">{title}</h3>
      {edges.length === 0 ? <p className="m-0 text-control text-muted-foreground">{side === 'caller' ? 'Nothing calls it.' : 'It calls nothing else.'}</p> : (
        <ul className="m-0 flex list-none flex-col p-0">
          {edges.map((edge) => {
            const other = edge[side]
            const bad = (edge.err ?? 0) >= ERROR_THRESHOLD
            return (
              <li key={`${edge.caller}->${edge.callee}`} className="flex items-center justify-between gap-2 py-1">
                <Link to={`/services/${other}`} search={kept} className="inline-flex min-w-0 items-center gap-2 truncate font-mono text-control"><ServiceDot name={other} />{other}</Link>
                <span className={cn('shrink-0 font-mono text-caption text-muted-foreground', bad && 'font-semibold text-warning-text')}>{num(edge.calls)} calls · {percent(edge.err)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function NodePanel({ name, service, callers, callees, kept, label, onClose }: { name: string; service: Service | undefined; callers: Edge[]; callees: Edge[]; kept: Record<string, string>; label: string; onClose: () => void }) {
  const bad = (service?.err ?? 0) >= ERROR_THRESHOLD
  return (
    <Card aria-label={`${name} details`} className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="inline-flex min-w-0 items-center gap-2"><ServiceDot name={name} /><span className="truncate font-mono">{name}</span></CardTitle>
        <CardKind>Service</CardKind>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" aria-label="Close the service panel" onClick={onClose}><X /></Button>
      </CardHeader>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        {service ? (
          <>
            {bad ? <Badge variant="warning" className="w-fit"><TriangleAlert />Error rate above {ERROR_THRESHOLD} %</Badge> : null}
            <dl className="m-0 flex flex-col">
              <Figure label="Requests" value={num(service.requests)} />
              <Figure label="Error rate" value={percent(service.err)} hot={bad} />
              <Figure label="p95" value={service.p95} />
            </dl>
          </>
        ) : <p className="m-0 text-control text-muted-foreground">No span of {name} was counted in the last {label}.</p>}
        <Others title="Called by" edges={callers} side="caller" kept={kept} />
        <Others title="Depends on" edges={callees} side="callee" kept={kept} />
        <Button asChild variant="primary"><Link to={`/services/${name}`} search={kept}>Open service</Link></Button>
      </div>
    </Card>
  )
}
