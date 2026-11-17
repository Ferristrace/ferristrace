import { SafeLink } from '@/components/ft/panels/SafeLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { stamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { KIND_PLURAL, SEVERITY_LABEL, linkOf, listed, type Item, type Severity, type Status } from './attention'
import { actionOf, extraOf, timeOf } from './hub'
import { StatusLine, listOf, type Checked } from './StatusLine'

const CHIP: Record<Severity, string> = {
  critical: 'border-destructive-border bg-destructive-subtle text-destructive-text',
  warning: 'border-warning-border bg-warning-subtle text-warning-text',
  info: 'border-transparent bg-muted text-muted-foreground',
}

const footer = 'm-0 border-t border-border-subtle px-3.5 py-3 text-control text-muted-foreground'

function Row({ item, now }: { item: Item; now: number }) {
  const main = linkOf(item.to)
  const action = actionOf(item)
  const act = linkOf(action.to)
  const extra = extraOf(item)
  const more = extra ? linkOf(extra.to) : null
  const time = timeOf(item, now)
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3.5 py-2 last:border-b-0 hover:bg-row-hover max-md:py-3">
      <span className={cn('inline-flex h-[22px] shrink-0 items-center rounded-full border px-[9px] text-caption font-medium', CHIP[item.severity])}>{SEVERITY_LABEL[item.severity]}</span>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col">
        <SafeLink to={main.path} search={main.search} className="w-fit max-w-full break-words font-semibold text-foreground no-underline hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {item.title}
        </SafeLink>
        <span className="break-words text-muted-foreground">
          {item.detail}
          {extra && more ? (
            <>
              {' '}
              <SafeLink to={more.path} search={more.search} aria-label={`${extra.label}: ${item.title}`} className="whitespace-nowrap text-accent-text no-underline hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                {extra.label}
              </SafeLink>
            </>
          ) : null}
        </span>
      </div>
      {time === null ? null : (
        <span className="whitespace-nowrap font-mono text-caption text-faint-foreground" title={item.since === null ? undefined : stamp(item.since)}>
          {time}
        </span>
      )}
      <Button asChild className="h-[34px] bg-card px-3.5 max-md:min-h-11">
        <SafeLink to={act.path} search={act.search} aria-label={`${action.label}: ${item.title}`}>{action.label}</SafeLink>
      </Button>
    </li>
  )
}

export function Attention({ items, status, missing, notes = [], checked, now, className }: { items: Item[]; status: Status; missing: string[]; notes?: string[]; checked: Checked; now: number; className?: string }) {
  const { shown, more, to, kind } = listed(items)
  const rest = to ? linkOf(to) : null
  const worst = items.some((item) => item.severity === 'critical') ? 'destructive' : items.some((item) => item.severity === 'warning') ? 'warning' : 'neutral'
  return (
    <section aria-labelledby="home-attention" className={cn('min-w-0', className)}>
      <Card className="flex h-full flex-col overflow-hidden rounded-sm">
        <CardHeader className="gap-2">
          <CardTitle id="home-attention">Needs attention</CardTitle>
          {items.length ? (
            <Badge variant={worst} className="rounded-full border-transparent px-2 font-medium tabular" aria-hidden>
              {items.length}
            </Badge>
          ) : null}
        </CardHeader>
        {shown.length ? (
          <>
            <span role="status" className="sr-only">{items.length === 1 ? '1 thing needs attention' : `${items.length} things need attention`}</span>
            <ol className="m-0 flex list-none flex-col p-0">{shown.map((item) => <Row key={item.id} item={item} now={now} />)}</ol>
            {more > 0 && rest ? (
              <SafeLink to={rest.path} search={rest.search} className="flex items-center border-t border-border-subtle px-3.5 py-3 text-control text-accent-text max-md:min-h-11">
                and {more} more{kind ? `, mostly ${KIND_PLURAL[kind]}` : ''}
              </SafeLink>
            ) : null}
            {missing.length ? <p className={footer}>Could not check {listOf(missing)}, so this list may be incomplete.</p> : null}
          </>
        ) : (
          <StatusLine status={status} checked={checked} missing={missing} now={now} />
        )}
        {notes.map((note) => <p key={note} className={footer}>{note}</p>)}
      </Card>
    </section>
  )
}
