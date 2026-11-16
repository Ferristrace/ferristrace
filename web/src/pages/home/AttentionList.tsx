import { CircleX, Info, TriangleAlert } from 'lucide-react'
import { SafeLink } from '@/components/ft/panels/SafeLink'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { since } from '@/data/services'
import { cn } from '@/lib/utils'
import { KIND_LABEL, KIND_PLURAL, SEVERITY_LABEL, linkOf, listed, type Item, type Severity, type Status } from './attention'
import { listOf } from './StatusLine'

const MARK: Record<Severity, { variant: 'destructive' | 'warning' | 'neutral'; Icon: typeof Info }> = {
  critical: { variant: 'destructive', Icon: CircleX },
  warning: { variant: 'warning', Icon: TriangleAlert },
  info: { variant: 'neutral', Icon: Info },
}

function Row({ item }: { item: Item }) {
  const { variant, Icon } = MARK[item.severity]
  const main = linkOf(item.to)
  const evidence = item.evidence ? linkOf(item.evidence.to) : null
  return (
    <li className="relative flex flex-col gap-1 border-b border-border-subtle px-3.5 py-3 last:border-b-0 hover:bg-row-hover">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={variant}><Icon aria-hidden />{SEVERITY_LABEL[item.severity]}</Badge>
        <span className="text-caption text-muted-foreground">{KIND_LABEL[item.kind]}</span>
        {item.since === null ? null : <span className="ml-auto text-caption text-muted-foreground">{since(item.since)}</span>}
      </div>
      <SafeLink
        to={main.path}
        search={main.search}
        className={cn('w-fit max-w-full break-words text-body font-semibold text-foreground no-underline after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring', (item.kind === 'service' || item.kind === 'silent') && 'font-mono')}
      >
        {item.title}
      </SafeLink>
      <p className="m-0 break-words text-control font-normal text-muted-foreground">{item.detail}</p>
      {evidence && item.evidence ? (
        <SafeLink to={evidence.path} search={evidence.search} aria-label={`${item.evidence.label}: ${item.title}`} className="relative z-10 inline-flex w-fit items-center text-control text-accent-text max-md:min-h-11">
          {item.evidence.label}
        </SafeLink>
      ) : null}
    </li>
  )
}

function Empty({ status, missing }: { status: Status; missing: string[] }) {
  if (missing.length) return <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">Could not check {listOf(missing)}, so this list may be incomplete.</p>
  if (status.kind === 'partial') return <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">The {listOf(status.names)} list was truncated, so this list may be incomplete.</p>
  if (status.kind === 'checking') return <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">Checking…</p>
  if (status.kind === 'nodata') return <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">No data to check. Nothing else is open.</p>
  return <p className="m-0 px-3.5 py-3 text-control text-muted-foreground">No open incident, firing alert, failing service, new issue or unhealthy pod.</p>
}

export function Attention({ items, status, missing }: { items: Item[]; status: Status; missing: string[] }) {
  const { shown, more, to, kind } = listed(items)
  const rest = to ? linkOf(to) : null
  const worst = items.some((item) => item.severity === 'critical') ? 'destructive' : items.some((item) => item.severity === 'warning') ? 'warning' : 'neutral'
  return (
    <section aria-labelledby="home-attention" className="min-w-0">
      <Card className="flex flex-col overflow-hidden">
        <CardHeader>
          <CardTitle id="home-attention">Needs attention</CardTitle>
          {items.length ? <Badge variant={worst} mono className="rounded-full px-2">{items.length}</Badge> : null}
        </CardHeader>
        {shown.length ? (
          <>
            <ol className="m-0 flex list-none flex-col p-0">{shown.map((item) => <Row key={item.id} item={item} />)}</ol>
            {more > 0 && rest ? (
              <SafeLink to={rest.path} search={rest.search} className="flex items-center border-t border-border-subtle px-3.5 py-3 text-control text-accent-text max-md:min-h-11">
                and {more} more{kind ? `, mostly ${KIND_PLURAL[kind]}` : ''}
              </SafeLink>
            ) : null}
            {missing.length ? <p className="m-0 border-t border-border-subtle px-3.5 py-3 text-control text-muted-foreground">Could not check {listOf(missing)}, so this list may be incomplete.</p> : null}
          </>
        ) : (
          <Empty status={status} missing={missing} />
        )}
      </Card>
    </section>
  )
}
